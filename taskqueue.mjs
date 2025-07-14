// taskqueue.mjs
import { CloudTasksClient } from '@google-cloud/tasks';
import winston from 'winston';
import fetch from 'node-fetch'; // Add this import for development mode

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Environment detection
const IS_LOCAL = process.env.NODE_ENV !== 'production';
const ENABLE_CLOUD_TASKS = IS_LOCAL ? (process.env.ENABLE_CLOUD_TASKS === 'true') : true;
logger.info(`Task Queue Configuration: IS_LOCAL=${IS_LOCAL}, ENABLE_CLOUD_TASKS=${ENABLE_CLOUD_TASKS}`);

// Initialize Cloud Tasks client
const tasksClient = new CloudTasksClient();

// Configuration
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'vaulted-bivouac-417511';
const LOCATION = 'us-east1';
const QUEUE_NAME = 'cv-refinement-queue';
let SERVICE_URL = process.env.APP_URL;

if (!SERVICE_URL) {
  // Only allow missing APP_URL in local development
  if (IS_LOCAL) {
    SERVICE_URL = 'http://localhost:8080';
    logger.warn(`APP_URL not set, using development fallback: ${SERVICE_URL}`);
  } else {
    logger.error('FATAL: APP_URL environment variable is not set in production!');
    throw new Error('APP_URL must be set in production environment');
  }
}

logger.info(`Task queue will send requests to: ${SERVICE_URL}`);

export async function createQueue() {
  // Skip queue creation in local development
  if (IS_LOCAL && process.env.ENABLE_CLOUD_TASKS !== 'true') {
    logger.info('Skipping Cloud Tasks queue creation in local environment');
    return;
  }
  
  const parent = tasksClient.locationPath(PROJECT_ID, LOCATION);
  const queue = {
    name: tasksClient.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME),
    rateLimits: {
      maxDispatchesPerSecond: 10,
      maxConcurrentDispatches: 5,
    },
    retryConfig: {
      maxAttempts: 3,
      maxRetryDuration: { seconds: 3600 }, // 1 hour max
      minBackoff: { seconds: 60 },
      maxBackoff: { seconds: 300 },
      maxDoublings: 3,
    },
  };

  try {
    await tasksClient.createQueue({ parent, queue });
    logger.info(`Created queue ${QUEUE_NAME}`);
  } catch (error) {
    if (error.code === 6) { // Already exists
      logger.info(`Queue ${QUEUE_NAME} already exists`);
    } else if (error.code === 7) { // Permission denied
      logger.error('Permission denied creating queue - check service account permissions');
      throw error;
    } else {
      logger.error('Error creating queue:', error);
      throw error;
    }
  }
}

export async function enqueueRefinementJob(jobData) {
  // Use IS_LOCAL instead of isDevelopment
if (IS_LOCAL && !process.env.ENABLE_CLOUD_TASKS) {
  logger.info('Running locally - processing synchronously');
  
  try {
    // Update status to processing FIRST
    if (jobData.jobId) {
      const { setJobData, getJobData } = await import('./storage.mjs');
      const existingData = await getJobData(jobData.jobId) || {};
      await setJobData(jobData.jobId, {
        ...existingData,
        status: 'processing',
        processingStartedAt: new Date().toISOString()
      });
    }
    
    // Make a direct HTTP call to simulate task processing
    const response = await fetch(`${SERVICE_URL}/api/process-refinement-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CloudTasks-TaskName': `local-task-${Date.now()}`
      },
      body: JSON.stringify({
        ...jobData,
        taskId: `local-task-${Date.now()}-${Math.random().toString(36).substring(2)}`
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to process task: ${response.status} - ${errorText}`);
    }
    
    logger.info(`Local task processed successfully for job ${jobData.jobId}`);
    return `local-task-${jobData.jobId}`;
    
  } catch (error) {
    logger.error('Failed to process local task:', error);
    
    // Update status to failed
    if (jobData.jobId) {
      const { setJobData, getJobData } = await import('./storage.mjs');
      const existingData = await getJobData(jobData.jobId) || {};
      await setJobData(jobData.jobId, {
        ...existingData,
        status: 'failed',
        error: error.message,
        failedAt: new Date().toISOString()
      });
    }
    
    throw error;
  }
}
  
  // Production mode - use Cloud Tasks
  try {
    const parent = tasksClient.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME);
    
    // Generate unique task ID
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    
    // Prepare task configuration
    const task = {
      httpRequest: {
        httpMethod: 'POST',
        url: `${SERVICE_URL}/api/process-refinement-task`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify({
          ...jobData,
          taskId: taskId,
          enqueuedAt: new Date().toISOString()
        })).toString('base64'),
      },
      // Add OIDC token for Cloud Run authentication
      oidcToken: {
        serviceAccountEmail: `cv-opt@${PROJECT_ID}.iam.gserviceaccount.com`,
        audience: SERVICE_URL,
      },
      // Schedule to run immediately
      scheduleTime: {
        seconds: Math.floor(Date.now() / 1000),
      },
    };
    
    // Create the task
    logger.info(`Creating Cloud Task for job ${jobData.jobId}`);
    const [response] = await tasksClient.createTask({ parent, task });
    
    logger.info(`✅ Created task ${response.name} for job ${jobData.jobId}`);
    
    // Return the task name for tracking
    return response.name;
    
  } catch (error) {
    logger.error(`❌ Error creating Cloud Task for job ${jobData.jobId}:`, error);
    
    // Check for specific error types
    if (error.code === 3) {
      logger.error('Invalid argument error - check task configuration');
    } else if (error.code === 7) {
      logger.error('Permission denied - check service account permissions');
    } else if (error.code === 9) {
      logger.error('Queue is full or task already exists');
    }
    
    // Re-throw the error to be handled by the caller
    throw error;
  }
}

// Initialize queue on module load
if (!IS_LOCAL || process.env.ENABLE_CLOUD_TASKS === 'true') {
  createQueue().catch(err => {
    logger.error('Failed to create queue:', err);
  });
} else {
  logger.info('Cloud Tasks disabled in local environment');
}