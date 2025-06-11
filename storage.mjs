// storage.mjs - Complete merged version with Cloud Storage support
import path from 'path';
import { fileURLToPath } from 'url';
import { Storage } from '@google-cloud/storage';
import { db } from './database.mjs';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

// In-memory storage maps
export const jobDataStorage = new Map();
export const freePassUsage = new Map();
export const orderToJobMapping = new Map();
export const userCreditsStorage = new Map();

// In-memory storage for free pass users
let inMemoryFreePassUsers = [];

// Get directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File paths (kept for backward compatibility)
const FREE_PASS_FILE = path.join(__dirname, 'data', 'free-passes.json');
const FREE_PASS_USERS_FILE = path.join(__dirname, 'data', 'free-pass-users.json');
const CREDITS_FILE = path.join(__dirname, 'data', 'user-credits.json');

// Storage type from environment variable
const DATA_STORAGE_TYPE = process.env.DATA_STORAGE_TYPE || 'memory';

// Initialize Google Cloud Storage
const storage = new Storage();
const bucketName = process.env.STORAGE_BUCKET || 'cv-opt-data';
let bucket;

// Log the storage type on startup
console.log(`Storage configuration: Type=${DATA_STORAGE_TYPE}, Bucket=${bucketName}`);

// Initialize bucket
async function initBucket() {
  // Skip Cloud Storage initialization if using memory-only or file storage
  if (DATA_STORAGE_TYPE === 'memory' || DATA_STORAGE_TYPE === 'file') {
    console.log(`Using ${DATA_STORAGE_TYPE} storage, skipping Cloud Storage initialization`);
    return;
  }

  try {
    bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();
    if (!exists && process.env.NODE_ENV === 'production') {
      console.log(`Creating bucket ${bucketName}...`);
      await storage.createBucket(bucketName, {
        location: 'US-EAST1',
        storageClass: 'STANDARD'
      });
      console.log(`Bucket ${bucketName} created.`);
    } else {
      console.log(`Using existing bucket: ${bucketName}`);
    }
  } catch (error) {
    console.error('Error initializing bucket:', error);
    // Don't throw - allow app to continue with fallback storage
    bucket = null;
  }
}

// Create a data directory in /tmp for backward compatibility
const DATA_DIR = '/tmp/cv-opt-data';

async function ensureDataDir() {
  try {
    await fsPromises.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Initialize data directory
ensureDataDir();

// Persist job data - supports both Cloud Storage and file system
export async function persistJobData(jobId, data) {
  try {
    // Always store in memory for fast access
    jobDataStorage.set(jobId, data);
    
    // Use Cloud Storage if available
    if (bucket && DATA_STORAGE_TYPE === 'cloud-storage') {
      const file = bucket.file(`jobs/${jobId}.json`);
      await file.save(JSON.stringify(data), {
        contentType: 'application/json',
        metadata: {
          cacheControl: 'no-cache',
        }
      });
      console.log(`Job data persisted to Cloud Storage: ${jobId}`);
    } 
    // Fall back to file system
    else if (DATA_STORAGE_TYPE === 'file') {
      const filePath = path.join(DATA_DIR, `job-${jobId}.json`);
      await fsPromises.writeFile(filePath, JSON.stringify(data), 'utf8');
      console.log(`Job data persisted to file system: ${jobId}`);
    }
    // Memory-only mode - data is already in the Map
  } catch (error) {
    console.error('Error persisting job data:', error);
    // Don't throw - operation continues with in-memory storage
  }
}

// Load job data - supports both Cloud Storage and file system
export async function loadJobData(jobId) {
  try {
    // First check memory
    if (jobDataStorage.has(jobId)) {
      return jobDataStorage.get(jobId);
    }
    
    // Try Cloud Storage
    if (bucket && DATA_STORAGE_TYPE === 'cloud-storage') {
      const file = bucket.file(`jobs/${jobId}.json`);
      const [exists] = await file.exists();
      
      if (exists) {
        const [content] = await file.download();
        const data = JSON.parse(content.toString());
        
        // Cache in memory
        jobDataStorage.set(jobId, data);
        console.log(`Job data loaded from Cloud Storage: ${jobId}`);
        return data;
      }
    }
    // Try file system
    else if (DATA_STORAGE_TYPE === 'file') {
      const filePath = path.join(DATA_DIR, `job-${jobId}.json`);
      try {
        const data = await fsPromises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(data);
        
        // Cache in memory
        jobDataStorage.set(jobId, parsed);
        console.log(`Job data loaded from file system: ${jobId}`);
        return parsed;
      } catch (error) {
        // File doesn't exist
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error loading job data:', error);
    return null;
  }
}

// Cleanup old jobs - supports both storage types
export async function cleanupOldJobs() {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  
  // Clean up in-memory storage
  for (const [jobId, data] of jobDataStorage.entries()) {
    const created = new Date(data.createdAt || data.timestamp || 0).getTime();
    if (now - created > ONE_DAY) {
      jobDataStorage.delete(jobId);
    }
  }
  
  // Clean up Cloud Storage
  if (bucket && DATA_STORAGE_TYPE === 'cloud-storage') {
    try {
      const [files] = await bucket.getFiles({ prefix: 'jobs/' });
      
      for (const file of files) {
        const [metadata] = await file.getMetadata();
        const created = new Date(metadata.timeCreated).getTime();
        
        if (now - created > ONE_DAY) {
          await file.delete();
          console.log(`Deleted old Cloud Storage file: ${file.name}`);
        }
      }
    } catch (error) {
      console.error('Error cleaning up Cloud Storage:', error);
    }
  }
  // Clean up file system
  else if (DATA_STORAGE_TYPE === 'file') {
    try {
      const files = await fsPromises.readdir(DATA_DIR);
      
      for (const file of files) {
        if (file.startsWith('job-')) {
          const filePath = path.join(DATA_DIR, file);
          const stats = await fsPromises.stat(filePath);
          if (now - stats.mtimeMs > ONE_DAY) {
            await fsPromises.unlink(filePath);
            console.log(`Deleted old file: ${file}`);
          }
        }
      }
    } catch (error) {
      console.error('Error cleaning up files:', error);
    }
  }
}

// Run cleanup every hour
setInterval(cleanupOldJobs, 60 * 60 * 1000);

// User credits functions - integrated with database and Cloud Storage
export async function getUserCredits(userId) {
  try {
    // Check database first (if available)
    if (db && DATA_STORAGE_TYPE !== 'memory') {
      try {
        const result = await db.get(
          'SELECT credits FROM user_credits WHERE user_id = ?',
          userId
        );
        if (result) {
          return result.credits;
        }
      } catch (dbError) {
        console.error('Database error, falling back to storage:', dbError);
      }
    }
    
    // Check in-memory storage
    if (userCreditsStorage.has(userId)) {
      return userCreditsStorage.get(userId);
    }
    
    // Check Cloud Storage
    if (bucket && DATA_STORAGE_TYPE === 'cloud-storage') {
      const file = bucket.file(`credits/${userId}.json`);
      const [exists] = await file.exists();
      
      if (exists) {
        const [content] = await file.download();
        const data = JSON.parse(content.toString());
        userCreditsStorage.set(userId, data.credits || 0);
        return data.credits || 0;
      }
    }
    
    return 0;
  } catch (error) {
    console.error('Error getting user credits:', error);
    return 0;
  }
}

export async function addUserCredits(userId, credits) {
  try {
    // Update database if available
    if (db && DATA_STORAGE_TYPE !== 'memory') {
      try {
        await db.run(
          `INSERT INTO user_credits (user_id, credits) 
           VALUES (?, ?) 
           ON CONFLICT(user_id) 
           DO UPDATE SET credits = credits + ?, updated_at = CURRENT_TIMESTAMP`,
          userId, credits, credits
        );
        
        await db.run(
          'INSERT INTO credit_transactions (user_id, amount, reason) VALUES (?, ?, ?)',
          userId, credits, 'credit_purchase'
        );
      } catch (dbError) {
        console.error('Database error, continuing with storage:', dbError);
      }
    }
    
    // Get current credits and update
    const current = await getUserCredits(userId);
    const newCredits = current + credits;
    
    // Update in memory
    userCreditsStorage.set(userId, newCredits);
    
    // Update in Cloud Storage
    if (bucket && DATA_STORAGE_TYPE === 'cloud-storage') {
      const file = bucket.file(`credits/${userId}.json`);
      await file.save(JSON.stringify({ 
        userId, 
        credits: newCredits,
        lastUpdated: new Date().toISOString()
      }), {
        contentType: 'application/json'
      });
    }
    
    console.log(`Added ${credits} credits to user ${userId.substring(0, 8)}... (new total: ${newCredits})`);
    return true;
  } catch (error) {
    console.error('Error adding user credits:', error);
    return false;
  }
}

export async function deductUserCredit(userId) {
  try {
    const current = await getUserCredits(userId);
    if (current > 0) {
      // Update database if available
      if (db && DATA_STORAGE_TYPE !== 'memory') {
        try {
          await db.run(
            'UPDATE user_credits SET credits = credits - 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
            userId
          );
          
          await db.run(
            'INSERT INTO credit_transactions (user_id, amount, reason) VALUES (?, ?, ?)',
            userId, -1, 'credit_used'
          );
        } catch (dbError) {
          console.error('Database error, continuing with storage:', dbError);
        }
      }
      
      // Update in memory and storage
      await addUserCredits(userId, -1);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deducting user credit:', error);
    return false;
  }
}

// Initialize credits storage
function initCreditsStorage() {
  try {
    if (DATA_STORAGE_TYPE === 'file') {
      // Create data directory if it doesn't exist
      const dataDirectory = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDirectory)) {
        fs.mkdirSync(dataDirectory, { recursive: true });
      }
      
      // Load existing credits if available
      if (fs.existsSync(CREDITS_FILE)) {
        const data = JSON.parse(fs.readFileSync(CREDITS_FILE, 'utf8'));
        Object.entries(data).forEach(([userId, credits]) => {
          userCreditsStorage.set(userId, credits);
        });
        console.log(`Loaded credits for ${userCreditsStorage.size} users from file`);
      }
    } else {
      console.log('Using in-memory/cloud storage for user credits');
    }
  } catch (error) {
    console.error('Error initializing credits storage:', error);
  }
}

export function saveCreditsStorage() {
  if (DATA_STORAGE_TYPE !== 'file') {
    return; // Only save to file in file mode
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
    if (DATA_STORAGE_TYPE === 'file') {
      // Create data directory if it doesn't exist
      const dataDirectory = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDirectory)) {
        fs.mkdirSync(dataDirectory, { recursive: true });
        console.log(`Created data directory at ${dataDirectory}`);
      }
      
      // Load existing data if available
      if (fs.existsSync(FREE_PASS_FILE)) {
        const data = JSON.parse(fs.readFileSync(FREE_PASS_FILE, 'utf8'));
        Object.entries(data).forEach(([userId, used]) => {
          freePassUsage.set(userId, used);
        });
        console.log(`Loaded ${freePassUsage.size} free pass records from file`);
      }
    } else {
      console.log('Using in-memory/cloud storage for free pass data');
    }
  } catch (error) {
    console.error('Error initializing free pass storage:', error);
  }
}

// Save free pass data to filesystem
export function saveFreePassUsage() {
  if (DATA_STORAGE_TYPE !== 'file') {
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

// Free pass functions
export function hasUsedFreePass(userId) {
  return freePassUsage.get(userId) === true;
}

export function markFreePassUsed(userId) {
  freePassUsage.set(userId, true);
  
  if (DATA_STORAGE_TYPE === 'file') {
    saveFreePassUsage();
  }
  
  return true;
}

// Store user information from free pass form
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
    
    // Save based on storage type
    if (DATA_STORAGE_TYPE === 'memory') {
      inMemoryFreePassUsers.push(userDataObj);
      console.log(`Saved free pass user to memory: ${userData.email}`);
    } 
    else if (DATA_STORAGE_TYPE === 'cloud-storage' && bucket) {
      // Save to memory first
      inMemoryFreePassUsers.push(userDataObj);
      
      // Then to Cloud Storage
      const userFile = bucket.file(`free-pass-users/${userData.userId}.json`);
      await userFile.save(JSON.stringify(userDataObj), {
        contentType: 'application/json'
      });
      
      // Update list file
      const allUsersFile = bucket.file('free-pass-users/all-users.json');
      let allUsers = [];
      
      try {
        const [content] = await allUsersFile.download();
        allUsers = JSON.parse(content.toString());
      } catch (err) {
        // File doesn't exist yet
      }
      
      allUsers.push(userDataObj);
      await allUsersFile.save(JSON.stringify(allUsers), {
        contentType: 'application/json'
      });
      console.log(`Saved free pass user to Cloud Storage: ${userData.email}`);
    } 
    else if (DATA_STORAGE_TYPE === 'file') {
      // Save to memory
      inMemoryFreePassUsers.push(userDataObj);
      
      // Save to file
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      let users = [];
      if (fs.existsSync(FREE_PASS_USERS_FILE)) {
        try {
          users = JSON.parse(fs.readFileSync(FREE_PASS_USERS_FILE, 'utf8'));
        } catch (err) {
          console.error('Error reading free pass users file:', err);
        }
      }
      
      users.push(userDataObj);
      
      try {
        fs.writeFileSync(FREE_PASS_USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
        console.log(`Saved free pass user to file: ${userData.email}`);
      } catch (writeErr) {
        console.error(`Error writing to ${FREE_PASS_USERS_FILE}:`, writeErr);
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
    if (DATA_STORAGE_TYPE === 'memory' || DATA_STORAGE_TYPE === 'cloud-storage') {
      return inMemoryFreePassUsers;
    } else if (DATA_STORAGE_TYPE === 'file' && fs.existsSync(FREE_PASS_USERS_FILE)) {
      return JSON.parse(fs.readFileSync(FREE_PASS_USERS_FILE, 'utf8'));
    }
    return [];
  } catch (error) {
    console.error('Error getting free pass users:', error);
    return [];
  }
}

// Get free pass user count
export function getFreePassUserCount() {
  try {
    if (DATA_STORAGE_TYPE === 'memory' || DATA_STORAGE_TYPE === 'cloud-storage') {
      return inMemoryFreePassUsers.length;
    } else if (DATA_STORAGE_TYPE === 'file' && fs.existsSync(FREE_PASS_USERS_FILE)) {
      const users = JSON.parse(fs.readFileSync(FREE_PASS_USERS_FILE, 'utf8'));
      return users.length;
    }
    return 0;
  } catch (error) {
    console.error('Error getting free pass user count:', error);
    return 0;
  }
}

// Auto-save interval for file-based storage
if (DATA_STORAGE_TYPE === 'file') {
  setInterval(() => {
    saveFreePassUsage();
    saveCreditsStorage();
  }, 60000); // Save every minute
}

// Initialize all storage systems
initBucket().then(() => {
  console.log('Storage initialization complete');
}).catch(console.error);

initFreePassStorage();
initCreditsStorage();

// Export for use in other modules
export { bucket, DATA_STORAGE_TYPE };