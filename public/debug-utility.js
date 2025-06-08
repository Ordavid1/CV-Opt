// debug-utility.js - Add to public folder
const appDebug = {
  // Set to false in production to disable all console output
  enabled: false,
  
  // Different logging levels
  log: function(message, data) {
    if (this.enabled && window.location.hostname === 'localhost') {
      if (data !== undefined) {
        console.log(message, data);
      } else {
        console.log(message);
      }
    }
  },
  
  warn: function(message, data) {
    if (this.enabled && window.location.hostname === 'localhost') {
      if (data !== undefined) {
        console.warn(message, data);
      } else {
        console.warn(message);
      }
    }
  },
  
  error: function(message, data) {
    if (this.enabled && window.location.hostname === 'localhost') {
      if (data !== undefined) {
        console.error(message, data);
      } else {
        console.error(message);
      }
    }
  }
};

// Install a global error handler to suppress common errors
window.addEventListener('error', function(event) {
  // Check if it's one of the known CSS errors
  if (event.error && event.error.message && 
      (event.error.message.includes('cssRules') || 
       event.error.message.includes('Cannot access rules'))) {
    // Prevent the error from appearing in console
    event.preventDefault();
    return true;
  }
  
  // Suppress JSON.parse errors with specific message patterns
  if (event.message && event.message.includes('SyntaxError') && 
      event.message.includes('JSON.parse') &&
      event.message.includes('[object Object]')) {
    event.preventDefault();
    return true;
  }
  
  // Let other errors through
  return false;
}, true);

// Override console.error to filter out common errors
(function() {
  const originalConsoleError = console.error;
  console.error = function() {
    // Skip CSS-related errors
    if (arguments[0] && typeof arguments[0] === 'string' && 
        (arguments[0].includes('cssRules') || 
         arguments[0].includes('Cannot access rules'))) {
      return;
    }
    
    // Skip "message port closed" errors
    if (arguments[0] && typeof arguments[0] === 'string' && 
        arguments[0].includes('message port closed')) {
      return;
    }
    
    // Pass all other errors to the original console.error
    return originalConsoleError.apply(console, arguments);
  };
})();

// Export for use in other scripts
window.appDebug = appDebug;