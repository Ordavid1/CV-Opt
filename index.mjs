// CV-Opt Index.mjs

import express from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import winston from 'winston';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import OpenAI from 'openai';
import { diffWords } from 'diff';
import compression from 'compression';
import helmet from 'helmet';
import crypto from 'crypto';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { jobDataStorage, setJobData, getJobData } from './storage.mjs';
import initLemonSqueezyRoutes from './lemonserver.mjs';
import { createCVRefinementPrompt, createInitialGreeting } from './public/promptTemplates.mjs';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------------------------------------------------
// Logger setup with Winston
// -------------------------------------------------------------------
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
  ),
  transports: [
    new winston.transports.Console() // Remove File transport, only use Console
  ],
});
logger.info('Application started - Enhanced Logging');

// Add this near the top of your file after setting __dirname
logger.info(`Current directory: ${__dirname}`);
logger.info(`Views directory: ${path.join(__dirname, 'views')}`);

// -----------------------
// Initialize Express app
// -----------------------

const app = express();
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0'; // Always bind to 0.0.0.0 for Cloud Run

// -------------------------------------------------------------------
// Important middleware configuration for webhook handling
// -------------------------------------------------------------------

/* Create strict limiter for checkout and API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
}); 

// Apply to specific routes
app.use('/api/store-job-data', apiLimiter);
app.use('/api/create-checkout', apiLimiter);
app.use('/refine', apiLimiter);
*/

// Standard middleware for non-webhook routes


// Updated CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400
}));

app.use(compression());

// Add security headers
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

// CRITICAL: Apply body parsers conditionally
app.use((req, res, next) => {
  // Set cache headers for specific routes
  if (req.path.includes('/api/store-job-data') || 
      req.path.includes('/api/create-checkout') || 
      req.path.includes('/api/refinement-status') ||
      req.path.includes('/refine')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  
  // Apply the correct body parser based on the route
  if (req.path === '/webhooks/lemonsqueezy' || 
      req.path === '/api/webhooks/lemonsqueezy') {
    // For webhooks, use raw body parser
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    // For all other routes, use JSON parser
    express.json({ limit: '10mb' })(req, res, () => {
      express.urlencoded({ extended: true })(req, res, next);
    });
  }
});

// --------------------------------------
// Setting index.ejs and security headers
// --------------------------------------

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// -------------------------------------------------------------------
// Updated Helmet Security Middleware with more relaxed CSS access
// -------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'", "*.lemonsqueezy.com", "*.cloudfront.net", "data:", "blob:"],
      
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "'unsafe-eval'",
        "www.googletagmanager.com",
        "www.google-analytics.com",
        "*.lemonsqueezy.com",
        "assets.lemonsqueezy.com",
        "d16sqexnkq44wp.cloudfront.net",
        "*.cloudfront.net",
        "blob:",
        "https://o4505075539902464.ingest.sentry.io",
        "*.redditstatic.com",
        "pixel.reddit.com",
        "*.redditmedia.com",
        "googleads.g.doubleclick.net",
        "www.googleadservices.com",
        "*.google.com",
        "*.doubleclick.net",
        "snap.licdn.com",
        "*.ads.linkedin.com",
        "https://www.googleadservices.com/pagead/conversion/*",
        "api.openai.com",
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        "*.googleadservices.com", 
        "*.googleads.g.doubleclick.net",
      ],
      
      scriptSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "*.lemonsqueezy.com",
        "*.cloudfront.net",
        "d16sqexnkq44wp.cloudfront.net",
        "https://o4505075539902464.ingest.sentry.io",
        "www.googletagmanager.com",
        "www.google-analytics.com",
        "*.redditstatic.com",
        "pixel.reddit.com",
        "*.redditmedia.com",
        "googleads.g.doubleclick.net",
        "*.googleadservices.com", 
        "*.googleads.g.doubleclick.net",
        "www.googleadservices.com",
        "*.google.com",
        "*.doubleclick.net",
        "snap.licdn.com",
        "*.ads.linkedin.com",
        "https://googleads.g.doubleclick.net/pagead/viewthroughconversion/*",  // Added specific path
        "https://www.googleadservices.com/pagead/conversion/*",  // Added specific path
        "*.google-analytics.com",
        "*.googletagmanager.com",
        "*.linkedin.com",
        "*.licdn.com",
      ],
      
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "fonts.googleapis.com",
        "*.lemonsqueezy.com",
        "*.cloudfront.net",
        "cdnjs.cloudflare.com"
      ],
      
      imgSrc: [
        "'self'", 
        "data:", 
        "blob:",
        "*.google.com",
        "www.google.co.il",
        "*.googletagmanager.com",
        "*.google-analytics.com",
        "*.lemonsqueezy.com",
        "*.redditstatic.com",
        "*.redditmedia.com",
        "pixel.reddit.com",
        "www.reddit.com",
        "alb.reddit.com",
        "googleads.g.doubleclick.net",
        "*.g.doubleclick.net",
        "*.googleadservices.com",
        "px.ads.linkedin.com",
        "*.licdn.com",
        "*.linkedin.com"
      ],
      
      connectSrc: [
        "'self'", 
        "api.openai.com",
        "www.google-analytics.com",
        "*.lemonsqueezy.com",
        "api.lemonsqueezy.com",
        "api-cors-anywhere.lemonsqueezy.com",
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        "*.redditstatic.com",
        "pixel.reddit.com",
        "*.reddit.com",
        "pixel-config.reddit.com",
        "conversions-config.reddit.com",
        "www.google.com",
        "www.google.co.il",
        'https://google.com/pagead/*',
        'https://google.com/ccm/*',
        '*.google.com',
        "*.doubleclick.net",
        "*.googleadservices.com",
        "*.g.doubleclick.net",
        "px.ads.linkedin.com",
        "*.licdn.com",
        "*.linkedin.com",
        "https://www.google.com/ccm/collect",  // Added specific path
        "https://www.google.com/pagead/1p-conversion/*"  // Added specific path
      ],
      
      frameSrc: [
        "'self'",
        "*.lemonsqueezy.com",
        "www.googletagmanager.com",
        "td.doubleclick.net",
        "*.doubleclick.net",
        "*.google.com",
        "*.linkedin.com"
      ],
      
      formAction: ["'self'", "*.lemonsqueezy.com"],
      workerSrc: ["'self'", "blob:", "*.lemonsqueezy.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      fontSrc: [
        "'self'", 
        "fonts.gstatic.com", 
        "*.lemonsqueezy.com", 
        "*.cloudfront.net",
        "cdnjs.cloudflare.com",
        "data:",
        "blob:", 
        "'unsafe-inline'",
        "*" 
      ],
      manifestSrc: ["'self'", "*.lemonsqueezy.com", "*.cloudfront.net"],
      mediaSrc: ["'self'", "*.lemonsqueezy.com", "*.cloudfront.net"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// -------------------------------------------------------------------
// Check environment variables
// -------------------------------------------------------------------
const requiredEnvVars = [
  'OPENAI_API_KEY',
  'LEMON_API_KEY',
  'LEMON_SQUEEZY_STORE_ID',
  'LEMON_SQUEEZY_VARIANT_ID',
  'LEMON_SQUEEZY_VARIANT_ID_BUNDLE',
  'APP_URL',
];

const missingEnvVars = requiredEnvVars.filter(varName => {
  if (!process.env[varName]) {
    logger.error(`Missing environment variable: ${varName}`);
    return true;
  }
  return false;
});

if (missingEnvVars.length > 0) {
  logger.error(`Missing environment variables: ${missingEnvVars.join(', ')}`);
  // Don't exit - Cloud Run will handle this
}

// -------------------------------------------------------------------
// Initialize OpenAI
// -------------------------------------------------------------------
logger.debug('Initializing OpenAI client...');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -------------------------------------------------------------------
// Serve front-end from the 'public' folder with updated headers for stylesheet access
// -------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    // Add CORS headers for all files
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    } else if (path.endsWith('.ico')) {
      res.setHeader('Content-Type', 'image/x-icon');
    }
  }
}));

// -------------------------------------------------------------------
// Initialize Lemon Squeezy routes
// -------------------------------------------------------------------
logger.info('Initializing LS routes...');
try {
  initLemonSqueezyRoutes(app, logger);
  logger.info('Lemon Squeezy routes initialized successfully');
} catch (error) {
  logger.error('Error initializing LS routes:', error);
}

// -------------------------------------------------------------------
// API Routes Group
// -------------------------------------------------------------------

// Health check endpoint
app.get('/health', (_req, res) => {
  // Check critical dependencies
  const healthCheck = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: Date.now(),
    environment: {
      NODE_ENV: process.env.NODE_ENV || 'not_set',
      DATA_STORAGE_TYPE: process.env.DATA_STORAGE_TYPE || 'not_set',
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasLemonSqueezy: !!process.env.LEMON_API_KEY
    }
  };

  try {
    // Add checks for critical services
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }
    
    if (!process.env.DATA_STORAGE_TYPE) {
      logger.warn('DATA_STORAGE_TYPE not set, using defaults');
    }

    res.status(200).json(healthCheck);
  } catch (error) {
    healthCheck.message = error.message;
    res.status(503).json(healthCheck);
  }
});


app.get('/', (_req, res, next) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  logger.info("Serving index.ejs");
  
  try {
    res.render('index', { 
      nonce,
      lemonsqueezyVariantId: process.env.LEMON_SQUEEZY_VARIANT_ID,
      appUrl: process.env.APP_URL || `http://${HOST}:${PORT}` // Changed from protocolUsed to http
    });
  } catch (error) {
    logger.error('Error in root route:', error);
    next(error);
  }
});


// -------------------------------------------------------------------
// /partial Endpoint (Minimal greeting / multi-turn step 1)
// -------------------------------------------------------------------
app.post('/partial', async (req, res) => {
  logger.info("'/partial' endpoint called.");
  try {
    const { conversation } = req.body;
    if (!conversation || !Array.isArray(conversation)) {
      return res.status(400).json({ error: "conversation array is required." });
    }

    const partialResponse = await openai.chat.completions.create({
      model: "o4-mini",
      messages: conversation,
    });

    const assistantReply = partialResponse.choices[0].message.content;
    logger.debug(`partial assistantReply: ${assistantReply.slice(0,200)}...`);

    return res.json({ assistantReply });
  } catch (err) {
    logger.error("Error in /partial endpoint:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

function removeMarkdownWrapper(text) {
  if (!text) return '';
  
  // Check if it starts with markdown code block
  if (text.startsWith('```')) {
    // Remove the opening markdown code fence with any language identifier
    let cleaned = text.replace(/^```\w*\s*\n/m, '');
    
    // Remove the closing markdown code fence
    cleaned = cleaned.replace(/\n```\s*$/m, '');
    
    return cleaned;
  }
  
  return text;
}

// -------------------------------------------------------------------
// /refine Endpoint (Multi-turn step 2)
// -------------------------------------------------------------------

// Refine Endpoint and Background Processing in index.mjs
// This is a partial file that shows only the modified parts

app.post('/refine', async (req, res) => {
  logger.info("🔥 '/refine' endpoint called.");
  logger.debug(`📝 Request body: ${JSON.stringify(req.body, null, 2)}`);

  // Validate the payload
  if (!req.body) {
    logger.error("❌ No request body received in /refine endpoint");
    return res.status(400).json({ error: "Request body missing" });
  }

  try {
    const { conversation, jobUrl, cvHTML, refinementLevel, orderId, jobId, tabSessionId } = req.body;
    
    // Enhanced logging for debugging
    logger.info(`Refinement level received as: ${typeof refinementLevel}: ${refinementLevel}`);
    logger.info(`Tab session ID: ${tabSessionId || 'not provided'}`);

    // Skip conversation check for webhook calls which may not have a conversation
    if (!orderId && (!conversation || !Array.isArray(conversation))) {
      logger.error("❌ Missing or invalid conversation array");
      return res.status(400).json({ error: "conversation array is required." });
    }
    
    if (!jobUrl || !cvHTML) {
      logger.error("❌ Missing jobUrl or cvHTML in request");
      return res.status(400).json({ error: "jobUrl and cvHTML are required." });
    }

    // Convert refinementLevel to a number (default to 5 if not provided)
    // More robust parsing with fallbacks
    let level = 5; // Default
    
    if (refinementLevel !== undefined && refinementLevel !== null) {
      const parsed = parseInt(refinementLevel, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
        level = parsed;
      }
    }
    
    logger.info(`Using final refinement level: ${level}`);
    
    let additionalInstruction = "";
    if (level <= 3) {
      additionalInstruction = "Make only minimal changes.";
    } else if (level <= 7) {
      additionalInstruction = "Make moderate refinements.";
    } else {
      additionalInstruction = "Apply strong, aggressive refinements tailored to the job description.";
    }

    // Store with jobId as the key, including tabSessionId
    if (jobId) {
      const existingData = await getJobData(jobId) || {};
      await setJobData(jobId, { 
        ...existingData,
        jobUrl,
        cvHTML,
        refinementLevel: level,
        tabSessionId,
      });
      logger.info(`✅ Updated job data for jobId: ${jobId} with refinement level: ${level} and tabSessionId: ${tabSessionId}`);
    }

    // CRITICAL: Check if this is a webhook call (has orderId) - if so, reply immediately
    // and do the processing after responding
    if (orderId) {
      logger.info("✅ Webhook-triggered refinement starting");
      res.status(200).json({ 
        status: "success", 
        message: "Refinement process started" 
      });
      
      // Continue processing in the background
      processRefinementAsync(req.body, logger)
        .catch(err => logger.error(`Background processing error: ${err.message}`));
      
      return; // Stop further execution of this handler
    }

    // For normal user-initiated calls, continue with synchronous processing
    // -------------------------------------------------------------------
    // 1. Fetch the job page
    // -------------------------------------------------------------------
    logger.info("Fetching job description page...");
    const jobResponse = await fetch(jobUrl);
    logger.debug(`Job page fetch status: ${jobResponse.status}`);
    if (!jobResponse.ok) {
      throw new Error('Failed to fetch the job description page.');
    }
    const jobHtml = await jobResponse.text();
    logger.debug(`jobHtml length: ${jobHtml.length}`);

    // -------------------------------------------------------------------
    // 2. Extract text from job page
    // -------------------------------------------------------------------
    logger.info("Extracting text from job page...");
    const $ = load(jobHtml);
    const jobTextRaw = $('body').text() || "";
    logger.debug(`jobTextRaw length: ${jobTextRaw.length}`);
    const jobDescription = jobTextRaw.replace(/\s+/g, ' ').trim();
    logger.debug(`jobDescription (first 100 chars): ${jobDescription.slice(0, 100)}`);

    // -------------------------------------------------------------------
    // 3. Extract keywords from the job description
    // -------------------------------------------------------------------
    logger.info("Using OpenAI to extract keywords...");
    const keywordsPrompt = `Extract the key: skills, qualifications, keywords, and optimization recommendations from this job description so we can pass ATS systems. Return them line-separated:\n\n"${jobDescription}"`;
    logger.debug(`keywordsPrompt: ${keywordsPrompt.slice(0,300)}...`);

    const keywordsResp = await openai.chat.completions.create({
      model: "o4-mini",
      messages: [{ role: "user", content: keywordsPrompt }],
    });
    logger.debug(`keywordsResp raw: ${JSON.stringify(keywordsResp, null, 2).slice(0,500)}...`);

    const extractedKeywords = keywordsResp.choices[0].message.content.trim();
    logger.info(`Extracted keywords: ${extractedKeywords}`);

    // -------------------------------------------------------------------
    // 4. Append a final user message with the full CV, job URL, refinement level, and additional instruction.
    // -------------------------------------------------------------------
    const newConversation = [...conversation]; // Create a copy to avoid modifying the original
    newConversation.push({
      role: "user",
      content: createCVRefinementPrompt(
        extractedKeywords, 
        cvHTML, 
        level, 
        additionalInstruction
      )
    });

    // -------------------------------------------------------------------
    // 5. Call the model again with the updated conversation
    // -------------------------------------------------------------------
    const refineResp = await openai.chat.completions.create({
      model: "o4-mini",
      messages: newConversation,
    });
    logger.debug(`refineResp raw: ${JSON.stringify(refineResp, null, 2).slice(0,500)}...`);

    const finalReply = refineResp.choices[0].message.content.trim();
    const cleanedReply = removeMarkdownWrapper(finalReply);

    logger.debug(`final CV (first 200 chars): ${finalReply.slice(0,200)}`);
    logger.info("Refined CV length:", finalReply.length);

    // -------------------------------------------------------------------
    // 6. Compute a diff between the original CV and the refined CV
    // -------------------------------------------------------------------

    // Simpler text normalization without DOM manipulation
    const normalize = str => {
      // Remove HTML tags
      const withoutTags = str.replace(/<[^>]*>/g, ' ');
      // Normalize whitespace
      return withoutTags.replace(/\s+/g, ' ').trim();
    };

    try {
      const normalizedOriginal = normalize(cvHTML);
      const normalizedRefined = normalize(finalReply);
      const changes = diffWords(normalizedOriginal, normalizedRefined);
      
      let changesHtml = "";
      for (const part of changes) {
        const value = part.value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (part.added) {
          changesHtml += `<span class="diff-added">${value}</span>`;
        } else if (part.removed) {
          changesHtml += `<span class="diff-removed">${value}</span>`;
        } else {
          changesHtml += value;
        }
      }
      logger.info("Computed changes diff.");

      // Store results using jobId as the key if provided
      if (jobId) {
        const existingData = jobDataStorage.get(jobId) || {};
        jobDataStorage.set(jobId, {
          ...existingData,
          jobUrl,
          cvHTML,
          refinedHTML: cleanedReply,
          changes: changesHtml,
          extractedKeywords,
          completedAt: new Date().toISOString(),
          tabSessionId, // Include tabSessionId in the stored results
        });
        logger.info(`✅ Refinement results stored for jobId: ${jobId} with tabSessionId: ${tabSessionId}`);
      }

      return res.json({ 
        status: "success",
        message: "Refinement complete",
        refinedHTML: cleanedReply, // <-- Use the cleaned version
        changes: changesHtml,
        extractedKeywords: extractedKeywords 
      });

    } catch (diffErr) {
      logger.error("Error in diff computation:", diffErr);
      // Return the refined CV even if diff fails
      return res.json({ 
        refinedHTML: finalReply,
        changes: null,
        extractedKeywords: extractedKeywords,
        error: "Could not compute changes diff"
      });
    }

  } catch (err) {
    logger.error("Error in /refine endpoint:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Helper function to process refinement asynchronously (for webhook calls)
   async function processRefinementAsync(data, logger) {
    try {
      const { jobUrl, cvHTML, refinementLevel, conversation = [], jobId } = data;
      
      // Enhanced logging for the background process
      logger.info(`Background process received refinement level: ${refinementLevel}`);
      
      // Parse the refinement level with the same robust approach
      let level = 5; // Default
      
      if (refinementLevel !== undefined && refinementLevel !== null) {
        const parsed = parseInt(refinementLevel, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
          level = parsed;
        }
      }
      
      logger.info(`Background process using refinement level: ${level}`);
      
    // 1. Fetch the job page
    logger.info("Background: Fetching job description page...");
    const jobResponse = await fetch(jobUrl);
    if (!jobResponse.ok) {
      throw new Error('Failed to fetch the job description page.');
    }
    
    const jobHtml = await jobResponse.text();
    
    // 2. Extract text from job page
    const $ = load(jobHtml);
    const jobTextRaw = $('body').text() || "";
    const jobDescription = jobTextRaw.replace(/\s+/g, ' ').trim();
    
    // 3. Extract keywords from the job description
    const keywordsPrompt = `Extract the key: skills, qualifications, keywords, and optimization recommendations from this job description so we can pass ATS systems. Return them line-separated:\n\n"${jobDescription}"`;
    
    const keywordsResp = await openai.chat.completions.create({
      model: "o4-mini",
      messages: [{ role: "user", content: keywordsPrompt }],
    });
    
    const extractedKeywords = keywordsResp.choices[0].message.content.trim();
    
    // 4. Create a message for refinement
    let additionalInstruction = "";
    if (level <= 3) {
      additionalInstruction = "Make only minimal changes.";
    } else if (level <= 7) {
      additionalInstruction = "Make moderate refinements.";
    } else {
      additionalInstruction = "Apply strong, aggressive refinements tailored to the job description.";
    }
    
    const messages = conversation.length > 0 ? [...conversation] : [
      { role: "user", content: createInitialGreeting() },
      {
        role: "user",
        content: createCVRefinementPrompt(
          extractedKeywords, 
          cvHTML, 
          level, 
          additionalInstruction
        )
      }
    ];

    // 5. Call the model with the messages
    const refineResp = await openai.chat.completions.create({
      model: "o4-mini",
      messages: messages,
    });
    
    const finalReply = refineResp.choices[0].message.content.trim();
    const cleanedReply = removeMarkdownWrapper(finalReply); // Add this line

    logger.info("Background: Refinement completed, CV length:", finalReply.length);
    logger.debug(`final CV (first 200 chars): ${finalReply.slice(0,200)}`);

    // 6. Compute a diff between the original CV and the refined CV
    const normalize = str => {
      const withoutTags = str.replace(/<[^>]*>/g, ' ');
      return withoutTags.replace(/\s+/g, ' ').trim();
    };

    try {
      const normalizedOriginal = normalize(cvHTML);
      const normalizedRefined = normalize(finalReply);
      const changes = diffWords(normalizedOriginal, normalizedRefined);
      
      let changesHtml = "";
      for (const part of changes) {
        const value = part.value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (part.added) {
          changesHtml += `<span class="diff-added">${value}</span>`;
        } else if (part.removed) {
          changesHtml += `<span class="diff-removed">${value}</span>`;
        } else {
          changesHtml += value;
        }
      }
      logger.info("Computed changes diff.");

      // We're done processing - store results with jobId as the key
      if (jobId) {
        // Get existing data to preserve any fields
        const existingData = jobDataStorage.get(jobId) || {};
        // Store results with all data in one place
        await setJobData(jobId, {
          ...existingData,
          jobUrl,
          cvHTML,
          refinedHTML: cleanedReply,
          changes: changesHtml,
          extractedKeywords,
          completedAt: new Date().toISOString()
        });
        
        logger.info(`✅ Refinement results stored for jobId: ${jobId}`);
      } else {
        logger.error("No jobId provided for storing results");
      }
      
      logger.info("Background processing completed successfully");

      return {
        status: "success",
        message: "Refinement complete",
        refinedHTML: cleanedReply,
        changes: changesHtml,
        extractedKeywords
      };

    } catch (diffErr) {
      logger.error("Error in diff computation:", diffErr);
      // Return the refined CV even if diff fails
      
      // Still store the result without changes
      if (jobId) {
        const existingData = await getJobData(jobId) || {};
        await setJobData(jobId, {
          ...existingData,
          jobUrl,
          cvHTML,
          refinedHTML: cleanedReply,
          changes: changesHtml,
          extractedKeywords,
          completedAt: new Date().toISOString()
        });
      }
      
      return { 
        refinedHTML: cleanedReply,
        changes: null,
        extractedKeywords: extractedKeywords,
        error: "Could not compute changes diff"
      };
    }

  } catch (err) {
    logger.error(`❌ Background processing failed: ${err.message}`);
    throw err;
  }
}

const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  logger.info(`Server running at http://${HOST}:${PORT}`);
  console.log(`Server is listening on port ${PORT}`);
});

server.on('error', (error) => {
  logger.error('Server error:', error.message);
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Export the server and app for use in other parts of your code
export { app, server };

// -------------------------------------------------------------------
// Serve index.html if needed
// -------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' ? 
      'Internal server error' : 
      err.message 
  });
});

/*
// Start everything
initializeServices().catch(error => {
  logger.error('Error during service initialization:', error);
});
*/