const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});