// lemonserver.mjs
import express from 'express';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

import { 
  jobDataStorage, 
  hasUsedFreePass, 
  markFreePassUsed,
  saveFreePassUserInfo,
  getFreePassUsers,
  getFreePassUserCount,
  getUserCredits,
  addUserCredits,
  deductUserCredit,
  saveCreditsStorage,
  orderToJobMapping
} from './storage.mjs';

const processedWebhooks = new Set();

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
  // Use session-based ID if available
  if (req.session && req.session.userId) {
    return req.session.userId;
  }
  
  // Generate new session ID
  const newUserId = crypto.randomBytes(32).toString('hex');
  
  // Store in session if session exists
  if (req.session) {
    req.session.userId = newUserId;
  }
 
  return newUserId;
}

const freePassEmails = new Set(); // Or use database table

async function sendVerificationEmail(email, token) {
  const transporter = nodemailer.createTransport({
    // Configure your email service
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  
  await transporter.sendMail({
    from: '"CV Optimizer" <noreply@cvoptimizer.com>',
    to: email,
    subject: 'Verify your free CV optimization',
    html: `Click here to verify: ${process.env.APP_URL}/verify?token=${token}`
  });
}

const userRateLimits = new Map(); // Track request counts per user
export default function initLemonSqueezyRoutes(app, logger) {
// 1. Enhanced store-job-data endpoint with better logging
app.post('/api/store-job-data', express.json(), (req, res) => {
  try {
    logger.info("Storing job data before checkout");
    logger.debug(`Direct body access: ${JSON.stringify(req.body)}`);
    
    // Extract bundleType first
    const { bundleType, jobUrl, cvHTML, refinementLevel, tabSessionId } = req.body;
    const userId = generateUserId(req);
    logger.info(`User ID: ${userId.substring(0, 8)}..., bundleType: ${bundleType || 'none'}`);

    // Get or create rate limit data for this user
    const userRequests = userRateLimits.get(userId) || { count: 0, lastReset: Date.now() };
    const now = Date.now();
    
    // Reset counter if window has passed (5 minutes)
    if (now - userRequests.lastReset > 5 * 60 * 1000) {
      userRequests.count = 0;
      userRequests.lastReset = now;
    }

    // Check for free pass attempts vs paid attempts
    const isAttemptingFreePass = !bundleType && hasUsedFreePass(userId);
    if (isAttemptingFreePass) {
      logger.warn(`User ${userId.substring(0, 8)} attempting to get another free pass`);
      return res.status(429).json({ 
        error: "You've already used your free pass. Please purchase a plan.",
        freePassUsed: true
      });
    }
    
    // More lenient rate limiting for paid purchases
    const maxRequests = bundleType ? 10 : 5; // Higher limit for paid purchases

    // Check rate limit
    if (userRequests.count >= maxRequests) {
      logger.warn(`Rate limit hit for user ${userId.substring(0, 8)}: ${userRequests.count} requests`);
      return res.status(429).json({ 
        error: "Too many requests. Please wait a moment and try again.",
        rateLimit: true
      });
    }

    // Increment counter and save back to Map
    userRequests.count++;
    userRateLimits.set(userId, userRequests); // ✅ Correct - save the object

    // Remove the setTimeout decay logic - not needed with time-window approach
    
    // Validate required fields
    if (!jobUrl || !cvHTML) {
      logger.error("Missing jobUrl or cvHTML in store-job-data request");
      return res.status(400).json({ error: "jobUrl and cvHTML are required" });
    }
    
    // Parse refinement level to ensure it's a number
    const parsedLevel = parseInt(refinementLevel, 10);
    const finalLevel = isNaN(parsedLevel) ? 5 : parsedLevel;
    
    // Generate a unique job ID
    const jobId = crypto.randomBytes(16).toString('hex');
    
    // Store the data using jobId as the primary key
    jobDataStorage.set(jobId, { 
      jobId,
      jobUrl, 
      cvHTML,
      refinementLevel: finalLevel,
      tabSessionId: tabSessionId || Math.random().toString(36).substring(2),
      userId: userId,
      bundleType: bundleType, // Store this too for later reference
      createdAt: new Date().toISOString(),
      checkoutPending: true,
      lastUpdated: new Date().toISOString()
    });
    
    logger.info(`✅ Pre-stored job data for jobId: ${jobId}, refinement level: ${finalLevel}, bundleType: ${bundleType || 'single'}`);
    
    return res.json({ 
      status: "success", 
      message: "Job data stored successfully",
      jobId: jobId,
      refinementLevel: finalLevel
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
    
    // Extract bundleType from request
    const { bundleType = 'single' } = req.body;
    logger.info(`Payment type selected: ${bundleType}`);

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
    
    // Generate userId for free pass and credits check
    const userId = generateUserId(req);
    logger.info(`User ID: ${userId.substring(0, 8)}...`);

    // Check if user has credits first
    const userCredits = await getUserCredits(userId);
    if (userCredits > 0) {
      logger.info(`User has ${userCredits} credits, using credit instead of payment`);
      
      // Deduct one credit
      await deductUserCredit(userId);
      saveCreditsStorage(); // Save the credit deduction
      
      // IMPORTANT: Trigger refinement process for credit usage
      try {
        // Get the job data
        const jobData = jobDataStorage.get(jobId);
        if (!jobData || !jobData.jobUrl || !jobData.cvHTML) {
          throw new Error('Missing job data for refinement');
        }
        
        // Trigger refinement process immediately
        const refineUrl = `${process.env.APP_URL || 'http://localhost:8080'}/refine`;
        logger.info(`Starting credit-based refinement for jobId: ${jobId}`);
        
        const refineResponse = await fetch(refineUrl, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-Internal-Request': 'true'  // ADD THIS
          },
          body: JSON.stringify({
            orderId: `credit-${jobId}`, // Mark as credit-based
            jobId,
            tabSessionId,
            conversation: [],
            jobUrl: jobData.jobUrl,
            cvHTML: jobData.cvHTML,
            refinementLevel: jobData.refinementLevel || 5
          })
        });
        
        if (!refineResponse.ok) {
          const errorText = await refineResponse.text();
          logger.error(`Failed to trigger credit-based refinement: ${errorText}`);
          throw new Error('Failed to start refinement process');
        }
        
        logger.info(`✅ Credit-based refinement started for jobId: ${jobId}`);
        
        // Return special response for credit usage
        return res.json({
          useCredit: true,
          remainingCredits: userCredits - 1,
          jobId: jobId,
          refinementStarted: true
        });
        
      } catch (error) {
        logger.error(`Error starting credit-based refinement: ${error.message}`);
        
        // Refund the credit if refinement fails to start
        addUserCredits(userId, 1);
        saveCreditsStorage();
        
        return res.status(500).json({
          error: 'Failed to start refinement process',
          details: error.message,
          creditRefunded: true
        });
      }
    }

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
          custom_price: bundleType === 'bundle' ? 500 : 100, // $5 or $1 in cents
          checkout_data: {
            custom: {
              jobId: jobId,
              refinementLevel: String(jobData.refinementLevel),
              tabSessionId: tabSessionId || Math.random().toString(36).substring(2),
              bundleType: bundleType,
              userId: userId // Add userId for credit tracking
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
              id: bundleType === 'bundle' 
                ? process.env.LEMON_SQUEEZY_VARIANT_ID_BUNDLE 
                : (process.env.LEMON_SQUEEZY_VARIANT_ID)
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
      // Don't try to read the body again if it was already logged
      logger.error('Lemon Squeezy API error: Status ' + response.status);
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const checkoutUrl = responseData.data?.attributes?.url;
    if (!checkoutUrl) {
      throw new Error('No checkout URL in response');
    }

    // ADD THIS CODE HERE - After getting checkoutUrl, before sending response
    // Extract checkout ID from URL to create mapping
    const checkoutId = checkoutUrl.match(/checkout\/custom\/([^?]+)/)?.[1];
    if (checkoutId) {
      orderToJobMapping.set(checkoutId, {
        jobId: jobId,
        userId: userId,
        tabSessionId: tabSessionId,
        refinementLevel: jobData.refinementLevel,
        bundleType: bundleType
      });
      logger.info(`Mapped checkout ${checkoutId} to job ${jobId}`);
    }

    logger.info('Checkout session created:', checkoutUrl);
    res.json({ 
      checkoutUrl,
      refinementLevel: jobData.refinementLevel,
      bundleType: bundleType
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

    // Parse the webhook payload first
    const bodyStr = req.body.toString('utf8');
    const payload = JSON.parse(bodyStr);
    
    // ADD: Check for duplicate webhook processing
    const eventId = payload.meta?.webhook_id || payload.meta?.event_id;
    if (eventId) {
      if (processedWebhooks.has(eventId)) {
        logger.info(`Webhook ${eventId} already processed, skipping`);
        return res.status(200).json({ received: true, duplicate: true });
      }
    }

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

    // 4️⃣ Convert body to string - const bodyStr = rawBody.toString('utf8');

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
    
    if (!signature || computedSignature !== signature) {
      logger.error('❌ Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // 7️⃣ Parse the webhook payload
    logger.debug('Webhook payload (first 500 chars):', JSON.stringify(payload).slice(0, 500));
      
    if (!payload?.meta?.event_name || !payload?.data) {
      logger.error('❌ Invalid webhook structure:', payload);
      return res.status(400).json({ error: 'Invalid webhook structure' });
    }

    // 8️⃣ Handle Order Created Event
    const eventName = payload.meta.event_name;
    logger.info(`✅ Processing webhook event: ${eventName}`);

    // NOW you can add the debug logging AFTER eventName is defined
    logger.info('=== WEBHOOK DEBUG ===');
    logger.info(`Event: ${eventName}`);
    logger.info(`Order ID: ${payload.data?.id}`);
    logger.info(`Attributes keys: ${Object.keys(payload.data?.attributes || {}).join(', ')}`);
    if (payload.data?.attributes?.checkout_data) {
      logger.info(`Checkout data keys: ${Object.keys(payload.data.attributes.checkout_data).join(', ')}`);
    }
    logger.info('=== END DEBUG ===');

    if (eventName === 'order_created') {
      const orderId = payload.data.id;
      const status = payload.data.attributes?.status;
      
      if (status === 'paid') {
        // Try to get checkout ID from order
        const checkoutId = payload.data.attributes?.checkout_id || 
                          payload.data.relationships?.checkout?.data?.id;
        
        if (checkoutId && orderToJobMapping.has(checkoutId)) {
          const mappedData = orderToJobMapping.get(checkoutId);
          jobId = mappedData.jobId;
          userId = mappedData.userId;
          tabSessionId = mappedData.tabSessionId;
          refinementLevel = mappedData.refinementLevel;
          bundleType = mappedData.bundleType;
          
          logger.info(`Retrieved data from checkout mapping: ${JSON.stringify(mappedData)}`);
        }
  
        let jobId = null;
        let refinementLevel = null;
        let tabSessionId = null;
        let bundleType = null;
        let userId = null;
        
        // Method 1: Check multiple possible locations for custom data
        const customLocations = [
          payload.data.attributes?.checkout_data?.custom,
          payload.data.attributes?.custom,
          payload.data.attributes?.metadata?.custom,
          payload.data.attributes?.meta?.custom,
          payload.meta?.custom_data
        ];
        
        for (const location of customLocations) {
          if (location) {
            jobId = location.jobId || jobId;
            refinementLevel = location.refinementLevel || refinementLevel;
            tabSessionId = location.tabSessionId || tabSessionId;
            bundleType = location.bundleType || bundleType;
            userId = location.userId || userId;
            
            if (jobId) {
              logger.info(`Found custom data at: ${JSON.stringify(location)}`);
              break;
            }
          }
        }
        
        // Log all attributes to debug
        logger.info(`Full order attributes: ${JSON.stringify(payload.data.attributes)}`);

        // ADD THIS: Method 1.5 - Get userId from customer email
        if (!userId && payload.data.attributes?.user_email) {
          const email = payload.data.attributes.user_email;
          // Generate the same userId that the browser generates
          // But we need to match the browser's userId generation method
          userId = crypto.createHash('sha256').update(email).digest('hex');
          logger.info(`Generated userId from customer email (${email}): ${userId.substring(0, 8)}...`);
        }
        // ADD THESE DEBUG LOGS
          logger.info(`DEBUG: Full payload.data.attributes keys: ${Object.keys(payload.data.attributes || {})}`);
          logger.info(`DEBUG: checkout_data exists? ${!!payload.data.attributes?.checkout_data}`);
          logger.info(`DEBUG: checkout_data.custom exists? ${!!payload.data.attributes?.checkout_data?.custom}`);
        
        // Method 2: From first_order_item.variant.slug or product name
        if (!bundleType && payload.data.attributes?.first_order_item) {
          const variantId = payload.data.attributes.first_order_item.variant_id;
          // Check if this is the bundle variant
          if (variantId == process.env.LEMON_SQUEEZY_VARIANT_ID_BUNDLE) {
            bundleType = 'bundle';
            logger.info(`Detected bundle purchase from variant ID: ${variantId}`);
          }
        }
        
        // Method 3: From order total (if $5.00 = bundle)
        if (!bundleType && payload.data.attributes?.total == 500) { // 500 cents = $5
          bundleType = 'bundle';
          logger.info(`Detected bundle purchase from total amount: $5.00`);
        }

        // Method 4: If still no userId, try to extract from customer email or create from order data
        if (!userId && payload.data.attributes?.customer_email) {
          // Generate userId from email
          const email = payload.data.attributes.customer_email;
          userId = crypto.createHash('sha256').update(email).digest('hex');
          logger.info(`Generated userId from customer email: ${userId.substring(0, 8)}...`);
        }

        // Method 5: If STILL no userId for bundle purchase, use order ID as last resort
        if (!userId && bundleType === 'bundle' && orderId) {
          // This is not ideal but ensures bundle purchases aren't lost
          userId = crypto.createHash('sha256').update(`order-${orderId}`).digest('hex');
          logger.warn(`Generated userId from order ID for bundle purchase: ${userId.substring(0, 8)}...`);
        }
        
        // If we still don't have userId but have a bundle, extract from most recent job
        if (bundleType === 'bundle' && !userId && jobId) {
          const jobData = jobDataStorage.get(jobId);
          if (jobData && jobData.userId) {
            userId = jobData.userId;
            logger.info(`Extracted userId from job data: ${userId.substring(0, 8)}...`);
          }
        }

        // If we still don't have userId, try to extract it from the stored job data
        if (!userId && jobId) {
          const jobData = jobDataStorage.get(jobId);
          if (jobData) {
            // The userId might be stored in the job data from the checkout creation
            userId = jobData.userId;
            logger.info(`Extracted userId from job data: ${userId.substring(0, 8)}...`);
          }
        }

        // If not a bundle purchase, continue with the jobId extraction logic
        if (!jobId) {
          // Option 2: From meta_data if available
          if (payload.data.attributes?.meta_data?.jobId) {
            jobId = payload.data.attributes.meta_data.jobId;
            refinementLevel = payload.data.attributes.meta_data.refinementLevel;
            logger.info(`Found jobId (${jobId}) and refinement level (${refinementLevel}) from meta_data`);
          }

        // Clear rate limit for this user after successful payment
        if (userId) {
          userRateLimits.delete(userId);
          logger.info(`Cleared rate limit for user ${userId.substring(0, 8)} after successful payment`);
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
            
            // EXTRACT userId FROM JOB DATA - ADD THIS
            if (jobData?.userId) {
              userId = jobData.userId;
              logger.info(`Extracted userId from most recent job data: ${userId.substring(0, 8)}...`);
            }
            
            logger.info(`Using most recent jobId: ${jobId} with refinement level: ${refinementLevel}`);
          }
        }
      }

        logger.info(`DEBUG: Before bundle check - bundleType: ${bundleType}, userId: ${userId ? userId.substring(0, 8) : 'null'}, jobId: ${jobId}`);
        // CHECK IF THIS IS A BUNDLE PURCHASE - THIS MUST BE HERE, NOT IN THE ELSE BLOCK
        if (bundleType === 'bundle' && userId) {
          logger.info(`✅ Bundle purchase confirmed for user ${userId.substring(0, 8)}...`);
          
          // Add 10 credits to the user
          addUserCredits(userId, 10);
          saveCreditsStorage();

          if (jobId) {
            const existingData = jobDataStorage.get(jobId) || {};
            jobDataStorage.set(jobId, {
              ...existingData,
              isBundlePurchase: true,
              bundleCredits: 10,
              completedAt: new Date().toISOString()
            });
          }

          logger.info(`✅ Added 10 credits to user ${userId.substring(0, 8)}...`);
          
          // ADD HERE: Record webhook as processed
          if (eventId) {
            processedWebhooks.add(eventId);
          }

          // Don't trigger refinement for bundle purchases
          return res.status(200).json({
            received: true,
            status: 'credits_added',
            credits: 10,
            userId: userId
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
        logger.info(`✅ Order ${orderId} paid, processing jobId: ${jobId}`);
        
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
            headers: { 
              'Content-Type': 'application/json',
              'X-Internal-Request': 'true'  // ADD THIS LINE
            },
            body: JSON.stringify({
              orderId,
              jobId,
              tabSessionId,
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

            // ADD HERE: Record webhook as processed
              if (eventId) {
                processedWebhooks.add(eventId);
              }

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

    // ADD HERE: Record webhook as processed for other events
      if (eventId) {
        processedWebhooks.add(eventId);
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
app.post('/api/refinement-status', express.json(), async (req, res) => {
  try {
    const { jobId, tabSessionId } = req.body;
        logger.info(`🔍 Refinement status check - jobId: ${jobId}, tabSessionId: ${tabSessionId}`);
    
    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }    
    logger.info(`Checking refinement status for jobId: ${jobId} with tabSessionId: ${tabSessionId || 'not provided'}`);
    
    // Get job data directly by jobId
    const jobData = jobDataStorage.get(jobId);
        logger.info(`📊 Job data found: ${jobData ? 'YES' : 'NO'}`);

    if (!jobData) {
      logger.info(`No data found for jobId: ${jobId}`);
      return res.json({ 
        status: 'pending',
        message: 'No refinement data found for this job'
      });
    }
          logger.info(`📊 Job data has refinedHTML: ${jobData.refinedHTML ? 'YES' : 'NO'}`);

    
    // CHECK IF THIS WAS A BUNDLE PURCHASE
    if (jobData.isBundlePurchase) {
      logger.info(`This was a bundle purchase - no refinement needed`);
      return res.json({
        status: 'bundle_purchase',
        bundleCredits: jobData.bundleCredits || 10,
        message: 'Bundle purchase completed - credits added'
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

    // ADD: Check if email already used
    if (freePassEmails.has(email.toLowerCase())) {
      return res.status(400).json({ 
        success: false, 
        message: 'This email has already been used for a free pass' 
      });
    }
    
    // ADD: Check database for email
    const existingUser = await db.get(
      'SELECT * FROM free_pass_users WHERE email = ?',
      email.toLowerCase()
    );
    
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'This email has already been used for a free pass' 
      });
    }
    
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
          headers: { 
            'Content-Type': 'application/json',
            'X-Internal-Request': 'true'  // ADD THIS
          },
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

// Credits check endpoint
app.get('/api/check-credits', async (req, res) => {  // Add async
  const userId = generateUserId(req);
  const credits = await getUserCredits(userId);  // Add await
  
  logger.info(`Credits check for user ${userId.substring(0, 8)}...: ${credits} credits`);
  
  res.json({ 
    credits: credits,
    hasCredits: credits > 0,
    userId: userId.substring(0, 8) + '...'
  });
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

// ADD THE RATE LIMIT DEBUGGER HERE - BEFORE THE CLOSING BRACE
// Utility endpoint to check and clear rate limits
app.post('/api/check-rate-limit', express.json(), (req, res) => {
  const userId = generateUserId(req);
  const userRequests = userRateLimits.get(userId);
  
  if (!userRequests) {
    return res.json({ 
      rateLimited: false, 
      requests: 0,
      message: 'No rate limit data for this user'
    });
  }
  
  const now = Date.now();
  const timeSinceReset = now - userRequests.lastReset;
  const windowRemaining = Math.max(0, (5 * 60 * 1000) - timeSinceReset);
  
  res.json({
    rateLimited: userRequests.count >= 10,
    requests: userRequests.count,
    windowRemaining: Math.ceil(windowRemaining / 1000), // seconds
    message: windowRemaining > 0 ? 
      `${userRequests.count} requests made. Window resets in ${Math.ceil(windowRemaining / 1000)} seconds.` :
      'Rate limit window has expired'
  });
});

// Clean up old rate limit entries every hour
setInterval(() => {
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  
  userRateLimits.forEach((data, userId) => {
    if (now - data.lastReset > fiveMinutes * 2) { // Clean up entries older than 10 minutes
      userRateLimits.delete(userId);
    }
  });
  
  logger.info(`Rate limit cleanup: ${userRateLimits.size} active entries`);
}, 60 * 60 * 1000); // Run every hour

}