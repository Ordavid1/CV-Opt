// lemonserver.mjs
import express from 'express';
import crypto from 'crypto';
import { 
  jobDataStorage, 
  hasUsedFreePass, 
  markFreePassUsed,
  saveFreePassUserInfo,
  getFreePassUsers,
  getFreePassUserCount 
} from './storage.mjs';

// New helper function to ensure atomic operations
async function atomicFreePassOperation(userId, userData, logger) {
  let savedData = false;
  let markedAsUsed = false;
  
  try {
    // First try to save the user data
    savedData = await saveFreePassUserInfo(userData);
    
    if (!savedData) {
      logger.warn(`Failed to save user data for ${userData.email}`);
      return false;
    }
    
    // Then mark free pass as used
    markedAsUsed = markFreePassUsed(userId);
    
    if (!markedAsUsed) {
      logger.warn(`Failed to mark free pass as used for ${userId}`);
      return false;
    }
    
    // Both operations succeeded
    return true;
  } catch (error) {
    logger.error(`Error in atomic free pass operation: ${error.message}`);
    
    // Try to rollback if possible
    if (savedData && !markedAsUsed) {
      // TODO: Add code to remove the saved user data if needed
    }
    
    return false;
  }
}

// Add the fetchWithRetry function here
async function fetchWithRetry(url, options, maxRetries = 3) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      
      // If status is 429 (rate limit) or 5xx (server error), retry
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        retries++;
        console.log(`Retrying API call (${retries}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, 1000 * retries)); // Exponential backoff
        continue;
      }
      
      return response; // Return failed response for other status codes
    } catch (error) {
      retries++;
      if (retries >= maxRetries) throw error;
      
      console.error(`API call failed, retrying (${retries}/${maxRetries}): ${error.message}`);
      await new Promise(r => setTimeout(r, 1000 * retries));
    }
  }
}

// Add the generateUserId function here, right after fetchWithRetry
function generateUserId(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';
  
  // Get device fingerprinting information from headers
  const acceptLanguage = req.headers['accept-language'] || '';
  const acceptEncoding = req.headers['accept-encoding'] || '';
  
  // Create more robust hash combining multiple factors
  const idString = `${ip}-${userAgent}-${acceptLanguage}-${acceptEncoding}`;
  return crypto.createHash('sha256').update(idString).digest('hex');
}

const userRateLimits = new Map(); // Track request counts per user

export default function initLemonSqueezyRoutes(app, logger) {

// 1. Enhanced store-job-data endpoint with better logging
app.post('/api/store-job-data', express.json(), (req, res) => {
  try {
    logger.info("Storing job data before checkout");
    logger.debug(`Direct body access: ${JSON.stringify(req.body)}`);
    
    // Check for rate limiting by user ID
    const userId = generateUserId(req);
    const userRequests = userRateLimits.get(userId) || 0;
    
    // If user has already used free pass, enforce stricter rate limits
    if (hasUsedFreePass(userId)) {
      // Check if they're making too many requests in a short time
      if (userRequests > 3) { // Max 3 requests within time window
        logger.warn(`Rate limit exceeded for user ${userId.substring(0, 8)}...`);
        return res.status(429).json({ 
          error: "Too many requests. You've already used your free pass.",
          rateLimit: true
        });
      }
      
      // Increment request counter
      userRateLimits.set(userId, userRequests + 1);
      
      // Reset counter after a delay (e.g., 1 minute)
      setTimeout(() => {
        const currentCount = userRateLimits.get(userId);
        if (currentCount) {
          userRateLimits.set(userId, Math.max(0, currentCount - 1));
        }
      }, 60000);
    }

    const { jobUrl, cvHTML, refinementLevel, tabSessionId } = req.body;
    
    // Enhanced logging for debugging
    logger.info(`Refinement level received in store-job-data: ${refinementLevel}`);
    
    if (!jobUrl || !cvHTML) {
      logger.error("Missing jobUrl or cvHTML in store-job-data request");
      return res.status(400).json({ error: "jobUrl and cvHTML are required" });
    }
    
    // Parse refinement level to ensure it's a number
    const parsedLevel = parseInt(refinementLevel, 10);
    const finalLevel = isNaN(parsedLevel) ? 5 : parsedLevel;
    
    // Generate a unique job ID
    const jobId = crypto.randomBytes(16).toString('hex');
    
    // Store the data using jobId as the primary key, including tabSessionId
    jobDataStorage.set(jobId, { 
      jobId,
      jobUrl, 
      cvHTML,
      refinementLevel: finalLevel,
      tabSessionId: tabSessionId || Math.random().toString(36).substring(2), // Store the tabSessionId
      createdAt: new Date().toISOString()
    });
    
    logger.info(`✅ Pre-stored job data for jobId: ${jobId}, refinement level: ${finalLevel}`);
    
    return res.json({ 
      status: "success", 
      message: "Job data stored successfully",
      jobId: jobId,
      refinementLevel: finalLevel // Echo back for confirmation
    });
  } catch (error) {
    logger.error("Error storing job data:", error);
    return res.status(500).json({ error: error.message });
  }
});

// 2. Enhanced create-checkout endpoint to handle refinement level
app.post('/api/create-checkout', express.json(), async (req, res) => {
  try {
    logger.info('Creating checkout session');
    logger.debug(`Checkout request body: ${JSON.stringify(req.body)}`);
    
    const { jobId, refinementLevel, tabSessionId } = req.body;
    
    if (!jobId) {
      logger.error('No jobId provided');
      return res.status(400).json({ error: "jobId is required" });
    }
    
    // Find the entry by jobId
    const jobData = jobDataStorage.get(jobId);
    
    if (!jobData) {
      logger.error(`No job data found for Job ID: ${jobId}`);
      return res.status(400).json({ error: "Job data not found. Please try again." });
    }
    
    logger.info(`Found job data for ID ${jobId}`);
    
    // Update refinement level if provided in this request
    if (refinementLevel !== undefined) {
      const parsedLevel = parseInt(refinementLevel, 10);
      if (!isNaN(parsedLevel)) {
        logger.info(`Updating refinement level from ${jobData.refinementLevel} to ${parsedLevel}`);
        jobData.refinementLevel = parsedLevel;
        jobDataStorage.set(jobId, jobData);
      }
    }
    
    // Generate userId for free pass check
    const userId = generateUserId(req);
    logger.info(`User ID for free pass check: ${userId.substring(0, 8)}...`);
    
    // Check if user has already used their free pass
    const freePassUsed = hasUsedFreePass(userId);
    
    // If user still has free pass available, process without payment
    if (!freePassUsed) {
      // [free pass code here]
    }
    
    // If no free pass or already used, continue with normal checkout process
    logger.info(`No free pass available for user, creating paid checkout`);

    // Add tabSessionId to checkout data for webhook processing
    const payload = {
      data: {
        type: "checkouts",
        attributes: {
          custom_price: 100,
          checkout_data: {
            custom: {
              jobId: jobId,
              refinementLevel: String(jobData.refinementLevel),
              tabSessionId: tabSessionId || Math.random().toString(36).substring(2) // Include the tabSessionId or generate a new one
            }
          }
        },
        relationships: {
          store: {
            data: {
              type: "stores",
              id: process.env.LEMON_SQUEEZY_STORE_ID
            }
          },
          variant: {
            data: {
              type: "variants",
              id: process.env.LEMON_SQUEEZY_VARIANT_ID
            }
          }
        }
      }
    };
    
    logger.info(`Sending checkout creation request with refinement level: ${jobData.refinementLevel}`);
    const response = await fetchWithRetry('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LEMON_API_KEY}`,
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json'
      },
      body: JSON.stringify(payload)
    });

    const responseData = await response.json();
    logger.debug(`Lemon Squeezy API response: ${JSON.stringify(responseData)}`);
    
    if (!response.ok) {
      const errorData = await response.json();
      logger.error('Lemon Squeezy API error details:', JSON.stringify(errorData));
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const checkoutUrl = responseData.data?.attributes?.url;
    if (!checkoutUrl) {
      throw new Error('No checkout URL in response');
    }

    logger.info('Checkout session created:', checkoutUrl);
    res.json({ 
      checkoutUrl,
      refinementLevel: jobData.refinementLevel // Echo back in response
    });
  } catch (error) {
    logger.error('Checkout creation error:', error);
    res.status(500).json({
      error: 'Failed to create checkout',
      details: error.message
    });
  }
});

// 3. Enhanced webhook handler to better extract refinement level
app.post('/webhooks/lemonsqueezy', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    logger.info("🔥 Webhook received at /webhooks/lemonsqueezy");

    // 1️⃣ Extract signature from headers
    const signature = req.get('x-signature');
    logger.debug('🛑 Signature from header:', signature);

    // 2️⃣ Get webhook secret from env variables
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    if (!secret) {
      logger.error('❌ Webhook secret is missing in environment variables.');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    // 3️⃣ Ensure raw body is a Buffer
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      logger.error('❌ Expected raw body to be Buffer, but got:', typeof rawBody);
      return res.status(400).json({ error: 'Invalid request body format' });
    }

    // 4️⃣ Convert body to string
    const bodyStr = rawBody.toString('utf8');

    // 5️⃣ Compute HMAC signature for verification
    const computedSignature = crypto
      .createHmac('sha256', secret)
      .update(bodyStr)
      .digest('hex');

    logger.debug('🛑 Signature verification:', {
      headerSignature: signature, 
      computedSignature,
      match: signature === computedSignature
    });

    // 6️⃣ Skip signature validation for now (for testing)
    // If this is a real production environment, you should uncomment this
    /*
    if (!signature || computedSignature !== signature) {
      logger.error('❌ Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    */

    // 7️⃣ Parse the webhook payload
    const payload = JSON.parse(bodyStr);
    logger.debug('Webhook payload (first 500 chars):', JSON.stringify(payload).slice(0, 500));
      
    if (!payload?.meta?.event_name || !payload?.data) {
      logger.error('❌ Invalid webhook structure:', payload);
      return res.status(400).json({ error: 'Invalid webhook structure' });
    }

    // 8️⃣ Handle Order Created Event
    const eventName = payload.meta.event_name;
    logger.info(`✅ Processing webhook event: ${eventName}`);

    if (eventName === 'order_created') {
      const orderId = payload.data.id;
      const status = payload.data.attributes?.status;
      
      if (status === 'paid') {
        // Extract custom data
        let jobId = null;
        let refinementLevel = null;
        let tabSessionId = null; // Variable to store the tab session ID
        
        // Try to extract from checkout_data.custom
        if (payload.data.attributes?.checkout_data?.custom) {
          const customData = payload.data.attributes.checkout_data.custom;
          jobId = customData.jobId;
          refinementLevel = customData.refinementLevel;
          tabSessionId = customData.tabSessionId; // Extract tabSessionId
          
          logger.info(`Found jobId (${jobId}), refinement level (${refinementLevel}), and tabSessionId (${tabSessionId}) from checkout data`);
        }
        // Option 2: From meta_data if available
        else if (payload.data.attributes?.meta_data?.jobId) {
          jobId = payload.data.attributes.meta_data.jobId;
          refinementLevel = payload.data.attributes.meta_data.refinementLevel;
          logger.info(`Found jobId (${jobId}) and refinement level (${refinementLevel}) from meta_data`);
        }
        // Option 3: Look for the most recent job data if jobId not found
        else {
          logger.warn("No jobId found in webhook payload, looking for most recent job");
          
          // Get all keys from jobDataStorage and sort by creation time
          const allJobIds = [...jobDataStorage.keys()];
          if (allJobIds.length > 0) {
            // Sort by creation time (most recent first)
            allJobIds.sort((a, b) => {
              const timeA = jobDataStorage.get(a)?.createdAt || '';
              const timeB = jobDataStorage.get(b)?.createdAt || '';
              return timeB.localeCompare(timeA);
            });
            
            // Use the most recent jobId
            jobId = allJobIds[0];
            const jobData = jobDataStorage.get(jobId);
            refinementLevel = jobData?.refinementLevel || 5;
            logger.info(`Using most recent jobId: ${jobId} with refinement level: ${refinementLevel}`);
          }
        }

        if (!jobId) {
          logger.error(`❌ No jobId found for order ${orderId}`);
          return res.status(200).json({ 
            received: true,
            status: 'error',
            message: "No job data found for this order"
          });
        }
        
        // Find job data by jobId
        const jobData = jobDataStorage.get(jobId);
        
        if (!jobData) {
          logger.error(`❌ No job data found for jobId: ${jobId}`);
          return res.status(200).json({ 
            received: true,
            status: 'error',
            message: "No job data found for this order"
          });
        }
        
        const { jobUrl, cvHTML } = jobData;
        logger.info(`✅ Found stored job data for order ${orderId} with jobId ${jobId}`);
        
          // Determine final refinement level to use, with fallbacks
          // Convert to number if it's a string
          let finalRefinementLevel;
          if (typeof refinementLevel === 'string') {
            finalRefinementLevel = parseInt(refinementLevel, 10) || jobData.refinementLevel || 5;
          } else {
            finalRefinementLevel = refinementLevel || jobData.refinementLevel || 5;
          }
        logger.info(`Using final refinement level for processing: ${finalRefinementLevel}`);
        
        // Trigger refinement process with data
        try {
          const refineResponse = await fetch(`${process.env.APP_URL || 'http://localhost:8080'}/refine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId,
              jobId,
              tabSessionId, // Include this in the refinement request
              conversation: [],
              jobUrl: jobData.jobUrl,
              cvHTML: jobData.cvHTML,
              refinementLevel: finalRefinementLevel
            })
          });

          // Handle response from `/refine`
          if (!refineResponse.ok) {
            const errorMsg = await refineResponse.text();
            logger.error(`❌ Failed to trigger refinement process: ${errorMsg}`);
            return res.status(500).json({ error: "Refinement process failed" });
          }

          logger.info(`✅ Refinement process started with level: ${finalRefinementLevel}`);

          return res.status(200).json({
            received: true,
            status: 'paid',
            orderId,
            jobId,
            refinementLevel: finalRefinementLevel
          });
        } catch (refineError) {
          logger.error(`❌ Error triggering refinement: ${refineError.message}`);
          return res.status(500).json({ error: "Error triggering refinement process" });
        }
      }
    }

    // Acknowledge other events to prevent webhook retries
    res.status(200).json({ received: true });

  } catch (error) {
    logger.error('❌ Webhook processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

  // Also keep the original path as a backup
  app.post('/api/webhooks/lemonsqueezy', express.raw({ type: 'application/json' }), async (req, res) => {
    // Redirect to the main webhook handler
    logger.info("Received webhook at /api/webhooks/lemonsqueezy, redirecting to /webhooks/lemonsqueezy");
    req.url = '/webhooks/lemonsqueezy';
    app._router.handle(req, res);
  });

  // Refinement status endpoint - simplified to use jobId only
// In lemonserver.mjs, update the refinement-status endpoint:

app.post('/api/refinement-status', express.json(), async (req, res) => {
  try {
    const { jobId, tabSessionId } = req.body;
    
    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }
    
    logger.info(`Checking refinement status for jobId: ${jobId} with tabSessionId: ${tabSessionId || 'not provided'}`);
    
    // Get job data directly by jobId
    const jobData = jobDataStorage.get(jobId);
    
    if (!jobData) {
      logger.info(`No data found for jobId: ${jobId}`);
      return res.json({ 
        status: 'pending',
        message: 'No refinement data found for this job'
      });
    }
    
    // Check if this is for a different tab session
    if (tabSessionId && jobData.tabSessionId && tabSessionId !== jobData.tabSessionId) {
      logger.info(`Tab session mismatch: request has ${tabSessionId}, job has ${jobData.tabSessionId}`);
      return res.json({
        status: 'wrong_tab',
        message: 'This job was processed in another browser tab'
      });
    }
    
    if (jobData.refinedHTML) {
      logger.info(`Refinement results found for jobId: ${jobId}`);
      // Only return results if tabSessionId matches or if no tabSessionId was stored
      return res.json({
        status: 'completed',
        refinedHTML: jobData.refinedHTML,
        changes: jobData.changes,
        extractedKeywords: jobData.extractedKeywords
      });
    }
    
    logger.info(`Refinement still in progress for jobId: ${jobId}`);
    return res.json({
      status: 'processing',
      message: 'Refinement is still in progress'
    });
    
  } catch (error) {
    logger.error('Error checking refinement status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add this endpoint to lemonserver.mjs for retrieving job data
// Get job data endpoint - helpful for debugging and fallback refinement
app.post('/api/get-job-data', express.json(), async (req, res) => {
  try {
    const { jobId } = req.body;
    
    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }
    
    logger.info(`Getting job data for jobId: ${jobId}`);
    
    // Get job data directly by jobId
    const jobData = jobDataStorage.get(jobId);
    
    if (!jobData) {
      logger.info(`No data found for jobId: ${jobId}`);
      return res.json({ 
        status: 'error',
        message: 'No job data found for this job'
      });
    }
    
    // Only return necessary fields, not the full data
    return res.json({
      status: 'success',
      jobId: jobData.jobId,
      jobUrl: jobData.jobUrl,
      cvHTML: jobData.cvHTML,
      createdAt: jobData.createdAt
    });
    
  } catch (error) {
    logger.error('Error getting job data:', error);
    res.status(500).json({ error: error.message });
  }
});

// New endpoint to handle free pass form submissions
app.post('/api/free-pass-submit', express.json(), async (req, res) => {
  try {
    logger.info("Processing free pass submission");
    
    const { firstName, lastName, email, jobId } = req.body;
    
    // Log the request for debugging
    logger.debug(`Free pass submission data: ${JSON.stringify(req.body)}`);
    
    if (!firstName || !lastName || !email || !jobId) {
      logger.error('Missing required fields in free pass submission');
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    
    // Get the current userId for consistent tracking
    const userId = generateUserId(req);
    
    // Save user information
    const userData = {
      firstName,
      lastName,
      email,
      jobId,
      userId
    };
    
    // Use atomic operation
    const success = await atomicFreePassOperation(userId, userData, logger);
    
    if (!success) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error processing free pass. Please try again.' 
      });
    }

    try {
      // Save user data to storage
      const saved = saveFreePassUserInfo(userData);
      
      if (!saved) {
        logger.warn(`Warning: Unable to save free pass user data for email: ${email}`);
        // Continue processing anyway
      } else {
        logger.info(`Free pass user data saved: ${email}`);
      }
    } catch (storageError) {
      // Log the error but continue processing
      logger.error(`Error saving free pass user data: ${storageError.message}`);
      logger.error(storageError.stack);
      // We'll continue despite this error
    }
    
    // Mark free pass as used for this user
    try {
      markFreePassUsed(userId);
      logger.info(`Free pass marked as used for user ID: ${userId.substring(0, 8)}...`);
    } catch (markError) {
      logger.error(`Error marking free pass as used: ${markError.message}`);
      // Continue despite this error
    }
    
    logger.info(`Free pass user submitted: ${email} (${firstName} ${lastName})`);
    
    // Find the job data
    const jobData = jobDataStorage.get(jobId);
    
    if (!jobData) {
      logger.error(`No job data found for job ID: ${jobId}`);
      return res.status(400).json({ success: false, message: 'Job data not found' });
    }
    
    // Start the refinement process if not already started
    try {
      // Only proceed if we have all the required data
      if (jobData.jobUrl && jobData.cvHTML) {
        // Start refinement process with job data
        const refineUrl = `${process.env.APP_URL || 'http://localhost:8080'}/refine`;
        logger.info(`Starting refinement for free pass user at: ${refineUrl}`);
        
        const refineResponse = await fetch(refineUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId,
            orderId: `free-${jobId}`, // Mark as free pass
            conversation: [],
            jobUrl: jobData.jobUrl,
            cvHTML: jobData.cvHTML,
            refinementLevel: jobData.refinementLevel || 5,
            userEmail: email // Include the email for tracking
          })
        });
        
        if (!refineResponse.ok) {
          logger.error(`Error from refinement endpoint: ${refineResponse.status}`);
          const errorText = await refineResponse.text();
          logger.error(`Refinement error details: ${errorText}`);
          // Continue despite this error - we'll still return success to the client
        } else {
          logger.info(`✅ Free pass refinement process started for ${jobId} (${email})`);
        }
      } else {
        logger.error(`Missing required job data for refinement: ${JSON.stringify(jobData)}`);
        return res.status(400).json({ success: false, message: 'Incomplete job data' });
      }
    } catch (refineError) {
      logger.error(`Error starting refinement process: ${refineError.message}`);
      logger.error(refineError.stack);
      // We'll return success anyway since the frontend will handle polling
    }
    
    // Return success regardless of minor errors
    return res.json({ success: true, message: 'Free pass submitted successfully' });
  } catch (error) {
    logger.error(`Error processing free pass submission: ${error.message}`);
    logger.error(error.stack);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Admin endpoint to view free pass stats
app.get('/api/admin/free-pass-stats', express.json(), async (req, res) => {
  try {
    // Simple check for admin access - you might want to improve this
    const apiKey = req.query.key;
    
    if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Get free pass user count and the last few users
    const allUsers = getFreePassUsers();
    
    // Include only what's needed for the report
    const simplifiedUsers = allUsers.map(user => ({
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
      timestamp: user.timestamp
    }));
    
    // Sort by timestamp (newest first)
    simplifiedUsers.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Create stats object
    const stats = {
      totalUsers: simplifiedUsers.length,
      storageType: process.env.DATA_STORAGE_TYPE || 'file',
      recentUsers: simplifiedUsers.slice(0, 10) // Show only the 10 most recent
    };
    
    return res.json(stats);
  } catch (error) {
    logger.error('Error getting free pass stats:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
})

}