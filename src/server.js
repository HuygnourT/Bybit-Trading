const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const { RestClientV5 } = require('bybit-api');

const bybitService = require('./services/bybitService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to create order
app.post('/api/order/create', async (req, res) => {
  try {
    const { apiKey, apiSecret, category, symbol, side, orderType, qty, price } = req.body;

    if (!apiKey || !apiSecret || !category || !symbol || !side || !orderType || !qty) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters' 
      });
    }

    const result = await bybitService.createOrder({
      apiKey,
      apiSecret,
      category,
      symbol,
      side,
      orderType,
      qty,
      price
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// API endpoint to get wallet balance
app.post('/api/wallet/balance', async (req, res) => {
  console.log("Calling wallet from server.js");
  try {
    const { apiKey, apiSecret, accountType } = req.body;

    if (!apiKey || !apiSecret || !accountType) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters' 
      });
    }

    const result = await bybitService.getWalletBalance({
      apiKey,
      apiSecret,
      accountType
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// API endpoint to get orderbook
app.post('/api/orderbook', async (req, res) => {
  try {
    const { symbol, category } = req.body;

    if (!symbol || !category) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters' 
      });
    }

    const result = await bybitService.getOrderbook({
      symbol,
      category
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// API endpoint to check order status
app.post('/api/order/status', async (req, res) => {
  try {
    const { apiKey, apiSecret, category, symbol, orderId } = req.body;

    if (!apiKey || !apiSecret || !category || !symbol || !orderId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters' 
      });
    }

    const result = await bybitService.getOrderStatus({
      apiKey,
      apiSecret,
      category,
      symbol,
      orderId
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// API endpoint to cancel order
app.post('/api/order/cancel', async (req, res) => {
  try {
    const { apiKey, apiSecret, category, symbol, orderId } = req.body;

    if (!apiKey || !apiSecret || !category || !symbol || !orderId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters' 
      });
    }

    const result = await bybitService.cancelOrder({
      apiKey,
      apiSecret,
      category,
      symbol,
      orderId
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});