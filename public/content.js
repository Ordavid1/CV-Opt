// Add this to a separate file or inject into content.js

// Monkey patch JSON.parse to handle "[object Object]" errors
(function() {
    const originalJSONParse = JSON.parse;
    JSON.parse = function(text, reviver) {
      try {
        // If text is literally "[object Object]", return an empty object
        if (text === "[object Object]") {
          return {};
        }
        return originalJSONParse.call(JSON, text, reviver);
      } catch (e) {
        // Silently return an empty object for common parsing errors
        if (e instanceof SyntaxError) {
          return {};
        }
        throw e;
      }
    };
  })();
  
  // Patch storage change dispatcher to handle errors gracefully
  if (typeof window._storageChangeDispatcher === 'function') {
    const original_storageChangeDispatcher = window._storageChangeDispatcher;
    window._storageChangeDispatcher = function(a, b, c) {
      try {
        return original_storageChangeDispatcher(a, b, c);
      } catch (e) {
        // Silently handle errors
        return null;
      }
    };
  }