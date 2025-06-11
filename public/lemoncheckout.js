// public/lemoncheckout.js

document.addEventListener('DOMContentLoaded', function() {
  // Create and add the button immediately
  const container = document.getElementById('lemon-checkout-container');
  if (!container) {
    // Silent error - not critical
    return;
  }

  const checkoutButton = document.createElement('button');
  checkoutButton.textContent = 'Optimize Me!';
  checkoutButton.className = 'lemon-checkout-button';
  
  container.innerHTML = '';
  container.appendChild(checkoutButton);

  // Add styles
  if (!document.getElementById('lemon-styles')) {
    const style = document.createElement('style');
    style.id = 'lemon-styles';
    style.textContent = `
      .lemon-checkout-button {
        background-color: #ffd24c;
        color: #000000;
        border: none;
        border-radius: 25px;
        padding: 12px 24px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s;
        width: 100%;
        max-width: 300px;
        margin: 10px auto;
        display: block;
      }

      .lemon-checkout-button:hover {
        background-color: #ffc82e;
      }

      .lemon-checkout-button:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);
  }

  // Handle checkout click
  checkoutButton.addEventListener('click', async () => {
    try {
      checkoutButton.disabled = true;
      checkoutButton.textContent = 'Loading checkout...';
      
      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }

      const { checkoutUrl } = await response.json();
      
      // Open the checkout using the new approach
      let validCheckoutUrl = checkoutUrl;
      if (!validCheckoutUrl.startsWith('http')) {
        if (validCheckoutUrl.startsWith('//')) {
          validCheckoutUrl = 'https:' + validCheckoutUrl;
        } else {
          validCheckoutUrl = 'https://' + validCheckoutUrl;
        }
      }
      
      // Fix the typo in the URL variable
      window.open(validCheckoutUrl, '_blank');
      
    } catch (error) {
      // Show error message without console log
      document.getElementById('result-message').innerHTML = 
        'Error processing checkout. Please try again.';
    } finally {
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Optimize Me!';
    }
  });
});