// direct-lemon-patch.js - Direct patch for Lemon.js
// This is a renamed version of direct-lemon-fix.js

(function() {
  console.log("Installing direct Lemon.js patch...");
  
  // Wait for the lemon.js script to load
  document.addEventListener('DOMContentLoaded', function() {
    // Patch the problematic function in lemon.js
    setTimeout(function() {
      try {
        // If LemonSqueezy already exists, check and patch it
        if (window.LemonSqueezy) {
          patchLemonSqueezy();
        } else {
          // Otherwise wait for it to be created
          watchForLemonSqueezy();
        }
      } catch (e) {
        console.error("Error in direct lemon patch:", e);
      }
    }, 100);
  });
  
  function watchForLemonSqueezy() {
    // Create a property descriptor to intercept LemonSqueezy creation
    let lemonSqueezyDescriptor = Object.getOwnPropertyDescriptor(window, 'LemonSqueezy');
    
    if (!lemonSqueezyDescriptor || !lemonSqueezyDescriptor.configurable) {
      // Define our own property to intercept creation
      let _LemonSqueezy = window.LemonSqueezy;
      
      Object.defineProperty(window, 'LemonSqueezy', {
        configurable: true,
        get: function() {
          return _LemonSqueezy;
        },
        set: function(newValue) {
          _LemonSqueezy = newValue;
          if (newValue) {
            patchLemonSqueezy();
          }
        }
      });
      
      // Also watch for createLemonSqueezy function
      const originalCreateLemonSqueezy = window.createLemonSqueezy;
      window.createLemonSqueezy = function() {
        const result = originalCreateLemonSqueezy ? originalCreateLemonSqueezy.apply(this, arguments) : undefined;
        
        // After creation, apply our patch
        setTimeout(patchLemonSqueezy, 0);
        
        return result;
      };
    }
  }
  
  function patchLemonSqueezy() {
    if (!window.LemonSqueezy) return;
    
    console.log("Applying direct patch to LemonSqueezy");
    
    // Try to find and patch the URL constructor issue
    const originalCreateIframe = window.LemonSqueezy.Url && window.LemonSqueezy.Url.createIframe;
    if (typeof originalCreateIframe === 'function') {
      window.LemonSqueezy.Url.createIframe = function() {
        try {
          return originalCreateIframe.apply(this, arguments);
        } catch (error) {
          console.warn("Error in LemonSqueezy.Url.createIframe, using fallback", error);
          // Create a simple iframe as fallback
          const iframe = document.createElement('iframe');
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.border = 'none';
          iframe.allow = 'payment';
          
          return iframe;
        }
      };
    }
    
    // Also patch any methods that use URL constructor
    for (const key in window.LemonSqueezy) {
      if (typeof window.LemonSqueezy[key] === 'function') {
        const original = window.LemonSqueezy[key];
        window.LemonSqueezy[key] = function() {
          try {
            return original.apply(this, arguments);
          } catch (error) {
            if (error.toString().includes('URL')) {
              console.warn(`Error in LemonSqueezy.${key} related to URL:`, error);
              return null;
            }
            throw error;
          }
        };
      }
    }
    
    // Patch URL construction in lemon.js for specific functions known to have issues
    if (typeof window.URL === 'function') {
      // Keep a reference to our already patched URL constructor
      const SafeURLConstructor = window.URL;
      
      // Create an even more aggressive version specifically for lemon.js
      window.URL = function ExtraSafeURLConstructor(url, base) {
        if (!url) {
          console.warn("ExtraSafeURL: Empty URL provided to constructor");
          return {
            href: window.location.origin,
            searchParams: new URLSearchParams(),
            toString: function() { return this.href; }
          };
        }
        
        try {
          return new SafeURLConstructor(url, base);
        } catch (e) {
          console.warn("ExtraSafeURL: Error creating URL:", e);
          return {
            href: window.location.origin,
            searchParams: new URLSearchParams(),
            toString: function() { return this.href; }
          };
        }
      };
      
      // Copy over prototype and static methods
      window.URL.prototype = SafeURLConstructor.prototype;
      window.URL.createObjectURL = SafeURLConstructor.createObjectURL;
      window.URL.revokeObjectURL = SafeURLConstructor.revokeObjectURL;
    }
  }
  
  console.log("Direct Lemon.js patch installed");
})();