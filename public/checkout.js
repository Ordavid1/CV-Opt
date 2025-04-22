// Enhanced checkout.js with Safari & DuckDuckGo compatibility improvements

// IIFE to avoid polluting global scope
(function() {
  // Variables declared at the top level of our IIFE
  let checkoutButton;
  let messageElement;
  let checkoutInProgress = false;
  let currentJobId = null;
  let paymentWindow = null;
  let paymentCompleted = false;
  
  // Create the debug panel
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
  
  // Debug logging function
  function debugLog(message) {
    if (window.appDebug && window.appDebug.enabled) {
      window.appDebug.log(message);
    }
    debugDiv.innerHTML += `${new Date().toISOString().substr(11, 8)}: ${message}<br>`;
    debugDiv.scrollTop = debugDiv.scrollHeight;
  }
  
  // Setup DOM once it's fully loaded
  document.addEventListener('DOMContentLoaded', function() {
    // Append debug panel to body
    document.body.appendChild(debugDiv);
    
    // Get DOM elements
    checkoutButton = document.getElementById('checkout-button');
    messageElement = document.getElementById('result-message');
    
    // Enable debug panel with keyboard shortcut
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        debugDiv.style.display = debugDiv.style.display === 'none' ? 'block' : 'none';
      }
    });
    
    // Skip initialization for Safari/DuckDuckGo as they use their own checkout flow
    if (window.isSafariOrDuckDuckGo) {
      debugLog("Not using standard checkout flow - using Safari-specific checkout instead");
      console.log("Not using standard checkout flow - will use Safari-specific checkout");
      return;
    }
    
    console.log("Using standard checkout flow for Chrome/Firefox");
    
    // Expose payment status to the window
    window.paymentCompleted = false;
    
    // Retrieve stored jobId from localStorage
    if (localStorage.getItem('currentJobId')) {
      currentJobId = localStorage.getItem('currentJobId');
    }
    
    // Initialize
    initializeCheckout();
  });
  
  // Reset checkout state
  function resetCheckoutState() {
    checkoutInProgress = false;
    paymentCompleted = false;
    window.paymentCompleted = false;
    window.checkoutCompleted = false;
    
    if (checkoutButton) {
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Optimize Me!';
    }
    
    hideSpinner();
  }
  
  // Initialize Lemon Squeezy SDK with retry and timeout
  function initializeLemonSqueezy(maxAttempts = 5, timeout = 1000) {
    let attempts = 0;
    
    return new Promise((resolve) => {
      function attemptInit() {
        attempts++;
        
        if (typeof window.createLemonSqueezy === 'function') {
          try {
            window.createLemonSqueezy();
            
            if (window.LemonSqueezy) {
              window.LemonSqueezy.Setup({
                eventHandler: handleLemonSqueezyEvent
              });
              console.log("LemonSqueezy initialized successfully");
              return resolve(true);
            }
          } catch (e) {
            console.log("LemonSqueezy init attempt failed:", e.message);
          }
        }
        
        if (attempts < maxAttempts) {
          setTimeout(attemptInit, timeout);
        } else {
          console.log("LemonSqueezy init failed after", maxAttempts, "attempts");
          resolve(false);
        }
      }
      
      // Start initialization attempts
      attemptInit();
    });
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
  
  // Main initialization function
  function initializeCheckout() {
    // Try to initialize LS after a short delay
    setTimeout(() => {
      initializeLemonSqueezy()
        .then(success => {
          if (!success) {
            console.log("Using fallback payment handling");
          }
        });
    }, 500);
    
    // Event handlers for checkout button and modal
    if (checkoutButton) {
      checkoutButton.removeEventListener('click', handleCheckout);
      checkoutButton.addEventListener('click', handleCheckout);
    }
    
    const closeCheckoutButton = document.getElementById('close-checkout');
    if (closeCheckoutButton) {
      closeCheckoutButton.addEventListener('click', closeCheckoutModal);
    }
    
    // Close modal with Escape key
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        const modal = document.getElementById('checkout-modal');
        if (modal && modal.classList.contains('open')) {
          closeCheckoutModal();
        }
      }
    });
    
    // Close modal when clicking outside the content
    const modal = document.getElementById('checkout-modal');
    if (modal) {
      modal.addEventListener('click', function(event) {
        if (event.target === this) {
          closeCheckoutModal();
        }
      });
    }
    
    // Handle global message events for payment notifications
    window.addEventListener('message', function(event) {
      // Debug logging
      if (window.appDebug && window.appDebug.enabled) {
        if (typeof event.data === 'object') {
          debugLog('Message event received (object)');
        } else {
          debugLog('Message event received: ' + event.data);
        }
      }
      
      // Handle object events
      if (event.data && typeof event.data === 'object') {
        const eventType = event.data.type || event.data.event;
        
        if (eventType === 'checkout:success') {
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
      
      // Handle string events
      if (typeof event.data === 'string') {
        if (event.data === 'checkout-completed' || event.data.includes('success')) {
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
    });
  }
  
  // Verify if payment was processed with backend
  async function verifyPaymentWithBackend(jobId) {
    if (!jobId) return false;
    
    try {
      // Check refinement status first
      const response = await fetch(`/api/refinement-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.status === 'processing' || data.status === 'completed') {
          return true;
        }
      }
      
      // Try order status as backup
      try {
        const orderResponse = await fetch(`/api/check-order-status?jobId=${jobId}`);
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
  
  // Handle checkout (for Chrome/Firefox)
  async function handleCheckout(event) {
    event.preventDefault();
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
      checkoutButton.textContent = 'Loading checkout...';
      
      // Store the data with refinement level
      const timestamp = new Date().getTime();
      const storeDataResponse = await fetch(`/api/store-job-data?t=${timestamp}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        },
        body: JSON.stringify({ 
          jobUrl, 
          cvHTML, 
          refinementLevel 
        })
      });
      
      if (!storeDataResponse.ok) {
        throw new Error(`Failed to store job data: ${storeDataResponse.status}`);
      }
      
      const storeResult = await storeDataResponse.json();
      const jobId = storeResult.jobId;
      if (jobId) {
        currentJobId = jobId;
        localStorage.setItem('currentJobId', jobId);
        localStorage.setItem('refinementLevel', refinementLevel);
      } else {
        throw new Error("No jobId returned from server");
      }
      
      // Create checkout session
      const response = await fetch(`/api/create-checkout?t=${timestamp}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate' 
        },
        body: JSON.stringify({ 
          jobId,
          refinementLevel
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create checkout session: ${response.status}`);
      }
      
      const data = await response.json();
      if (!data.checkoutUrl) {
        throw new Error('No checkout URL in response');
      }
      
      messageElement.textContent = 'Opening checkout...';
      
      // Extra validation for URL
      let validCheckoutUrl = data.checkoutUrl;
      if (!validCheckoutUrl.startsWith('http')) {
        if (validCheckoutUrl.startsWith('//')) {
          validCheckoutUrl = 'https:' + validCheckoutUrl;
        } else {
          validCheckoutUrl = 'https://' + validCheckoutUrl;
        }
      }
      
      // Standard mode: Set iframe src and open modal
      const checkoutIframe = document.getElementById('checkout-iframe');
      const checkoutModal = document.getElementById('checkout-modal');
      
      if (checkoutIframe && checkoutModal) {
        checkoutIframe.src = validCheckoutUrl;
        checkoutModal.classList.add('open');
        document.body.style.overflow = 'hidden'; // Prevent scrolling
        
        // Start backup payment detection
        startBackupPaymentDetection(jobId);
      } else {
        throw new Error("Checkout elements not found");
      }
      
      // Show the Check Results button if it exists
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
  function startBackupPaymentDetection(jobId) {
    // Wait a reasonable amount of time before starting checks
    setTimeout(() => {
      // Don't run detection if payment is already recognized
      if (paymentCompleted || window.paymentCompleted) {
        return;
      }
      
      let attempts = 0;
      const maxAttempts = 30; // 15 minutes total (30s intervals)
      
      const interval = setInterval(async () => {
        attempts++;
        
        // Skip check if modal already closed or payment already detected
        const modal = document.getElementById('checkout-modal');
        if (!modal || !modal.classList.contains('open') || 
            paymentCompleted || window.paymentCompleted) {
          clearInterval(interval);
          return;
        }
        
        try {
          const isSuccess = await verifyPaymentWithBackend(jobId);
          if (isSuccess) {
            // Set payment flags
            paymentCompleted = true;
            window.paymentCompleted = true;
            
            // Update message
            messageElement.textContent = '✅ Payment successful! Processing your request...';
            
            // Close the modal if open
            if (modal && modal.classList.contains('open')) {
              modal.classList.remove('open');
              setTimeout(() => {
                const iframe = document.getElementById('checkout-iframe');
                if (iframe) iframe.src = 'about:blank';
                document.body.style.overflow = '';
              }, 500);
            }
            
            // Start polling for results
            if (typeof pollRefinementStatus === 'function') {
              window.checkoutCompleted = false;
              pollRefinementStatus(jobId);
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
  
  // Spinner helper functions
  function showSpinner() {
    const spinner = document.getElementById("spinner");
    if (spinner) spinner.style.display = "block";
  }
  
  function hideSpinner() {
    const spinner = document.getElementById("spinner");
    if (spinner) spinner.style.display = "none";
  }
  
  // Refinement status polling function
  function pollRefinementStatus(jobId) {
    if (!jobId) {
      messageElement.textContent = 'Error: Unable to poll for results (no jobId)';
      return;
    }
    
    let attempts = 0;
    const maxAttempts = 60;
    const pollInterval = 5000;
    
    messageElement.textContent = '⏳ Processing your CV...';
    showSpinner();
    
    const interval = setInterval(async () => {
      try {
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/refinement-status?t=${timestamp}`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          },
          body: JSON.stringify({ jobId })
        });
        
        if (!response.ok) {
          throw new Error(`Failed to check refinement status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.status === 'completed' && data.refinedHTML) {
          clearInterval(interval);
          messageElement.textContent = '✅ CV refinement complete!';
          
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
                body: JSON.stringify({ jobId })
              }).then(r => r.json());
              
              if (jobData && jobData.jobUrl && jobData.cvHTML) {
                await fetch('/refine', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    jobId,
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
  
  // Expose public functions
  // Make checkout modal functions available globally
  window.closeCheckoutModal = closeCheckoutModal;
  
  // Expose refinement functions
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
      const jobId = currentJobId || localStorage.getItem('currentJobId');
      if (!jobId) return false;
      
      const response = await fetch('/api/refinement-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
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
})();