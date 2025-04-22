// payment-force-refine.js - Force payment confirmation and refinement
// This is a compatible version of payment-force.js

(function() {
  console.log("Installing force payment & refinement module...");
  
  // Initialize variables
  let currentJobId = localStorage.getItem('currentJobId');
  let paymentAttempted = false;
  let refinementForced = false;
  let refinementCheckInterval = null;
  
  // Wait for DOM to be ready
  document.addEventListener('DOMContentLoaded', function() {
    // Setup forced refinement button
    setupForceRefinementButton();
    
    // Intercept checkout button to capture jobId
    const checkoutButton = document.getElementById('checkout-button');
    if (checkoutButton) {
      checkoutButton.addEventListener('click', function(event) {
        paymentAttempted = true;
        
        // Setup auto force refinement after timeout
        setupAutoForceRefinement();
      }, true);
    }
    
    // Also handle existing checkout flow
    if (currentJobId) {
      setupExistingJobMonitoring();
    }
  });
  
  // Add a hidden force refinement button
  function setupForceRefinementButton() {
    const existingButton = document.getElementById('force-refinement-button');
    if (existingButton) return;
    
    const button = document.createElement('button');
    button.id = 'force-refinement-button';
    button.textContent = 'Force Start Refinement';
    button.style.position = 'fixed';
    button.style.bottom = '10px';
    button.style.right = '10px';
    button.style.zIndex = '9999';
    button.style.backgroundColor = '#4CAF50';
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.padding = '8px 12px';
    button.style.cursor = 'pointer';
    button.style.display = 'none';
    
    button.addEventListener('click', function() {
      forceRefinementStart();
    });
    
    document.body.appendChild(button);
    
    // Add keyboard shortcut: Ctrl+Alt+F to force refinement
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.altKey && e.key === 'f') {
        if (currentJobId || localStorage.getItem('currentJobId')) {
          console.log("Force refinement keyboard shortcut activated");
          forceRefinementStart();
        }
      }
    });
  }
  
// Auto force refinement after a timeout - with better safeguards
function setupAutoForceRefinement() {
  // Clear any existing auto-force
  if (window.autoForceTimeout) {
    clearTimeout(window.autoForceTimeout);
    window.autoForceTimeout = null;
  }
  
  // Only show the force button in Safari browsers as a fallback
  if (window.isSafariOrDuckDuckGo) {
    setTimeout(() => {
      const button = document.getElementById('force-refinement-button');
      if (button && paymentAttempted && !refinementForced) {
        // Only show on Safari browsers after delay
        button.style.display = 'block';
      }
    }, 60000); // After 60 seconds
    
    // Only enable auto-forcing on Safari browsers
    window.autoForceTimeout = setTimeout(() => {
      // Check that payment was attempted but we're still waiting
      if (paymentAttempted && !refinementForced) {
        // Check if payment is still in progress (modal open)
        const modal = document.getElementById('checkout-modal');
        const isModalOpen = modal && modal.classList.contains('open');
        
        // Additional checks for payment popup window in Safari
        const paymentInProgressIndicators = [
          document.getElementById('result-message')?.textContent.includes('checkout'),
          document.getElementById('result-message')?.textContent.includes('payment'),
          window.paymentWindow && !window.paymentWindow.closed,
          localStorage.getItem('paymentAttempted') === 'true',
          isModalOpen
        ];
        
        if (paymentInProgressIndicators.some(indicator => indicator === true)) {
          console.log("Auto-forcing refinement after timeout - payment appears stuck");
          forceRefinementStart();
        } else {
          console.log("Payment not clearly in progress, not auto-forcing");
        }
      }
    }, 120000); // Increased to 2 minutes
  }
}
  
  // Monitor existing job refinement
  function setupExistingJobMonitoring() {
    // Check if there's an active monitoring already
    if (refinementCheckInterval) {
      clearInterval(refinementCheckInterval);
    }
    
    // Start checking refinement status to see if it's completed
    refinementCheckInterval = setInterval(async () => {
      try {
        const jobId = currentJobId || localStorage.getItem('currentJobId');
        if (!jobId) {
          clearInterval(refinementCheckInterval);
          return;
        }
        
        // Check if refinement is still in progress
        const response = await fetch('/api/refinement-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId })
        });
        
        if (!response.ok) {
          throw new Error(`Failed to check refinement status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // If we've been stuck in processing for a while, force start
        if (data.status === 'processing' && !refinementForced) {
          // Show the force button
          const button = document.getElementById('force-refinement-button');
          if (button) {
            button.style.display = 'block';
          }
        }
        
        // If completed, clean up
        if (data.status === 'completed') {
          clearInterval(refinementCheckInterval);
          const button = document.getElementById('force-refinement-button');
          if (button) {
            button.style.display = 'none';
          }
        }
      } catch (error) {
        console.error("Error checking refinement status:", error);
      }
    }, 15000); // Check every 15 seconds
  }
  
  // Force start the refinement process
  async function forceRefinementStart() {
    // CRITICAL: Only allow force refinement in Safari browsers
    if (!window.isSafariOrDuckDuckGo) {
      console.log("Force refinement blocked - only available on Safari browsers");
      // Show notification if available
      if (typeof showNotification === 'function') {
        showNotification('This function is only available for Safari browsers');
      }
      return;
    }    
    try {
      // Hide spinner and reset UI
      const spinner = document.getElementById('spinner');
      if (spinner) spinner.style.display = 'none';
      
      // Close any modals
      const modal = document.getElementById('checkout-modal');
      if (modal) {
        modal.classList.remove('open');
        setTimeout(() => {
          const iframe = document.getElementById('checkout-iframe');
          if (iframe) iframe.src = 'about:blank';
          document.body.style.overflow = '';
        }, 300);
      }
      
      // Get the current job ID
      const jobId = currentJobId || localStorage.getItem('currentJobId');
      if (!jobId) {
        showMessage('No job ID found. Please try again.');
        return;
      }
      
      // Additional check to verify payment was attempted
      // This will prevent using the force button to bypass payment
      const verifyPayment = await fetch('/api/check-payment-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      }).then(r => r.json()).catch(() => ({ verified: false }));
      
      if (!verifyPayment.verified) {
        // Check local storage backup
        const paymentTimestamp = localStorage.getItem('paymentAttemptTime');
        const currentTime = new Date().getTime();
        // Only allow force if payment was attempted in the last 10 minutes
        if (!paymentTimestamp || (currentTime - paymentTimestamp > 600000)) {
          throw new Error('Payment verification failed. Please complete payment first.');
        }
      }

      // Show forcing message
      showMessage('🔄 Forcing refinement to start...');
      
      // Set flag to prevent duplicate forcing
      refinementForced = true;
      
      // Hide the force button
      const button = document.getElementById('force-refinement-button');
      if (button) {
        button.style.display = 'none';
      }
      
      // First try to get job data to use for forcing
      const jobDataResponse = await fetch('/api/get-job-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      });
      
      if (!jobDataResponse.ok) {
        throw new Error(`Failed to get job data: ${jobDataResponse.status}`);
      }
      
      const jobData = await jobDataResponse.json();
      
      if (jobData.status !== 'success' || !jobData.jobUrl || !jobData.cvHTML) {
        throw new Error('Invalid job data received');
      }
      
      // Directly call the refine endpoint with the job data
      showMessage('🚀 Starting refinement process directly...');
      
      const refineResponse = await fetch('/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          jobUrl: jobData.jobUrl,
          cvHTML: jobData.cvHTML,
          refinementLevel: localStorage.getItem('refinementLevel') || 5,
          forceStart: true,
          conversation: []
        })
      });
      
      if (!refineResponse.ok) {
        throw new Error(`Failed to start refinement: ${refineResponse.status}`);
      }
      
      // Show success message
      showMessage('✅ Refinement process started! Results will appear shortly.');
      
      // Start polling for results
      startPollForResults(jobId);
      
    } catch (error) {
      console.error("Error forcing refinement:", error);
      showMessage(`Error: ${error.message}. Please try again.`);
      
      // Reset force flag
      refinementForced = false;
    }
  }
  
  // Start polling for results
  function startPollForResults(jobId) {
    if (!jobId) return;
    
    let attempts = 0;
    const maxAttempts = 60;
    const pollInterval = 5000;
    
    // Show spinner
    const spinner = document.getElementById('spinner');
    if (spinner) spinner.style.display = 'block';
    
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
          
          // Update UI with results
          showMessage('✅ CV refinement complete!');
          
          const outDoc = document.getElementById('cvOutputFrame').contentDocument;
          if (outDoc) {
            outDoc.body.innerHTML = data.refinedHTML;
            
            if (data.changes) {
              const changesContainer = document.getElementById("changes");
              if (changesContainer) {
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
            }
            
            // Show notification if available
            if (typeof showNotification === 'function') {
              showNotification('✅ CV refinement complete! Check the results.');
            }
          }
          
          // Hide spinner and reset UI
          if (spinner) spinner.style.display = 'none';
          
          const checkoutButton = document.getElementById('checkout-button');
          if (checkoutButton) {
            checkoutButton.disabled = false;
            checkoutButton.textContent = 'Optimize Me!';
          }
          
          return;
        }
        
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          showMessage('Refinement process timed out. Please try again.');
          
          if (spinner) spinner.style.display = 'none';
          
          const checkoutButton = document.getElementById('checkout-button');
          if (checkoutButton) {
            checkoutButton.disabled = false;
            checkoutButton.textContent = 'Optimize Me!';
          }
        }
      } catch (error) {
        console.error("Error checking refinement status:", error);
        
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          showMessage('Error checking refinement status. Please try again.');
          
          if (spinner) spinner.style.display = 'none';
          
          const checkoutButton = document.getElementById('checkout-button');
          if (checkoutButton) {
            checkoutButton.disabled = false;
            checkoutButton.textContent = 'Optimize Me!';
          }
        }
      }
    }, pollInterval);
  }
  
  // Helper to show message
  function showMessage(message) {
    const messageElement = document.getElementById('result-message');
    if (messageElement) {
      messageElement.textContent = message;
    }
  }
  
  // Expose the force refinement function globally
  window.forceRefinementStart = forceRefinementStart;
  
  console.log("Force payment & refinement module installed");
})();