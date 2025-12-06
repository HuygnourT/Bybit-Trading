const CryptoJS = require('crypto-js');

function createSignature(paramStr, secret) {
  return CryptoJS.HmacSHA256(paramStr, secret).toString(CryptoJS.enc.Hex);
}

module.exports = {
  createSignature
};