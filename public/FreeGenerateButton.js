import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';

const FreeGenerateButton = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [showNotice, setShowNotice] = useState(true);

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      // Call your existing startRefinement function
      if (window.startRefinement) {
        await window.startRefinement();
      } else {
        console.error('startRefinement function not found');
      }
    } catch (error) {
      console.error('Error during generation:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto mb-8">
      {showNotice && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start">
          <AlertCircle className="text-blue-500 w-5 h-5 mt-0.5 mr-2 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-blue-700">
              Temporarily available for free while we update our payment system.
              <button 
                onClick={() => setShowNotice(false)}
                className="ml-2 text-blue-600 hover:text-blue-800 underline"
              >
                Dismiss
              </button>
            </p>
          </div>
        </div>
      )}
      
      <button
        onClick={handleGenerate}
        disabled={isLoading}
        className={`w-full py-4 px-6 rounded-full text-white font-medium text-lg transition-all
          ${isLoading 
            ? 'bg-blue-400 cursor-not-allowed' 
            : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
          }`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
              <circle 
                className="opacity-25" 
                cx="12" 
                cy="12" 
                r="10" 
                stroke="currentColor" 
                strokeWidth="4"
                fill="none"
              />
              <path 
                className="opacity-75" 
                fill="currentColor" 
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Generating...
          </span>
        ) : (
          'Generate CV Optimization (Free)'
        )}
      </button>
    </div>
  );
};

export default FreeGenerateButton;