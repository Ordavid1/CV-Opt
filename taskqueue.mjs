// taskqueue.mjs
import { CloudTasksClient } from '@google-cloud/tasks';
import winston from 'winston';

const IS_LOCAL = process.env.NODE_ENV !== 'production';


const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Initialize Cloud Tasks client
const tasksClient = new CloudTasksClient();

// Configuration
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'vaulted-bivouac-417511';
const LOCATION = 'us-east1';
const QUEUE_NAME = 'cv-refinement-queue';
const SERVICE_URL = process.env.APP_URL;

if (!SERVICE_URL) {
  logger.error('APP_URL environment variable is not set!');
  
  // Only use localhost as fallback in development
  if (process.env.NODE_ENV === 'development') {
    const fallbackUrl = 'http://localhost:8080';
    logger.warn(`Using development fallback URL: ${fallbackUrl}`);
    SERVICE_URL = fallbackUrl;
  } else {
    throw new Error('APP_URL must be set in production environment');
  }
}

logger.info(`Task queue will send requests to: ${SERVICE_URL}`);

export async function createQueue() {
  const parent = tasksClient.locationPath(PROJECT_ID, LOCATION);
  const queue = {
    name: tasksClient.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME),
    rateLimits: {
      maxDispatchesPerSecond: 10,
      maxConcurrentDispatches: 5,
    },
    retryConfig: {
      maxAttempts: 3,
      maxBackoff: { seconds: 300 },
      minBackoff: { seconds: 60 },
    },
  };

  try {
    await tasksClient.createQueue({ parent, queue });
    logger.info(`Created queue ${QUEUE_NAME}`);
  } catch (error) {
    if (error.code === 6) { // Already exists
      logger.info(`Queue ${QUEUE_NAME} already exists`);
    } else {
      logger.error('Error creating queue:', error);
      throw error;
    }
  }
}

export async function enqueueRefinementJob(jobData) {
      // For local development, process directly instead of using Cloud Tasks
  if (IS_LOCAL) {
    logger.info(`Local development: Processing refinement directly for job ${jobData.jobId}`);
    console.warn('Running in local mode, not using Cloud Tasks. This is for development only.');
    
    // Import and call processRefinementAsync directly
    const { processRefinementAsync } = await import('./index.mjs');
    
    // Process in background (fire and forget for local dev)
    processRefinementAsync(jobData, logger)
      .then(result => {
        logger.info(`✅ Local refinement completed for job ${jobData.jobId}`);
      })
      .catch(err => {
        logger.error(`❌ Local refinement failed for job ${jobData.jobId}:`, err);
      });
    
    // Return a fake task name
    return `local-task-${jobData.jobId}`;
  }

    // For production, enqueue the job in Cloud Tasks
  const parent = tasksClient.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME);
  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: `${SERVICE_URL}/api/process-refinement-task`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: Buffer.from(JSON.stringify({
        ...jobData,
        taskId: `task-${Date.now()}-${Math.random().toString(36).substring(2)}`
      })).toString('base64'),
    },
    // Schedule to run immediately
    scheduleTime: {
      seconds: Math.floor(Date.now() / 1000),
    },
  };

  try {
    const [response] = await tasksClient.createTask({ parent, task });
    logger.info(`Created task ${response.name} for job ${jobData.jobId}`);
    return response.name;
  } catch (error) {
    logger.error('Error creating task:', error);
    throw error;
  }
}

// Initialize queue on module load
createQueue().catch(err => {
  logger.error('Failed to create queue:', err);
});