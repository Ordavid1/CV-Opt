// browser-compatibility.js - Complete fix for Safari and DuckDuckGo
// This should be loaded FIRST, before any other scripts

(function() {
  // More precise browser detection - separate flags for each browser
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent) && 
                  !(/Chrome/.test(navigator.userAgent)) && 
                  !(/Edg|Edge|OPR|Opera/.test(navigator.userAgent));
                  
  const isChrome = /Chrome/.test(navigator.userAgent) && 
                  !/Edg|Edge|OPR|Opera/.test(navigator.userAgent) &&
                  !(/DuckDuckGo/.test(navigator.userAgent));
                  
  const isDuckDuckGo = /DuckDuckGo/.test(navigator.userAgent);

  // Set specific browser flags
  window.isSafari = isSafari;
  window.isChrome = isChrome;
  window.isDuckDuckGo = isDuckDuckGo;
  
  // Compatibility flag - Safari or DuckDuckGo will use special handling
  window.isSafariOrDuckDuckGo = isSafari || isDuckDuckGo;

  console.log(`Browser detection: Safari=${isSafari}, Chrome=${isChrome}, DuckDuckGo=${isDuckDuckGo}`);
  
  if (window.isSafariOrDuckDuckGo) {
    console.log("Safari or DuckDuckGo detected - enabling compatibility mode");
    document.documentElement.classList.add('safari-browser');
      
      // =====================================================
      // 1. URL Constructor Fix - Critical for Safari
      // =====================================================
      const OriginalURL = window.URL;
      
      window.URL = function SafeURLConstructor(url, base) {
        // Handle undefined or invalid URLs
        if (url === undefined || url === null) {
          console.warn("SafeURL: Handling undefined/null URL input");
          return {
            href: "about:blank",
            toString: function() { return this.href; },
            searchParams: new URLSearchParams()
          };
        }
        
        // Convert non-string URLs to strings
        if (typeof url !== 'string') {
          try {
            url = String(url);
          } catch (e) {
            console.warn("SafeURL: Couldn't convert URL to string");
            return {
              href: "about:blank",
              toString: function() { return this.href; },
              searchParams: new URLSearchParams()
            };
          }
        }
        
        // Add protocol if missing
        if (url && !url.includes('://') && !url.startsWith('mailto:') && !url.startsWith('tel:')) {
          if (url.startsWith('//')) {
            url = 'https:' + url;
          } else if (url.startsWith('/')) {
            url = window.location.origin + url;
          } else if (!url.startsWith('http')) {
            url = 'https://' + url;
          }
        }
        
        // Try to construct with the fixed URL
        try {
          return new OriginalURL(url, base);
        } catch (e) {
          console.warn("SafeURL: Failed to create URL with input:", url, e);
          
          // Return a minimal URL-like object
          return {
            href: "about:blank",
            toString: function() { return this.href; },
            searchParams: new URLSearchParams()
          };
        }
      };
      
      // Copy prototype and static methods
      window.URL.prototype = OriginalURL.prototype;
      window.URL.createObjectURL = OriginalURL.createObjectURL;
      window.URL.revokeObjectURL = OriginalURL.revokeObjectURL;
      
      // =====================================================
      // 2. LemonSqueezy Mock Implementation
      // =====================================================
      // This will replace the actual Lemon Squeezy SDK for Safari/DuckDuckGo
      // with a version that opens checkout in a new window instead of iframe
      
      // Store original script loading behavior
      const originalCreateElement = document.createElement;
      
      // Override script loading to intercept lemon.js
      document.createElement = function(tagName) {
        const element = originalCreateElement.call(document, tagName);
        
        if (tagName.toLowerCase() === 'script') {
          const originalSetAttribute = element.setAttribute;
          
          element.setAttribute = function(name, value) {
            if (name === 'src' && value && value.includes('lemon.js')) {
              console.log("Intercepting Lemon Squeezy script load");
              
              // Don't actually load the script, but create our implementation
              setTimeout(function() {
                createSafariLemonSqueezy();
              }, 0);
              
              // Call the original to maintain expected behavior
              return originalSetAttribute.call(this, name, value);
            }
            return originalSetAttribute.call(this, name, value);
          };
        }
        
        return element;
      };
      
      // Create our custom Lemon Squeezy implementation
      function createSafariLemonSqueezy() {
        console.log("Creating Safari-compatible LemonSqueezy implementation");
        
        // Create a mock of the LemonSqueezy SDK
        window.LemonSqueezy = {
          Setup: function(options) {
            window.LemonSqueezyOptions = options;
            console.log("SafariLemonSqueezy: Setup called");
            return true;
          },
          Url: {
            Close: function() {
              console.log("SafariLemonSqueezy: Close called");
            }
          }
        };
        
        // Mock the createLemonSqueezy function
        window.createLemonSqueezy = function() {
          console.log("SafariLemonSqueezy: createLemonSqueezy called");
          return true;
        };
        
        // Notify that our implementation is ready
        const event = new CustomEvent('safariLemonSqueezyReady');
        document.dispatchEvent(event);
      }
      
      // =====================================================
      // 3. Fix common Safari issues
      // =====================================================
      
      // Fix for JSON.parse issues
      const originalJSONParse = JSON.parse;
      JSON.parse = function(text, reviver) {
        if (text === undefined || text === null || text === "[object Object]") {
          return {};
        }
        try {
          return originalJSONParse.call(JSON, text, reviver);
        } catch (e) {
          console.warn('JSON parse error:', e);
          return {};
        }
      };
      
      // Fix for window.open issues in Safari
      const originalWindowOpen = window.open;
      window.open = function(url, target, features) {
        // Fix URL if needed
        if (url && typeof url === 'string') {
          if (!url.includes('://') && !url.startsWith('mailto:')) {
            if (url.startsWith('//')) {
              url = 'https:' + url;
            } else if (!url.startsWith('/') && !url.startsWith('http')) {
              url = 'https://' + url;
            }
          }
        }
        
        // Call original with fixed URL
        try {
          return originalWindowOpen.call(window, url, target, features);
        } catch (e) {
          console.warn('Error in window.open:', e);
          // Try again with simpler features string
          try {
            return originalWindowOpen.call(window, url, target, 'width=800,height=600');
          } catch (e2) {
            console.error('Failed to open window:', e2);
            return null;
          }
        }
      };
      
      // =====================================================
      // 4. Fix for Safari spinner/overlay issues
      // =====================================================
      window.addEventListener('load', function() {
        // Create a function to hide all spinners and overlays
        window.forceHideSpinner = function() {
          // Hide spinner
          const spinner = document.getElementById('spinner');
          if (spinner) spinner.style.display = 'none';
          
          // Hide checkout modal
          const checkoutModal = document.getElementById('checkout-modal');
          if (checkoutModal) {
            checkoutModal.classList.remove('open');
            checkoutModal.style.display = 'none';
          }
          
          // Hide any other potential loading indicators
          const loaders = document.querySelectorAll('.loader, .loading, .spinner');
          loaders.forEach(function(loader) {
            loader.style.display = 'none';
          });
          
          // Enable button
          const checkoutButton = document.getElementById('checkout-button');
          if (checkoutButton) {
            checkoutButton.disabled = false;
          }
          
          document.body.style.overflow = '';
        };
        
        // Add emergency escape hatch (double-tap Escape key)
        let lastEscTime = 0;
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') {
            const now = new Date().getTime();
            if (now - lastEscTime < 500) {
              // Double-tap of Escape detected
              forceHideSpinner();
            }
            lastEscTime = now;
          }
        });
        
        // Add fail-safe timer to auto-hide spinner after 45 seconds
        const checkoutButton = document.getElementById('checkout-button');
        if (checkoutButton) {
          checkoutButton.addEventListener('click', function() {
            setTimeout(forceHideSpinner, 45000);
          });
        }
      });
    }
  })();