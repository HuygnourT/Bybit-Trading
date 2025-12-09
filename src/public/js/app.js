// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('✅ App.js loaded successfully');

     // Mode switching
    setupModeSwitch();
    
    // Get all elements
    const orderTypeSelect = document.getElementById('orderType');
    const priceGroup = document.getElementById('priceGroup');
    const buyBtn = document.getElementById('buyBtn');
    const sellBtn = document.getElementById('sellBtn');
    const balanceBtn = document.getElementById('balanceBtn');
    const buyText = document.getElementById('buyText');
    const sellText = document.getElementById('sellText');
    
    // Check if elements exist
    console.log('Order Type Select:', orderTypeSelect ? 'Found' : 'Not Found');
    console.log('Buy Button:', buyBtn ? 'Found' : 'Not Found');
    console.log('Sell Button:', sellBtn ? 'Found' : 'Not Found');
    console.log('Balance Button:', balanceBtn ? 'Found' : 'Not Found');
    
    // Toggle price input based on order type
    if (orderTypeSelect) {
        orderTypeSelect.addEventListener('change', function() {
            const orderType = this.value;
            
            if (orderType === 'Limit') {
                priceGroup.style.display = 'block';
                buyText.textContent = 'Buy Limit';
                sellText.textContent = 'Sell Limit';
            } else {
                priceGroup.style.display = 'none';
                buyText.textContent = 'Buy Market';
                sellText.textContent = 'Sell Market';
            }
            
            console.log('Order type changed to:', orderType);
        });
    }
    
    // Buy button event
    if (buyBtn) {
        buyBtn.addEventListener('click', function() {
            console.log('Buy button clicked');
            placeOrder('Buy');
        });
    }
    
    // Sell button event
    if (sellBtn) {
        sellBtn.addEventListener('click', function() {
            console.log('Sell button clicked');
            placeOrder('Sell');
        });
    }
    
    // Balance button event
    if (balanceBtn) {
        balanceBtn.addEventListener('click', function() {
            console.log('Balance button clicked');
            checkBalance();
        });
    }
});

// Setup mode switching between Single Order and Scalp
function setupModeSwitch() {
    const singleModeBtn = document.getElementById('singleModeBtn');
    const scalpModeBtn = document.getElementById('scalpModeBtn');
    const singleOrderMode = document.getElementById('singleOrderMode');
    const scalpMode = document.getElementById('scalpMode');

    singleModeBtn.addEventListener('click', function() {
        // Switch to Single Order mode
        singleModeBtn.classList.add('active');
        scalpModeBtn.classList.remove('active');
        singleOrderMode.classList.add('active');
        singleOrderMode.style.display = 'block';
        scalpMode.classList.remove('active');
        scalpMode.style.display = 'none';

        // Show category selection
        if (categoryGroup) {
            categoryGroup.style.display = 'block';
        }
        
        console.log('Switched to Single Order mode');
    });

    scalpModeBtn.addEventListener('click', function() {
        // Switch to Scalp mode
        scalpModeBtn.classList.add('active');
        singleModeBtn.classList.remove('active');
        scalpMode.classList.add('active');
        scalpMode.style.display = 'block';
        singleOrderMode.classList.remove('active');
        singleOrderMode.style.display = 'none';

        // Hide category selection
        if (categoryGroup) {
            categoryGroup.style.display = 'none';
        }
        
        console.log('Switched to Scalp mode');
    });
}

// Check USDT Balance Function
async function checkBalance() {
    let apiKey = document.getElementById('apiKey').value.trim();
    let apiSecret = document.getElementById('apiSecret').value.trim();
    let category = document.getElementById('category').value;
    
    console.log('Checking balance for category:', category);
    console.log('apiKey:', apiKey);
    console.log('apiSecret:', apiSecret);
    // Validation
    if (!apiKey || !apiSecret) {
        showResponse('Please enter your API Key and Secret', 'error');
        return;
    }
    
    // Map category to account type
    let accountType = 'UNIFIED';
    
    console.log('Account type:', accountType);
    
    const balanceDisplay = document.getElementById('balanceDisplay');
    balanceDisplay.innerHTML = '<div style="text-align: center; color: #3b82f6;">⏳ Loading balance...</div>';
    balanceDisplay.classList.add('show');
    
    try {
        const response = await fetch('/api/wallet/balance', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                apiKey,
                apiSecret,
                accountType
            })
        });
        console.log("Calling wallet from app.js");
        const data = await response.json();
        console.log('Balance response:', data);
        
        if (data.success) {
            displayBalance(data.data, accountType);
        } else {
            balanceDisplay.innerHTML = `<div style="color: #dc2626;">❌ Error: ${data.message}</div>`;
        }
    } catch (error) {
        console.error('Balance error:', error);
        balanceDisplay.innerHTML = `<div style="color: #dc2626;">❌ Request failed: ${error.message}</div>`;
    }
}

// Display Balance Function
function displayBalance(data, accountType) {
    const balanceDisplay = document.getElementById('balanceDisplay');
    
    console.log('Displaying balance data:', data);
    
    if (!data.list || data.list.length === 0) {
        balanceDisplay.innerHTML = '<div style="color: #dc2626;">No balance data found</div>';
        return;
    }
    
    const account = data.list[0];
    let html = '<div style="font-weight: 600; margin-bottom: 10px; color: #166534;">💰 Account Balance</div>';
    
    // Find USDT coin
    if (account.coin) {
        const usdtCoin = account.coin.find(c => c.coin === 'USDT');
        
        if (usdtCoin) {
            html += `
                <div class="balance-item">
                    <span class="balance-label">USDT Available:</span>
                    <span class="balance-value">${parseFloat(usdtCoin.availableToWithdraw || usdtCoin.walletBalance || 0).toFixed(2)} USDT</span>
                </div>
            `;
            
            if (usdtCoin.walletBalance) {
                html += `
                    <div class="balance-item">
                        <span class="balance-label">Total Balance:</span>
                        <span class="balance-value">${parseFloat(usdtCoin.walletBalance).toFixed(2)} USDT</span>
                    </div>
                `;
            }
            
            if (usdtCoin.locked && parseFloat(usdtCoin.locked) > 0) {
                html += `
                    <div class="balance-item">
                        <span class="balance-label">Locked:</span>
                        <span class="balance-value">${parseFloat(usdtCoin.locked).toFixed(2)} USDT</span>
                    </div>
                `;
            }
        } else {
            html += '<div style="color: #dc2626;">No USDT balance found</div>';
        }
    }
    
    // Show total equity if available
    if (account.totalEquity) {
        html += `
            <div class="balance-item" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid #22c55e;">
                <span class="balance-label">Total Equity:</span>
                <span class="balance-value">${parseFloat(account.totalEquity).toFixed(2)} USDT</span>
            </div>
        `;
    }
    
    balanceDisplay.innerHTML = html;
}

// Place Order Function
async function placeOrder(side) {
    const apiKey = document.getElementById('apiKey').value.trim();
    const apiSecret = document.getElementById('apiSecret').value.trim();
    const symbol = document.getElementById('symbol').value.trim();
    const category = document.getElementById('category').value;
    const qty = document.getElementById('qty').value.trim();
    const orderType = document.getElementById('orderType').value;
    const price = document.getElementById('price').value.trim();
    
    console.log('Placing order:', { side, symbol, qty, orderType, price });
    
    // Validation
    if (!apiKey || !apiSecret) {
        showResponse('Please enter your API Key and Secret', 'error');
        return;
    }
    
    if (!symbol || !qty) {
        showResponse('Please enter Symbol and Quantity', 'error');
        return;
    }
    
    if (orderType === 'Limit' && !price) {
        showResponse('Please enter Price for Limit Order', 'error');
        return;
    }
    
    // Show loading
    showResponse('⏳ Placing order...', 'info');
    
    try {
        const response = await fetch('/api/order/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                apiKey,
                apiSecret,
                category,
                symbol,
                side,
                orderType,
                qty,
                price: orderType === 'Limit' ? price : undefined
            })
        });
        
        const data = await response.json();
        console.log('Order response:', data);
        
        if (data.success) {
            showResponse(
                `✅ Order placed successfully!\n\nOrder ID: ${data.data.orderId}\nSide: ${side}\nType: ${orderType}\nQuantity: ${qty}${price ? `\nPrice: ${price}` : ''}`,
                'success'
            );
        } else {
            showResponse(`❌ Error: ${data.message}\n\nCode: ${data.code || 'N/A'}`, 'error');
        }
    } catch (error) {
        console.error('Order error:', error);
        showResponse(`❌ Request failed: ${error.message}`, 'error');
    }
}

// Show Response Function
function showResponse(message, type) {
    const responseDiv = document.getElementById('response');
    responseDiv.textContent = message;
    responseDiv.className = `response ${type}`;
    responseDiv.style.display = 'block';
    
    console.log('Response:', type, message);
    
    // Auto-hide after 10 seconds (except for loading messages)
    if (type !== 'info') {
        setTimeout(() => {
            responseDiv.style.display = 'none';
        }, 10000);
    }
}
