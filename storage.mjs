// Modified storage.mjs with in-memory option for Cloud Run
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Storage } from '@google-cloud/storage';
import { db } from './database.mjs';

export const jobDataStorage = new Map();
export const freePassUsage = new Map(); // For in-memory tracking
export const orderToJobMapping = new Map();
export const userCreditsStorage = new Map();

import { promises as fs } from 'fs';
import path from 'path';

// Create a data directory in /tmp (persists during container lifetime)
const DATA_DIR = '/tmp/cv-opt-data';

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Initialize data directory
ensureDataDir();

// Persist job data to disk
export async function persistJobData(jobId, data) {
  try {
    const filePath = path.join(DATA_DIR, `job-${jobId}.json`);
    await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
    jobDataStorage.set(jobId, data); // Also keep in memory for fast access
  } catch (error) {
    console.error('Error persisting job data:', error);
  }
}

// Load job data from disk
export async function loadJobData(jobId) {
  try {
    // First check memory
    if (jobDataStorage.has(jobId)) {
      return jobDataStorage.get(jobId);
    }
    
    // Then check disk
    const filePath = path.join(DATA_DIR, `job-${jobId}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    
    // Cache in memory
    jobDataStorage.set(jobId, parsed);
    return parsed;
  } catch (error) {
    console.error('Error loading job data:', error);
    return null;
  }
}

// Cleanup old job files (call periodically)
export async function cleanupOldJobs() {
  try {
    const files = await fs.readdir(DATA_DIR);
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    
    for (const file of files) {
      if (file.startsWith('job-')) {
        const filePath = path.join(DATA_DIR, file);
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > ONE_DAY) {
          await fs.unlink(filePath);
        }
      }
    }
  } catch (error) {
    console.error('Error cleaning up old jobs:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupOldJobs, 60 * 60 * 1000);

export async function getUserCredits(userId) {
  try {
    // Check database first
    if (db) {
      const result = await db.get(
        'SELECT credits FROM user_credits WHERE user_id = ?',
        userId
      );
      if (result) {
        return result.credits;
      }
    }
    
    // Fallback to in-memory storage
    return userCreditsStorage.get(userId) || 0;
  } catch (error) {
    console.error('Error getting user credits:', error);
    // Fallback to in-memory storage
    return userCreditsStorage.get(userId) || 0;
  }
}

export async function addUserCredits(userId, credits) {
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
    
    return true;
  } catch (error) {
    console.error('Error adding user credits:', error);
    return false;
  }
}

export async function deductUserCredit(userId) {
  try {
    const current = await getUserCredits(userId);  // Add await
    if (current > 0) {
      // Update database
      if (db) {
        await db.run(
          'UPDATE user_credits SET credits = credits - 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
          userId
        );
        
        await db.run(
          'INSERT INTO credit_transactions (user_id, amount, reason) VALUES (?, ?, ?)',
          userId, -1, 'credit_used'
        );
      }
      
      // Also update in-memory storage
      userCreditsStorage.set(userId, current - 1);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deducting user credit:', error);
    return false;
  }
}

// In-memory storage for free pass users (for Cloud Run)
let inMemoryFreePassUsers = [];

// Get directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FREE_PASS_FILE = path.join(__dirname, 'data', 'free-passes.json');
const FREE_PASS_USERS_FILE = path.join(__dirname, 'data', 'free-pass-users.json');
const CREDITS_FILE = path.join(__dirname, 'data', 'user-credits.json');

// Storage type from environment variable (memory or file)
const DATA_STORAGE_TYPE = process.env.DATA_STORAGE_TYPE || 'memory';

// Log the storage type on startup
console.log(`Free pass user data storage type: ${DATA_STORAGE_TYPE}`);

// NOW we can define the init function since DATA_STORAGE_TYPE is available
function initCreditsStorage() {
  try {
    if (DATA_STORAGE_TYPE !== 'memory') {
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
        console.log(`Loaded credits for ${userCreditsStorage.size} users`);
      }
    } else {
      console.log('Using in-memory storage for user credits');
    }
  } catch (error) {
    console.error('Error initializing credits storage:', error);
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

// Initialize Google Cloud Storage
const storage = new Storage();
const bucketName = process.env.STORAGE_BUCKET || 'cv-opt-user-data';
let bucket;


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
  } catch (error) {
    console.error('Error initializing bucket:', error);
  }
}

// Initialize free pass storage
function initFreePassStorage() {
  try {
    // Only initialize file storage if not using memory storage
    if (DATA_STORAGE_TYPE !== 'memory') {
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
        console.log(`Loaded ${freePassUsage.size} free pass records`);
      }
    } else {
      console.log('Using in-memory storage for free pass users');
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
if (DATA_STORAGE_TYPE !== 'memory') {
  setInterval(() => {
    saveFreePassUsage();
    saveCreditsStorage(); // Also save credits periodically
  }, 60000); // Save every minute
}

// Initialize when module is loaded - MOVE TO THE VERY END
initFreePassStorage();
initCreditsStorage(); // Now this will work because DATA_STORAGE_TYPE is defined
// Call this at startup
initBucket();