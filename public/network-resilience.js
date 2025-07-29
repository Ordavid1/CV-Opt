// network-resilience.js - Properly fixed to avoid recursive fetch calls

(function() {
  console.log("Installing network resilience module...");
  
  // Store original fetch to avoid recursion
  const originalFetch = window.fetch;
  
  // Create a resilient fetch function with retry logic
  window.fetchWithRetry = async function(url, options = {}, maxRetries = 3, retryDelay = 1000) {
    let retries = 0;
    
    while (true) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const fetchOptions = {
          ...options,
          signal: controller.signal,
          // Add cache-busting
          headers: {
            ...options.headers,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        };
        
        // Add timestamp to GET URLs
        let fetchUrl = url;
        if (!options.method || options.method === 'GET') {
          const separator = url.includes('?') ? '&' : '?';
          fetchUrl = `${url}${separator}t=${Date.now()}`;
        }
        
        // IMPORTANT: Use originalFetch, not window.fetch to avoid recursion
        const response = await originalFetch(fetchUrl, fetchOptions);
        clearTimeout(timeoutId);
        
        return response;
      } catch (error) {
        console.warn(`Fetch attempt ${retries + 1} failed:`, error.message);
        
        if (retries >= maxRetries || error.name === 'AbortError') {
          console.error(`Fetch failed after ${retries} retries:`, error);
          throw error;
        }
        
        // Exponential backoff
        const delay = retryDelay * Math.pow(2, retries);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        retries++;
      }
    }
  };
  
  // Patch refinement status checks to use resilient fetch
  function patchRefinementStatusChecks() {
    // Try to find and patch pollRefinementStatus function
    if (typeof window.pollRefinementStatus === 'function') {
      const originalPoll = window.pollRefinementStatus;
      
      window.pollRefinementStatus = function(jobId) {
        if (!jobId) {
          const msgElement = document.getElementById('result-message');
          if (msgElement) {
            msgElement.textContent = 'Error: Unable to poll for results (no jobId)';
          }
          return;
        }
        
        let attempts = 0;
        const maxAttempts = 60;
        const pollInterval = 5000;
        
        const msgElement = document.getElementById('result-message');
        if (msgElement) {
          msgElement.textContent = '⏳ Processing your CV...';
        }
        
        const spinner = document.getElementById('spinner');
        if (spinner) spinner.style.display = 'block';
        
        const interval = setInterval(async () => {
          try {
            // Use our resilient fetch directly rather than patching window.fetch
            // This avoids recursion issues
            const response = await window.fetchWithRetry('/api/refinement-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jobId })
            }, 3, 1000);
            
            if (!response.ok) {
              throw new Error(`Failed to check refinement status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.status === 'completed' && data.refinedHTML) {
              clearInterval(interval);
              if (msgElement) {
                msgElement.textContent = '✅ CV refinement complete!';
              }
              
              const outDoc = document.getElementById('cvOutputFrame').contentDocument;
              if (outDoc) {
                updateOutputFrame(data.refinedHTML);
                
                if (data.changes) {
                  // Use the parent window's displayChangesInIframe function if available
                  if (window.displayChangesInIframe && typeof window.displayChangesInIframe === 'function') {
                    window.displayChangesInIframe(data.refinedHTML, data.changes);
                  } else {
                    // Fallback to simple display
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
                }
                
                if (typeof showNotification === 'function') {
                  showNotification('✅ CV refinement complete! Check the results.');
                }
                
                if (spinner) spinner.style.display = 'none';
                
                const checkoutButton = document.getElementById('checkout-button');
                if (checkoutButton) {
                  checkoutButton.disabled = false;
                  checkoutButton.textContent = 'Optimize Me!';
                }
                
                return;
              }
            } else if (data.status === 'pending' && attempts === Math.floor(maxAttempts / 2)) {
              // Force refinement at halfway point if available
              if (typeof window.forceRefinementStart === 'function') {
                window.forceRefinementStart();
              }
            }
            
            attempts++;
            if (attempts >= maxAttempts) {
              clearInterval(interval);
              if (msgElement) {
                msgElement.textContent = 'Refinement process timed out. Please try again.';
              }
              
              if (spinner) spinner.style.display = 'none';
              
              const checkoutButton = document.getElementById('checkout-button');
              if (checkoutButton) {
                checkoutButton.disabled = false;
                checkoutButton.textContent = 'Optimize Me!';
              }
            }
          } catch (error) {
            console.error("Error checking refinement status:", error);
            
            attempts++;
            if (attempts >= maxAttempts) {
              clearInterval(interval);
              if (msgElement) {
                msgElement.textContent = 'Error checking refinement status. Please try again.';
              }
              
              if (spinner) spinner.style.display = 'none';
              
              const checkoutButton = document.getElementById('checkout-button');
              if (checkoutButton) {
                checkoutButton.disabled = false;
                checkoutButton.textContent = 'Optimize Me!';
              }
            }
          }
        }, pollInterval);
      };
    }
    
    // Also patch monitorForResults if it exists
    if (typeof window.monitorForResults === 'function') {
      const originalMonitor = window.monitorForResults;
      
      window.monitorForResults = function() {
        const jobId = sessionStorage.getItem('currentJobId') || localStorage.getItem('currentJobId');
        if (jobId) {
          window.checkoutCompleted = false;
          window.pollRefinementStatus(jobId); // Use our patched function
          return true;
        } else {
          return false;
        }
      };
    }
  }
  
  // Apply patches once DOM is loaded - DO NOT PATCH WINDOW.FETCH GLOBALLY
  document.addEventListener('DOMContentLoaded', function() {
    try {
      patchRefinementStatusChecks();
    } catch (error) {
      console.error("Error applying network resilience patches:", error);
    }
  });
  
  console.log("Network resilience module installed");
})();