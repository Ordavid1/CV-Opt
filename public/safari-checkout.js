// safari-checkout.js - Updated to handle different browsers correctly

(function() {
  // Declare variables at IIFE scope level
  let currentJobId = null;
  let popupWindow = null;
  let popupCheckInterval = null;
  
  // Wait for DOM to be ready
  document.addEventListener('DOMContentLoaded', function() {
    // Only run for Safari or DuckDuckGo
    if (!window.isSafariOrDuckDuckGo) {
      return;
    }
    
    console.log("Initializing Safari/DuckDuckGo checkout handling");
    
    // Find the checkout button
    const checkoutButton = document.getElementById('checkout-button');
    const resultMessage = document.getElementById('result-message');
    
    if (!checkoutButton) {
      console.warn("Safari checkout: Checkout button not found");
      return;
    }
    
    // Replace the checkout button click handler
    checkoutButton.addEventListener('click', handleSafariCheckout, true);
    
    // Retrieve stored jobId from localStorage
    if (localStorage.getItem('currentJobId')) {
      currentJobId = localStorage.getItem('currentJobId');
    }
    
    console.log("Safari/DuckDuckGo checkout handling initialized");
  });
  
  // Helper function to show spinner
  function showSpinner() {
    const spinner = document.getElementById('spinner');
    if (spinner) spinner.style.display = 'block';
  }
  
  // Helper function to hide spinner
  function hideSpinner() {
    const spinner = document.getElementById('spinner');
    if (spinner) spinner.style.display = 'none';
  }
    
  // Handle checkout for Safari/DuckDuckGo
  async function handleSafariCheckout(event) {
    // Get reference to resultMessage and checkoutButton
    const resultMessage = document.getElementById('result-message');
    const checkoutButton = document.getElementById('checkout-button');
    
    // Prevent default behavior and stop propagation
    event.preventDefault();
    event.stopPropagation();
    
    // Update UI
    resultMessage.textContent = 'Preparing checkout...';
    showSpinner();
    checkoutButton.disabled = true;
    
    try {
      // Get job URL and CV data
      const jobUrl = document.getElementById('jobUrlInput').value.trim();
      const inputDoc = document.getElementById('cvInputFrame')?.contentDocument;
      
      if (!inputDoc) {
        throw new Error('Could not access CV input frame.');
      }
      
      const cvHTML = inputDoc.body.innerHTML;
      
      if (!jobUrl || !cvHTML || cvHTML.includes('class="placeholder"')) {
        throw new Error('Please provide both a job URL and your CV.');
      }
      
      // Get refinement level
      const slider = document.getElementById('refineStrength');
      const refinementLevel = slider ? parseInt(slider.value, 10) : 5;
      
      // Store job data
      resultMessage.textContent = 'Storing job data...';
      const storeResponse = await fetch('/api/store-job-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobUrl, cvHTML, refinementLevel })
      });
      
      if (!storeResponse.ok) {
        throw new Error('Failed to store job data. Please try again.');
      }
      
      const storeData = await storeResponse.json();
      currentJobId = storeData.jobId;
      
      if (!currentJobId) {
        throw new Error('No job ID received from server.');
      }
      
      // Store job ID for later use
      localStorage.setItem('currentJobId', currentJobId);
      
      // Create checkout session
      resultMessage.textContent = 'Creating checkout session...';
      const checkoutResponse = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: currentJobId, refinementLevel })
      });
      
      if (!checkoutResponse.ok) {
        throw new Error('Failed to create checkout session.');
      }
      
      const checkoutData = await checkoutResponse.json();
      
      if (!checkoutData.checkoutUrl) {
        throw new Error('No checkout URL received.');
      }
      
      // Fix URL if needed - ensure it's a full, valid URL
      let checkoutUrl = checkoutData.checkoutUrl;
      if (!checkoutUrl.startsWith('http')) {
        if (checkoutUrl.startsWith('//')) {
          checkoutUrl = 'https:' + checkoutUrl;
        } else {
          checkoutUrl = 'https://' + checkoutUrl;
        }
      }
      
      // Log the URL for debugging
      console.log("Raw checkout URL:", checkoutData.checkoutUrl);
      console.log("Processed checkout URL:", checkoutUrl);

      // Different handling for Safari vs DuckDuckGo
      if (window.isDuckDuckGo) {
        console.log("DuckDuckGo detected - using popup window for payment");
        resultMessage.textContent = 'Opening checkout in new window...';
        
        // Store payment intent in localStorage
        localStorage.setItem('paymentAttempted', 'true');
        localStorage.setItem('paymentAttemptTime', new Date().getTime());
        
        // Open in new window for DuckDuckGo
        const popup = window.open(
          checkoutUrl,
          'lemonsqueezy_checkout',
          'width=600,height=800,menubar=no,toolbar=no,location=yes,status=no,resizable=yes'
        );
        
        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          // If popup fails, fall back to direct redirect
          console.log("Popup window failed, falling back to direct redirect");
          window.location.href = checkoutUrl;
          return;
        }
        
        // Store the popup reference
        popupWindow = popup;
        window.paymentWindow = popup;
        
        // Monitor popup for payment completion
        monitorPopupAndPayment(currentJobId);
        
        return;
      } else {
        // Safari gets popup window
        console.log("Safari detected - using popup window for payment");
        resultMessage.textContent = 'Opening checkout in new window...';
        
        // Store payment intent in localStorage
        localStorage.setItem('paymentAttempted', 'true');
        localStorage.setItem('paymentAttemptTime', new Date().getTime());
        
        // Open in new window for Safari
        const popup = window.open(
          checkoutUrl,
          'lemonsqueezy_checkout',
          'width=600,height=800,menubar=no,toolbar=no,location=yes,status=no,resizable=yes'
        );
        
        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          // If popup fails, fall back to direct redirect
          console.log("Popup window failed, falling back to direct redirect");
          window.location.href = checkoutUrl;
          return;
        }
        
        // Store the popup reference
        popupWindow = popup;
        window.paymentWindow = popup;
        
        // Monitor popup for payment completion
        monitorPopupAndPayment(currentJobId);
        
        return;
      }
      
    } catch (error) {
      console.error('Safari/DuckDuckGo checkout error:', error);
      resultMessage.textContent = error.message;
      hideSpinner();
      checkoutButton.disabled = false;
    }
  }
  
  // Monitor popup window for payment completion
  function monitorPopupAndPayment(jobId) {
    if (!jobId) {
      console.warn("No job ID for monitoring");
      return;
    }
    
    if (!popupWindow) {
      console.warn("No popup window reference for monitoring");
      return;
    }
    
    console.log("Starting popup payment monitoring for jobId:", jobId);
    
    // Clear any existing interval first
    if (popupCheckInterval) {
      clearInterval(popupCheckInterval);
    }
    
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes (5s intervals)
    
    // Set up interval to check popup and payment status
    popupCheckInterval = setInterval(async () => {
      const resultMessage = document.getElementById('result-message');
      const checkoutButton = document.getElementById('checkout-button');
      
      attempts++;
      
      // First check if popup is closed
      if (popupWindow.closed) {
        console.log("Popup closed - checking if payment was completed");
        
        try {
          // Check payment status with backend
          const response = await fetch('/api/refinement-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId })
          });
          
          if (response.ok) {
            const data = await response.json();
            
            if (data.status === 'processing' || data.status === 'completed') {
              // Payment successful
              clearInterval(popupCheckInterval);
              
              // Update UI and start polling for results
              if (resultMessage) {
                resultMessage.textContent = '✅ Payment successful! Processing your CV...';
              }
              
              // Start polling for results
              if (typeof pollRefinementStatus === 'function') {
                pollRefinementStatus(jobId);
              } else if (typeof window.monitorForResults === 'function') {
                window.monitorForResults();
              } else {
                basicPollRefinementStatus(jobId);
              }
              
              // Clear popup reference
              popupWindow = null;
              window.paymentWindow = null;
              
              return;
            } else {
              // Payment not detected yet, but popup is closed
              if (attempts >= maxAttempts) {
                clearInterval(popupCheckInterval);
                
                if (resultMessage) {
                  resultMessage.textContent = 'Checkout window closed. If you completed payment, results will appear soon.';
                }
                
                hideSpinner();
                
                if (checkoutButton) {
                  checkoutButton.disabled = false;
                  checkoutButton.textContent = 'Optimize Me!';
                }
                
                // Schedule a final check after a delay
                setTimeout(() => {
                  checkPaymentStatus(jobId);
                }, 10000);
              }
            }
          }
        } catch (error) {
          console.error("Error checking payment status:", error);
          
          if (attempts >= maxAttempts) {
            clearInterval(popupCheckInterval);
            
            if (resultMessage) {
              resultMessage.textContent = 'Error checking payment. Please try again.';
            }
            
            hideSpinner();
            
            if (checkoutButton) {
              checkoutButton.disabled = false;
            }
          }
        }
      } else {
        // Popup still open - update message periodically
        if (attempts % 12 === 0 && resultMessage) { // Every minute
          resultMessage.textContent = 'Waiting for payment to complete...';
        }
        
        // Check for timeout
        if (attempts >= maxAttempts) {
          clearInterval(popupCheckInterval);
          
          // Try to close the popup
          if (!popupWindow.closed) {
            try {
              popupWindow.close();
            } catch (e) {
              // Ignore errors closing window
            }
          }
          
          if (resultMessage) {
            resultMessage.textContent = 'Checkout timed out. Please try again.';
          }
          
          hideSpinner();
          
          if (checkoutButton) {
            checkoutButton.disabled = false;
          }
        }
      }
    }, 5000);
  }
  
  // One-time payment status check
  async function checkPaymentStatus(jobId) {
    if (!jobId) return;
    
    try {
      const response = await fetch('/api/refinement-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.status === 'processing' || data.status === 'completed') {
          // Payment was successful after all
          const resultMessage = document.getElementById('result-message');
          if (resultMessage) {
            resultMessage.textContent = '✅ Payment confirmed! Processing your CV...';
          }
          
          // Start polling for results
          if (typeof pollRefinementStatus === 'function') {
            pollRefinementStatus(jobId);
          } else if (typeof window.monitorForResults === 'function') {
            window.monitorForResults();
          } else {
            basicPollRefinementStatus(jobId);
          }
        }
      }
    } catch (error) {
      console.error("Error in final payment check:", error);
    }
  }
  
  // Basic polling function as fallback
  function basicPollRefinementStatus(jobId) {
    if (!jobId) return;
    
    const resultMessage = document.getElementById('result-message');
    const checkoutButton = document.getElementById('checkout-button');
    let attempts = 0;
    const maxAttempts = 60;
    
    const interval = setInterval(async () => {
      attempts++;
      
      try {
        const response = await fetch('/api/refinement-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId })
        });
        
        if (!response.ok) {
          throw new Error(`Failed to check refinement status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.status === 'completed' && data.refinedHTML) {
          clearInterval(interval);
          resultMessage.textContent = '✅ CV refinement complete!';
          
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
        }
        
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          resultMessage.textContent = 'Refinement process timed out. Please try again.';
          hideSpinner();
          checkoutButton.disabled = false;
          checkoutButton.textContent = 'Optimize Me!';
        }
      } catch (error) {
        console.error('Error checking refinement status:', error);
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          resultMessage.textContent = 'Error checking refinement status. Please try again.';
          hideSpinner();
          checkoutButton.disabled = false;
          checkoutButton.textContent = 'Optimize Me!';
        }
      }
    }, 5000);
  }
  
  // Check if we need to start polling after returning from payment redirect
  window.addEventListener('load', function() {
    // Only execute for Safari/DuckDuckGo browsers
    if (!window.isSafariOrDuckDuckGo) return;
    
    const jobId = localStorage.getItem('currentJobId');
    const paymentAttempted = localStorage.getItem('paymentAttempted');
    const paymentTime = localStorage.getItem('paymentAttemptTime');
    
    // If we have a job ID and payment was attempted recently (last 15 minutes)
    if (jobId && paymentAttempted === 'true' && paymentTime) {
      const timeSincePayment = Date.now() - parseInt(paymentTime, 10);
      if (timeSincePayment < 15 * 60 * 1000) { // 15 minutes
        console.log("Detected return from payment redirect, checking for results");
        
        // Check if results are ready
        checkPaymentStatus(jobId);
      }
    }
  });
})();