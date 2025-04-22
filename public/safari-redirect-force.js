// safari-redirect-force.js - Force direct redirect for Safari payments
// Add this to your public folder and include it in index.ejs

(function() {
  // Execute immediately to catch any checkout attempts
  // This script takes precedence over all other checkout methods for Safari
  
  console.log("⚠️ Safari direct redirect enforcer initialized");
  
  // Immediately check if we're on Safari/iOS and set up event capture
  const isSafariBrowser = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) || 
                         /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                         navigator.userAgent.indexOf('DuckDuckGo') !== -1;
                         
  if (!isSafariBrowser) {
    console.log("Not Safari, skipping redirect enforcer");
    return;
  }
  
  // Override checkout function before anything else loads
  window.safariCheckoutRedirect = function(checkoutUrl) {
    if (!checkoutUrl) {
      console.error("No checkout URL provided for Safari redirect");
      return false;
    }
    
    console.log("🔴 SAFARI REDIRECT: Forcing direct payment page redirect");
    
    // Make sure URL is fully qualified
    if (!checkoutUrl.startsWith('http')) {
      if (checkoutUrl.startsWith('//')) {
        checkoutUrl = 'https:' + checkoutUrl;
      } else {
        checkoutUrl = 'https://' + checkoutUrl;
      }
    }
    
    // Store critical data before redirect
    const jobId = localStorage.getItem('currentJobId');
    
    if (jobId) {
      console.log("Storing payment attempt data for jobId:", jobId);
      localStorage.setItem('paymentAttempted', 'true');
      localStorage.setItem('paymentAttemptTime', Date.now());
      localStorage.setItem('lastCheckoutUrl', checkoutUrl);
    }
    
    // Give a brief moment for storage to sync
    setTimeout(() => {
      // Redirect the entire window
      window.location.href = checkoutUrl;
    }, 100);
    
    return true;
  };
  
  // Capture checkout data directly from fetch responses
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    try {
      const url = args[0];
      // Check if this is a create-checkout request
      if (typeof url === 'string' && url.includes('/api/create-checkout')) {
        console.log("🔍 Safari redirect: Detected checkout API call");
        
        // Call original fetch
        const response = await originalFetch.apply(this, args);
        
        // Clone the response so we can read it and still return the original
        const clonedResponse = response.clone();
        
        // Process the response asynchronously
        clonedResponse.json().then(data => {
          if (data && data.checkoutUrl) {
            console.log("🔍 Safari redirect: Found checkout URL in response");
            console.log("Checkout URL:", data.checkoutUrl);
            
            // Store for use even if main flow fails
            localStorage.setItem('lastCheckoutUrl', data.checkoutUrl);
          }
        }).catch(e => {
          console.error("Error processing checkout response:", e);
        });
        
        // Return original response
        return response;
      }
      
      // Default behavior
      return originalFetch.apply(this, args);
    } catch (error) {
      console.error("Error in fetch override:", error);
      return originalFetch.apply(this, args);
    }
  };
  
  // Intercept modal openings and iframe loads - capture early in document load
  document.addEventListener('DOMContentLoaded', function() {
    // Override checkout modal opening
    const checkoutModal = document.getElementById('checkout-modal');
    const checkoutIframe = document.getElementById('checkout-iframe');
    
    if (checkoutModal) {
      // Monitor class changes on modal to detect opening
      const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          if (mutation.attributeName === 'class' && 
              checkoutModal.classList.contains('open') && 
              checkoutIframe) {
                
            console.log("🔴 Safari redirect: Detected modal opening, checking for URL");
            
            // Try to extract URL from iframe
            let iframeUrl = checkoutIframe.src;
            
            if (iframeUrl && iframeUrl !== 'about:blank' && !iframeUrl.includes('blank')) {
              console.log("🔴 Safari redirect: Found URL in iframe:", iframeUrl);
              window.safariCheckoutRedirect(iframeUrl);
              return;
            }
            
            // Check localStorage as backup
            const lastUrl = localStorage.getItem('lastCheckoutUrl');
            if (lastUrl) {
              console.log("🔴 Safari redirect: Using URL from localStorage:", lastUrl);
              window.safariCheckoutRedirect(lastUrl);
              return;
            }
          }
        });
      });
      
      observer.observe(checkoutModal, { attributes: true });
    }
    
    // Also add a listener to the checkout button
    const checkoutButton = document.getElementById('checkout-button');
    if (checkoutButton) {
      checkoutButton.addEventListener('click', function() {
        console.log("🔍 Safari redirect: Checkout button clicked");
        
        // Set a timer to check for URL in localStorage after button click
        setTimeout(() => {
          const lastUrl = localStorage.getItem('lastCheckoutUrl');
          if (lastUrl) {
            // Only redirect if modal is open (means we're in checkout flow)
            if (checkoutModal && checkoutModal.classList.contains('open')) {
              console.log("🔴 Safari redirect: Using delayed URL from localStorage:", lastUrl);
              window.safariCheckoutRedirect(lastUrl);
            }
          }
        }, 2000);  // 2 second delay to allow API call to complete
      }, true);  // Use capture phase to run before other handlers
    }
    
    // If returning from payment, check if we need to poll
    // (for when a user returns from checkout page)
    const jobId = localStorage.getItem('currentJobId');
    const paymentAttempted = localStorage.getItem('paymentAttempted');
    
    if (jobId && paymentAttempted === 'true') {
      console.log("Safari redirect: Detected return from payment page");
      
      // Check refinement status
      fetch('/api/refinement-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      })
      .then(response => response.json())
      .then(data => {
        console.log("Safari redirect: Refinement status check:", data);
        
        if (data.status === 'processing' || data.status === 'completed') {
          console.log("Safari redirect: Payment confirmed, showing results");
          
          const resultMessage = document.getElementById('result-message');
          if (resultMessage) {
            resultMessage.textContent = '✅ Payment successful! Processing your CV...';
          }
          
          // Start polling for results
          if (typeof window.monitorForResults === 'function') {
            window.monitorForResults();
          } else if (typeof pollRefinementStatus === 'function') {
            pollRefinementStatus(jobId);
          }
        }
      })
      .catch(error => {
        console.error("Error checking refinement status after return:", error);
      });
    }
  });
  
  console.log("Safari redirect enforcer fully initialized");
})();