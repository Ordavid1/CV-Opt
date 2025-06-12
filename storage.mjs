// Modified storage.mjs with in-memory option for Cloud Run
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Storage } from '@google-cloud/storage';

import winston from 'winston';

// Create logger for storage module
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
  ),
  transports: [new winston.transports.Console()]
});

export const jobDataStorage = new Map();
export const freePassUsage = new Map(); // For in-memory tracking
export const userCreditsStorage = new Map();

// In-memory storage for free pass users (for Cloud Run)
let inMemoryFreePassUsers = [];

// Get directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FREE_PASS_FILE = path.join(__dirname, 'data', 'free-passes.json');
const FREE_PASS_USERS_FILE = path.join(__dirname, 'data', 'free-pass-users.json');
const CREDITS_FILE = path.join(__dirname, 'data', 'user-credits.json');

// Storage type from environment variable, default to cloud-storage if STORAGE_BUCKET env var is provided
const DATA_STORAGE_TYPE = process.env.DATA_STORAGE_TYPE || (process.env.STORAGE_BUCKET ? 'cloud-storage' : 'memory');

// Initialize Google Cloud Storage
const storage = new Storage();
const bucketName = process.env.STORAGE_BUCKET || 'cv-opt-user-data';
let bucket;

// Log the storage type on startup
console.log(`Free pass user data storage type: ${DATA_STORAGE_TYPE}`);

// Initialize bucket
async function initBucket() {
  try {
    bucket = storage.bucket(bucketName);
    // Check if bucket exists, create if not
    const [exists] = await bucket.exists();
    if (!exists && process.env.NODE_ENV === 'production') {
      await storage.createBucket(bucketName);
      console.log(`Bucket ${bucketName} created.`);
    }
    console.log(`Cloud Storage bucket initialized: ${bucketName}`);
  } catch (error) {
    console.error('Error initializing bucket:', error);
  }
}

// Enhanced job storage functions that respect DATA_STORAGE_TYPE
export async function setJobData(jobId, data) {
  // Always store in memory for fast access
  jobDataStorage.set(jobId, data);
  // Persist to Cloud Storage if bucket is initialized
  if (bucket) {
    try {
      const file = bucket.file(`jobs/${jobId}.json`);
      await file.save(JSON.stringify(data), {
        contentType: 'application/json',
      });
      console.log(`Job data persisted to Cloud Storage: ${jobId}`);
    } catch (error) {
      console.error(`Error saving job data to Cloud Storage: ${error.message}`);
    }
  }
}

export async function getJobData(jobId) {
  // Try memory first
  let data = jobDataStorage.get(jobId);
  // If not in memory and bucket is available, try to load it
  if (!data && bucket) {
    try {
      const file = bucket.file(`jobs/${jobId}.json`);
      const [exists] = await file.exists();
      if (exists) {
        const [content] = await file.download();
        data = JSON.parse(content.toString());
        jobDataStorage.set(jobId, data);
        console.log(`Job data loaded from Cloud Storage: ${jobId}`);
      }
    } catch (error) {
      console.error(`Error loading job data from Cloud Storage: ${error.message}`);
    }
  }
  return data;
}

export function getUserCredits(userId) {
  return userCreditsStorage.get(userId) || 0;
}

export function addUserCredits(userId, credits) {
  const current = getUserCredits(userId);
  userCreditsStorage.set(userId, current + credits);
  return current + credits;
}

export function deductUserCredit(userId) {
  const current = getUserCredits(userId);
  if (current > 0) {
    userCreditsStorage.set(userId, current - 1);
    return true;
  }
  return false;
}

// NOW we can define the init function since DATA_STORAGE_TYPE is available
function initCreditsStorage() {
  try {
    // In Cloud Run, we can't create directories, so skip file operations
    if (DATA_STORAGE_TYPE === 'cloud-storage' || DATA_STORAGE_TYPE === 'memory') {
      logger.info('Using cloud/memory storage - skipping file system initialization');
      return;
    }
    
    // Only try to create directories in development/file mode
    if (DATA_STORAGE_TYPE === 'file') {
      const dataDirectory = path.join(__dirname, 'data');
      try {
        if (!fs.existsSync(dataDirectory)) {
          fs.mkdirSync(dataDirectory, { recursive: true });
        }
      } catch (mkdirError) {
        // If we can't create the directory, switch to memory mode
        logger.warn('Cannot create data directory, using memory storage instead');
        return;
      }
      
      // Load existing credits if available
      if (fs.existsSync(CREDITS_FILE)) {
        const data = JSON.parse(fs.readFileSync(CREDITS_FILE, 'utf8'));
        Object.entries(data).forEach(([userId, credits]) => {
          userCreditsStorage.set(userId, credits);
        });
        logger.info(`Loaded credits for ${userCreditsStorage.size} users`);
      }
    }
  } catch (error) {
    logger.error('Error initializing credits storage:', error);
    // Don't throw - just use memory storage
  }
}

export function saveCreditsStorage() {
  if (DATA_STORAGE_TYPE === 'memory') {
    return;
  }
  
  const data = {};
  userCreditsStorage.forEach((credits, userId) => {
    data[userId] = credits;
  });
  
  try {
    fs.writeFileSync(CREDITS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving credits data:', error);
  }
}

// Initialize free pass storage
function initFreePassStorage() {
  try {
    // Skip file operations for both memory and cloud-storage modes
    if (DATA_STORAGE_TYPE === 'memory' || DATA_STORAGE_TYPE === 'cloud-storage') {
      console.log(`Using ${DATA_STORAGE_TYPE} storage for free pass data`);
      return;
    }
    
    // Only try file operations if explicitly in file mode
    if (DATA_STORAGE_TYPE === 'file') {
      // Create data directory if it doesn't exist
      const dataDirectory = path.join(__dirname, 'data');
      try {
        if (!fs.existsSync(dataDirectory)) {
          fs.mkdirSync(dataDirectory, { recursive: true });
          console.log(`Created data directory at ${dataDirectory}`);
        }
      } catch (mkdirError) {
        console.log('Unable to create data directory - using in-memory storage');
        return; // Skip file operations
      }
      
      // Load existing data if available
      if (fs.existsSync(FREE_PASS_FILE)) {
        const data = JSON.parse(fs.readFileSync(FREE_PASS_FILE, 'utf8'));
        Object.entries(data).forEach(([userId, used]) => {
          freePassUsage.set(userId, used);
        });
        console.log(`Loaded ${freePassUsage.size} free pass records`);
      }
    }
  } catch (error) {
    console.error('Error initializing free pass storage:', error);
  }
}

// Save free pass data to filesystem
export function saveFreePassUsage() {
  // Skip file saving if using memory storage
  if (DATA_STORAGE_TYPE === 'memory') {
    return;
  }
  
  const data = {};
  freePassUsage.forEach((used, userId) => {
    data[userId] = used;
  });
  
  try {
    fs.writeFileSync(FREE_PASS_FILE, JSON.stringify(data), 'utf8');
  } catch (error) {
    console.error('Error saving free pass data:', error);
  }
}

// Check if user has already used their free pass
export function hasUsedFreePass(userId) {
  return freePassUsage.get(userId) === true;
}

// Mark free pass as used
export function markFreePassUsed(userId) {
  freePassUsage.set(userId, true);
  
  // Save to file if not using memory storage
  if (DATA_STORAGE_TYPE !== 'memory') {
    saveFreePassUsage(); // Save immediately on changes
  }
}

// New function: Store user information from free pass form
export async function saveFreePassUserInfo(userData) {
  try {
    const userDataObj = {
      firstName: userData.firstName,
      lastName: userData.lastName,
      email: userData.email,
      jobId: userData.jobId,
      userId: userData.userId,
      timestamp: new Date().toISOString()
    };
    
    // Choose storage based on environment
    if (DATA_STORAGE_TYPE === 'memory') {
      // In-memory storage for Cloud Run
      inMemoryFreePassUsers.push(userDataObj);
      console.log(`Saved free pass user to memory: ${userData.email}`);
    } 
    else if (DATA_STORAGE_TYPE === 'cloud-storage' && bucket) {
      // Cloud Storage for production
      const userFile = bucket.file(`free-pass-users/${userData.userId}.json`);
      await userFile.save(JSON.stringify(userDataObj), {
        contentType: 'application/json'
      });
      
      // Also update list file with all users
      const allUsersFile = bucket.file('free-pass-users/all-users.json');
      try {
        const [content] = await allUsersFile.download();
        const allUsers = JSON.parse(content.toString());
        allUsers.push(userDataObj);
        await allUsersFile.save(JSON.stringify(allUsers), {
          contentType: 'application/json'
        });
      } catch (err) {
        // If file doesn't exist, create it
        await allUsersFile.save(JSON.stringify([userDataObj]), {
          contentType: 'application/json'
        });
      }
      console.log(`Saved free pass user to Cloud Storage: ${userData.email}`);
    } 
    else {
      // File-based storage for development
      // ENSURE DATA DIRECTORY EXISTS
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(`Created data directory at ${dataDir}`);
      }
      
      // Append to the list of users
      let users = [];
      if (fs.existsSync(FREE_PASS_USERS_FILE)) {
        try {
          users = JSON.parse(fs.readFileSync(FREE_PASS_USERS_FILE, 'utf8'));
        } catch (err) {
          console.error('Error reading free pass users file:', err);
        }
      }
      
      // Add the new user
      users.push(userDataObj);
      
      // Write back to file with better formatting and error logging
      try {
        fs.writeFileSync(FREE_PASS_USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
        console.log(`Saved free pass user to file: ${userData.email}, path: ${FREE_PASS_USERS_FILE}`);
      } catch (writeErr) {
        console.error(`Error writing to ${FREE_PASS_USERS_FILE}:`, writeErr);
        console.error(`Path exists? ${fs.existsSync(path.dirname(FREE_PASS_USERS_FILE))}`);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error saving free pass user data:', error);
    return false;
  }
}

// Get all free pass users
export function getFreePassUsers() {
  try {
    if (DATA_STORAGE_TYPE === 'memory') {
      // Return in-memory data
      return inMemoryFreePassUsers;
    } else {
      // Return file-based data
      if (fs.existsSync(FREE_PASS_USERS_FILE)) {
        return JSON.parse(fs.readFileSync(FREE_PASS_USERS_FILE, 'utf8'));
      }
    }
    return [];
  } catch (error) {
    console.error('Error getting free pass users:', error);
    return [];
  }
}

// Add a new endpoint to get free pass user count
export function getFreePassUserCount() {
  try {
    if (DATA_STORAGE_TYPE === 'memory') {
      return inMemoryFreePassUsers.length;
    } else {
      if (fs.existsSync(FREE_PASS_USERS_FILE)) {
        const users = JSON.parse(fs.readFileSync(FREE_PASS_USERS_FILE, 'utf8'));
        return users.length;
      }
    }
    return 0;
  } catch (error) {
    console.error('Error getting free pass user count:', error);
    return 0;
  }
}

// Auto-save interval to ensure durability (skip for memory storage)
if (DATA_STORAGE_TYPE !== 'memory' && DATA_STORAGE_TYPE !== 'cloud-storage') {
  setInterval(() => {
    saveFreePassUsage();
    saveCreditsStorage(); // Also save credits periodically
  }, 60000); // Save every minute
}

// Immediately initialize Cloud Storage bucket when module loads
initBucket()
  .then(() => logger.info(`✅ Cloud Storage bucket "${bucketName}" initialized`))
  .catch(err => logger.error(`Error initializing Cloud Storage bucket: ${err.message}`));

// Export initBucket so it can be invoked at server startup
export { initBucket };