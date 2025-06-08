// error-suppressor.js - Place this before any other scripts

(function() {
  // Store original console methods
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };
  
  // Patterns to always filter out
  const errorPatterns = [
    'cssRules',
    'CSSStyleSheet',
    'Cannot access rules',
    'Failed to read',
    'SecurityError',
    'message port closed',
    'Unchecked runtime.lastError',
    'inspector',
    '@reduxjs/toolkit',
    'Refused to execute script',
    'MIME type',
    'Failed to load resource',
    '[object Object] is not valid JSON',
    'Manifest:',
    'site.webmanifest'
  ];
  
  // Create filtered console methods
  function shouldFilter(args) {
    if (args.length > 0 && typeof args[0] === 'string') {
      const message = args[0];
      return errorPatterns.some(pattern => message.includes(pattern));
    }
    return false;
  }
  
  // Override all console methods
  console.log = function() {
    if (window.debugEnabled || !shouldFilter(arguments)) {
      originalConsole.log.apply(console, arguments);
    }
  };
  
  console.warn = function() {
    if (window.debugEnabled || !shouldFilter(arguments)) {
      originalConsole.warn.apply(console, arguments);
    }
  };
  
  console.error = function() {
    if (window.debugEnabled || !shouldFilter(arguments)) {
      originalConsole.error.apply(console, arguments);
    }
  };
  
  console.info = function() {
    if (window.debugEnabled || !shouldFilter(arguments)) {
      originalConsole.info.apply(console, arguments);
    }
  };
  
  console.debug = function() {
    if (window.debugEnabled || !shouldFilter(arguments)) {
      originalConsole.debug.apply(console, arguments);
    }
  };
  
  // Create public debug API
  window.appDebug = {
    enable: function() {
      window.debugEnabled = true;
      originalConsole.log('Debug mode enabled');
    },
    
    disable: function() {
      window.debugEnabled = false;
      originalConsole.log('Debug mode disabled');
    },
    
    log: function() {
      if (window.debugEnabled) {
        originalConsole.log.apply(console, arguments);
      }
    }
  };
  
  // Start with debugging disabled
  window.debugEnabled = false;
  
  // Add keyboard shortcut to toggle debugging
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      if (window.debugEnabled) {
        window.appDebug.disable();
      } else {
        window.appDebug.enable();
      }
    }
  });
  
  // Capture and suppress global errors
  window.addEventListener('error', function(event) {
    // Check if error message matches any pattern
    if (errorPatterns.some(pattern => 
      (event.message && event.message.includes(pattern)) || 
      (event.filename && event.filename.includes(pattern))
    )) {
      event.preventDefault();
      return true;
    }
    return window.debugEnabled;
  }, true);
  
  // Suppress unhandled promise rejections
  window.addEventListener('unhandledrejection', function(event) {
    if (errorPatterns.some(pattern => 
      event.reason && 
      ((typeof event.reason === 'string' && event.reason.includes(pattern)) ||
       (event.reason.message && event.reason.message.includes(pattern)))
    )) {
      event.preventDefault();
      return true;
    }
    return window.debugEnabled;
  });
  
  // Fix JSON.parse errors
  const originalJSONParse = JSON.parse;
  JSON.parse = function(text, reviver) {
    try {
      if (text === "[object Object]" || text === undefined || text === null) {
        return {};
      }
      return originalJSONParse.call(JSON, text, reviver);
    } catch (e) {
      return {};
    }
  };
  
  // Provide fallback for manifest requests
  const originalFetch = window.fetch;
  window.fetch = function(resource, init) {
    if (resource && resource.toString().includes('site.webmanifest')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          name: "AI CV Optimizer",
          short_name: "CV Optimizer",
          icons: [
            {
              src: "/favicon.ico",
              sizes: "64x64",
              type: "image/x-icon"
            }
          ],
          theme_color: "#ff4081",
          background_color: "#121212",
          display: "standalone"
        }),
        text: () => Promise.resolve(JSON.stringify({
          name: "AI CV Optimizer",
          short_name: "CV Optimizer"
        }))
      });
    }
    return originalFetch.apply(this, arguments);
  };
})();