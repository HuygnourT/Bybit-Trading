module.exports = {
  bybit: {
    apiUrl: process.env.BYBIT_API_URL || 'https://api.bybit.com',
    testnetUrl: 'https://api-testnet.bybit.com'
  },
  server: {
    port: process.env.PORT || 3000
  }
};