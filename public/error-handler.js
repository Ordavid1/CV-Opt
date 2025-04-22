// error-handler.js - Global error suppressions

// List of error messages to suppress
const suppressedErrorMessages = [
    'Failed to read the \'cssRules\' property from \'CSSStyleSheet\'',
    'Cannot access rules',
    'The message port closed before a response was received',
    '[object Object] is not valid JSON',
    'setImmediate',
    'SecurityError: Failed to read',
    'Unchecked runtime.lastError',
    'inspector',
    '@reduxjs/toolkit'
  ];
  
  // Suppress unhandled promise rejections with matching messages
  window.addEventListener('unhandledrejection', function(event) {
    const errorMsg = String(event.reason);
    
    for (const pattern of suppressedErrorMessages) {
      if (errorMsg.includes(pattern)) {
        event.preventDefault();
        return;
      }
    }
  });
  
  // Override console.error to filter out noise
  (function() {
    const originalConsoleError = console.error;
    console.error = function() {
      // Convert all arguments to strings for easy checking
      const errorMsg = Array.from(arguments).join(' ');
      
      // Check if this is an error we want to suppress
      for (const pattern of suppressedErrorMessages) {
        if (errorMsg.includes(pattern)) {
          return; // Suppress this error
        }
      }
      
      // Let other errors through
      return originalConsoleError.apply(console, arguments);
    };
  })();
  
  // Handle JS errors
  window.addEventListener('error', function(event) {
    const errorMsg = event.message || '';
    
    for (const pattern of suppressedErrorMessages) {
      if (errorMsg.includes(pattern)) {
        event.preventDefault();
        return true; // Prevent default error handling
      }
    }
    
    return false; // Let other errors through
  }, true);
  
  // Patch localStorage to handle errors gracefully
  (function() {
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      try {
        return originalSetItem.call(localStorage, key, value);
      } catch (e) {
        // Fail silently for quota errors
        return null;
      }
    };
  })();
  
  // Fix for common IndexedDB errors
  if (window.indexedDB) {
    const originalOpen = indexedDB.open;
    indexedDB.open = function() {
      try {
        return originalOpen.apply(indexedDB, arguments);
      } catch (e) {
        // Return a mock IDBRequest that silently fails
        return {
          onerror: null,
          onsuccess: null,
          onupgradeneeded: null,
          result: null,
          error: new Error('Mocked IDB error')
        };
      }
    };
  }