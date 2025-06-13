// lemonserver.mjs
import express from 'express';
import crypto from 'crypto';
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
  setJobData,  // Add this
  getJobData   // Add this
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
app.post('/api/store-job-data', express.json(), async (req, res) => {
  try {
    logger.info("Storing job data before checkout");
    // Selective debug: only key fields and trimmed cvHTML preview
    const url = req.body.jobUrl;
    const level = req.body.refinementLevel;
    const tabId = req.body.tabSessionId;
    const html = req.body.cvHTML;
    let cvPreview = '';
    if (html && typeof html === 'string') {
      const first50 = html.slice(0, 50);
      const last50 = html.slice(-50);
      cvPreview = `${first50}...${last50}`;
    }
    logger.debug(`Job data received: jobUrl=${url}, refinementLevel=${level}, tabSessionId=${tabId}, cvHTMLPreview=${cvPreview}`);
    
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
    await setJobData(jobId, { 
      jobId,
      jobUrl, 
      cvHTML,
      refinementLevel: finalLevel,
      tabSessionId: tabSessionId || Math.random().toString(36).substring(2),
      userId: userId,
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
    
    // Extract bundleType from request
    const { bundleType = 'single' } = req.body;
    logger.info(`Payment type selected: ${bundleType}`);

    // Find the entry by jobId
    const jobData = await getJobData(jobId);
    
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
        await setJobData(jobId, jobData);
      }
    }
    
  // Generate userId for free pass and credits check
  const userId = generateUserId(req);
  logger.info(`User ID: ${userId.substring(0, 8)}...`);

  // Check if user has credits first
  const userCredits = getUserCredits(userId);
  if (userCredits > 0) {
  logger.info(`User has ${userCredits} credits, using credit instead of payment`);

  // Deduct one credit
  deductUserCredit(userId);
  saveCreditsStorage(); // Save the credit deduction
  
  // Trigger refinement process immediately
  try {
    // Get the job data
    const jobData = await getJobData(jobId);
    if (!jobData || !jobData.jobUrl || !jobData.cvHTML) {
      throw new Error('Missing job data for refinement');
    }
    
    // Trigger refinement process
    const refineUrl = `${process.env.APP_URL || 'http://localhost:8080'}/refine`;
    logger.info(`Starting credit-based refinement for jobId: ${jobId}`);
    
    // Don't wait for refinement to complete - just trigger it
    fetch(refineUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: `credit-${jobId}`, // Mark as credit-based
        jobId,
        tabSessionId,
        conversation: [],
        jobUrl: jobData.jobUrl,
        cvHTML: jobData.cvHTML,
        refinementLevel: jobData.refinementLevel || 5
      })
    }).then(response => {
      if (!response.ok) {
        logger.error(`Failed to trigger credit-based refinement: ${response.status}`);
      } else {
        logger.info(`Credit-based refinement triggered successfully`);
      }
    }).catch(error => {
      logger.error(`Error triggering credit-based refinement: ${error.message}`);
    });
    
    // Return success response immediately
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
    
    return res.json({
      useCredit: true,
      remainingCredits: userCredits, // Original amount since we refunded
      jobId: jobId,
      refinementStarted: false,
      error: error.message
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

    logger.info('Checkout session created:', checkoutUrl);
    res.json({ 
      checkoutUrl,
      refinementLevel: jobData.refinementLevel, // Echo back in response
      bundleType: bundleType // ADD THIS LINE
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
    
    if (!signature || computedSignature !== signature) {
      logger.error('❌ Invalid webhook signature');
      logger.debug('Expected:', computedSignature);
      logger.debug('Received:', signature);
      return res.status(401).json({ error: 'Invalid signature' });
    }
    

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

      // Check if we've already processed this order
      const processedOrderKey = `processed_order_${orderId}`;
      const alreadyProcessed = jobDataStorage.has(processedOrderKey);

      if (alreadyProcessed) {
        logger.info(`Order ${orderId} already processed, skipping duplicate webhook`);
        return res.status(200).json({ 
          received: true,
          status: 'already_processed',
          orderId
        });
      }

      // Mark this order as processed
      jobDataStorage.set(processedOrderKey, {
        processedAt: new Date().toISOString(),
        orderId
      });

      // Set expiry for this flag (clean up after 1 hour)
      setTimeout(() => {
        jobDataStorage.delete(processedOrderKey);
      }, 3600000);

      const status = payload.data.attributes?.status;
      
      if (status === 'paid') {
        // Extract custom data - check multiple possible locations
        let jobId = null;
        let refinementLevel = null;
        let tabSessionId = null;
        let bundleType = null;
        let userId = null;
        
        // Method 1: From checkout_data.custom
        if (payload.data.attributes?.checkout_data?.custom) {
            logger.info(`DEBUG: Full checkout_data: ${JSON.stringify(payload.data.attributes?.checkout_data)}`);
            logger.info(`DEBUG: Full attributes: ${JSON.stringify(payload.data.attributes)}`);
          const customData = payload.data.attributes.checkout_data.custom;
          jobId = customData.jobId;
          refinementLevel = customData.refinementLevel;
          tabSessionId = customData.tabSessionId;
          bundleType = customData.bundleType;
          userId = customData.userId;
          
          logger.info(`Found custom data - jobId: ${jobId}, bundle: ${bundleType}, userId: ${userId}`);
        }

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
          const jobData = await getJobData(jobId);
          if (jobData && jobData.userId) {
            userId = jobData.userId;
            logger.info(`Extracted userId from job data: ${userId.substring(0, 8)}...`);
          }
        }

        // If we still don't have userId, try to extract it from the stored job data
        if (!userId && jobId) {
          const jobData = await getJobData(jobId);
          if (jobData) {
            // The userId might be stored in the job data from the checkout creation
            userId = jobData.userId;
            logger.info(`Extracted userId from job data: ${userId.substring(0, 8)}...`);
          }
        }

        // If not a bundle purchase, continue with the jobId extraction logic
        // Around line 450 in the webhook handler, replace this section:
        if (!jobId) {
          logger.warn("No jobId found in webhook payload, looking for most recent job");
          
          // First try in-memory storage
          const allJobIds = [...jobDataStorage.keys()];
          
          if (allJobIds.length === 0 && bucket) {
            // If no jobs in memory, try Cloud Storage
            logger.info("No jobs in memory, searching Cloud Storage...");
            
            try {
              // List all job files
              const [files] = await bucket.getFiles({
                prefix: 'jobs/',
                maxResults: 100,
                orderBy: 'created desc'
              });
              
              if (files.length > 0) {
                // Get the most recent file
                const mostRecentFile = files[0];
                const jobId = mostRecentFile.name.replace('jobs/', '').replace('.json', '');
                
                logger.info(`Found most recent job in Cloud Storage: ${jobId}`);
                
                // Load the job data
                const [content] = await mostRecentFile.download();
                const jobData = JSON.parse(content.toString());
                
                // Cache it in memory
                jobDataStorage.set(jobId, jobData);
                
                // Use this jobId
                refinementLevel = jobData.refinementLevel || 5;
                userId = jobData.userId || userId;
                
                logger.info(`Using job from Cloud Storage: ${jobId} with refinement level: ${refinementLevel}`);
              } else {
                logger.error("No jobs found in Cloud Storage either");
              }
            } catch (error) {
              logger.error("Error searching Cloud Storage for jobs:", error);
            }
          } else if (allJobIds.length > 0) {
            // Use in-memory jobs
            allJobIds.sort((a, b) => {
              const timeA = jobDataStorage.get(a)?.createdAt || '';
              const timeB = jobDataStorage.get(b)?.createdAt || '';
              return timeB.localeCompare(timeA);
            });
            
            jobId = allJobIds[0];
            const jobData = await getJobData(jobId);
            refinementLevel = jobData?.refinementLevel || 5;
            
            if (jobData?.userId) {
              userId = jobData.userId;
              logger.info(`Extracted userId from most recent job data: ${userId.substring(0, 8)}...`);
            }
            
            logger.info(`Using most recent jobId: ${jobId} with refinement level: ${refinementLevel}`);
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
            const existingData = await getJobData(jobId) || {};
            await setJobData(jobId, {
              ...existingData,
              isBundlePurchase: true,
              bundleCredits: 10,
              completedAt: new Date().toISOString()
            });
          }

          logger.info(`✅ Added 10 credits to user ${userId.substring(0, 8)}...`);
          
          // Don't trigger refinement for bundle purchases
          return res.status(200).json({
            received: true,
            status: 'credits_added',
            credits: 10,
            userId: userId
          });
        }

        // Find job data by jobId
        const jobData = await getJobData(jobId);
        
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
        
        // Trigger refinement process in-process (avoid HTTP loop)
        try {
          logger.info(`🔄 Enqueueing refinement for jobId: ${jobId} at level: ${finalRefinementLevel}`);
          
          // Import the enqueue function at the top of lemonserver.mjs
          const { enqueueRefinementJob } = await import('./taskqueue.mjs');
          
          // Check if we're in local/sync mode
          const isLocalMode = process.env.NODE_ENV !== 'production' && !process.env.ENABLE_CLOUD_TASKS;

          if (isLocalMode) {
            // In local mode, don't update status after enqueueing since it runs synchronously
            logger.info(`🔄 Enqueueing refinement for jobId: ${jobId} at level: ${finalRefinementLevel} (local mode)`);
            
            await enqueueRefinementJob({
              orderId,
              jobId,
              tabSessionId,
              jobUrl: jobData.jobUrl,
              cvHTML: jobData.cvHTML,
              refinementLevel: finalRefinementLevel,
              conversation: []
            });
            
            // Don't update status here in local mode - the job is already complete!
            logger.info(`✅ Refinement completed synchronously for jobId: ${jobId}`);
          } else {
            // Production mode - update status to queued
            logger.info(`🔄 Enqueueing refinement for jobId: ${jobId} at level: ${finalRefinementLevel}`);
            
            await enqueueRefinementJob({
              orderId,
              jobId,
              tabSessionId,
              jobUrl: jobData.jobUrl,
              cvHTML: jobData.cvHTML,
              refinementLevel: finalRefinementLevel,
              conversation: []
            });
            
            // Only update status in production mode
            await setJobData(jobId, {
              ...jobData,
              status: 'queued',
              orderId,
              queuedAt: new Date().toISOString()
            });
            
            logger.info(`✅ Refinement job queued for jobId: ${jobId}`);
          }
          
          logger.info(`✅ Refinement job queued for jobId: ${jobId}`);
          
          return res.status(200).json({
            received: true,
            status: 'paid',
            orderId,
            jobId,
            refinementLevel: finalRefinementLevel
          });
        } catch (err) {
          logger.error(`❌ Error queueing refinement for jobId ${jobId}: ${err.message}`);
          return res.status(500).json({ error: "Error queueing refinement process" });
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
    
    const jobData = await getJobData(jobId);
    
    if (!jobData) {
      logger.info(`No data found for jobId: ${jobId}`);
      return res.json({ 
        status: 'pending',
        message: 'No refinement data found for this job'
      });
    }
    
    // CHECK FOR COMPLETED STATUS FIRST!!!
    if (jobData.status === 'completed' || (jobData.refinedHTML && jobData.completedAt)) {
      logger.info(`Refinement results found for jobId: ${jobId}`);
      return res.json({
        status: 'completed',
        refinedHTML: jobData.refinedHTML,
        changes: jobData.changes,
        extractedKeywords: jobData.extractedKeywords,
        processingTime: jobData.processingTime
      });
    }
    
    // Then check for error state
    if (jobData.status === 'failed' || jobData.error) {
      logger.error(`Job ${jobId} failed:`, jobData.error);
      return res.json({
        status: 'failed',
        error: jobData.error?.message || 'Refinement process failed',
        failedAt: jobData.failedAt
      });
    }
    
    // Check if this was a bundle purchase
    if (jobData.isBundlePurchase) {
      logger.info(`This was a bundle purchase - no refinement needed`);
      return res.json({
        status: 'bundle_purchase',
        bundleCredits: jobData.bundleCredits || 10,
        message: 'Bundle purchase completed - credits added'
      });
    }

    // Check if job is queued
    if (jobData.status === 'queued') {
      logger.info(`Job ${jobId} is queued for processing`);
      return res.json({
        status: 'queued',
        message: 'Your CV refinement is queued and will start processing shortly',
        queuedAt: jobData.queuedAt
      });
    }

    // Check if job is processing
    if (jobData.status === 'processing') {
      logger.info(`Job ${jobId} is currently being processed`);
      return res.json({
        status: 'processing',
        message: 'Your CV is being refined right now',
        processingStartedAt: jobData.processingStartedAt
      });
    }

    // Check tab session mismatch
    if (tabSessionId && jobData.tabSessionId && tabSessionId !== jobData.tabSessionId) {
      logger.info(`Tab session mismatch: request has ${tabSessionId}, job has ${jobData.tabSessionId}`);
      return res.json({
        status: 'wrong_tab',
        message: 'This job was processed in another browser tab'
      });
    }
    
    // Check if refinement is complete FIRST
    if (jobData.status === 'completed' || (jobData.refinedHTML && jobData.completedAt)) {
      logger.info(`Refinement results found for jobId: ${jobId}`);
      return res.json({
        status: 'completed',
        refinedHTML: jobData.refinedHTML,
        changes: jobData.changes,
        extractedKeywords: jobData.extractedKeywords,
        processingTime: jobData.processingTime
      });
    }
    
// Check if it's been too long (timeout detection)
if (jobData.createdAt || jobData.processingStartedAt) {
  const startTime = new Date(jobData.processingStartedAt || jobData.createdAt);
  const now = new Date();
  const minutesElapsed = (now - startTime) / (1000 * 60);
  
  // If it's been more than 5 minutes and still processing, something is wrong
  if (minutesElapsed > 5 && jobData.status === 'processing') {
    logger.warn(`Job ${jobId} has been processing for ${minutesElapsed.toFixed(1)} minutes - likely failed`);
    
    // Update the job status to failed
    await setJobData(jobId, {
      ...jobData,
      status: 'failed',
      error: {
        message: 'Refinement process timed out after 5 minutes',
        stage: 'processing_timeout',
        minutesElapsed: minutesElapsed.toFixed(1)
      },
      failedAt: new Date().toISOString()
    });
    
    return res.json({
      status: 'failed',
      error: 'Refinement process timed out. Please try again.',
      minutesElapsed: minutesElapsed.toFixed(1)
    });
  }
}} catch (error) {
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
    const jobData = await getJobData(jobId);
    
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
    const jobData = await getJobData(jobId);
    
    if (!jobData) {
      logger.error(`No job data found for job ID: ${jobId}`);
      return res.status(400).json({ success: false, message: 'Job data not found' });
    }
    
    // Start the refinement process if not already started
    try {
      // Only proceed if we have all the required data
      if (jobData.jobUrl && jobData.cvHTML) {
        // Trigger refinement process immediately
        const refineUrl = `${process.env.APP_URL || 'http://localhost:8080'}/refine`;
        logger.info(`Starting credit-based refinement for jobId: ${jobId}`);

        const refineResponse = await fetch(refineUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: `credit-${jobId}`,
            jobId,
            tabSessionId,
            conversation: [],
            jobUrl: jobData.jobUrl,
            cvHTML: jobData.cvHTML,
            refinementLevel: jobData.refinementLevel || 5,
            userEmail: email // Include the email for tracking
          })
        });
        // Wait a moment for the refinement to start processing
        await new Promise(resolve => setTimeout(resolve, 500));

        // Don't overwrite the status if refinement has already updated it
        const currentJobData = await getJobData(jobId);
        if (currentJobData && currentJobData.status !== 'completed' && currentJobData.status !== 'processing') {
          // Only update if still in initial state
          await setJobData(jobId, {
            ...currentJobData,
            creditUsed: true,
            creditUsedAt: new Date().toISOString()
          });
        }

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
app.get('/api/check-credits', (req, res) => {
  const userId = generateUserId(req);
  const credits = getUserCredits(userId);
  
  logger.info(`Credits check for user ${userId.substring(0, 8)}...: ${credits} credits`);
  
  res.json({ 
    credits: credits,
    hasCredits: credits > 0,
    userId: userId.substring(0, 8) + '...'
  });
});

// Admin endpoint to view free pass stats
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
      storageType: process.env.DATA_STORAGE_TYPE || 'cloud-storage', // Change default to 'cloud-storage'
      recentUsers: simplifiedUsers.slice(0, 10), // Show only the 10 most recent
      environment: process.env.NODE_ENV || 'development',
      storageMode: process.env.DATA_STORAGE_TYPE ? 'configured' : 'default'
    };
    
    return res.json(stats);
  } catch (error) {
    logger.error('Error getting free pass stats:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

}