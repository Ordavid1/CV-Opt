document.addEventListener('DOMContentLoaded', function() {
// Get CSRF token
function getCSRFToken() {
  const token = document.querySelector('meta[name="csrf-token"]');
  return token ? token.getAttribute('content') : '';
}
const csrfToken = getCSRFToken();

  // Robust browser detection function
  function detectBrowser() {
    // Print full user agent for debugging
    console.log("Full user agent:", navigator.userAgent);
    
    const ua = navigator.userAgent.toLowerCase();
    
    // Check for Edge first (as it contains both chrome and safari in UA)
    if (ua.indexOf('edg') > -1) {
      return 'edge';
    }
    
    // Check for Firefox
    if (ua.indexOf('firefox') > -1) {
      return 'firefox';
    }
    
    // Check for Chrome (Chrome has both chrome AND safari in the UA)
    if (ua.indexOf('chrome') > -1) {
      return 'chrome';
    }
    
    // Check for Safari (contains safari but NOT chrome)
    if (ua.indexOf('safari') > -1) {
      return 'safari';
    }
    
    // Default to 'other' if not detected
    return 'other';
  }

  // Run detection and set browser-specific classes
  const currentBrowser = detectBrowser();
  console.log(`Browser correctly detected as: ${currentBrowser}`);

  // CHANGED: Force all browsers to use popup checkout
  const useModalCheckout = false; // Always false to use popup for all browsers
  console.log(`Using modal checkout: ${useModalCheckout}`);

// 1. First check if we're in a popup window (for Safari/Firefox)
const isPopupWindow = window.opener && window.opener !== window;

// 2. If this is a popup window and URL contains success params, redirect to parent
if (isPopupWindow) {
  const urlParams = new URLSearchParams(window.location.search);
  const paymentSuccess = urlParams.get('payment_success');
  const orderId = urlParams.get('order_id');
  
  if (paymentSuccess === 'true') {
    console.log('Success detected in popup window. Redirecting to parent with success params.');
    
    try {
      // First try to send a message to the parent window
      window.opener.postMessage({
        type: 'payment_success',
        orderId: orderId,
        sourceWindow: 'popup'
      }, '*');
      
      // Then redirect parent to success URL and close this popup
      const currentUrl = window.location.href;
      window.opener.location.href = currentUrl;
      
      // Show a brief message before closing
      document.body.innerHTML = `
        <div style="text-align: center; padding: 30px; font-family: sans-serif;">
          <h2>Payment Successful!</h2>
          <p>Redirecting back to the main window...</p>
        </div>
      `;
      
      // Close the popup after a short delay
      setTimeout(() => window.close(), 1500);
    } catch (e) {
      console.error('Error communicating with parent window:', e);
    }
  }
}

// 3. Add listener in parent window for messages from popup
window.addEventListener('message', function(event) {
  // Process messages from popup windows
  if (event.data && event.data.type === 'payment_success') {
    console.log('Received payment success message from popup:', event.data);
    
    // Set payment success flags
    window.paymentCompleted = true;
    window.paymentSuccessHandled = true;
    
    // ADD THIS NEW CODE HERE (after existing success handling):
    // Check if this was a bundle purchase
    if (event.data.bundleType === 'bundle' || event.data.credits) {
        // Update credits display
        const creditsDisplay = document.getElementById('credits-display');
        const creditsCount = document.getElementById('credits-count');
        
        if (creditsDisplay && creditsCount) {
            creditsDisplay.style.display = 'block';
            creditsCount.textContent = event.data.credits || '10';
        }
        
        // Show special notification for bundle purchase
        if (typeof showNotification === 'function') {
            showNotification('✅ 10 CV optimization credits added to your account!', 'success');
        }
        
        // Update the message
        messageElement.textContent = '✅ Credits added! You can now optimize 10 CVs.';
        
        // Show special bundle notification using the enhanced function
        if (typeof showBundleSuccessNotification === 'function') {
            showBundleSuccessNotification('You have 10 credits!<br>Start refining your CVs');
        } else if (typeof showNotification === 'function') {
            // Fallback to regular notification
            showNotification('✅ 10 CV optimization credits added to your account!', 'success');
        }
        
        // Update payment options display
        if (typeof updatePaymentOptionsDisplay === 'function') {
            updatePaymentOptionsDisplay(10);
        }
        
        // Update the message
        messageElement.textContent = '✅ Credits added! You can now optimize 10 CVs.';
    }

    // Update UI
    const messageElement = document.getElementById('result-message');
    if (messageElement) {
      messageElement.textContent = '✅ Payment successful! Processing your request...';
    }
    
    // Show notification
    if (typeof showNotification === 'function') {
      showNotification('Payment successful! Your CV is being optimized now.', 'success');
    }
    
    // Start the CV processing
    const jobId = sessionStorage.getItem('currentJobId') || localStorage.getItem('currentJobId');
    if (jobId) {
      window.checkoutCompleted = false;
      
      // Start processing after a short delay
      setTimeout(() => {
        if (typeof pollRefinementStatus === 'function') {
          pollRefinementStatus(jobId);
        } else if (typeof window.monitorForResults === 'function') {
          window.monitorForResults();
        }
      }, 1000);
    }
  }
});

// 4. Modify the URL parameter handling to work in both contexts
function handleSuccessUrlParameters() {
  // Parse URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const paymentSuccess = urlParams.get('payment_success');
  const orderId = urlParams.get('order_id');
  const closeModal = urlParams.get('close_modal');
  
  if (paymentSuccess === 'true') {
    console.log(`Payment success detected in URL with order ID: ${orderId}`);
    
    // 1. Set payment success flags so processing continues
    window.paymentCompleted = true;
    window.paymentSuccessHandled = true;
    
    // 2. Update UI message
    const messageElement = document.getElementById('result-message');
    if (messageElement) {
      messageElement.textContent = '✅ Payment successful! Processing your request...';
    }
    
    // 3. Show a notification
    if (typeof showNotification === 'function') {
      showNotification('Payment successful! Your CV is being optimized now.', 'success');
    }
    
    // 4. Close any modal that might be open
    setTimeout(() => {
      const modal = document.getElementById('checkout-modal');
      if (modal && modal.classList.contains('open')) {
        // Safely close using the existing function
        if (typeof window.hideCheckoutModal === 'function') {
          window.hideCheckoutModal();
        } else if (typeof closeCheckoutModal === 'function') {
          closeCheckoutModal();
        }
      }
      
      // 5. Start the processing if it hasn't already started
      // Get the current jobId
      const jobId = sessionStorage.getItem('currentJobId') || localStorage.getItem('currentJobId');
      if (jobId) {
        // Set a flag so we don't start multiple processes
        window.checkoutCompleted = false;
        
        // Start processing
        if (typeof pollRefinementStatus === 'function') {
          pollRefinementStatus(jobId);
        } else if (typeof window.monitorForResults === 'function') {
          window.monitorForResults();
        }
      }
      
      // 6. Remove the URL parameters to prevent reprocessing on refresh
      if (window.history && window.history.replaceState) {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    }, 500);
    
    return true;
  }
  
  return false;
}

// Call the function immediately (keep this part from the previous implementation)
const autoHandled = handleSuccessUrlParameters();

  // Add appropriate classes to body
  document.body.classList.remove('chrome-browser', 'safari-browser', 'firefox-browser', 'edge-browser');
  document.body.classList.add(`${currentBrowser}-browser`);

  // CHANGED: Always use popup checkout
  document.body.classList.add('using-popup-checkout');
  document.body.classList.remove('using-modal-checkout');

  // Create a global variable to track popup window
  let paymentPopupWindow = null;
  
  const checkoutButton = document.getElementById('checkout-button');
  const messageElement = document.getElementById('result-message');
  let checkoutInProgress = false;
  let currentJobId = null;
  let paymentWindow = null;
  let paymentCompleted = false;
  window.paymentCompleted = false;

  // -------------
  // DEBUG
  // -------------
  // Debug panel setup - only visible with keyboard shortcut
  const debugDiv = document.createElement('div');
  debugDiv.style.position = 'fixed';
  debugDiv.style.bottom = '10px';
  debugDiv.style.right = '10px';
  debugDiv.style.width = '300px';
  debugDiv.style.maxHeight = '200px';
  debugDiv.style.overflow = 'auto';
  debugDiv.style.background = 'rgba(0,0,0,0.7)';
  debugDiv.style.color = '#fff';
  debugDiv.style.padding = '10px';
  debugDiv.style.fontSize = '10px';
  debugDiv.style.zIndex = '9999';
  debugDiv.style.display = 'none';
  document.body.appendChild(debugDiv);
  
  // Only log to debug panel, not to console
  function debugLog(message) {
    if (window.appDebug && window.appDebug.enabled) {
      window.appDebug.log(message);
    }
    debugDiv.innerHTML += `${new Date().toISOString().substr(11, 8)}: ${message}<br>`;
    debugDiv.scrollTop = debugDiv.scrollHeight;
  }
  
  // Only enable debug panel with keyboard shortcut
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      debugDiv.style.display = debugDiv.style.display === 'none' ? 'block' : 'none';
    }
  });

  // -------------
  // DEBUG
  // -------------



  // Reset checkout state
  function resetCheckoutState() {
    checkoutInProgress = false;
    paymentCompleted = false;
    window.paymentCompleted = false;
    window.checkoutCompleted = false;
    
    const checkoutButton = document.getElementById('checkout-button');
    if (checkoutButton) {
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Optimize Me!';
    }
    
    hideSpinner();
  }

  // Retrieve stored jobId from localStorage
  if (sessionStorage.getItem('currentJobId')) {
    currentJobId = sessionStorage.getItem('currentJobId');
  } else if (localStorage.getItem('currentJobId')) {
    // For backward compatibility
    currentJobId = localStorage.getItem('currentJobId');
    sessionStorage.setItem('currentJobId', currentJobId);
  }
  

  // Initialize Lemon Squeezy SDK
  function initializeLemonSqueezy() {
    if (typeof window.createLemonSqueezy === 'function') {
      window.createLemonSqueezy();
      if (window.LemonSqueezy) {
        window.LemonSqueezy.Setup({
          eventHandler: handleLemonSqueezyEvent
        });
        return true;
      }
    }
    return false;
  }

  // Lemon Squeezy event handler
  function handleLemonSqueezyEvent(event) {
    // Extract event type, handle both formats
    const eventType = event.event || (event.data && event.data.type);
    
    if (eventType === 'checkout:loaded') {
      messageElement.textContent = 'Checkout loaded, waiting for payment...';
    } 
    else if (eventType === 'checkout:success') {
      // Mark payment as completed
      paymentCompleted = true;
      window.paymentCompleted = true;
      
      // Update message
      messageElement.textContent = '✅ Payment successful! Processing your request...';
      
      // Wait long enough for payment to be registered
      setTimeout(() => {
        // Close the modal
        const modal = document.getElementById('checkout-modal');
        if (modal && modal.classList.contains('open')) {
          modal.classList.remove('open');
          
          setTimeout(() => {
            const iframe = document.getElementById('checkout-iframe');
            if (iframe) iframe.src = 'about:blank';
            document.body.style.overflow = '';
            
            // Start polling for results
            if (currentJobId) {
              window.checkoutCompleted = false;
              pollRefinementStatus(currentJobId);
            }
          }, 500);
        }
      }, 2000); // Wait 2 seconds to ensure payment registers
    }
    else if (eventType === 'checkout:closed') {
      // Only treat as cancellation if payment NOT completed
      if (!paymentCompleted && !window.paymentCompleted) {
        // Double-check with backend before showing cancellation
        verifyPaymentWithBackend(currentJobId).then(success => {
          if (success) {
            paymentCompleted = true;
            window.paymentCompleted = true;
            messageElement.textContent = 'Payment confirmed! Processing your CV...';
            
            if (currentJobId) {
              setTimeout(() => {
                window.checkoutCompleted = false;
                pollRefinementStatus(currentJobId);
              }, 300);
            }
          } else {
            resetCheckoutState();
            messageElement.textContent = 'Checkout cancelled. Click to try again.';
          }
        });
      }
    }
  }

  // Try to initialize LS
  initializeLemonSqueezy();

  // Verify if payment was processed with backend
// Modified payment verification function to include tabSessionId
async function verifyPaymentWithBackend(jobId, tabSessionId) {
  if (!jobId) return false;
  
  try {
    // Check refinement status first
    const response = await fetch(`/api/refinement-status`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken // Include CSRF token for security
      },
      body: JSON.stringify({ jobId, tabSessionId })
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.status === 'processing' || data.status === 'completed') {
        return true;
      }
    }
    
    // Try order status as backup
    try {
    const orderResponse = await fetch(`/api/check-order-status?jobId=${jobId}&tabSessionId=${encodeURIComponent(tabSessionId)}`, {
        headers: {
         'X-CSRF-Token': csrfToken  // ADD HEADERS WITH CSRF
         }
    });
      if (orderResponse.ok) {
        const orderData = await orderResponse.json();
        if (orderData.status === 'paid') {
          return true;
        }
      }
    } catch (e) {
      // Silent error
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

  // Handle checkout with enhanced Safari handling
async function handleCheckout(event) {
  event.preventDefault();
  
  // Debug output at the beginning of handleCheckout
  console.log("Starting checkout process");
  
  resetCheckoutState();
  
  messageElement.textContent = 'Preparing checkout...';
  try {
    // Get job URL and CV data
    const jobUrl = document.getElementById('jobUrlInput').value.trim();
    const inputDoc = document.getElementById('cvInputFrame')?.contentDocument;
    if (!inputDoc) {
      messageElement.textContent = 'Error: Could not access the CV input frame.';
      throw new Error('Could not access CV input frame.');
    }
    const cvHTML = inputDoc.body.innerHTML;
    if (!jobUrl || !cvHTML || cvHTML.includes('class="placeholder"')) {
      messageElement.textContent = 'Please provide both a job URL and your CV before checkout.';
      throw new Error('Missing job URL or CV data.');
    }
    
    // Get the refinement level
    const slider = document.getElementById('refineStrength');
    const refinementLevel = slider ? parseInt(slider.value, 10) : 5;
    
    // Disable checkout button and show processing state
    checkoutInProgress = true;
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Processing...';

    // Generate a unique tab session ID
    const tabSessionId = sessionStorage.getItem('tabSessionId') || 
                          Math.random().toString(36).substring(2);
    sessionStorage.setItem('tabSessionId', tabSessionId);
  
    // In handleCheckout function, add bundle type to the request
    const selectedPaymentType = document.querySelector('input[name="payment-type"]:checked').value;

    // Store the data with refinement level and tabSessionId
    const timestamp = new Date().getTime();
    const storeDataResponse = await fetch(`/api/store-job-data?t=${timestamp}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ 
        jobUrl, 
        cvHTML, 
        refinementLevel,
        tabSessionId,
        bundleType: selectedPaymentType
      })
    });
  
    // Update the error handling in handleCheckout
    if (!storeDataResponse.ok) {
      // Special handling for rate limit errors
      if (storeDataResponse.status === 429) {
        messageElement.textContent = 'You\'ve already used your free pass. Please try again later.';
        
        // Add the free-pass-used class to update UI
        document.body.classList.add('free-pass-used');
        localStorage.setItem('freePassUsed', 'true');
        
        // Re-enable button
        checkoutInProgress = false;
        checkoutButton.disabled = false;
        checkoutButton.textContent = 'Optimize Me! ($1)';
        
        return; // Exit early
      }
      throw new Error(`Failed to store job data: ${storeDataResponse.status}`);
    }
    
    const storeResult = await storeDataResponse.json();
    const jobId = storeResult.jobId;
    if (jobId) {
      currentJobId = jobId;
      // Store in sessionStorage for tab isolation
      sessionStorage.setItem('currentJobId', jobId);
      // Also update localStorage for existing code compatibility
      localStorage.setItem('currentJobId', jobId);
      localStorage.setItem('refinementLevel', refinementLevel);
    } else {
      throw new Error("No jobId returned from server");
    }

    // When creating checkout
    const response = await fetch(`/api/create-checkout?t=${timestamp}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-CSRF-Token': csrfToken  // Include CSRF token for security
      },
      body: JSON.stringify({ 
        jobId,
        refinementLevel,
        tabSessionId,
        bundleType: selectedPaymentType // Add this
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to create checkout session: ${response.status}`);
    }
    
    // Handle credit-based response
    const data = await response.json();

    if (data.useCredit === true) {
      // Using credits instead of payment
      messageElement.textContent = `✅ Using 1 credit. ${data.remainingCredits} credits remaining. Processing your CV...`;
      
      // Update credits display
      document.getElementById('credits-count').textContent = data.remainingCredits;

      // Update payment options display based on remaining credits
      if (typeof updatePaymentOptionsDisplay === 'function') {
        updatePaymentOptionsDisplay(data.remainingCredits);
      }

      // If credits are now 0, update the checkout button text
      if (data.remainingCredits === 0) {
        const checkoutButton = document.getElementById('checkout-button');
        if (checkoutButton) {
          checkoutButton.innerHTML = '<span class="button-icon">✨</span>Optimize My CV';
        }
      }
      
      // Mark payment as complete since we used a credit
      window.paymentCompleted = true;
      window.paymentSuccessHandled = true;
      
      // Start polling for refinement results
      setTimeout(() => {
        if (typeof pollRefinementStatus === 'function') {
          window.checkoutCompleted = false;
          pollRefinementStatus(jobId, tabSessionId);
        }
      }, 1000);
      
      return; // Exit early, no payment needed
    }
          
    // Handle free pass case
    if (data.freePass === true) {
      console.log("Free pass detected, showing user form instead of payment");
      
      // Update message
      messageElement.textContent = '🎁 You qualify for a free optimization! Please complete the form.';
      
      // Calculate center position for the popup
      const width = 480;
      const height = 580;
      const left = (window.innerWidth - width) / 2 + window.screenX;
      const top = (window.innerHeight - height) / 2 + window.screenY;
      
      // Open the free pass form popup
      const freePassFormUrl = `/free-pass-form.html?jobId=${jobId}&tabSessionId=${encodeURIComponent(tabSessionId)}`;
      const freePassWindow = window.open(
        freePassFormUrl,
        'freePassWindow',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
      );
      
      // Store reference to the window
      window.freePassWindow = freePassWindow;
      
      // Handle popup
      if (!freePassWindow) {
        messageElement.textContent = '⚠️ The form was blocked. Please disable popup blockers and try again.';
        checkoutInProgress = false;
        checkoutButton.disabled = false;
        checkoutButton.textContent = 'Optimize Me!';
        return;
      }
      
      // Add popup notice
      if (!document.querySelector('.popup-notice')) {
        const noticeDiv = document.createElement('div');
        noticeDiv.className = 'popup-notice';
        noticeDiv.textContent = 'Please complete the form in the popup window to continue with your free optimization.';
        
        const insertAfter = document.getElementById('result-message');
        if (insertAfter && insertAfter.parentNode) {
          insertAfter.parentNode.insertBefore(noticeDiv, insertAfter.nextSibling);
        }
      }
      
      return; // Skip the regular checkout flow
    }
    
    // Regular checkout flow
    if (!data.checkoutUrl) {
      throw new Error('No checkout URL in response');
    }
    
    messageElement.textContent = 'Opening checkout...';

    // Validate URL
    let validCheckoutUrl = data.checkoutUrl;
    if (!validCheckoutUrl.startsWith('http')) {
      if (validCheckoutUrl.startsWith('//')) {
        validCheckoutUrl = 'https:' + validCheckoutUrl;
      } else {
        validCheckoutUrl = 'https://' + validCheckoutUrl;
      }
    }
    
    /*
    // Add tab session ID as a URL parameter to the checkout URL
    if (validCheckoutUrl.includes('?')) {
      validCheckoutUrl += `&tab_session=${encodeURIComponent(tabSessionId)}`;
    } else {
      validCheckoutUrl += `?tab_session=${encodeURIComponent(tabSessionId)}`;
    }
    */
    
    console.log("Using popup window checkout for all browsers");

    // Close existing popup
    if (paymentPopupWindow && !paymentPopupWindow.closed) {
      paymentPopupWindow.close();
    }

    // Calculate center position for the popup
    const width = Math.min(800, window.innerWidth - 40);
    const height = Math.min(700, window.innerHeight - 40);
    const left = (window.innerWidth - width) / 2 + window.screenX;
    const top = (window.innerHeight - height) / 2 + window.screenY;

    // Open the checkout in a popup
    paymentPopupWindow = window.open(
      validCheckoutUrl,
      'checkoutWindow',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
    );

    // Show popup notification
    if (paymentPopupWindow) {
      paymentPopupWindow.focus();
    }

    messageElement.textContent = 'Checkout is open in a new window.';

    // Add notice about popup window
    if (!document.querySelector('.popup-notice')) {
      const noticeDiv = document.createElement('div');
      noticeDiv.className = 'popup-notice';
      noticeDiv.textContent = 'Checkout opens in a separate window. Please don\'t close it until payment is complete.';
      
      const insertAfter = document.getElementById('result-message');
      if (insertAfter && insertAfter.parentNode) {
        insertAfter.parentNode.insertBefore(noticeDiv, insertAfter.nextSibling);
      }
    }

    // Setup popup monitor
    const popupCheckInterval = setInterval(() => {
      if (paymentPopupWindow.closed) {
        clearInterval(popupCheckInterval);
        
        // Check payment status
        verifyPaymentWithBackend(jobId, tabSessionId).then(success => {
          if (success) {
            // Payment successful
            paymentCompleted = true;
            window.paymentCompleted = true;
            messageElement.textContent = '✅ Payment successful! Processing your request...';
            
            // Start polling for results
            if (typeof pollRefinementStatus === 'function') {
              window.checkoutCompleted = false;
              pollRefinementStatus(jobId, tabSessionId);
            }
          } else {
            // Double check after a short delay
            setTimeout(() => {
              verifyPaymentWithBackend(jobId, tabSessionId).then(delayedSuccess => {
                if (delayedSuccess) {
                  paymentCompleted = true;
                  window.paymentCompleted = true;
                  messageElement.textContent = '✅ Payment successful! Processing your request...';
                  
                  if (typeof pollRefinementStatus === 'function') {
                    window.checkoutCompleted = false;
                    pollRefinementStatus(jobId, tabSessionId);
                  }
                } else {
                  // Only reset if payment truly failed
                  resetCheckoutState();
                  messageElement.textContent = 'Checkout cancelled or window closed. Click to try again.';
                }
              });
            }, 3000);
          }
        });
      }
    }, 1000);
      
    // Start backup payment detection
    startBackupPaymentDetection(jobId, tabSessionId);
    
    // Show results button if it exists
    if (typeof showCheckResultsButton === 'function') {
      showCheckResultsButton();
    }
  } catch (error) {
    messageElement.textContent = `Error: ${error.message}. Please try again.`;
    checkoutInProgress = false;
    checkoutButton.disabled = false;
    checkoutButton.textContent = 'Optimize Me!';
  }
}

  // Backup system to detect payment in case the events are missed
// Modified backupPaymentDetection to include tabSessionId
function startBackupPaymentDetection(jobId, tabSessionId) {
  // Wait a reasonable amount of time before starting checks
  setTimeout(() => {
    // Don't run detection if payment is already recognized
    if (paymentCompleted || window.paymentCompleted) {
      return;
    }
    
    let attempts = 0;
    const maxAttempts = 30; // 15 minutes total (30s intervals)
    
    // For popup approach: monitor the popup window
    if (paymentPopupWindow) {
      const popupCheckInterval = setInterval(() => {
        // Check if popup was closed
        if (paymentPopupWindow.closed) {
          clearInterval(popupCheckInterval);
          
          // Verify payment status when popup closes
          verifyPaymentWithBackend(jobId, tabSessionId).then(success => {
            if (success) {
              // Set payment flags
              paymentCompleted = true;
              window.paymentCompleted = true;
              
              // Update message
              messageElement.textContent = '✅ Payment successful! Processing your request...';
              
              // Start polling for results
              if (typeof pollRefinementStatus === 'function') {
                window.checkoutCompleted = false;
                pollRefinementStatus(jobId, tabSessionId);
              }
            } else {
              // Double check after a short delay
              setTimeout(() => {
                verifyPaymentWithBackend(jobId, tabSessionId).then(delayedSuccess => {
                  if (delayedSuccess) {
                    paymentCompleted = true;
                    window.paymentCompleted = true;
                    messageElement.textContent = '✅ Payment successful! Processing your request...';
                    
                    if (typeof pollRefinementStatus === 'function') {
                      window.checkoutCompleted = false;
                      pollRefinementStatus(jobId, tabSessionId);
                    }
                  } else {
                    // Only reset if payment truly failed
                    resetCheckoutState();
                    messageElement.textContent = 'Checkout cancelled. Click to try again.';
                  }
                });
              }, 3000);
            }
          });
        }
      }, 1000);
    }
    
    // Backend check
    const interval = setInterval(async () => {
      attempts++;
      
      // Skip check if payment already detected
      if (paymentCompleted || window.paymentCompleted) {
        clearInterval(interval);
        return;
      }
      
      try {
        const isSuccess = await verifyPaymentWithBackend(jobId, tabSessionId);
        if (isSuccess) {
          // Set payment flags
          paymentCompleted = true;
          window.paymentCompleted = true;
          
          // Update message
          messageElement.textContent = '✅ Payment successful! Processing your request...';
          
          // Close popup if it's still open
          if (paymentPopupWindow && !paymentPopupWindow.closed) {
            paymentPopupWindow.close();
          }
          
          // Start polling for results
          if (typeof pollRefinementStatus === 'function') {
            window.checkoutCompleted = false;
            pollRefinementStatus(jobId, tabSessionId);
          }
          
          clearInterval(interval);
        }
      } catch (error) {
        // Silent error
      }
      
      if (attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 30000); // Check every 30 seconds
  }, 60000); // Start after 1 minute
}

  // Function for handling manual close by user
  function closeCheckoutModal() {
    // For Chrome's modal approach
    if (useModalCheckout) {
      const checkoutModal = document.getElementById('checkout-modal');
      if (checkoutModal) {
        // Add a closing class for a different animation when closing
        checkoutModal.classList.add('closing');
        
        // Remove open class to start transition
        checkoutModal.classList.remove('open');
        
        // Wait for animation to finish before fully hiding and clearing iframe
        setTimeout(() => {
          const checkoutIframe = document.getElementById('checkout-iframe');
          if (checkoutIframe) {
            checkoutIframe.src = 'about:blank';
          }
          
          // Remove closing class
          checkoutModal.classList.remove('closing');
          
          // Re-enable scrolling
          document.body.style.overflow = '';
        }, 500); // Match the duration of the CSS transition
      }
    } 
    // For Safari & other browsers using popup approach
    else if (paymentPopupWindow && !paymentPopupWindow.closed) {
      paymentPopupWindow.close();
      paymentPopupWindow = null;
    }
    
    // If payment is already completed, handle as success
    if (paymentCompleted || window.paymentCompleted) {
      messageElement.textContent = 'Processing your CV...';
      
      if (currentJobId && typeof pollRefinementStatus === 'function') {
        window.checkoutCompleted = false;
        pollRefinementStatus(currentJobId);
      }
    } 
    else if (checkoutInProgress) {
      // Double-check with backend before showing cancellation
      // Show checking message first so it doesn't flash cancellation
      messageElement.textContent = 'Checking payment status...';
      
      verifyPaymentWithBackend(currentJobId).then(success => {
        if (success) {
          // Set payment flags
          paymentCompleted = true;
          window.paymentCompleted = true;
          
          // Show success message and start processing
          messageElement.textContent = 'Payment confirmed! Processing your CV...';
          
          if (currentJobId && typeof pollRefinementStatus === 'function') {
            setTimeout(() => {
              window.checkoutCompleted = false;
              pollRefinementStatus(currentJobId);
            }, 300);
          }
        } else {
          resetCheckoutState();
          messageElement.textContent = 'Checkout cancelled. Click to try again.';
        }
      }).catch(error => {
        // Err on the side of assuming payment might have gone through
        messageElement.textContent = 'Payment status uncertain. Please check your email for confirmation.';
      });
    }
  }

  // Make it globally available
  window.closeCheckoutModal = closeCheckoutModal;

  // Event handlers for checkout button and modal
  if (checkoutButton) {
    checkoutButton.removeEventListener('click', handleCheckout);
    checkoutButton.addEventListener('click', handleCheckout);
  }
  
  const closeCheckoutButton = document.getElementById('close-checkout');
  if (closeCheckoutButton) {
    closeCheckoutButton.addEventListener('click', closeCheckoutModal);
  }

  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape' && document.getElementById('checkout-modal').classList.contains('open')) {
      closeCheckoutModal();
    }
  });

  document.getElementById('checkout-modal').addEventListener('click', function(event) {
    if (event.target === this) {
      closeCheckoutModal();
    }
  });

  // Handle global message events for payment notifications
  window.addEventListener('message', function(event) {
    // Only log in debug mode
    if (window.appDebug && window.appDebug.enabled) {
      if (typeof event.data === 'object') {
        window.appDebug.log('Message event received (object)');
      } else {
        window.appDebug.log('Message event received: ' + event.data);
      }
    }
    
    // Process messages differently based on checkout type
    if (useModalCheckout) {
      // CHROME - Modal Checkout Processing
      
      // Handle object events from modal
      if (event.data && typeof event.data === 'object') {
        const eventType = event.data.type || event.data.event;
        
        if (eventType === 'checkout:success') {
          console.log("Modal checkout success detected (object event)");
          
          // Set payment flags
          paymentCompleted = true;
          window.paymentCompleted = true;
          
          // Update message
          messageElement.textContent = '✅ Payment successful! Processing your request...';
          
          // Close modal and start polling after a delay
          setTimeout(() => {
            const modal = document.getElementById('checkout-modal');
            if (modal && modal.classList.contains('open')) {
              modal.classList.remove('open');
              
              setTimeout(() => {
                const iframe = document.getElementById('checkout-iframe');
                if (iframe) iframe.src = 'about:blank';
                document.body.style.overflow = '';
                
                // Start polling for results
                if (currentJobId && typeof pollRefinementStatus === 'function') {
                  window.checkoutCompleted = false;
                  pollRefinementStatus(currentJobId);
                }
              }, 500);
            }
          }, 2000);
        }
      }
      
      // Handle string events from modal
      if (typeof event.data === 'string') {
        if (event.data === 'checkout-completed' || event.data.includes('success')) {
          console.log("Modal checkout success detected (string event)");
          
          // Set payment flags
          paymentCompleted = true;
          window.paymentCompleted = true;
          
          // Update message
          messageElement.textContent = '✅ Payment successful! Processing your request...';
          
          // Close modal and start polling after a delay
          setTimeout(() => {
            const modal = document.getElementById('checkout-modal');
            if (modal && modal.classList.contains('open')) {
              modal.classList.remove('open');
              
              setTimeout(() => {
                const iframe = document.getElementById('checkout-iframe');
                if (iframe) iframe.src = 'about:blank';
                document.body.style.overflow = '';
                
                // Start polling for results
                if (currentJobId && typeof pollRefinementStatus === 'function') {
                  window.checkoutCompleted = false;
                  pollRefinementStatus(currentJobId);
                }
              }, 500);
            }
          }, 2000);
        }
      }
    } else {
      // SAFARI & OTHERS - Popup Window Processing
      
      // Check if this message might be from our popup
      if (paymentPopupWindow && !paymentPopupWindow.closed) {
        try {
          // For popup windows, we care less about the message content
          // and more about checking the URL for success patterns
          
          // Look for success indicators in URL
          const popupUrl = paymentPopupWindow.location.href;
          const successPatterns = ['/success', '/thank-you', '/confirmation', 
                                 '/complete', '/confirmed', 'status=completed',
                                 'status=success', 'payment_status=paid'];
          
          for (const pattern of successPatterns) {
            if (popupUrl.includes(pattern)) {
              console.log(`Popup checkout success detected (URL pattern: ${pattern})`);
              
              // Set payment flags
              paymentCompleted = true;
              window.paymentCompleted = true;
              
              // Update message
              messageElement.textContent = '✅ Payment successful! Processing your request...';
              
              // Close the popup
              paymentPopupWindow.close();
              paymentPopupWindow = null;
              
              // Start polling for results
              if (currentJobId && typeof pollRefinementStatus === 'function') {
                window.checkoutCompleted = false;
                pollRefinementStatus(currentJobId);
              }
              
              return;
            }
          }
        } catch (e) {
          // Safely ignore cross-origin errors
          // This happens when trying to check popup URL across domains
        }
      }
      
      // General message processing for both checkout types
      // This catches success messages that might come from other sources
      
      // Handle object message format
      if (event.data && typeof event.data === 'object') {
        const eventType = event.data.type || event.data.event;
        
        if (eventType === 'checkout:success') {
          console.log("Checkout success detected (object event)");
          
          // Set payment flags
          paymentCompleted = true;
          window.paymentCompleted = true;
          
          // Update message
          messageElement.textContent = '✅ Payment successful! Processing your request...';
          
          // Close popup if open
          if (paymentPopupWindow && !paymentPopupWindow.closed) {
            paymentPopupWindow.close();
            paymentPopupWindow = null;
          }
          
          // Start polling for results
          if (currentJobId && typeof pollRefinementStatus === 'function') {
            window.checkoutCompleted = false;
            pollRefinementStatus(currentJobId);
          }
        }
      }
      
      // Handle string message format
      if (typeof event.data === 'string') {
        if (event.data === 'checkout-completed' || event.data.includes('success')) {
          console.log("Checkout success detected (string event)");
          
          // Set payment flags
          paymentCompleted = true;
          window.paymentCompleted = true;
          
          // Update message
          messageElement.textContent = '✅ Payment successful! Processing your request...';
          
          // Close popup if open
          if (paymentPopupWindow && !paymentPopupWindow.closed) {
            paymentPopupWindow.close();
            paymentPopupWindow = null;
          }
          
          // Start polling for results
          if (currentJobId && typeof pollRefinementStatus === 'function') {
            window.checkoutCompleted = false;
            pollRefinementStatus(currentJobId);
          }
        }
      }
    }
  });

  // Spinner helper functions
  function showSpinner() {
    document.getElementById("spinner").style.display = "block";
  }

  function hideSpinner() {
    document.getElementById("spinner").style.display = "none";
  }

  // Refinement status polling function
// Modified pollRefinementStatus function to use tabSessionId
function pollRefinementStatus(jobId) {
  if (!jobId) {
    messageElement.textContent = 'Error: Unable to poll for results (no jobId)';
    return;
  }
  
  // Get the tab session ID from session storage
  const tabSessionId = sessionStorage.getItem('tabSessionId');
  
  let attempts = 0;
  const maxAttempts = 60;
  const pollInterval = 5000;
  
  messageElement.textContent = '⏳ Processing your CV...';
  // Clear any popup notices when processing starts
  const popupNotice = document.querySelector('.popup-notice');
  if (popupNotice) {
    popupNotice.remove();
  }
  showSpinner();
  
  const interval = setInterval(async () => {
    try {
      const timestamp = new Date().getTime();
      const response = await fetch(`/api/refinement-status?t=${timestamp}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-CSRF-Token': csrfToken // Include CSRF token for security
        },
        body: JSON.stringify({ jobId, tabSessionId }) // Include tabSessionId
      });
      
      if (!response.ok) {
        throw new Error(`Failed to check refinement status: ${response.status}`);
      }
      
      const data = await response.json();
      
    // HANDLE BUNDLE PURCHASE STATUS
    if (data.status === 'bundle_purchase') {
      clearInterval(interval);
      messageElement.textContent = '✅ 10 credits added to your account!';
      hideSpinner();
      
      // Update credits display
      fetch('/api/check-credits')
        .then(response => response.json())
        .then(creditsData => {
          document.getElementById('credits-count').textContent = creditsData.credits;
          document.getElementById('credits-display').style.display = 'block';
          
          // Update payment options display - ADD THIS
          if (typeof updatePaymentOptionsDisplay === 'function') {
            updatePaymentOptionsDisplay(creditsData.credits);
          }
        });
      
      // Show the enhanced bundle success notification - REPLACE THE OLD showNotification with:
      if (typeof showBundleSuccessNotification === 'function') {
        showBundleSuccessNotification('You have 10 credits!<br>Start refining your CVs');
      } else if (typeof showNotification === 'function') {
        // Fallback to regular notification
        showNotification('✅ 10 CV optimization credits added to your account!', 'success');
      }
      
      // Re-enable checkout button
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Optimize My CV';
      
      return;
    }

      // Check for session mismatch
      if (data.status === 'wrong_tab') {
        clearInterval(interval);
        messageElement.textContent = 'This job was processed in another browser tab.';
        hideSpinner();
        checkoutButton.disabled = false;
        checkoutButton.textContent = 'Optimize Me!';
        return;
      }
      
      if (data.status === 'completed' && data.refinedHTML) {
        clearInterval(interval);
        messageElement.textContent = '✅ CV refinement complete!';
        
        const outDoc = document.getElementById('cvOutputFrame').contentDocument;
        if (outDoc) {
          updateOutputFrame(data.refinedHTML);
          
          if (data.changes) {
            const changesContainer = document.getElementById("changes");
            changesContainer.innerHTML = '<h3>Changes Made</h3>';
            const changesContent = document.createElement('div');
            changesContent.className = 'changes-content';
            changesContent.innerHTML = data.changes;
            changesContainer.appendChild(changesContent);
            const legend = document.createElement('div');
            legend.style.marginTop = '1rem';
            legend.style.fontSize = '0.9rem';
            legend.innerHTML = `
              <span class="diff-added">Green text</span> = Added content<br>
              <span class="diff-removed">Red text</span> = Removed content
            `;
            changesContainer.appendChild(legend);
          }
          
          if (typeof showNotification === 'function') {
            showNotification('✅ CV refinement complete! Check the results.');
          }
          
          hideSpinner();
          checkoutButton.disabled = false;
          checkoutButton.textContent = 'Optimize Me!';
          return;
        }
      } else if (data.status === 'pending') {
        // Trigger fallback refinement at halfway point
        if (attempts === Math.floor(maxAttempts / 2)) {
          try {
            const jobData = await fetch('/api/get-job-data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jobId, tabSessionId })
            }).then(r => r.json());
            
            if (jobData && jobData.jobUrl && jobData.cvHTML) {
              await fetch('/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobId,
                  tabSessionId,
                  jobUrl: jobData.jobUrl,
                  cvHTML: jobData.cvHTML,
                  refinementLevel: jobData.refinementLevel || 5,
                  conversation: []
                })
              });
            }
          } catch (error) {
            // Silent error
          }
        }
      }
      
      attempts++;
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        messageElement.textContent = 'Refinement process timed out. Please try again.';
        hideSpinner();
        checkoutButton.disabled = false;
        checkoutButton.textContent = 'Optimize Me!';
      }
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        messageElement.textContent = 'Error checking refinement status. Please try again.';
        hideSpinner();
        checkoutButton.disabled = false;
        checkoutButton.textContent = 'Optimize Me!';
      }
    }
  }, pollInterval);
}
  
  // Expose needed functions globally
  window.pollRefinementStatus = pollRefinementStatus;
  window.monitorForResults = function() {
    if (currentJobId) {
      window.checkoutCompleted = false;
      pollRefinementStatus(currentJobId);
      return true;
    } else {
      return false;
    }
  };
  window.checkRefinementStatus = async function() {
    try {
      const jobId = currentJobId || sessionStorage.getItem('currentJobId') || localStorage.getItem('currentJobId');
      if (!jobId) return false;
      
      const response = await fetch('/api/refinement-status', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-CSRF-Token': csrfToken  // Include CSRF token for security
        },
        body: JSON.stringify({ jobId, tabSessionId})
      });
      
      if (!response.ok) return false;
      
      const data = await response.json();
      if (data.status === 'completed' && data.refinedHTML) {
        const outDoc = document.getElementById('cvOutputFrame').contentDocument;
        if (outDoc) {
          outDoc.body.innerHTML = data.refinedHTML;
          
          if (data.changes) {
            const changesContainer = document.getElementById("changes");
            changesContainer.innerHTML = '<h3>Changes Made</h3>';
            const changesContent = document.createElement('div');
            changesContent.className = 'changes-content';
            changesContent.innerHTML = data.changes;
            changesContainer.appendChild(changesContent);
            const legend = document.createElement('div');
            legend.style.marginTop = '1rem';
            legend.style.fontSize = '0.9rem';
            legend.innerHTML = `
              <span class="diff-added">Green text</span> = Added content<br>
              <span class="diff-removed">Red text</span> = Removed content
            `;
            changesContainer.appendChild(legend);
          }
          
          if (typeof showNotification === 'function') {
            showNotification('✅ CV refinement complete! Check the results.');
          }
          
          hideSpinner();
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  };

// Function to enhance checkout modal with confirmation
function enhanceCheckoutOverlay() {
  // Patch the pollRefinementStatus function to keep track of the interval
  if (typeof window.pollRefinementStatus === 'function') {
    const originalPoll = window.pollRefinementStatus;
    window.pollRefinementStatus = function(jobId) {
      // Call the original function first
      originalPoll.call(this, jobId);
      
      // This is a bit of a hack to find the interval that was just created
      // We'll keep track of the last interval ID
      const lastIntervalId = setInterval(() => {}, 100000);
      clearInterval(lastIntervalId);
      
      // The interval we're looking for should be close to this ID
      for (let i = lastIntervalId - 10; i < lastIntervalId; i++) {
        window.refinementInterval = i;
      }
    };
  }

  // Also, let's improve the monitorForResults function similarly
  if (typeof window.monitorForResults === 'function') {
    const originalMonitor = window.monitorForResults;
    window.monitorForResults = function() {
      const result = originalMonitor.apply(this, arguments);
      
      // This is a bit of a hack to find the interval that was just created
      const lastIntervalId = setInterval(() => {}, 100000);
      clearInterval(lastIntervalId);
      
      // The interval we're looking for should be close to this ID
      for (let i = lastIntervalId - 10; i < lastIntervalId; i++) {
        window.refinementInterval = i;
      }
      
      return result;
    };
  }
  
  // Get the overlay element
  const checkoutOverlay = document.getElementById('checkout-modal');
  if (!checkoutOverlay) return;
  
  // Create and add styling for better overlay visibility
  const style = document.createElement('style');
  style.textContent = `
    /* Enhanced overlay styling */
    .checkout-overlay {
      background-color: rgba(0, 0, 0, 0.7) !important; /* Dark semi-transparent background */
    }
    
    /* Improved container styling */
    .checkout-container {
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6) !important; /* Stronger shadow for better visibility */
    }
    
    /* Confirmation dialog styling */
    .checkout-confirm-dialog {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: #fff;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
      z-index: 1100;
      display: none;
      text-align: center;
      width: 90%;
      max-width: 400px;
      color: #333;
    }
    
    .checkout-confirm-dialog p {
      margin-bottom: 20px;
      font-size: 16px;
    }
    
    .checkout-confirm-buttons {
      display: flex;
      justify-content: center;
      gap: 10px;
    }
    
    .checkout-confirm-buttons button {
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      border: none;
    }
    
    .checkout-confirm-buttons button.cancel {
      background-color: #f44336;
      color: white;
    }
    
    .checkout-confirm-buttons button.continue {
      background-color: #4CAF50;
      color: white;
    }
  `;
  document.head.appendChild(style);
  
  // Create confirmation dialog
  const confirmDialog = document.createElement('div');
  confirmDialog.className = 'checkout-confirm-dialog';
  confirmDialog.innerHTML = `
    <p>Are you sure you want to close the checkout? Your payment has not been completed.</p>
    <div class="checkout-confirm-buttons">
      <button class="continue">Continue Payment</button>
      <button class="cancel">Close Checkout</button>
    </div>
  `;
  document.body.appendChild(confirmDialog); // Add to body instead of overlay to prevent issues
  
  // Get buttons
  const continueBtn = confirmDialog.querySelector('button.continue');
  const cancelBtn = confirmDialog.querySelector('button.cancel');
  
  // Function to show the confirmation dialog
  function showConfirmDialog() {
    confirmDialog.style.display = 'block';
  }
  
  // Function to hide the confirmation dialog
  function hideConfirmDialog() {
    confirmDialog.style.display = 'none';
  }
  
  // Continue button closes the dialog without closing modal
  continueBtn.addEventListener('click', hideConfirmDialog);
  
  // Cancel button confirms closing the modal
  cancelBtn.addEventListener('click', function() {
    hideConfirmDialog();
    
    // ENHANCED RESET FUNCTIONALITY
    console.log("User confirmed checkout cancellation - performing full reset");
    
    // 1. Reset all payment tracking flags
    window.paymentCompleted = false;
    window.paymentSuccessHandled = false;
    window.paymentInProgress = false;
    window.paymentSuccessDetected = false;
    window.checkoutCompleted = false;
    checkoutInProgress = false; // This is from the outer scope in checkout.js
    
    // 2. Reset the checkout button
    const checkoutButton = document.getElementById('checkout-button');
    if (checkoutButton) {
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Optimize Me!';
    }
    
    // 3. Stop any running processes
    // Clear any running intervals for polling/refinement
    if (window.refinementInterval) {
      clearInterval(window.refinementInterval);
      window.refinementInterval = null;
    }
    
    // 4. Reset the status message
    const messageElement = document.getElementById('result-message');
    if (messageElement) {
      messageElement.textContent = 'Checkout cancelled. Click to try again.';
    }
    
    // 5. Hide any spinner that might be showing
    const spinner = document.getElementById('spinner');
    if (spinner) {
      spinner.style.display = 'none';
    }
    
    // 6. Close the modal
    if (typeof window.hideCheckoutModal === 'function') {
      window.hideCheckoutModal();
    } else if (typeof closeCheckoutModal === 'function') {
      closeCheckoutModal();
    }
    
    // 7. Clear any payment popup window
    if (window.paymentPopupWindow && !window.paymentPopupWindow.closed) {
      window.paymentPopupWindow.close();
      window.paymentPopupWindow = null;
    }
    
    // 8. Record the cancellation for analytics (if needed)
    try {
      if (typeof gtag === 'function') {
        gtag('event', 'checkout_abandoned', {
          'event_category': 'ecommerce',
          'event_label': 'User confirmed cancellation'
        });
      }
    } catch (e) {
      // Silently ignore analytics errors
    }
    
    // Show notification that checkout was cancelled
    if (typeof showNotification === 'function') {
      showNotification('Checkout cancelled. You can try again when ready.', 'info');
    }
  });
  
  // IMPORTANT: We need to completely replace the existing click handler
  // First, clone and replace the overlay element to remove all existing handlers
  const newOverlay = checkoutOverlay.cloneNode(true);
  checkoutOverlay.parentNode.replaceChild(newOverlay, checkoutOverlay);
  
  // Now add our new handler
  newOverlay.addEventListener('click', function(event) {
    // Only handle clicks directly on the overlay (not the container)
    if (event.target === newOverlay && !window.paymentCompleted) {
      event.preventDefault();
      event.stopPropagation();
      showConfirmDialog();
    }
  });
  
  // Also replace the close button
  const closeBtn = document.getElementById('close-checkout');
  if (closeBtn) {
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    
    newCloseBtn.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      
      if (!window.paymentCompleted) {
        showConfirmDialog();
      } else {
        if (typeof window.hideCheckoutModal === 'function') {
          window.hideCheckoutModal();
        } else if (typeof closeCheckoutModal === 'function') {
          closeCheckoutModal();
        }
      }
    });
  }
  
  // Replace the Escape key handler
  // First, remove existing document keydown handlers
  const newDocument = document.cloneNode(false);
  document.addEventListener = function(type, handler) {
    if (type === 'keydown') {
      const originalHandler = handler;
      handler = function(event) {
        if (event.key === 'Escape' && newOverlay.classList.contains('open') && !window.paymentCompleted) {
          event.preventDefault();
          event.stopPropagation();
          showConfirmDialog();
          return;
        }
        return originalHandler.apply(this, arguments);
      };
    }
    EventTarget.prototype.addEventListener.call(document, type, handler);
  };
  
  // Add our own Escape key handler
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      if (confirmDialog.style.display === 'block') {
        // If confirmation is open, just close it
        hideConfirmDialog();
        event.preventDefault();
        event.stopPropagation();
      } else if (newOverlay.classList.contains('open') && !window.paymentCompleted) {
        // If modal is open, show confirmation
        showConfirmDialog();
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }, true); // Using capture phase to get it first
  
  console.log('Checkout overlay enhancement applied');
}

// Add a check in the enhanceCheckoutOverlay function to prevent overriding the success handling for auto-closed modals
// Add this at the beginning of enhanceCheckoutOverlay
if (typeof window.enhanceCheckoutOverlay === 'function') {
  const originalEnhance = window.enhanceCheckoutOverlay;
  window.enhanceCheckoutOverlay = function() {
    // Don't enhance if we already handled success via URL params
    if (window.paymentCompleted && window.paymentSuccessHandled) {
      console.log("Payment already handled via URL, skipping modal enhancement");
      return;
    }
    
    // Otherwise call the original function
    return originalEnhance.apply(this, arguments);
  };
}

// Call this function at the end of DOMContentLoaded
enhanceCheckoutOverlay();

// Find the original functions and replace them with enhanced versions
if (typeof closeCheckoutModal === 'function') {
  const originalCloseCheckoutModal = closeCheckoutModal;
  window.closeCheckoutModal = function() {
    // Check if payment was successful before closing
    if (window.paymentCompleted || window.paymentSuccessHandled) {
      console.log("Payment was successful - safely closing modal without reset");
      
      // Just close the modal without resetting payment process
      const checkoutModal = document.getElementById('checkout-modal');
      if (checkoutModal) {
        // Add a closing class for a different animation when closing
        checkoutModal.classList.add('closing');
        
        // Remove open class to start transition
        checkoutModal.classList.remove('open');
        
        // Wait for animation to finish before fully hiding and clearing iframe
        setTimeout(() => {
          const checkoutIframe = document.getElementById('checkout-iframe');
          if (checkoutIframe) {
            checkoutIframe.src = 'about:blank';
          }
          
          // Remove closing class
          checkoutModal.classList.remove('closing');
          
          // Re-enable scrolling
          document.body.style.overflow = '';
        }, 500); // Match the duration of the CSS transition
      }
      
      // Continue with processing if it's not already started
      const jobId = sessionStorage.getItem('currentJobId') || localStorage.getItem('currentJobId');
      if (jobId && !window.checkoutCompleted) {
        window.checkoutCompleted = true;
        
        // Start processing
        if (typeof pollRefinementStatus === 'function') {
          pollRefinementStatus(jobId);
        } else if (typeof window.monitorForResults === 'function') {
          window.monitorForResults();
        }
      }
      
      return;
    }
    
    // For non-payment success cases, use the original function
    return originalCloseCheckoutModal.apply(this, arguments);
  };
}

// Also update window.hideCheckoutModal if it exists
if (typeof window.hideCheckoutModal === 'function') {
  const originalHideCheckoutModal = window.hideCheckoutModal;
  window.hideCheckoutModal = function() {
    // Check if payment was successful before closing
    if (window.paymentCompleted || window.paymentSuccessHandled) {
      console.log("Payment was successful - safely closing modal without reset");
      
      // Just close the modal without resetting payment process
      const checkoutModal = document.getElementById('checkout-modal');
      if (checkoutModal) {
        checkoutModal.classList.remove('open');
        setTimeout(() => {
          const iframe = document.getElementById('checkout-iframe');
          if (iframe) iframe.src = 'about:blank';
          document.body.style.overflow = '';
        }, 500);
      }
      
      // Continue with processing if it's not already started
      const jobId = sessionStorage.getItem('currentJobId') || localStorage.getItem('currentJobId');
      if (jobId && !window.checkoutCompleted) {
        window.checkoutCompleted = true;
        
        // Start processing
        if (typeof pollRefinementStatus === 'function') {
          pollRefinementStatus(jobId);
        } else if (typeof window.monitorForResults === 'function') {
          window.monitorForResults();
        }
      }
      
      return;
    }
    
    // For non-payment success cases, use the original function
    return originalHideCheckoutModal.apply(this, arguments);
  };
}

// Improved message listener for free pass form submission
window.addEventListener('message', function(event) {
  // Handle free pass form submission
  if (event.data && event.data.type === 'free_pass_submitted') {
    console.log("Free pass form submitted:", event.data.userData);
    
    // Extract the data
    const userData = event.data.userData;
    const jobId = userData.jobId;
    
    // Update UI immediately
    document.getElementById('result-message').textContent = 
      '✅ Thank you, ' + userData.firstName + '! Processing your CV...';
    
    // Remove any popup notices from the UI
    const popupNotice = document.querySelector('.popup-notice');
    if (popupNotice) {
      popupNotice.remove();
    }
    
    // Show notification
    if (typeof showNotification === 'function') {
      showNotification(`🎁 Thanks, ${userData.firstName}! Your CV is being processed...`, 'success');
    }
    
    // Update button appearance
    const checkoutButton = document.getElementById('checkout-button');
    if (checkoutButton) {
      checkoutButton.disabled = true;
      checkoutButton.textContent = 'Processing...';
    }
    
    // Mark free pass as used in UI and localStorage
    document.body.classList.add('free-pass-used');
    localStorage.setItem('freePassUsed', 'true');
    
    // Also dispatch a custom event
    window.dispatchEvent(new CustomEvent('freePassUsed'));
    
    // Hide any free pass indicator
    const freePassStatus = document.getElementById('free-pass-status');
    if (freePassStatus) {
      freePassStatus.style.display = 'none';
    }
    
    // Start processing
    window.paymentCompleted = true;
    window.paymentSuccessHandled = true;
    
    // Start polling for results if we have a valid jobId
    if (jobId) {
      window.checkoutCompleted = false;
      
      // Close the popup window if it's still open
      if (window.freePassWindow && !window.freePassWindow.closed) {
        try {
          window.freePassWindow.close();
        } catch (e) {
          // Ignore errors closing the window
        }
      }
      
      // Start polling with a short delay to allow the backend to process
      setTimeout(() => {
        if (typeof pollRefinementStatus === 'function') {
          pollRefinementStatus(jobId);
        } else if (typeof window.monitorForResults === 'function') {
          window.monitorForResults();
        }
      }, 1000);
    }
  }
}, false);


});