const crypto = require('../utils/crypto');
const https = require('https');

const BYBIT_API_URL = 'api.bybit.com';

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

module.exports = {
  createOrder
};
