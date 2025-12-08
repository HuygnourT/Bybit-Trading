// Arbitrage Trading Bot Module
// Implements Maker-Based Arbitrage Strategy

class ArbitrageBot {
    constructor() {
        this.isRunning = false;
        this.config = {};
        this.activeBuyOrders = [];
        this.activeSellTPOrders = [];
        this.loopInterval = null;
        this.stats = {
            totalBuys: 0,
            totalSells: 0,
            totalProfit: 0,
            totalFees: 0
        };
    }

    // Initialize bot with configuration
    init(config) {
        this.config = config;
        this.log('Bot initialized with config', 'info');
        this.log(`Symbol: ${config.symbol}, Tick Size: ${config.tickSize}`, 'info');
    }

    // Start the arbitrage bot
    async start() {
        if (this.isRunning) {
            this.log('Bot is already running', 'warning');
            return;
        }

        this.isRunning = true;
        this.updateStatus('running');
        this.log('🚀 Bot started', 'success');

        // Start main loop
        this.runMainLoop();
    }

    // Test single order (for debugging)
    async testSingleOrder() {
        this.log('🧪 Starting test single order with repricing...', 'info');
        
        let currentOrderId = null;
        let orderFilled = false;
        let repricingAttempts = 0;
        const maxRepricingAttempts = 10; // Maximum repricing attempts
        
        try {
            while (!orderFilled && repricingAttempts < maxRepricingAttempts) {
                repricingAttempts++;
                
                if (repricingAttempts > 1) {
                    this.log(`🔄 Repricing attempt #${repricingAttempts}/${maxRepricingAttempts}`, 'warning');
                }
                
                // 1. Fetch fresh orderbook
                const orderbook = await this.fetchOrderbook();
                
                if (!orderbook) {
                    this.log('❌ Failed to fetch orderbook', 'error');
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
                    continue;
                }

                const bestBid = orderbook.bestBid;
                this.log(`Best Bid: ${bestBid}`, 'info');

                // 2. Calculate buy price at offset ticks
                const buyPrice = this.calculateLayerPrice(bestBid, 0);
                const roundedBuyPrice = buyPrice;//.roundToTick(buyPrice);
                
                this.log(`Buy price calculated: ${roundedBuyPrice} (offset: ${this.config.offsetTicks} ticks)`, 'info');

                // 3. Place buy order
                this.log(`Placing BUY order at ${roundedBuyPrice} for ${this.config.orderQty}...`, 'info');
                currentOrderId = await this.placeLimitOrder('Buy', roundedBuyPrice, this.config.orderQty);
                
                if (!currentOrderId) {
                    this.log('❌ Failed to place buy order, retrying...', 'error');
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
                    continue;
                }

                this.log(`✅ Buy order placed: ${currentOrderId}`, 'success');

                // 4. Monitor this order
                const checkInterval = 2000; // Check every 2 seconds
                const maxTime = this.config.buyTTL * 1000; // Convert TTL to milliseconds
                const maxAttempts = Math.ceil(maxTime / checkInterval);
                
                this.log(`📊 Monitoring order (TTL: ${this.config.buyTTL}s, repricing threshold: ${this.config.repriceTicks} ticks)`, 'info');
                
                const orderPlacedTime = Date.now();
                let attempts = 0;
                let shouldReprice = false;

                while (attempts < maxAttempts && !orderFilled && !shouldReprice) {
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                    attempts++;
                    
                    const elapsedSeconds = ((Date.now() - orderPlacedTime) / 1000).toFixed(1);
                    
                    this.log(`Check ${attempts}/${maxAttempts}: Checking order status (elapsed: ${elapsedSeconds}s/${this.config.buyTTL}s)...`, 'info');
                    
                    // Fetch fresh orderbook for repricing check
                    const currentOrderbook = await this.fetchOrderbook();
                    if (currentOrderbook) {
                        const currentBestBid = currentOrderbook.bestBid;
                        const tickDiff = Math.abs(roundedBuyPrice - currentBestBid) / this.config.tickSize;
                        
                        if (tickDiff >= this.config.repriceTicks) {
                            this.log(`🔄 Price moved ${tickDiff.toFixed(1)} ticks (threshold: ${this.config.repriceTicks}). Need repricing!`, 'warning');
                            this.log(`Order price: ${roundedBuyPrice}, Current best bid: ${currentBestBid}`, 'warning');
                            shouldReprice = true;
                            break;
                        }
                    }
                    
                    const status = await this.checkOrderStatus(currentOrderId);
                    
                    if (!status) {
                        this.log('⚠️ Status check returned undefined/null', 'warning');
                        continue;
                    }

                    if (status.filled) {
                        orderFilled = true;
                        
                        this.log(`✅ Buy order filled at ${roundedBuyPrice}!`, 'success');
                        this.log(`Order filled in ${elapsedSeconds}s (repricing attempt #${repricingAttempts})`, 'success');
                        
                        // 5. Create TP order
                        this.log('Creating take-profit order...', 'info');
                        await this.createSellTPOrder(roundedBuyPrice, this.config.orderQty);
                        
                        this.log('🎉 Test completed successfully!', 'success');
                        break;
                    } else if (status.partiallyFilled) {
                        this.log(`Partially filled: ${status.filledQty}/${this.config.orderQty}`, 'info');
                    } else {
                        //this.log(`Order status: ${status.orderStatus}`, 'info');
                    }
                }

                // Check if we need to cancel and reprice
                if (shouldReprice || (attempts >= maxAttempts && !orderFilled)) {
                    if (shouldReprice) {
                        this.log('Canceling order for repricing...', 'warning');
                    } else {
                        this.log(`⏱️ TTL (${this.config.buyTTL}s) reached without fill. Repricing...`, 'warning');
                    }
                    
                    await this.cancelOrder(currentOrderId);
                    this.log('Order canceled. Will create new order with fresh price...', 'info');
                    
                    // Wait a bit before repricing
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (!orderFilled) {
                if (repricingAttempts >= maxRepricingAttempts) {
                    this.log(`❌ Test ended: Maximum repricing attempts (${maxRepricingAttempts}) reached without fill`, 'error');
                } else {
                    this.log('❌ Test ended: Order not filled', 'error');
                }
            }

        } catch (error) {
            this.log(`Test error: ${error.message}`, 'error');
            if (currentOrderId) {
                this.log('Attempting to cancel order due to error...', 'warning');
                await this.cancelOrder(currentOrderId);
            }
        }
    }


    // Stop the arbitrage bot
    async stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        clearTimeout(this.loopInterval);
        this.updateStatus('stopped');
        this.log('⏹️ Bot stopped', 'warning');

        // Cancel all active orders
        await this.cancelAllOrders();
    }

    // Main arbitrage loop
    async runMainLoop() {
        if (!this.isRunning) return;

        try {
            // 1. Fetch orderbook
            const orderbook = await this.fetchOrderbook();
            
            if (orderbook) {
                const bestBid = orderbook.bestBid;
                const bestAsk = orderbook.bestAsk;

                this.log(`Orderbook: Bid=${bestBid}, Ask=${bestAsk}`, 'info');

                // 2. Update existing BUY orders
                await this.updateBuyOrders(bestBid);

                // 3. Create new BUY orders if needed
                await this.createBuyOrders(bestBid);

                // 4. Update SELL TP orders
                await this.updateSellTPOrders();
            }

        } catch (error) {
            this.log(`Loop error: ${error.message}`, 'error');
        }

        // ⭐ NEW: Update status display with current orders
        this.updateStatus('running');

        // Schedule next iteration
        this.loopInterval = setTimeout(() => {
            this.runMainLoop();
        }, this.config.loopInterval);
    }

    // Fetch orderbook data
    async fetchOrderbook() {
        try {
            const response = await fetch('/api/orderbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: this.config.symbol,
                    category: this.config.category
                })
            });

            const data = await response.json();
            
            if (data.success && data.data) {
                return {
                    bestBid: parseFloat(data.data.bestBid),
                    bestAsk: parseFloat(data.data.bestAsk)
                };
            }

            return null;
        } catch (error) {
            this.log(`Failed to fetch orderbook: ${error.message}`, 'error');
            return null;
        }

        console.log("fetchOrderbook Completed");
    }

    // Update existing BUY orders (TTL and repricing)
    async updateBuyOrders(bestBid) {
        var now = Date.now();
        var ordersToRemove = [];
        
        for (let i = 0; i < this.activeBuyOrders.length; i++) {
            let order = this.activeBuyOrders[i];
            let age = (now - order.timestamp) / 1000; // seconds

            // Check order status first
            let status = await this.checkOrderStatus(order.orderId);
            
            //console.log(`Check order ${order.orderId} ${status.filledQty} ${status.filled} ${status.partiallyFilled}`);

            if (status.filled) {
                this.log(`✅ Buy order ${order.orderId} filled at ${order.price}`, 'success');
                this.stats.totalBuys++;
                await this.createSellTPOrder(order.price, order.qty);
                console.log(`Removed order ${order.orderId} after fill`);
                ordersToRemove.push(i);
                continue;
            } else if (status.partiallyFilled) {
                order.filledQty = status.filledQty;
            }

            // Check TTL
            if (age >= this.config.buyTTL) {
                this.log(`Order ${order.orderId} expired (TTL: ${age.toFixed(1)}s)`, 'warning');
                await this.cancelOrder(order.orderId);
                
                // If partially filled, create TP order
                if (order.filledQty > 0) {
                    await this.createSellTPOrder(order.price, order.filledQty);
                }
                
                ordersToRemove.push(i);
                console.log(`Removed order ${order.orderId} after time out`);
                continue;
            }

            // Check if needs repricing
            const tickDiff = Math.abs(order.price - bestBid) / this.config.tickSize;

            
            if (tickDiff >= this.config.repriceTicks) {
                // ⭐ FIX: If partially filled, create TP first
                if (order.filledQty > 0) {
                    this.log(`Creating TP for partial fill before repricing`, 'success');
                    await this.createSellTPOrder(order.price, order.filledQty);
                }

                this.log(`Repricing order ${order.orderId} (diff: ${tickDiff.toFixed(1)} ticks)`, 'info');                
                await this.cancelOrder(order.orderId);
                ordersToRemove.push(i);
                continue;
            }
        }

        // Remove processed orders
        for (let i = ordersToRemove.length - 1; i >= 0; i--) {
            this.activeBuyOrders.splice(ordersToRemove[i], 1);
        }
    }

    // Create new BUY orders
    async createBuyOrders(bestBid) {
        const needed = this.config.maxBuyOrders - this.activeBuyOrders.length;
        
        if (needed <= 0) return;

        // Get existing layers to avoid duplicates
        const existingLayers = this.activeBuyOrders.map(order => order.layer);

        for (let layer = 0; layer < this.config.maxBuyOrders; layer++) {
            // Skip if this layer already has an order
            if (existingLayers.includes(layer)) {
                continue;
            }

            const price = this.calculateLayerPrice(bestBid, layer);
            const roundedPrice = this.roundToTick(price);

            this.log(`Creating BUY order at ${roundedPrice} (layer ${layer})`, 'info');

            const orderId = await this.placeLimitOrder('Buy', roundedPrice, this.config.orderQty);
            
            if (orderId) {
                this.activeBuyOrders.push({
                    orderId: orderId,
                    price: roundedPrice,
                    qty: this.config.orderQty,
                    filledQty: 0,
                    timestamp: Date.now(),
                    layer: layer
                });
            }

            // Stop if we've created enough orders
            if (this.activeBuyOrders.length >= this.config.maxBuyOrders) {
                break;
            }
        }
    }

    // Calculate price for each layer
    calculateLayerPrice(bestBid, layerIndex) {
        const offsetPrice = bestBid + (this.config.offsetTicks * this.config.tickSize);
        const layerPrice = offsetPrice - (layerIndex * this.config.layerStepTicks * this.config.tickSize);
        return layerPrice;
    }

    // Round price to tick size
    roundToTick(price) {
        return Math.round(price / this.config.tickSize) * this.config.tickSize;
    }

    // Create SELL take-profit order
    async createSellTPOrder(buyPrice, qty) {
        if (this.activeSellTPOrders.length >= this.config.maxSellTPOrders) {
            this.log('Max TP orders reached, skipping', 'warning');
            return;
        }

        const tpPrice = this.roundToTick(buyPrice + (this.config.tpTicks * this.config.tickSize));
        
        this.log(`Creating SELL TP at ${tpPrice} for ${qty} (profit: ${this.config.tpTicks} ticks)`, 'success');

        const orderId = await this.placeLimitOrder('Sell', tpPrice, qty);
        
        if (orderId) {
            this.activeSellTPOrders.push({
                orderId: orderId,
                price: tpPrice,
                qty: qty,
                buyPrice: buyPrice,
                timestamp: Date.now()
            });
        }
    }

    // Update SELL TP orders
    async updateSellTPOrders() {
        const ordersToRemove = [];

        for (let i = 0; i < this.activeSellTPOrders.length; i++) {
            const order = this.activeSellTPOrders[i];
            
            const status = await this.checkOrderStatus(order.orderId);
            
            if (status.filled) {
                const profit = (order.price - order.buyPrice) * order.qty;
                this.stats.totalSells++;
                this.stats.totalProfit += profit;
                
                this.log(`💰 TP order ${order.orderId} filled! Profit: ${profit.toFixed(4)} USDT`, 'success');
                ordersToRemove.push(i);
            }
        }

        // Remove filled orders
        for (let i = ordersToRemove.length - 1; i >= 0; i--) {
            this.activeSellTPOrders.splice(ordersToRemove[i], 1);
        }
    }

    // Place limit order via API
    async placeLimitOrder(side, price, qty) {
        try {
            const response = await fetch('/api/order/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: this.config.apiKey,
                    apiSecret: this.config.apiSecret,
                    category: this.config.category,
                    symbol: this.config.symbol,
                    side: side,
                    orderType: 'Limit',
                    qty: qty.toString(),
                    price: price.toString()
                })
            });

            const data = await response.json();
            
            if (data.success) {
                return data.data.orderId;
            } else {
                this.log(`Order failed: ${data.message}`, 'error');
                return null;
            }
        } catch (error) {
            this.log(`Order error: ${error.message}`, 'error');
            return null;
        }
    }

    // Check order status
    async checkOrderStatus(orderId) {
        try {
            const response = await fetch('/api/order/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: this.config.apiKey,
                    apiSecret: this.config.apiSecret,
                    category: this.config.category,
                    symbol: this.config.symbol,
                    orderId: orderId
                })
            });

            const data = await response.json();

            // ⭐ NEW: Log API response
            //this.log(`API Response: ${JSON.stringify(data)}`, 'info');
            
            if (data.success && data.data && data.data.list && data.data.list.length > 0) {                
                let order = data.data.list[0];  // ✅ Get first order from list
                let orderStatus = order.orderStatus;  // ✅ Correct path!
                let cumExecQty = parseFloat(order.cumExecQty || 0);  // ✅ Correct path!
                
                this.log(`Order ${orderId} status: ${orderStatus}, filled: ${cumExecQty}`, 'info');
                
                // ⭐ NEW: Store result before returning
                const result = {
                    filled: orderStatus === 'Filled',
                    partiallyFilled: orderStatus === 'PartiallyFilled',
                    filledQty: cumExecQty
                };
                
                // ⭐ NEW: Log return value
                //this.log(`Returning result: ${JSON.stringify(result)}`, 'info');
                return result;
            }

            return { filled: false, partiallyFilled: false, filledQty: 0 };
        } catch (error) {
            return { filled: false, partiallyFilled: false, filledQty: 0 };
        }
    }

    // Cancel order
    async cancelOrder(orderId) {
        try {
            const response = await fetch('/api/order/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: this.config.apiKey,
                    apiSecret: this.config.apiSecret,
                    category: this.config.category,
                    symbol: this.config.symbol,
                    orderId: orderId
                })
            });

            const data = await response.json();
            
            if (data.success) {
                this.log(`Order ${orderId} canceled`, 'info');
                return true;
            }
            
            return false;
        } catch (error) {
            this.log(`Cancel error: ${error.message}`, 'error');
            return false;
        }
    }

    // Cancel all active orders
    async cancelAllOrders() {
        this.log('Canceling all active orders...', 'warning');
        
        const allOrders = [...this.activeBuyOrders, ...this.activeSellTPOrders];
        
        for (const order of allOrders) {
            await this.cancelOrder(order.orderId);
        }

        this.activeBuyOrders = [];
        this.activeSellTPOrders = [];
    }

    // Update status display
    updateStatus(status) {
        const statusEl = document.getElementById('arbStatus');
        
        if (status === 'running') {
            statusEl.classList.add('running');

            // ⭐ NEW: Build order details
            let buyOrdersHTML = '';
            buyOrdersHTML += 'Active Buy Orders:';
            
            // ⭐ NEW: Loop through buy orders and display details
            if (this.activeBuyOrders.length > 0) {
                this.activeBuyOrders.forEach(order => {
                    buyOrdersHTML += `• Layer ${order.layer}: ${order.price} | Qty: ${order.qty} | Age: ${Math.floor((Date.now() - order.timestamp) / 1000)}s`;
                });
            } else {
                buyOrdersHTML += '• No active buy orders';
            }
            
            buyOrdersHTML += 'Active TP Orders:';
            
            // ⭐ NEW: Loop through TP orders and display details
            if (this.activeSellTPOrders.length > 0) {
                this.activeSellTPOrders.forEach(order => {
                    buyOrdersHTML += `• Price: ${order.price} | Qty: ${order.qty} | Profit: ${((order.price - order.buyPrice) * order.qty).toFixed(6)}`;
                });
            } else {
                buyOrdersHTML += '• No active TP orders';
            }
            
            buyOrdersHTML += '';
            
            statusEl.innerHTML = `
                🟢 Bot Status: Running
                
                    Buy Orders: ${this.activeBuyOrders.length}/${this.config.maxBuyOrders} |
                    TP Orders: ${this.activeSellTPOrders.length}/${this.config.maxSellTPOrders} |
                    Total Buys: ${this.stats.totalBuys} | 
                    Total Sells: ${this.stats.totalSells} | 
                    Profit: ${this.stats.totalProfit.toFixed(6)} USDT
                
                ${buyOrdersHTML}
            `;
        } else {
            statusEl.classList.remove('running');
            statusEl.innerHTML = '<div class="status-header">🔴 Bot Status: Stopped</div>';
        }
    }

    // Log message to UI
    log(message, type = 'info') {
        const logsContent = document.getElementById('logsContent');
        const timestamp = new Date().toLocaleTimeString();
        const logItem = document.createElement('div');
        logItem.className = `log-item ${type}`;
        logItem.textContent = `[${timestamp}] ${message}`;
        
        logsContent.insertBefore(logItem, logsContent.firstChild);
        
        // Keep only last 100 logs
        while (logsContent.children.length > 100) {
            logsContent.removeChild(logsContent.lastChild);
        }

        //console.log(`[ARB ${type.toUpperCase()}]`, message);
    }
}

// Global bot instance
var arbitrageBot = new ArbitrageBot();

// Initialize arbitrage UI handlers
document.addEventListener('DOMContentLoaded', function() {
    const startBtn = document.getElementById('startArbBtn');
    const stopBtn = document.getElementById('stopArbBtn');

    if (startBtn) {
        startBtn.addEventListener('click', async function() {
            const config = getArbitrageConfig();
            
            if (!validateConfig(config)) {
                return;
            }

            arbitrageBot.init(config);
            await arbitrageBot.start();

            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', async function() {
            await arbitrageBot.stop();
            
            startBtn.style.display = 'block';
            stopBtn.style.display = 'none';
        });
    }

    if (testOrderBtn) {
        testOrderBtn.addEventListener('click', async function() {
            const config = getArbitrageConfig();
            
            if (!validateConfig(config)) {
                return;
            }

            arbitrageBot.init(config);
            await arbitrageBot.testSingleOrder();
        });
    }
});

// Get configuration from UI
function getArbitrageConfig() {
    return {
        apiKey: document.getElementById('apiKey').value.trim(),
        apiSecret: document.getElementById('apiSecret').value.trim(),
        symbol: document.getElementById('symbol').value.trim(),
        category: document.getElementById('category').value,
        tickSize: parseFloat(document.getElementById('arbTickSize').value),
        maxBuyOrders: parseInt(document.getElementById('arbMaxBuyOrders').value),
        offsetTicks: parseInt(document.getElementById('arbOffsetTicks').value),
        layerStepTicks: parseInt(document.getElementById('arbLayerStepTicks').value),
        buyTTL: parseInt(document.getElementById('arbBuyTTL').value),
        repriceTicks: parseInt(document.getElementById('arbRepriceTicks').value),
        tpTicks: parseInt(document.getElementById('arbTPTicks').value),
        maxSellTPOrders: parseInt(document.getElementById('arbMaxSellTPOrders').value),
        orderQty: parseFloat(document.getElementById('arbOrderQty').value),
        loopInterval: parseInt(document.getElementById('arbLoopInterval').value)
    };
}

// Validate configuration
function validateConfig(config) {
    if (!config.apiKey || !config.apiSecret) {
        alert('Please enter API Key and Secret');
        return false;
    }

    if (!config.symbol) {
        alert('Please enter Trading Symbol');
        return false;
    }

    if (config.orderQty <= 0) {
        alert('Order Quantity must be greater than 0');
        return false;
    }

    return true;
}