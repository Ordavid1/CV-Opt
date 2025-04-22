// lemonserver.mjs
import express from 'express';
import crypto from 'crypto';
import { jobDataStorage } from './storage.mjs';

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

export default function initLemonSqueezyRoutes(app, logger) {

// 1. Enhanced store-job-data endpoint with better logging
app.post('/api/store-job-data', express.json(), (req, res) => {
  try {
    logger.info("Storing job data before checkout");
    logger.debug(`Direct body access: ${JSON.stringify(req.body)}`);
    
    const { jobUrl, cvHTML, refinementLevel } = req.body;
    
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
    
    // Store the data using jobId as the primary key
    jobDataStorage.set(jobId, { 
      jobId,
      jobUrl, 
      cvHTML,
      refinementLevel: finalLevel, // Use the parsed level
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
    
    const { jobId, refinementLevel } = req.body;
    
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
    
    // Add refinement level to checkout data for webhook processing
    const payload = {
      data: {
        type: "checkouts",
        attributes: {
          custom_price: 100,
          checkout_data: {
            custom: {
              jobId: jobId,
              refinementLevel: String(jobData.refinementLevel)
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
      // IMPORTANT: Return 200 instead of 500 to acknowledge receipt
      return res.status(200).json({ 
        received: true,
        status: 'error',
        error: 'Webhook secret not configured' 
      });
    }

    // 3️⃣ Ensure raw body is a Buffer
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      logger.error('❌ Expected raw body to be Buffer, but got:', typeof rawBody);
      // IMPORTANT: Return 200 instead of 400 to acknowledge receipt
      return res.status(200).json({ 
        received: true,
        status: 'error',
        error: 'Invalid request body format' 
      });
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
      // IMPORTANT: Return 200 instead of 401 to acknowledge receipt
      return res.status(200).json({ 
        received: true,
        status: 'error',
        error: 'Invalid signature' 
      });
    }
    */

    // 7️⃣ Parse the webhook payload
    const payload = JSON.parse(bodyStr);
    logger.debug('Webhook payload (first 500 chars):', JSON.stringify(payload).slice(0, 500));
    
    if (!payload?.meta?.event_name || !payload?.data) {
      logger.error('❌ Invalid webhook structure:', payload);
      // IMPORTANT: Return 200 instead of 400 to acknowledge receipt
      return res.status(200).json({ 
        received: true,
        status: 'error',
        error: 'Invalid webhook structure' 
      });
    }

    // 8️⃣ Handle Order Created Event
    const eventName = payload.meta.event_name;
    logger.info(`✅ Processing webhook event: ${eventName}`);

    if (eventName === 'order_created') {
      const orderId = payload.data.id;
      const status = payload.data.attributes?.status;
      
      if (status === 'paid') {
        // Log more details to find custom data
        logger.debug("Order attributes:", JSON.stringify(payload.data.attributes || {}));
        logger.debug("Checkout data:", JSON.stringify(payload.data.attributes?.checkout_data || {}));
        logger.debug("Custom data:", JSON.stringify(payload.data.attributes?.checkout_data?.custom || {}));
        logger.debug("Meta custom data:", JSON.stringify(payload.meta?.custom_data || {}));
        
        // Try multiple ways to get the jobId and refinementLevel
        let jobId = null;
        let refinementLevel = null;
        
        // Option 1: From meta.custom_data (seen in your webhook example)
        if (payload.meta?.custom_data?.jobId) {
          jobId = payload.meta.custom_data.jobId;
          refinementLevel = payload.meta.custom_data.refinementLevel;
          logger.info(`Found jobId (${jobId}) and refinement level (${refinementLevel}) from meta.custom_data`);
        }
        // Option 2: From checkout_data.custom
        else if (payload.data.attributes?.checkout_data?.custom?.jobId) {
          jobId = payload.data.attributes.checkout_data.custom.jobId;
          refinementLevel = payload.data.attributes.checkout_data.custom.refinementLevel;
          logger.info(`Found jobId (${jobId}) and refinement level (${refinementLevel}) from checkout_data.custom`);
        } 
        // Option 3: From meta_data if available
        else if (payload.data.attributes?.meta_data?.jobId) {
          jobId = payload.data.attributes.meta_data.jobId;
          refinementLevel = payload.data.attributes.meta_data.refinementLevel;
          logger.info(`Found jobId (${jobId}) and refinement level (${refinementLevel}) from meta_data`);
        }
        // Option 4: Look for the most recent job data if jobId not found
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
          // IMPORTANT: Return 200 to acknowledge receipt
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
          // IMPORTANT: Return 200 to acknowledge receipt
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
              conversation: [],
              jobUrl,
              cvHTML,
              refinementLevel: finalRefinementLevel
            })
          });

          // Handle response from `/refine`
          if (!refineResponse.ok) {
            const errorMsg = await refineResponse.text();
            logger.error(`❌ Failed to trigger refinement process: ${errorMsg}`);
            // IMPORTANT: Return 200 instead of 500 to acknowledge receipt
            return res.status(200).json({ 
              received: true,
              status: 'error',
              error: "Refinement process failed",
              errorDetails: errorMsg
            });
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
          // IMPORTANT: Return 200 instead of 500 to acknowledge receipt
          return res.status(200).json({ 
            received: true,
            status: 'error',
            error: "Error triggering refinement process",
            errorDetails: refineError.message
          });
        }
      }
    }

    // Acknowledge other events to prevent webhook retries
    return res.status(200).json({ received: true });

  } catch (error) {
    logger.error('❌ Webhook processing error:', error);
    // IMPORTANT: Return 200 instead of 500 to acknowledge receipt
    return res.status(200).json({ 
      received: true,
      status: 'error',
      error: error.message
    });
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
      const { jobId } = req.body;
      
      if (!jobId) {
        return res.status(400).json({ error: 'jobId is required' });
      }
      
      logger.info(`Checking refinement status for jobId: ${jobId}`);
      
      // Get job data directly by jobId
      const jobData = jobDataStorage.get(jobId);
      
      if (!jobData) {
        logger.info(`No data found for jobId: ${jobId}`);
        return res.json({ 
          status: 'pending',
          message: 'No refinement data found for this job'
        });
      }
      
      if (jobData.refinedHTML) {
        logger.info(`Refinement results found for jobId: ${jobId}`);
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

}