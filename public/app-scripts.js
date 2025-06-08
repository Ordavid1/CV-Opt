// app-scripts.js - Combined script file for CV Optimizer

document.addEventListener('DOMContentLoaded', function() {
  console.log("Initializing CV Optimizer scripts");

    // Check if free pass may have been used in a previous session
    function checkPreviousFreePassUsage() {
      // Look for indicators in localStorage
      const freePassUsed = localStorage.getItem('freePassUsed') === 'true';
      
      if (freePassUsed) {
        // Update UI to reflect that free pass was used
        document.body.classList.add('free-pass-used');
        
        const freePassStatus = document.getElementById('free-pass-status');
        if (freePassStatus) {
          freePassStatus.style.display = 'none';
        }
        
        // Update checkout button text
        const checkoutButton = document.getElementById('checkout-button');
        if (checkoutButton) {
          checkoutButton.innerHTML = '<span class="button-icon">✨</span>Optimize Me! ($1)';
        }
      }
    }
    
    // Call on page load
    checkPreviousFreePassUsage();
    
    // Also capture free pass usage when it happens
    window.addEventListener('message', function(event) {
      // Check for our custom free pass message
      if (event.data && event.data.type === 'free-pass-used') {
        localStorage.setItem('freePassUsed', 'true');
        document.body.classList.add('free-pass-used');
      }
    });
  
  // Modify the existing pollRefinementStatus to handle free pass results
  const originalPoll = window.pollRefinementStatus;
  if (typeof originalPoll === 'function') {
    window.pollRefinementStatus = function(jobId) {
      // Check if this was a free pass refinement
      const freePass = localStorage.getItem('freePassUsed') !== 'true';
      if (freePass) {
        // Mark as used after successful processing starts
        localStorage.setItem('freePassUsed', 'true');
        document.body.classList.add('free-pass-used');
        
        // Dispatch an event for other parts of the app
        window.dispatchEvent(new CustomEvent('freePassUsed'));
      }
      
      // Call the original function
      return originalPoll.call(this, jobId);
    }}
  
  /* ------------------------------------------------------
   * SECTION 1: ERROR HANDLING
   * Intercepts and suppresses common CSS errors
   * ------------------------------------------------------ */
  (function() {
    // Create a proxy for console.error to filter out specific stylesheet errors
    const originalConsoleError = console.error;
    console.error = function() {
      // Check if the error is about cssRules
      if (arguments[0] && typeof arguments[0] === 'string' && 
          (arguments[0].includes('cssRules') || 
           arguments[0].includes('Cannot access rules'))) {
        // Silently ignore this specific error
        return;
      }
      // Pass all other errors to the original console.error
      return originalConsoleError.apply(console, arguments);
    };
    
    // Add a global error handler to catch and suppress stylesheet errors
    window.addEventListener('error', function(event) {
      if (event.error && event.error.message && 
          (event.error.message.includes('cssRules') || 
           event.error.message.includes('Cannot access rules'))) {
        event.preventDefault();
        return true; // Prevents the error from propagating
      }
    }, true);
  })();

  /* ------------------------------------------------------
   * SECTION 2: PAYMENT HANDLING
   * Handles payment success detection and modal management
   * ------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', function() {
  console.log("🚀 Initializing ultimate payment handling system");
  
  // Global payment status tracking
  window.paymentSuccessHandled = false;
  window.paymentInProgress = false;
  window.forceCloseTimer = null;
  
  // Configuration
  const CONFIG = {
    INITIAL_DELAY: 3000,     // Initial delay before processing success
    FORCE_CLOSE_DELAY: 7000, // Time to wait before forced close after success
    FAILSAFE_TIMEOUT: 30000, // Auto-close modal after 30 seconds regardless of state
    BACKEND_CHECK_INTERVAL: 8000, // Check backend every 8 seconds
    DEBUG: true              // Enable verbose logging
  };
  
  // Debug logging function
  function debugLog(message, data) {
    if (window.debugEnabled) {
    if (CONFIG.DEBUG) {
      console.log(`[PAYMENT] ${message}`, data !== undefined ? data : '');
    }}
  }
  
  // Force close the modal regardless of state
  function forceCloseModal() {
    debugLog("⚠️ FORCE CLOSING MODAL");
    const modal = document.getElementById('checkout-modal');
    if (modal) {
      modal.classList.remove('open');
      setTimeout(() => {
        const iframe = document.getElementById('checkout-iframe');
        if (iframe) {
          iframe.src = 'about:blank';
        }
        document.body.style.overflow = '';
      }, 300);
    }
  }
  
  // Main success handler with MAXIMUM robustness
  function handlePaymentSuccess(source) {
    debugLog(`✅ Payment success from: ${source}`);
    
    // Prevent duplicate handling
    if (window.paymentSuccessHandled) {
      debugLog("Payment already handled, skipping");
      return;
    }
    
    // Update UI immediately
    const messageElement = document.getElementById('result-message');
    if (messageElement) {
      messageElement.textContent = '✅ Payment received! Processing your payment...';
    }
    
    // Set a flag to indicate we've detected a success
    window.paymentSuccessDetected = true;
    
    // Schedule the forced close as a backup
    debugLog(`Scheduling forced close in ${CONFIG.FORCE_CLOSE_DELAY/1000} seconds`);
    
    // Clear any existing timer
    if (window.forceCloseTimer) {
      clearTimeout(window.forceCloseTimer);
    }
    
    // Set a new force close timer
    window.forceCloseTimer = setTimeout(() => {
      debugLog("Force close timer activated");
      if (!window.paymentSuccessHandled) {
        debugLog("Payment wasn't fully handled, forcing completion");
        completePaymentProcess(source + " (forced)");
      }
    }, CONFIG.FORCE_CLOSE_DELAY);
    
    // Begin normal payment completion with initial delay
    debugLog(`Starting normal completion in ${CONFIG.INITIAL_DELAY/1000} seconds`);
    setTimeout(() => {
      completePaymentProcess(source);
    }, CONFIG.INITIAL_DELAY);
  }
  
  // Complete the payment process and close the modal
  function completePaymentProcess(source) {
    debugLog(`Completing payment process from: ${source}`);
    
    // Set all payment flags
    window.paymentSuccessHandled = true;
    window.paymentCompleted = true;
    window.paymentInProgress = false;
    
    // Update UI
    const messageElement = document.getElementById('result-message');
    if (messageElement) {
      messageElement.textContent = '✅ Payment successful! Processing your request...';
    }
    
    // DEFINITELY close the modal
    debugLog("🔒 EXECUTING MODAL CLOSE");
    forceCloseModal();
    
    // Start refinement after a short delay
    setTimeout(() => {
      startRefinementProcess();
    }, 1000);
  }
  
  // Start the refinement process
  function startRefinementProcess() {
    debugLog("Starting refinement process");
    const jobId = sessionStorage.getItem('currentJobId') || localStorage.getItem('currentJobId');
    
    if (!jobId) {
      console.error("No jobId found for processing");
      return;
    }
    
    window.checkoutCompleted = false;
    
    // Try all possible ways to start processing
    if (typeof pollRefinementStatus === 'function') {
      debugLog("Using pollRefinementStatus");
      pollRefinementStatus(jobId);
    } else if (typeof window.monitorForResults === 'function') {
      debugLog("Using monitorForResults");
      window.monitorForResults();
    } else if (typeof window.startRefinement === 'function') {
      debugLog("Using startRefinement");
      window.startRefinement();
    } else {
      console.error("No refinement function found");
      
      // Last-resort attempt - try to directly call the backend
      fetch('/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, fallback: true })
      }).catch(e => console.error("Error with fallback refinement:", e));
    }
  }
  
  // Manual modal close handler
  function closeCheckoutModal() {
    debugLog("Manual modal close requested");
    
    // If a payment appears to be in progress, show a warning
    if (window.paymentInProgress && !window.paymentSuccessHandled && !window.paymentSuccessDetected) {
      if (!confirm("A payment may be in progress. Are you sure you want to close this window?")) {
        return;
      }
    }
    
    forceCloseModal();
  }
  
  // Make functions globally available
  window.handlePaymentSuccess = handlePaymentSuccess;
  window.closeCheckoutModal = closeCheckoutModal;
  if (window.debugEnabled) {
  window.debugPaymentSystem = function() {
    console.log("=== PAYMENT SYSTEM STATE ===");
    console.log("paymentSuccessHandled:", window.paymentSuccessHandled);
    console.log("paymentCompleted:", window.paymentCompleted);
    console.log("paymentInProgress:", window.paymentInProgress);
    console.log("paymentSuccessDetected:", window.paymentSuccessDetected);
    console.log("checkoutCompleted:", window.checkoutCompleted);
    console.log("forceCloseTimer:", window.forceCloseTimer !== null);
    console.log("=== END STATE ===");
  }};
  
  // FAILSAFE: Force close after maximum time regardless of state
  function setupFailsafeTimeout() {
    const checkoutButton = document.getElementById('checkout-button');
    if (!checkoutButton) return;
    
    checkoutButton.addEventListener('click', function() {
      debugLog(`Setting up failsafe timeout: ${CONFIG.FAILSAFE_TIMEOUT/1000} seconds`);
      
      // After the failsafe timeout, force close the modal
      setTimeout(() => {
        const modal = document.getElementById('checkout-modal');
        if (modal && modal.classList.contains('open')) {
          debugLog("⚠️ FAILSAFE TIMEOUT REACHED - forcing modal close");
          
          // If payment not already handled, mark as success and process
          if (!window.paymentSuccessHandled && !window.paymentCompleted) {
            // Check with backend one last time
            const jobId = sessionStorage.getItem('currentJobId') || localStorage.getItem('currentJobId');
            if (jobId) {
              fetch('/api/refinement-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId })
              })
              .then(response => response.json())
              .then(data => {
                if (data.status === 'processing' || data.status === 'completed') {
                  // Backend says process started, so payment succeeded
                  handlePaymentSuccess('failsafe backend check');
                } else {
                  // No indication of success, just close the modal
                  forceCloseModal();
                }
              })
              .catch(e => {
                // On error, just close the modal
                forceCloseModal();
              });
            } else {
              forceCloseModal();
            }
          } else {
            forceCloseModal();
          }
        }
      }, CONFIG.FAILSAFE_TIMEOUT);
    });
  }
  
  // Initialize the failsafe timeout
  setupFailsafeTimeout();
  
  // ----------------------
  // EVENT LISTENERS SECTION
  // ----------------------
  
  // Detect iframe URL changes for success
  function monitorIframeForSuccess() {
    const iframe = document.getElementById('checkout-iframe');
    if (!iframe) return;
    
    debugLog("Setting up iframe success detection");
    
    // Track when iframe loads
    iframe.onload = function() {
      debugLog("Iframe loaded - payment entry may be starting");
      window.paymentInProgress = true;
      
      // Try to send a message to the iframe
      try {
        iframe.contentWindow.postMessage('parent-ready', '*');
      } catch (e) {
        // Ignore cross-origin errors
      }
    };
    
    // Check iframe URL for success patterns
    const checkInterval = setInterval(() => {
      try {
        const url = iframe.contentWindow.location.href;
        debugLog("Checking iframe URL:", url);
        
        // Check for success indicators in URL
        const successPatterns = ['/success', '/thank-you', '/confirmation', 
                               '/complete', '/confirmed', 'status=completed',
                               'status=success', 'payment_status=paid'];
        
        for (const pattern of successPatterns) {
          if (url.includes(pattern)) {
            debugLog(`✨ Success pattern found in URL: ${pattern}`);
            clearInterval(checkInterval);
            handlePaymentSuccess('iframe URL pattern match');
            return;
          }
        }
      } catch (e) {
        // Ignore cross-origin errors
      }
    }, 1000);
    
    // Clear interval after 5 minutes maximum
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 300000);
  }
  
  // Direct iframe communication attempt
  function setupIframeCommunication() {
    debugLog("Setting up direct iframe communication");
    
    // When checkout-iframe is updated, try to communicate with it
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'attributes' && 
            mutation.attributeName === 'src' && 
            mutation.target.id === 'checkout-iframe') {
          
          const iframe = document.getElementById('checkout-iframe');
          if (iframe && iframe.src && iframe.src !== 'about:blank') {
            debugLog("Iframe src changed, attempting communication");
            
            setTimeout(() => {
              try {
                // Try to send a message to the iframe
                iframe.contentWindow.postMessage({ 
                  type: 'parent-ready',
                  source: 'cv-optimizer-parent'
                }, '*');
              } catch (e) {
                // Ignore cross-origin errors
              }
            }, 1000);
            
            // Start monitoring for success in URL
            monitorIframeForSuccess();
          }
        }
      });
    });
    
    // Start observing the document
    observer.observe(document, { 
      attributes: true, 
      childList: true, 
      subtree: true 
    });
  }
  
  // Initialize iframe communication
  setupIframeCommunication();
  
  // Global message listener for maximum compatibility
  window.addEventListener('message', function(event) {
    debugLog("Message received:", event.data);
    
    // Don't process messages from this window
    if (event.source === window) {
      return;
    }
    
    // String message handling (common with LS)
    if (typeof event.data === 'string') {
      debugLog("String message received:", event.data);
      
      const successIndicators = [
        'checkout-completed', 'success', 'checkout:success',
        'payment-success', 'payment_success', 'order_created',
        'payment_completed', 'order-success'
      ];
      
      for (const indicator of successIndicators) {
        if (event.data.includes(indicator)) {
          debugLog(`✨ Success indicator found in message: ${indicator}`);
          handlePaymentSuccess('string message pattern match');
          return;
        }
      }
    }
    
    // Object message handling (LS API format)
    if (typeof event.data === 'object' && event.data !== null) {
      debugLog("Object message received:", JSON.stringify(event.data));
      
      // Check all known patterns for success
      if (
        // Lemon Squeezy success patterns
        (event.data.type === 'checkout:success') ||
        (event.data.event === 'checkout:success') ||
        // Webhook patterns
        (event.data.meta && event.data.meta.event_name === 'order_created') ||
        (event.data.data && event.data.data.type === 'checkouts' && 
         event.data.data.attributes && event.data.data.attributes.status === 'paid') ||
        // Alert patterns
        (event.data.status === 'success') ||
        (event.data.payment_status === 'paid') ||
        (event.data.completed === true)
      ) {
        debugLog("✨ Success pattern matched in object message");
        handlePaymentSuccess('object message pattern match');
      }
    }
  }, false);
  
  // Initialize Lemon Squeezy handler
  function initLemonSqueezy() {
    if (typeof window.createLemonSqueezy !== 'function') {
      debugLog("LemonSqueezy SDK not available");
      return;
    }
    
    debugLog("Setting up LemonSqueezy SDK");
    
    try {
      window.createLemonSqueezy();
      
      if (window.LemonSqueezy) {
        window.LemonSqueezy.Setup({
          eventHandler: function(event) {
            debugLog("LemonSqueezy direct event:", event);
            
            // Check for success event from LS
            if (event.event === 'checkout:success' || 
                event.type === 'checkout:success') {
              debugLog("✨ LemonSqueezy direct success event detected");
              handlePaymentSuccess('LemonSqueezy direct event');
            }
          }
        });
        debugLog("LemonSqueezy handler initialized successfully");
      } else {
        debugLog("LemonSqueezy object not available after initialization");
      }
    } catch (e) {
      console.error("Error initializing LemonSqueezy:", e);
    }
  }
  
  // Initialize Lemon Squeezy
  initLemonSqueezy();
  
  // Backend polling system - check for payment confirmation
  function setupBackendPolling() {
    const checkoutButton = document.getElementById('checkout-button');
    if (!checkoutButton) return;
    
    checkoutButton.addEventListener('click', function() {
      debugLog("Setting up backend polling system");
      
      // Wait for modal to open before starting polling
      setTimeout(function startBackendPolling() {
        // Skip if payment already handled
        if (window.paymentSuccessHandled || window.paymentCompleted) {
          debugLog("Payment already handled, stopping backend polling");
          return;
        }
        
        // Check if modal is open
        const modal = document.getElementById('checkout-modal');
        if (!modal || !modal.classList.contains('open')) {
          debugLog("Modal not open, skipping backend poll");
          return;
        }
        
        debugLog("Polling backend for payment status");
        
        // Get the current jobId
        const jobId = sessionStorage.getItem('currentJobId') || localStorage.getItem('currentJobId');
        if (!jobId) {
          debugLog("No jobId found, skipping backend poll");
          return;
        }
        
        // Check refinement status
        fetch('/api/refinement-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId })
        })
        .then(response => response.json())
        .then(data => {
          debugLog("Backend poll response:", data);
          
          // If refinement is processing or completed, payment succeeded
          if (data.status === 'processing' || data.status === 'completed') {
            debugLog("✨ Backend indicates successful payment");
            handlePaymentSuccess('backend polling');
          } else {
            // Schedule next check if modal still open
            if (modal && modal.classList.contains('open')) {
              debugLog(`Scheduling next backend poll in ${CONFIG.BACKEND_CHECK_INTERVAL/1000}s`);
              setTimeout(startBackendPolling, CONFIG.BACKEND_CHECK_INTERVAL);
            }
          }
        })
        .catch(e => {
          console.error("Error polling backend:", e);
          // Continue polling despite errors
          if (modal && modal.classList.contains('open')) {
            setTimeout(startBackendPolling, CONFIG.BACKEND_CHECK_INTERVAL);
          }
        });
      }, 20000); // Start first poll after 20 seconds
    });
  }
  
  // Initialize backend polling
  setupBackendPolling();
  
  // Setup checkout button listener
  const checkoutButton = document.getElementById('checkout-button');
  if (checkoutButton) {
    checkoutButton.addEventListener('click', function() {
      debugLog("Checkout button clicked - resetting payment state");
      
      // Reset all payment tracking variables
      window.paymentSuccessHandled = false;
      window.paymentCompleted = false;
      window.paymentInProgress = false;
      window.paymentSuccessDetected = false;
      window.checkoutCompleted = false;
      
      // Clear any existing force close timer
      if (window.forceCloseTimer) {
        clearTimeout(window.forceCloseTimer);
        window.forceCloseTimer = null;
      }
      
      // Start monitoring for iframe loading
      setTimeout(() => {
        monitorIframeForSuccess();
      }, 2000);
    });
  }
  
  // Setup modal close handlers
  const modal = document.getElementById('checkout-modal');
  const closeBtn = document.getElementById('close-checkout');
  
  if (modal) {
    modal.addEventListener('click', function(event) {
      if (event.target === this) {
        closeCheckoutModal();
      }
    });
  }
  
  if (closeBtn) {
    closeBtn.addEventListener('click', closeCheckoutModal);
  }
  
  // ESC key handler
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      const modal = document.getElementById('checkout-modal');
      if (modal && modal.classList.contains('open')) {
        closeCheckoutModal();
      }
    }
  });

  // Add debug key combo (Ctrl+Shift+P)
  document.addEventListener('keydown', function(event) {
    if (event.ctrlKey && event.shiftKey && event.key === 'P') {
      window.debugPaymentSystem();
    }
  });
  
  debugLog("Ultimate payment handling system initialized");
});

// Updated modal open/close functions
function showCheckoutModal(url) {
  const checkoutIframe = document.getElementById('checkout-iframe');
  const checkoutModal = document.getElementById('checkout-modal');
  
  if (checkoutIframe && checkoutModal) {
    // Set iframe source if provided
    if (url) {
      checkoutIframe.src = url;
    }
    
    // Reset any closing animation class
    checkoutModal.classList.remove('closing');
    
    // Trigger the open animation by adding the open class
    setTimeout(() => {
      checkoutModal.classList.add('open');
      document.body.style.overflow = 'hidden'; // Prevent scrolling behind modal
    }, 10); // Small delay to ensure transition works
  }
}

function hideCheckoutModal() {
  const checkoutModal = document.getElementById('checkout-modal');
  const checkoutIframe = document.getElementById('checkout-iframe');
  
  if (checkoutModal) {
    // Add closing class for a different animation when closing
    checkoutModal.classList.add('closing');
    
    // Remove open class to start transition
    checkoutModal.classList.remove('open');
    
    // Wait for animation to finish before fully hiding and clearing iframe
    setTimeout(() => {
      // Reset iframe source
      if (checkoutIframe) {
        checkoutIframe.src = 'about:blank';
      }
      
      // Remove closing class
      checkoutModal.classList.remove('closing');
      
      // Re-enable page scrolling
      document.body.style.overflow = '';
    }, 500); // Match the duration of the CSS transition
  }
}

// Event listeners for close button and escape key
document.addEventListener('DOMContentLoaded', function() {
  const closeBtn = document.getElementById('close-checkout');
  const checkoutModal = document.getElementById('checkout-modal');
  
  if (closeBtn) {
    closeBtn.addEventListener('click', hideCheckoutModal);
  }
  
  // Close when clicking outside the modal content
  if (checkoutModal) {
    checkoutModal.addEventListener('click', function(event) {
      // Only close if clicking directly on the overlay (not the container)
      if (event.target === this) {
        hideCheckoutModal();
      }
    });
  }
  
  // Close with Escape key
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape' && checkoutModal && checkoutModal.classList.contains('open')) {
      hideCheckoutModal();
    }
  });
});

// Make sure functions are available globally
window.showCheckoutModal = showCheckoutModal;
window.hideCheckoutModal = hideCheckoutModal;

  /* ------------------------------------------------------
   * SECTION 3: CV AND JOB URL PERSISTENCE
   * Saves and loads CV content and job URL across sessions
   * ------------------------------------------------------ */

  // ----- Job URL Persistence -----
  const jobUrlInput = document.getElementById('jobUrlInput');
  if (jobUrlInput) {
    // Load saved job URL
    const savedJobURL = localStorage.getItem('savedJobURL');
    if (savedJobURL) {
      jobUrlInput.value = savedJobURL;
      console.log("Loaded saved job URL");
    }
    
    // Save job URL when it changes
    function saveJobURL() {
      const url = jobUrlInput.value.trim();
      if (url) {
        localStorage.setItem('savedJobURL', url);
        console.log("Job URL saved to localStorage");
      }
    }
    
    // Add event listeners to save job URL
    jobUrlInput.addEventListener('input', function() {
      if (this.value.trim()) {
        localStorage.setItem('savedJobURL', this.value.trim());
      }
    });
    jobUrlInput.addEventListener('change', saveJobURL);
    jobUrlInput.addEventListener('blur', saveJobURL);
  }
  
  // ----- CV Content Persistence -----
  // Function to save CV content
  function saveCV() {
    const inputFrame = document.getElementById('cvInputFrame');
    if (!inputFrame || !inputFrame.contentDocument) return;
    
    const content = inputFrame.contentDocument.body.innerHTML;
    // Only save if it's not the placeholder and not empty
    if (!content.includes('class="placeholder"') && 
        content.trim() !== '' && 
        content !== '<br>') {
      sessionStorage.setItem('savedCVContent', content);
      console.log("CV content saved to localStorage");
    }
  }
  
  // Function to load saved CV into the input frame
  function loadSavedCV() {
    const savedCV = localStorage.getItem('savedCVContent');
    if (!savedCV) {
      console.log("No saved CV content found");
      return;
    }
    
    const inputFrame = document.getElementById('cvInputFrame');
    if (!inputFrame || !inputFrame.contentDocument) {
      console.log("CV input frame not accessible yet");
      return;
    }
    
    // Replace placeholder with saved content
    const doc = inputFrame.contentDocument;
    if (doc.body.innerHTML.includes('class="placeholder"') || 
        doc.body.innerHTML.trim() === '' || 
        doc.body.innerHTML === '<br>') {
      
      // Ensure design mode is enabled
      doc.designMode = 'on';
      
      // Set the content
      doc.body.innerHTML = savedCV;
      console.log("Loaded saved CV content");
    }
  }
  
  // Set up event listeners on the CV input frame
  function setupCVEvents() {
    const inputFrame = document.getElementById('cvInputFrame');
    if (!inputFrame || !inputFrame.contentDocument) {
      return false;
    }
    
    const doc = inputFrame.contentDocument;
    
    // Check if listeners are already attached
    if (doc.body.hasAttribute('data-has-save-listeners')) {
      return true;
    }
    
    // Mark that we've attached listeners
    doc.body.setAttribute('data-has-save-listeners', 'true');
    
    // Add event listeners to save CV when it changes
    doc.body.addEventListener('input', saveCV);
    doc.body.addEventListener('keyup', saveCV);
    doc.body.addEventListener('paste', function() {
      // Wait a moment for paste to complete
      setTimeout(saveCV, 100);
    });
    if (window.debugEnabled) {
    console.log("Added CV content save listeners");
    }
    return true;
  }
  
  // Try initial CV setup at different times
  setTimeout(loadSavedCV, 500);
  setTimeout(loadSavedCV, 1500);
  setTimeout(setupCVEvents, 800);
  setTimeout(setupCVEvents, 1800);
  
  // Monitor iframe loads
  const inputFrame = document.getElementById('cvInputFrame');
  if (inputFrame) {
    inputFrame.addEventListener('load', function() {
      console.log("CV input frame loaded, setting up persistence");
      setTimeout(loadSavedCV, 200);
      setTimeout(setupCVEvents, 300);
    });
  }
  
  // Create a MutationObserver to detect when the iframe is ready
  const targetNode = document.body;
  const config = { childList: true, subtree: true };
  
  const observer = new MutationObserver(function(mutations) {
    if (!setupCVEvents()) {
      // If we couldn't set up events, try loading the CV
      loadSavedCV();
    }
  });
  
  // Start observing
  observer.observe(targetNode, config);

  /* ------------------------------------------------------
   * SECTION 4: Safari-specific session management
   * ------------------------------------------------------ */

function improveSessionManagement() {
  const ua = navigator.userAgent.toLowerCase();
  const isSafari = ua.indexOf('safari') > -1 && ua.indexOf('chrome') === -1;
  
  if (isSafari) {
    console.log("Applying Safari-specific optimizations");
    
    // More robust local storage handling
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      // Always try in a try-catch for Safari
      try {
        const result = originalSetItem.call(localStorage, key, value);
        
        // Dispatch a custom event so other parts of the code know storage changed
        window.dispatchEvent(new Event('storage'));
        
        return result;
      } catch (e) {
        console.error("Error setting localStorage item:", e);
        // Fallback to session storage
        try {
          sessionStorage.setItem(key, value);
        } catch (e2) {
          console.error("Both storage mechanisms failed:", e2);
        }
      }
    };
    
    // Improve localStorage retrieval
    const originalGetItem = localStorage.getItem;
    localStorage.getItem = function(key) {
      try {
        const value = originalGetItem.call(localStorage, key);
        if (value === null && sessionStorage) {
          // Try from session if not in local
          return sessionStorage.getItem(key);
        }
        return value;
      } catch (e) {
        // Fallback to session storage on error
        try {
          return sessionStorage.getItem(key);
        } catch (e2) {
          console.error("Both storage mechanisms failed for get:", e2);
          return null;
        }
      }
    };
  }
}

// Call this function on page load
document.addEventListener('DOMContentLoaded', improveSessionManagement);


  console.log("CV Optimizer scripts fully initialized");
});
