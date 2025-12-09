// Scalping Trading Bot Module
// Implements Maker-Based Scalping Strategy

class ScalpingBot {
    constructor() {
        this.isRunning = false;
        this.isPaused = false;  // Paused state (no new buys, but TP orders still monitored)
        this.config = {};
        this.activeBuyOrders = [];
        this.activeSellTPOrders = [];
        this.loopInterval = null;
        this.lastBuyFillTime = 0;  // Track when last buy was filled (for wait delay)
        
        // Market sell tracking (when max TP reached)
        this.isWaitingForMarketSell = false;  // Flag to stop buy orders
        this.pendingMarketSell = null;        // Track the market sell order
        this.pendingNewTP = null;             // Store the new TP to create after market sell fills
        
        // Enhanced statistics tracking
        this.stats = {
            // Buy order stats
            totalBuyOrdersCreated: 0,
            totalBuyOrdersFilled: 0,
            totalBuyOrdersCanceled: 0,
            
            // Sell order stats
            totalSellOrdersCreated: 0,
            totalSellOrdersFilled: 0,
            totalSellOrdersCanceled: 0,
            
            // Profit tracking
            realProfit: 0,           // Profit from completed sell orders
            totalFees: 0,
            
            // For avg price calculation
            pendingPositions: []      // Track buy orders with pending sell TP
        };
    }

    // Initialize bot with configuration
    init(config) {
        this.config = config;
        this.resetStats();
        this.log('Bot initialized with config', 'info');
        this.log(`Symbol: ${config.symbol}, Tick Size: ${config.tickSize}`, 'info');
        this.log(`Wait After Buy Fill: ${config.waitAfterBuyFill}ms`, 'info');
        this.log(`Sell All On Stop: ${config.sellAllOnStop ? 'YES' : 'NO'}`, 'info');
    }

    // Reset statistics
    resetStats() {
        this.stats = {
            totalBuyOrdersCreated: 0,
            totalBuyOrdersFilled: 0,
            totalBuyOrdersCanceled: 0,
            totalSellOrdersCreated: 0,
            totalSellOrdersFilled: 0,
            totalSellOrdersCanceled: 0,
            realProfit: 0,
            totalFees: 0,
            pendingPositions: []
        };
        
        // Reset market sell tracking
        this.isWaitingForMarketSell = false;
        this.pendingMarketSell = null;
        this.pendingNewTP = null;
    }

    // Calculate estimated profit (pending + completed)
    calculateEstimatedProfit() {
        let estimatedProfit = this.stats.realProfit;
        
        // Add potential profit from pending sell TP orders
        for (let order of this.activeSellTPOrders) {
            let potentialProfit = (order.price - order.buyPrice) * order.qty;
            estimatedProfit += potentialProfit;
        }
        
        return estimatedProfit;
    }

    // Calculate average buy price for positions with pending sell orders
    calculateAvgBuyPrice() {
        if (this.stats.pendingPositions.length === 0) {
            return 0;
        }
        
        let totalValue = 0;
        let totalQty = 0;
        
        for (let position of this.stats.pendingPositions) {
            totalValue += position.buyPrice * position.qty;
            totalQty += position.qty;
        }
        
        return totalQty > 0 ? totalValue / totalQty : 0;
    }

    	// Calculate total pending quantity
    	calculateTotalPendingQty() {
        let totalQty = 0;
        for (let position of this.stats.pendingPositions) {
            totalQty += position.qty;
        }
        return totalQty;
    }

    // Start the scalping bot
    async start() {
        if (this.isRunning) {
            this.log('Bot is already running', 'warning');
            return;
        }

        this.isRunning = true;
        this.isPaused = false;  // Ensure paused is reset on start
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
        const maxRepricingAttempts = 10;
        
        try {
            while (!orderFilled && repricingAttempts < maxRepricingAttempts) {
                repricingAttempts++;
                
                if (repricingAttempts > 1) {
                    this.log(`🔄 Repricing attempt #${repricingAttempts}/${maxRepricingAttempts}`, 'warning');
                }
                
                const orderbook = await this.fetchOrderbook();
                
                if (!orderbook) {
                    this.log('❌ Failed to fetch orderbook', 'error');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }

                const bestBid = orderbook.bestBid;
                this.log(`Best Bid: ${bestBid}`, 'info');

                const buyPrice = this.calculateLayerPrice(bestBid, 0);
                const roundedBuyPrice = buyPrice;
                
                this.log(`Buy price calculated: ${roundedBuyPrice} (offset: ${this.config.offsetTicks} ticks)`, 'info');

                this.log(`Placing BUY order at ${roundedBuyPrice} for ${this.config.orderQty}...`, 'info');
                currentOrderId = await this.placeLimitOrder('Buy', roundedBuyPrice, this.config.orderQty);
                
                if (!currentOrderId) {
                    this.log('❌ Failed to place buy order, retrying...', 'error');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }

                this.stats.totalBuyOrdersCreated++;
                this.log(`✅ Buy order placed: ${currentOrderId}`, 'success');
                this.updateStatus('running');

                const checkInterval = 2000;
                const maxTime = this.config.buyTTL * 1000;
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
                        this.stats.totalBuyOrdersFilled++;
                        
                        this.log(`✅ Buy order filled at ${roundedBuyPrice}!`, 'success');
                        this.log(`Order filled in ${elapsedSeconds}s (repricing attempt #${repricingAttempts})`, 'success');
                        
                        // Record fill time for buy order delay
                        this.lastBuyFillTime = Date.now();
                        
                        // Create TP immediately (no wait)
                        this.log('Creating take-profit order...', 'info');
                        await this.createSellTPOrder(roundedBuyPrice, this.config.orderQty);
                        
                        this.updateStatus('running');
                        this.log('🎉 Test completed successfully!', 'success');
                        break;
                    } else if (status.partiallyFilled) {
                        this.log(`Partially filled: ${status.filledQty}/${this.config.orderQty}`, 'info');
                    }
                }

                if (shouldReprice || (attempts >= maxAttempts && !orderFilled)) {
                    if (shouldReprice) {
                        this.log('Canceling order for repricing...', 'warning');
                    } else {
                        this.log(`⏱️ TTL (${this.config.buyTTL}s) reached without fill. Repricing...`, 'warning');
                    }
                    
                    await this.cancelOrder(currentOrderId);
                    this.stats.totalBuyOrdersCanceled++;
                    this.log('Order canceled. Will create new order with fresh price...', 'info');
                    this.updateStatus('running');
                    
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
                this.stats.totalBuyOrdersCanceled++;
            }
        }
    }

    // Stop the scalping bot
    async stop() {
        if (!this.isRunning) {
            return;
        }

        // First, stop the loop immediately
        this.isRunning = false;
        this.isPaused = false;
        
        if (this.loopInterval) {
            clearTimeout(this.loopInterval);
            this.loopInterval = null;
        }
        
        this.log('⏹️ Stopping bot...', 'warning');
        this.updateStatus('stopping');

        // Cancel all buy orders first
        for (const order of this.activeBuyOrders) {
            await this.cancelOrder(order.orderId);
            this.stats.totalBuyOrdersCanceled++;
            this.log(`Canceled buy order ${order.orderId}`, 'info');
        }
        this.activeBuyOrders = [];

        // Handle TP orders based on sellAllOnStop option
        if (this.config.sellAllOnStop && this.activeSellTPOrders.length > 0) {
            this.log('💰 Sell All On Stop enabled - Selling all positions at market...', 'warning');
            await this.sellAllAtMarket();
        } else {
            // Cancel all TP orders (original behavior)
            await this.cancelAllTPOrders();
        }

        this.updateStatus('stopped');
        this.log('⏹️ Bot stopped', 'warning');
    }

    // Sell all pending positions at market price
    async sellAllAtMarket() {
        if (this.activeSellTPOrders.length === 0) {
            this.log('No TP orders to sell', 'info');
            return;
        }

        // Get current orderbook for best ask price
        const orderbook = await this.fetchOrderbook();
        if (!orderbook) {
            this.log('❌ Failed to fetch orderbook for market sell, canceling TP orders instead', 'error');
            await this.cancelAllTPOrders();
            return;
        }

        const bestAsk = orderbook.bestAsk;
        this.log(`📊 Best Ask Price: ${bestAsk}`, 'info');

        // Process each TP order
        for (const order of this.activeSellTPOrders) {
            try {
                // Cancel the existing TP limit order first
                await this.cancelOrder(order.orderId);
                this.stats.totalSellOrdersCanceled++;
                this.log(`Canceled TP order ${order.orderId}`, 'info');

                // Place market sell order
                this.log(`🔴 Selling ${order.qty} at market (ask: ${bestAsk})...`, 'warning');
                const sellOrderId = await this.placeMarketOrder('Sell', order.qty);

                if (sellOrderId) {
                    // Calculate profit/loss based on best ask (approximation)
                    const profitLoss = (bestAsk - order.buyPrice) * order.qty;
                    this.stats.realProfit += profitLoss;
                    this.stats.totalSellOrdersFilled++;

                    const profitStr = profitLoss >= 0 ? `+${profitLoss.toFixed(6)}` : profitLoss.toFixed(6);
                    this.log(`💰 Market sold ${order.qty} @ ~${bestAsk}, P/L: ${profitStr} USDT`, profitLoss >= 0 ? 'success' : 'error');

                    // Remove from pending positions
                    const pendingIndex = this.stats.pendingPositions.findIndex(p => p.orderId === order.orderId);
                    if (pendingIndex !== -1) {
                        this.stats.pendingPositions.splice(pendingIndex, 1);
                    }
                } else {
                    this.log(`❌ Failed to market sell for TP order ${order.orderId}`, 'error');
                }
            } catch (error) {
                this.log(`Error selling TP order ${order.orderId}: ${error.message}`, 'error');
            }
        }

        this.activeSellTPOrders = [];
        this.log(`📊 Final Real Profit: ${this.stats.realProfit >= 0 ? '+' : ''}${this.stats.realProfit.toFixed(6)} USDT`, 
            this.stats.realProfit >= 0 ? 'success' : 'error');
    }

    // Cancel all TP orders without selling
    async cancelAllTPOrders() {
        for (const order of this.activeSellTPOrders) {
            await this.cancelOrder(order.orderId);
            this.stats.totalSellOrdersCanceled++;

            // Remove from pending positions
            const pendingIndex = this.stats.pendingPositions.findIndex(p => p.orderId === order.orderId);
            if (pendingIndex !== -1) {
                this.stats.pendingPositions.splice(pendingIndex, 1);
            }
        }
        this.activeSellTPOrders = [];
    }

    // Place market order
    async placeMarketOrder(side, qty) {
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
                    orderType: 'Market',
                    qty: qty.toString()
                })
            });

            const data = await response.json();
            
            if (data.success) {
                return data.data.orderId;
            } else {
                this.log(`Market order failed: ${data.message}`, 'error');
                return null;
            }
        } catch (error) {
            this.log(`Market order error: ${error.message}`, 'error');
            return null;
        }
    }

    // Pause the bot - cancel buy orders but keep TP orders
    async pause() {
        if (!this.isRunning) {
            this.log('⚠️ Bot is not running, cannot pause', 'warning');
            return;
        }
        
        if (this.isPaused) {
            this.log('⚠️ Bot is already paused', 'warning');
            return;
        }

        this.isPaused = true;
        this.log('⏸️ Bot pausing - Canceling buy orders, keeping TP orders...', 'warning');

        // Cancel all active buy orders
        for (const order of this.activeBuyOrders) {
            await this.cancelOrder(order.orderId);
            this.stats.totalBuyOrdersCanceled++;
            this.log(`Canceled buy order ${order.orderId}`, 'info');
        }
        this.activeBuyOrders = [];

        this.updateStatus('paused');
        this.log(`⏸️ Bot paused. ${this.activeSellTPOrders.length} TP orders still active.`, 'warning');
    }

    // Resume the bot from paused state
    async resume() {
        if (!this.isRunning) {
            this.log('⚠️ Bot is not running, cannot resume', 'warning');
            return;
        }
        
        if (!this.isPaused) {
            this.log('⚠️ Bot is not paused, cannot resume', 'warning');
            return;
        }

        this.isPaused = false;
        this.updateStatus('running');
        this.log('▶️ Bot resumed - Will create new buy orders...', 'success');
    }

    // Main scalping loop
    async runMainLoop() {
        if (!this.isRunning) return;

        try {
            // First, check if we're waiting for a market sell to complete
            if (this.isWaitingForMarketSell && this.pendingMarketSell) {
                await this.checkMarketSellStatus();
            }
            
            const orderbook = await this.fetchOrderbook();
            
            if (orderbook) {
                const bestBid = orderbook.bestBid;
                const bestAsk = orderbook.bestAsk;

                this.log(`Orderbook: Bid=${bestBid}, Ask=${bestAsk}${this.isWaitingForMarketSell ? ' [⏳ WAITING FOR MARKET SELL]' : ''}`, 'info');

                // Only manage buy orders if not paused AND not waiting for market sell
                if (!this.isPaused && !this.isWaitingForMarketSell) {
                    await this.updateBuyOrders(bestBid);
                    await this.createBuyOrders(bestBid);
                } else if (this.isWaitingForMarketSell) {
                    this.log('🛑 Buy orders stopped - Waiting for market sell to fill...', 'warning');
                    // Cancel any existing buy orders while waiting
                    if (this.activeBuyOrders.length > 0) {
                        this.log(`Canceling ${this.activeBuyOrders.length} active buy orders...`, 'warning');
                        for (const order of this.activeBuyOrders) {
                            await this.cancelOrder(order.orderId);
                            this.stats.totalBuyOrdersCanceled++;
                        }
                        this.activeBuyOrders = [];
                    }
                } else {
                    this.log('⏸️ Paused - Skipping buy order management', 'info');
                }
                
                // Always monitor TP orders (even when paused or waiting)
                await this.updateSellTPOrders();
            }

        } catch (error) {
            this.log(`Loop error: ${error.message}`, 'error');
        }

        let displayStatus = this.isPaused ? 'paused' : 'running';
        if (this.isWaitingForMarketSell) {
            displayStatus = 'waiting_market_sell';
        }
        this.updateStatus(displayStatus);

        // Only schedule next loop if still running
        if (this.isRunning) {
            this.loopInterval = setTimeout(() => {
                this.runMainLoop();
            }, this.config.loopInterval);
        }
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
    }

    // Update existing BUY orders (TTL and repricing)
    async updateBuyOrders(bestBid) {
        let now = Date.now();
        let ordersToRemove = [];
        
        for (let i = 0; i < this.activeBuyOrders.length; i++) {
            let order = this.activeBuyOrders[i];
            let age = (now - order.timestamp) / 1000;

            let status = await this.checkOrderStatus(order.orderId);

            if (status.filled) {
                this.log(`✅ Buy order ${order.orderId} filled at ${order.price}`, 'success');
                this.stats.totalBuyOrdersFilled++;
                
                // Record fill time for buy order delay
                this.lastBuyFillTime = Date.now();
                
                // Create TP immediately (no wait)
                await this.createSellTPOrder(order.price, order.qty);
                ordersToRemove.push(i);
                continue;
            } else if (status.partiallyFilled) {
                order.filledQty = status.filledQty;
            }

            if (age >= this.config.buyTTL) {
                this.log(`Order ${order.orderId} expired (TTL: ${age.toFixed(1)}s)`, 'warning');
                await this.cancelOrder(order.orderId);
                this.stats.totalBuyOrdersCanceled++;
                
                if (order.filledQty > 0) {
                    this.stats.totalBuyOrdersFilled++;
                    
                    // Record fill time for buy order delay
                    this.lastBuyFillTime = Date.now();
                    
                    // Create TP immediately (no wait)
                    await this.createSellTPOrder(order.price, order.filledQty);
                }
                
                ordersToRemove.push(i);
                continue;
            }

            const tickDiff = Math.abs(order.price - bestBid) / this.config.tickSize;
            
            if (tickDiff >= this.config.repriceTicks) {
                if (order.filledQty > 0) {
                    this.log(`Creating TP for partial fill before repricing`, 'success');
                    this.stats.totalBuyOrdersFilled++;
                    
                    // Record fill time for buy order delay
                    this.lastBuyFillTime = Date.now();
                    
                    // Create TP immediately (no wait)
                    await this.createSellTPOrder(order.price, order.filledQty);
                }

                this.log(`Repricing order ${order.orderId} (diff: ${tickDiff.toFixed(1)} ticks)`, 'info');                
                await this.cancelOrder(order.orderId);
                this.stats.totalBuyOrdersCanceled++;
                ordersToRemove.push(i);
                continue;
            }
        }

        for (let i = ordersToRemove.length - 1; i >= 0; i--) {
            this.activeBuyOrders.splice(ordersToRemove[i], 1);
        }
    }

    // Create new BUY orders
    async createBuyOrders(bestBid) {
        const needed = this.config.maxBuyOrders - this.activeBuyOrders.length;
        
        if (needed <= 0) return;

        // Check if we need to wait after last buy fill
        if (this.config.waitAfterBuyFill > 0 && this.lastBuyFillTime > 0) {
            const timeSinceLastFill = Date.now() - this.lastBuyFillTime;
            if (timeSinceLastFill < this.config.waitAfterBuyFill) {
                const remainingWait = this.config.waitAfterBuyFill - timeSinceLastFill;
                this.log(`⏱️ Waiting ${remainingWait}ms before creating new buy orders...`, 'info');
                return; // Skip this cycle, will create on next loop
            }
        }

        const existingLayers = this.activeBuyOrders.map(order => order.layer);
        
        // Get all existing buy order prices to avoid duplicates
        const existingPrices = this.activeBuyOrders.map(order => order.price);

        for (let layer = 0; layer < this.config.maxBuyOrders; layer++) {
            if (existingLayers.includes(layer)) continue;
            
            // Calculate price for this layer
            const offsetTicks = this.config.offsetTicks + (layer * this.config.layerStepTicks);
            let buyPrice = bestBid - (offsetTicks * this.config.tickSize);
            buyPrice = this.roundToTick(buyPrice);
            
            // Check if this price already exists in active orders
            const conflictIndex = this.activeBuyOrders.findIndex(order => 
                Math.abs(order.price - buyPrice) < this.config.tickSize * 0.5
            );
            
            if (conflictIndex !== -1) {
                // Price conflict detected
                const conflictOrder = this.activeBuyOrders[conflictIndex];
                
                // Adjust new price UP by layerStepTicks to make it unique (closer to best bid)
                const adjustment = this.config.layerStepTicks * this.config.tickSize;
                buyPrice = this.roundToTick(buyPrice + adjustment);
                
                this.log(`Layer ${layer} price conflict with Layer ${conflictOrder.layer}, adjusted UP to ${buyPrice}`, 'warning');
                
                // Check again after adjustment
                const stillConflicts = existingPrices.some(existingPrice => 
                    Math.abs(existingPrice - buyPrice) < this.config.tickSize * 0.5
                );
                
                if (stillConflicts) {
                    this.log(`Layer ${layer} still has price conflict, skipping`, 'warning');
                    continue;
                }
                
                // Switch layers: new higher price becomes Layer 0, old lower price becomes Layer 1
                if (layer < conflictOrder.layer) {
                    this.log(`Switching layers: New order @ ${buyPrice} → Layer ${layer}, Old order @ ${conflictOrder.price} → Layer ${layer + 1}`, 'info');
                    conflictOrder.layer = layer + 1;
                } else if (buyPrice > conflictOrder.price) {
                    this.log(`Switching layers: New order @ ${buyPrice} → Layer ${conflictOrder.layer}, Old order @ ${conflictOrder.price} → Layer ${layer}`, 'info');
                    const oldLayer = conflictOrder.layer;
                    conflictOrder.layer = layer;
                }
            }
            
            // Add this price to existingPrices to prevent conflicts with next layers in this loop
            existingPrices.push(buyPrice);

            // Create the buy order
            this.log(`Creating BUY order at ${buyPrice} (layer ${layer})`, 'info');

            const orderId = await this.placeLimitOrder('Buy', buyPrice, this.config.orderQty);
            
            if (orderId) {
                this.stats.totalBuyOrdersCreated++;
                this.activeBuyOrders.push({
                    orderId: orderId,
                    price: buyPrice,
                    qty: this.config.orderQty,
                    filledQty: 0,
                    timestamp: Date.now(),
                    layer: layer
                });
            }

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
        const tickSize = this.config.tickSize;
        // Calculate decimal places from tick size
        const tickStr = tickSize.toString();
        const decimalPlaces = tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
        // Round to tick size and fix floating point precision
        const rounded = Math.round(price / tickSize) * tickSize;
        return parseFloat(rounded.toFixed(decimalPlaces));
    }

    // Create SELL take-profit order
    async createSellTPOrder(buyPrice, qty) {
        // If max TP orders reached:
        // 1. Cancel ONLY the highest TP order (keep all other TPs)
        // 2. Market sell the canceled position immediately
        // 3. Stop buy orders until market sell is filled
        // 4. Then create new TP for the pending buy and resume buy orders
        if (this.activeSellTPOrders.length >= this.config.maxSellTPOrders) {
            this.log(`⚠️ Max TP orders (${this.config.maxSellTPOrders}) reached!`, 'warning');
            
            // Find the highest TP price order (furthest from current price)
            let highestTPIndex = 0;
            let highestTPPrice = this.activeSellTPOrders[0].price;
            
            for (let i = 1; i < this.activeSellTPOrders.length; i++) {
                if (this.activeSellTPOrders[i].price > highestTPPrice) {
                    highestTPPrice = this.activeSellTPOrders[i].price;
                    highestTPIndex = i;
                }
            }
            
            const highestOrder = this.activeSellTPOrders[highestTPIndex];
            const remainingTPs = this.activeSellTPOrders.length - 1;
            
            this.log(`🔄 Canceling ONLY highest TP @ ${highestOrder.price} (buy was @ ${highestOrder.buyPrice})`, 'warning');
            this.log(`📊 Keeping ${remainingTPs} other TP orders active`, 'info');
            
            // Cancel ONLY the highest TP order
            await this.cancelOrder(highestOrder.orderId);
            this.stats.totalSellOrdersCanceled++;
            
            // Remove ONLY the highest from active sell TP orders (keep all others)
            this.activeSellTPOrders.splice(highestTPIndex, 1);
            
            // Remove from pending positions
            const pendingIndex = this.stats.pendingPositions.findIndex(p => p.orderId === highestOrder.orderId);
            if (pendingIndex !== -1) {
                this.stats.pendingPositions.splice(pendingIndex, 1);
            }
            
            // STOP buy orders and MARKET SELL the canceled position
            this.isWaitingForMarketSell = true;
            this.log(`🛑 STOPPING buy orders until market sell completes...`, 'warning');
            
            // Store the pending new TP info to create after market sell fills
            this.pendingNewTP = {
                buyPrice: buyPrice,
                qty: qty
            };
            
            // Place MARKET SELL for the canceled position
            this.log(`🔴 MARKET SELLING ${highestOrder.qty} (was TP @ ${highestOrder.price})...`, 'warning');
            const marketOrderId = await this.placeMarketOrder('Sell', highestOrder.qty);
            
            if (marketOrderId) {
                this.pendingMarketSell = {
                    orderId: marketOrderId,
                    qty: highestOrder.qty,
                    buyPrice: highestOrder.buyPrice,  // Original buy price for P/L calculation
                    originalTPPrice: highestOrder.price,  // For reference
                    timestamp: Date.now()
                };
                this.log(`📤 Market sell order placed: ${marketOrderId}`, 'info');
            } else {
                // Market sell failed, resume normal operation
                this.log(`❌ Market sell failed! Resuming normal operation...`, 'error');
                this.isWaitingForMarketSell = false;
                this.pendingNewTP = null;
            }
            
            return; // Don't create new TP yet, wait for market sell to fill
        }

        // Normal case: Create new TP order for the current buy
        const tpPrice = this.roundToTick(buyPrice + (this.config.tpTicks * this.config.tickSize));
        
        this.log(`Creating SELL TP at ${tpPrice} for ${qty} (profit: ${this.config.tpTicks} ticks)`, 'success');

        const orderId = await this.placeLimitOrder('Sell', tpPrice, qty);
        
        if (orderId) {
            this.stats.totalSellOrdersCreated++;
            
            const newOrder = {
                orderId: orderId,
                price: tpPrice,
                qty: qty,
                buyPrice: buyPrice,
                timestamp: Date.now()
            };
            
            this.activeSellTPOrders.push(newOrder);
            
            // Add to pending positions for avg price calculation
            this.stats.pendingPositions.push({
                orderId: orderId,
                buyPrice: buyPrice,
                qty: qty,
                sellPrice: tpPrice
            });
        }
    }
    
    // Check market sell order status
    async checkMarketSellStatus() {
        if (!this.pendingMarketSell) return;
        
        try {
            const status = await this.checkOrderStatus(this.pendingMarketSell.orderId);
            const elapsed = (Date.now() - this.pendingMarketSell.timestamp) / 1000;
            
            if (status.filled) {
                // Get current price for P/L calculation (approximate)
                const orderbook = await this.fetchOrderbook();
                const sellPrice = orderbook ? orderbook.bestBid : this.pendingMarketSell.buyPrice;
                
                const profitLoss = (sellPrice - this.pendingMarketSell.buyPrice) * this.pendingMarketSell.qty;
                this.stats.realProfit += profitLoss;
                this.stats.totalSellOrdersFilled++;
                
                const profitStr = profitLoss >= 0 ? `+${profitLoss.toFixed(6)}` : profitLoss.toFixed(6);
                this.log(`💰 Market sell FILLED @ ~${sellPrice}! P/L: ${profitStr} USDT`, profitLoss >= 0 ? 'success' : 'error');
                
                // Create pending new TP if not already created by updateSellTPOrders
                if (this.pendingNewTP) {
                    this.log(`✅ Creating TP for pending buy @ ${this.pendingNewTP.buyPrice}...`, 'success');
                    
                    const tpPrice = this.roundToTick(this.pendingNewTP.buyPrice + (this.config.tpTicks * this.config.tickSize));
                    const orderId = await this.placeLimitOrder('Sell', tpPrice, this.pendingNewTP.qty);
                    
                    if (orderId) {
                        this.stats.totalSellOrdersCreated++;
                        
                        this.activeSellTPOrders.push({
                            orderId: orderId,
                            price: tpPrice,
                            qty: this.pendingNewTP.qty,
                            buyPrice: this.pendingNewTP.buyPrice,
                            timestamp: Date.now()
                        });
                        
                        this.stats.pendingPositions.push({
                            orderId: orderId,
                            buyPrice: this.pendingNewTP.buyPrice,
                            qty: this.pendingNewTP.qty,
                            sellPrice: tpPrice
                        });
                        
                        this.log(`✅ New TP created @ ${tpPrice} (total TPs: ${this.activeSellTPOrders.length})`, 'success');
                    }
                } else {
                    this.log(`ℹ️ Pending TP was already created while waiting`, 'info');
                }
                
                // Resume normal operation
                this.isWaitingForMarketSell = false;
                this.pendingMarketSell = null;
                this.pendingNewTP = null;
                this.log(`▶️ Resuming buy orders...`, 'success');
                
            } else if (status.partiallyFilled) {
                // Partial fill - keep waiting but log progress
                this.log(`⏳ Market sell partially filled: ${status.filledQty}/${this.pendingMarketSell.qty} (${elapsed.toFixed(1)}s)`, 'warning');
                
            } else {
                // Not filled yet
                const MARKET_SELL_TIMEOUT = 30; // seconds
                
                if (elapsed > MARKET_SELL_TIMEOUT) {
                    // Timeout! Cancel and convert to limit sell at current bid
                    this.log(`⚠️ Market sell timeout (${elapsed.toFixed(1)}s)! Converting to limit sell...`, 'error');
                    
                    // Try to cancel the market order (may fail if already filled)
                    await this.cancelOrder(this.pendingMarketSell.orderId);
                    
                    // Get current bid price and place limit sell
                    const orderbook = await this.fetchOrderbook();
                    if (orderbook) {
                        const limitPrice = this.roundToTick(orderbook.bestBid);
                        this.log(`📝 Placing limit sell @ ${limitPrice} (current bid)`, 'warning');
                        
                        const newOrderId = await this.placeLimitOrder('Sell', limitPrice, this.pendingMarketSell.qty);
                        
                        if (newOrderId) {
                            // Update pending market sell to track the new limit order
                            this.pendingMarketSell.orderId = newOrderId;
                            this.pendingMarketSell.timestamp = Date.now();
                            this.pendingMarketSell.isLimitFallback = true;
                            this.pendingMarketSell.limitPrice = limitPrice;
                            this.log(`📤 Fallback limit sell placed: ${newOrderId}`, 'info');
                        } else {
                            // Failed to place limit order - resume anyway to avoid getting stuck
                            this.log(`❌ Failed to place fallback limit sell! Resuming without it...`, 'error');
                            this.isWaitingForMarketSell = false;
                            this.pendingMarketSell = null;
                            // Still create pending TP
                            if (this.pendingNewTP) {
                                await this.createFallbackTP();
                            }
                            this.pendingNewTP = null;
                        }
                    }
                } else if (this.pendingMarketSell.isLimitFallback) {
                    // We're now tracking a limit order fallback
                    const limitElapsed = elapsed;
                    const LIMIT_REPRICE_THRESHOLD = 10; // seconds
                    
                    if (limitElapsed > LIMIT_REPRICE_THRESHOLD) {
                        // Reprice the limit sell to current bid
                        const orderbook = await this.fetchOrderbook();
                        if (orderbook) {
                            const currentBid = orderbook.bestBid;
                            const priceDiff = Math.abs(currentBid - this.pendingMarketSell.limitPrice);
                            
                            // Only reprice if price moved significantly (more than 2 ticks)
                            if (priceDiff > this.config.tickSize * 2) {
                                this.log(`🔄 Repricing fallback limit sell: ${this.pendingMarketSell.limitPrice} → ${currentBid}`, 'warning');
                                
                                await this.cancelOrder(this.pendingMarketSell.orderId);
                                const newLimitPrice = this.roundToTick(currentBid);
                                const newOrderId = await this.placeLimitOrder('Sell', newLimitPrice, this.pendingMarketSell.qty);
                                
                                if (newOrderId) {
                                    this.pendingMarketSell.orderId = newOrderId;
                                    this.pendingMarketSell.timestamp = Date.now();
                                    this.pendingMarketSell.limitPrice = newLimitPrice;
                                    this.log(`📤 Repriced limit sell: ${newOrderId} @ ${newLimitPrice}`, 'info');
                                }
                            }
                        }
                    } else {
                        this.log(`⏳ Waiting for fallback limit sell to fill... (${limitElapsed.toFixed(1)}s) @ ${this.pendingMarketSell.limitPrice}`, 'info');
                    }
                } else {
                    this.log(`⏳ Waiting for market sell to fill... (${elapsed.toFixed(1)}s)`, 'info');
                }
            }
        } catch (error) {
            this.log(`Error checking market sell status: ${error.message}`, 'error');
        }
    }
    
    // Helper: Create fallback TP when market sell fails completely
    async createFallbackTP() {
        if (!this.pendingNewTP) return;
        
        const tpPrice = this.roundToTick(this.pendingNewTP.buyPrice + (this.config.tpTicks * this.config.tickSize));
        const orderId = await this.placeLimitOrder('Sell', tpPrice, this.pendingNewTP.qty);
        
        if (orderId) {
            this.stats.totalSellOrdersCreated++;
            
            this.activeSellTPOrders.push({
                orderId: orderId,
                price: tpPrice,
                qty: this.pendingNewTP.qty,
                buyPrice: this.pendingNewTP.buyPrice,
                timestamp: Date.now()
            });
            
            this.stats.pendingPositions.push({
                orderId: orderId,
                buyPrice: this.pendingNewTP.buyPrice,
                qty: this.pendingNewTP.qty,
                sellPrice: tpPrice
            });
            
            this.log(`✅ Fallback TP created @ ${tpPrice}`, 'success');
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
                this.stats.totalSellOrdersFilled++;
                this.stats.realProfit += profit;
                
                // Remove from pending positions
                const pendingIndex = this.stats.pendingPositions.findIndex(p => p.orderId === order.orderId);
                if (pendingIndex !== -1) {
                    this.stats.pendingPositions.splice(pendingIndex, 1);
                }
                
                this.log(`💰 TP order ${order.orderId} filled! Profit: ${profit.toFixed(6)} USDT`, 'success');
                ordersToRemove.push(i);
            }
        }

        for (let i = ordersToRemove.length - 1; i >= 0; i--) {
            this.activeSellTPOrders.splice(ordersToRemove[i], 1);
        }
        
        // ✅ NEW: If we're waiting for market sell but a TP just filled,
        // we now have room - create the pending TP immediately
        if (this.isWaitingForMarketSell && this.pendingNewTP && ordersToRemove.length > 0) {
            if (this.activeSellTPOrders.length < this.config.maxSellTPOrders) {
                this.log(`📊 TP filled while waiting! Creating pending TP now (have room: ${this.activeSellTPOrders.length}/${this.config.maxSellTPOrders})`, 'info');
                
                const tpPrice = this.roundToTick(this.pendingNewTP.buyPrice + (this.config.tpTicks * this.config.tickSize));
                const orderId = await this.placeLimitOrder('Sell', tpPrice, this.pendingNewTP.qty);
                
                if (orderId) {
                    this.stats.totalSellOrdersCreated++;
                    
                    this.activeSellTPOrders.push({
                        orderId: orderId,
                        price: tpPrice,
                        qty: this.pendingNewTP.qty,
                        buyPrice: this.pendingNewTP.buyPrice,
                        timestamp: Date.now()
                    });
                    
                    this.stats.pendingPositions.push({
                        orderId: orderId,
                        buyPrice: this.pendingNewTP.buyPrice,
                        qty: this.pendingNewTP.qty,
                        sellPrice: tpPrice
                    });
                    
                    this.log(`✅ Pending TP created @ ${tpPrice}`, 'success');
                    
                    // Clear pending (but still wait for market sell to complete)
                    this.pendingNewTP = null;
                }
            }
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
            
            if (data.success && data.data && data.data.list && data.data.list.length > 0) {                
                let order = data.data.list[0];
                let orderStatus = order.orderStatus;
                let cumExecQty = parseFloat(order.cumExecQty || 0);
                
                const result = {
                    filled: orderStatus === 'Filled',
                    partiallyFilled: orderStatus === 'PartiallyFilled',
                    filledQty: cumExecQty
                };
                
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

    // Cancel all active orders (legacy - now split into separate methods)
    async cancelAllOrders() {
        this.log('Canceling all active orders...', 'warning');
        
        for (const order of this.activeBuyOrders) {
            await this.cancelOrder(order.orderId);
            this.stats.totalBuyOrdersCanceled++;
        }
        
        for (const order of this.activeSellTPOrders) {
            await this.cancelOrder(order.orderId);
            this.stats.totalSellOrdersCanceled++;
            
            // Remove from pending positions
            const pendingIndex = this.stats.pendingPositions.findIndex(p => p.orderId === order.orderId);
            if (pendingIndex !== -1) {
                this.stats.pendingPositions.splice(pendingIndex, 1);
            }
        }

        this.activeBuyOrders = [];
        this.activeSellTPOrders = [];
    }

    // Update status display with enhanced UI
    updateStatus(status) {
        const statusEl = document.getElementById('scalpStatus');
        
        if (status === 'running' || status === 'paused' || status === 'stopping') {
            statusEl.classList.add('running');
            if (status === 'paused') {
                statusEl.classList.remove('paused');
                statusEl.classList.add('paused');
            } else {
                statusEl.classList.remove('paused');
            }
            
            // Calculate statistics
            let estimatedProfit = this.calculateEstimatedProfit();
            let avgBuyPrice = this.calculateAvgBuyPrice();
            let totalPendingQty = this.calculateTotalPendingQty();
            
            // Format numbers for display
            let formatPrice = (price) => price > 0 ? price.toFixed(6) : '-';
            let formatProfit = (profit) => {
                let formatted = profit.toFixed(6);
                let prefix = profit >= 0 ? '+' : '';
                return prefix + formatted;
            };
            
            let statusText = 'Bot Running';
            let statusColor = '#10b981';
            let statusColor2 = '#059669';
            
            if (status === 'paused') {
                statusText = 'Bot Paused (TP Active)';
                statusColor = '#8b5cf6';
                statusColor2 = '#7c3aed';
            } else if (status === 'stopping') {
                statusText = 'Stopping...';
                statusColor = '#f59e0b';
                statusColor2 = '#d97706';
            } else if (status === 'waiting_market_sell') {
                statusText = '⏳ Waiting for Market Sell...';
                statusColor = '#ef4444';
                statusColor2 = '#dc2626';
            }
            
            // Determine if buy orders should appear stopped
            const buyOrdersStopped = status === 'paused' || status === 'waiting_market_sell';
            
            statusEl.innerHTML = `
                <div class="status-running">
                    <div class="status-header-main" style="background: linear-gradient(135deg, ${statusColor}, ${statusColor2});">
                        <span class="status-dot" style="${buyOrdersStopped ? 'animation: none; background: #fbbf24;' : ''}"></span>
                        <span class="status-text">${statusText}</span>
                    </div>
                    
                    <div class="stats-grid">
                        <div class="stat-card buy-stats">
                            <div class="stat-icon">📥</div>
                            <div class="stat-content">
                                <div class="stat-label">Buy Orders</div>
                                <div class="stat-value">${this.stats.totalBuyOrdersFilled} <span class="stat-total">/ ${this.stats.totalBuyOrdersCreated}</span></div>
                                <div class="stat-detail">Filled / Created</div>
                            </div>
                        </div>
                        
                        <div class="stat-card sell-stats">
                            <div class="stat-icon">📤</div>
                            <div class="stat-content">
                                <div class="stat-label">Sell Orders</div>
                                <div class="stat-value">${this.stats.totalSellOrdersFilled} <span class="stat-total">/ ${this.stats.totalSellOrdersCreated}</span></div>
                                <div class="stat-detail">Filled / Created</div>
                            </div>
                        </div>
                        
                        <div class="stat-card profit-estimated">
                            <div class="stat-icon">📊</div>
                            <div class="stat-content">
                                <div class="stat-label">Estimated Profit</div>
                                <div class="stat-value ${estimatedProfit >= 0 ? 'positive' : 'negative'}">${formatProfit(estimatedProfit)} USDT</div>
                                <div class="stat-detail">Pending + Completed</div>
                            </div>
                        </div>
                        
                        <div class="stat-card profit-real">
                            <div class="stat-icon">💰</div>
                            <div class="stat-content">
                                <div class="stat-label">Real Profit</div>
                                <div class="stat-value ${this.stats.realProfit >= 0 ? 'positive' : 'negative'}">${formatProfit(this.stats.realProfit)} USDT</div>
                                <div class="stat-detail">Completed Only</div>
                            </div>
                        </div>
                        
                        <div class="stat-card avg-price">
                            <div class="stat-icon">⚖️</div>
                            <div class="stat-content">
                                <div class="stat-label">Avg Buy Price</div>
                                <div class="stat-value">${formatPrice(avgBuyPrice)}</div>
                                <div class="stat-detail">Qty: ${totalPendingQty.toFixed(4)}</div>
                            </div>
                        </div>
                        
                        <div class="stat-card active-orders">
                            <div class="stat-icon">📋</div>
                            <div class="stat-content">
                                <div class="stat-label">Active Orders</div>
                                <div class="stat-value">${this.activeBuyOrders.length + this.activeSellTPOrders.length}</div>
                                <div class="stat-detail">Buy: ${this.activeBuyOrders.length} | TP: ${this.activeSellTPOrders.length}</div>
                            </div>
                        </div>
                    </div>
                    
                    ${status === 'waiting_market_sell' && this.pendingMarketSell ? `
                    <div class="market-sell-status">
                        <div class="market-sell-header">🔴 Market Sell in Progress</div>
                        <div class="market-sell-info">
                            <span>Qty: ${this.pendingMarketSell.qty}</span>
                            <span>Buy Price: ${this.pendingMarketSell.buyPrice}</span>
                            <span>Waiting: ${((Date.now() - this.pendingMarketSell.timestamp) / 1000).toFixed(1)}s</span>
                        </div>
                    </div>
                    ` : ''}
                    
                    <div class="orders-section">
                        <div class="orders-panel" style="${buyOrdersStopped ? 'opacity: 0.5;' : ''}">
                            <div class="panel-header">
                                <span class="panel-icon">${buyOrdersStopped ? '🛑' : '🟢'}</span>
                                <span class="panel-title">Active Buy Orders (${this.activeBuyOrders.length}/${this.config.maxBuyOrders}) ${status === 'paused' ? '- PAUSED' : (status === 'waiting_market_sell' ? '- STOPPED' : '')}</span>
                            </div>
                            <div class="orders-list">
                                ${this.activeBuyOrders.length > 0 ? 
                                    this.activeBuyOrders.map(order => `
                                        <div class="order-item buy-order">
                                            <span class="order-layer">L${order.layer}</span>
                                            <span class="order-price">${order.price.toFixed(6)}</span>
                                            <span class="order-qty">${order.qty}</span>
                                            <span class="order-age">${Math.floor((Date.now() - order.timestamp) / 1000)}s</span>
                                        </div>
                                    `).join('') : 
                                    `<div class="no-orders">${status === 'paused' ? 'Buy orders paused' : (status === 'waiting_market_sell' ? 'Buy orders stopped - waiting for market sell' : 'No active buy orders')}</div>`
                                }
                            </div>
                        </div>
                        
                        <div class="orders-panel">
                            <div class="panel-header">
                                <span class="panel-icon">🔵</span>
                                <span class="panel-title">Active TP Orders (${this.activeSellTPOrders.length}/${this.config.maxSellTPOrders})</span>
                            </div>
                            <div class="orders-list">
                                ${this.activeSellTPOrders.length > 0 ? 
                                    this.activeSellTPOrders.map(order => {
                                        const potentialProfit = (order.price - order.buyPrice) * order.qty;
                                        return `
                                            <div class="order-item tp-order">
                                                <span class="order-price">${order.price.toFixed(6)}</span>
                                                <span class="order-qty">${order.qty}</span>
                                                <span class="order-profit">+${potentialProfit.toFixed(6)}</span>
                                            </div>
                                        `;
                                    }).join('') : 
                                    '<div class="no-orders">No active TP orders</div>'
                                }
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            statusEl.classList.remove('running');
            
            // Show final stats when stopped
            const estimatedProfit = this.calculateEstimatedProfit();
            
            statusEl.innerHTML = `
                <div class="status-stopped">
                    <div class="status-header-main stopped">
                        <span class="status-dot stopped"></span>
                        <span class="status-text">Bot Stopped</span>
                    </div>
                    
                    <div class="final-stats">
                        <div class="final-stat">
                            <span class="final-label">Total Buy Orders:</span>
                            <span class="final-value">${this.stats.totalBuyOrdersFilled} / ${this.stats.totalBuyOrdersCreated} (${this.stats.totalBuyOrdersCanceled} canceled)</span>
                        </div>
                        <div class="final-stat">
                            <span class="final-label">Total Sell Orders:</span>
                            <span class="final-value">${this.stats.totalSellOrdersFilled} / ${this.stats.totalSellOrdersCreated} (${this.stats.totalSellOrdersCanceled} canceled)</span>
                        </div>
                        <div class="final-stat">
                            <span class="final-label">Real Profit:</span>
                            <span class="final-value ${this.stats.realProfit >= 0 ? 'positive' : 'negative'}">${this.stats.realProfit >= 0 ? '+' : ''}${this.stats.realProfit.toFixed(6)} USDT</span>
                        </div>
                    </div>
                </div>
            `;
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
        
        while (logsContent.children.length > 100) {
            logsContent.removeChild(logsContent.lastChild);
        }
    }
}

// Global bot instance
const scalpingBot = new ScalpingBot();

// Initialize scalping UI handlers
document.addEventListener('DOMContentLoaded', function() {
    const startBtn = document.getElementById('startScalpBtn');
    const stopBtn = document.getElementById('stopScalpBtn');
    const pauseBtn = document.getElementById('pauseScalpBtn');
    const resumeBtn = document.getElementById('resumeScalpBtn');
    const testOrderBtn = document.getElementById('testOrderBtn');
    const clearStatsBtn = document.getElementById('clearStatsBtn');

    // Function to update clear stats button state
    function updateClearStatsBtn() {
        if (clearStatsBtn) {
            clearStatsBtn.disabled = scalpingBot.isRunning || scalpingBot.isPaused;
        }
    }

    // Function to reset button states
    function resetButtonStates() {
        startBtn.style.display = 'block';
        stopBtn.style.display = 'none';
        pauseBtn.style.display = 'none';
        resumeBtn.style.display = 'none';
        updateClearStatsBtn();
    }

    if (startBtn) {
        startBtn.addEventListener('click', async function() {
            const config = getScalpingConfig();
            
            if (!validateConfig(config)) {
                return;
            }

            // Auto-clear stats when starting bot
            scalpingBot.resetStats();
            scalpingBot.log('📊 Statistics cleared on bot start', 'info');

            scalpingBot.init(config);
            await scalpingBot.start();

            startBtn.style.display = 'none';
            pauseBtn.style.display = 'block';
            stopBtn.style.display = 'block';
            resumeBtn.style.display = 'none';
            updateClearStatsBtn();
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', async function() {
            // Disable buttons during stop process
            stopBtn.disabled = true;
            pauseBtn.disabled = true;
            resumeBtn.disabled = true;
            
            await scalpingBot.stop();
            
            // Re-enable and reset button states
            stopBtn.disabled = false;
            pauseBtn.disabled = false;
            resumeBtn.disabled = false;
            resetButtonStates();
        });
    }

    if (pauseBtn) {
        pauseBtn.addEventListener('click', async function() {
            await scalpingBot.pause();
            
            pauseBtn.style.display = 'none';
            resumeBtn.style.display = 'block';
            updateClearStatsBtn();
        });
    }

    if (resumeBtn) {
        resumeBtn.addEventListener('click', async function() {
            await scalpingBot.resume();
            
            resumeBtn.style.display = 'none';
            pauseBtn.style.display = 'block';
            updateClearStatsBtn();
        });
    }

    if (clearStatsBtn) {
        clearStatsBtn.addEventListener('click', function() {
            if (scalpingBot.isRunning || scalpingBot.isPaused) {
                scalpingBot.log('⚠️ Cannot clear stats while bot is running', 'warning');
                return;
            }
            
            scalpingBot.resetStats();
            scalpingBot.updateStatus('stopped');
            scalpingBot.log('🗑️ Statistics cleared', 'info');
        });
    }

    if (testOrderBtn) {
        testOrderBtn.addEventListener('click', async function() {
            const config = getScalpingConfig();
            
            if (!validateConfig(config)) {
                return;
            }

            scalpingBot.init(config);
            await scalpingBot.testSingleOrder();
        });
    }
});

// Get configuration from UI
function getScalpingConfig() {
    return {
        apiKey: document.getElementById('apiKey').value.trim(),
        apiSecret: document.getElementById('apiSecret').value.trim(),
        symbol: document.getElementById('symbol').value.trim(),
        category: document.getElementById('category').value,
        tickSize: parseFloat(document.getElementById('scalpTickSize').value),
        maxBuyOrders: parseInt(document.getElementById('scalpMaxBuyOrders').value),
        offsetTicks: parseInt(document.getElementById('scalpOffsetTicks').value),
        layerStepTicks: parseInt(document.getElementById('scalpLayerStepTicks').value),
        buyTTL: parseInt(document.getElementById('scalpBuyTTL').value),
        repriceTicks: parseInt(document.getElementById('scalpRepriceTicks').value),
        tpTicks: parseInt(document.getElementById('scalpTPTicks').value),
        maxSellTPOrders: parseInt(document.getElementById('scalpMaxSellTPOrders').value),
        orderQty: parseFloat(document.getElementById('scalpOrderQty').value),
        loopInterval: parseInt(document.getElementById('scalpLoopInterval').value),
        waitAfterBuyFill: parseInt(document.getElementById('scalpWaitAfterBuyFill').value) || 0,
        sellAllOnStop: document.getElementById('scalpSellAllOnStop')?.checked || false
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
