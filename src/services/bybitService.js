const crypto = require('../utils/crypto');
const https = require('https');

const BYBIT_API_URL = 'api-testnet.bybit.com';

async function createOrder({ apiKey, apiSecret, category, symbol, side, orderType, qty, price }) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  const params = {
    category,
    symbol,
    side,
    orderType,
    qty
  };

  if (orderType === 'Limit' && price) {
    params.price = price;
  }

  const paramStr = timestamp + apiKey + recvWindow + JSON.stringify(params);
  const signature = crypto.createSignature(paramStr, apiSecret);

  const options = {
    hostname: BYBIT_API_URL,
    path: '/v5/order/create',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.retCode === 0) {
            resolve({
              success: true,
              data: response.result
            });
          } else {
            resolve({
              success: false,
              message: response.retMsg,
              code: response.retCode
            });
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(JSON.stringify(params));
    req.end();
  });
}

async function getWalletBalance({ apiKey, apiSecret, accountType }) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  console.log("Calling wallet from bybitService.js");
  // Query parameters for GET request
  const queryString = `accountType=${accountType}`;
  const paramStr = timestamp + apiKey + recvWindow + queryString;
  const signature = crypto.createSignature(paramStr, apiSecret);

  const options = {
    hostname: BYBIT_API_URL,
    path: `/v5/account/wallet-balance?${queryString}`,
    accountType: accountType,
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.retCode === 0) {
            resolve({
              success: true,
              data: response.result
            });
          } else {
            resolve({
              success: false,
              message: response.retMsg,
              code: response.retCode
            });
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

// Get Orderbook (public endpoint, no auth needed)
async function getOrderbook({ symbol, category }) {
  const options = {
    hostname: BYBIT_API_URL,
    path: `/v5/market/orderbook?category=${category}&symbol=${symbol}&limit=1`,
    method: 'GET'
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.retCode === 0 && response.result) {
            const result = response.result;
            resolve({
              success: true,
              data: {
                bestBid: result.b && result.b[0] ? result.b[0][0] : '0',
                bestAsk: result.a && result.a[0] ? result.a[0][0] : '0'
              }
            });
          } else {
            resolve({
              success: false,
              message: response.retMsg || 'Failed to fetch orderbook'
            });
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

// Get Order Status
async function getOrderStatus({ apiKey, apiSecret, category, symbol, orderId }) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  const queryString = `category=${category}&symbol=${symbol}&orderId=${orderId}`;
  const paramStr = timestamp + apiKey + recvWindow + queryString;
  const signature = crypto.createSignature(paramStr, apiSecret);

  const options = {
    hostname: BYBIT_API_URL,
    path: `/v5/order/realtime?${queryString}`,
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow
    }
  };

  return makeRequest(options);
}

// Cancel Order
async function cancelOrder({ apiKey, apiSecret, category, symbol, orderId }) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  const params = {
    category,
    symbol,
    orderId
  };

  const paramStr = timestamp + apiKey + recvWindow + JSON.stringify(params);
  const signature = crypto.createSignature(paramStr, apiSecret);

  const options = {
    hostname: BYBIT_API_URL,
    path: '/v5/order/cancel',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow
    }
  };

  return makeRequest(options, params);
}

// Helper function to make HTTPS requests
function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.retCode === 0) {
            resolve({
              success: true,
              data: response.result
            });
          } else {
            resolve({
              success: false,
              message: response.retMsg,
              code: response.retCode
            });
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

module.exports = {
  createOrder,
  getWalletBalance,
  getOrderbook,
  getOrderStatus,
  cancelOrder 
};
