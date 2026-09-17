// 网易云音乐加密模块
// 协议实现移植自 api-enhanced（github.com/NeteaseCloudMusicApiEnhanced/api-enhanced）的 util/crypto.js，
// 去掉了 crypto-js / node-forge 依赖，仅使用 Node 内置 crypto，便于内网 / 离线环境部署。
//
// 支持两种加密方式：
//   weapi  —— PC 网页端协议（AES-128-CBC 双重加密 + RSA 加密随机密钥）
//   eapi   —— 客户端协议（AES-128-ECB + MD5 摘要，接口域名 interfacepc.music.163.com）

var crypto = require('crypto');

var IV = '0102030405060708';
var PRESET_KEY = '0CoJUm6Qyw8W8jud';
var EAPI_KEY = 'e82ckenh8dichen8';
var BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// 网易云 weapi 固定公钥（1024 位，与 api-enhanced 保持一致）
var PUBLIC_KEY_PEM = [
  '-----BEGIN PUBLIC KEY-----',
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB',
  '-----END PUBLIC KEY-----'
].join('\n');

// AES 加密：mode 为 'cbc' 或 'ecb'，format 为 'base64' 或 'hex'
function aesEncrypt(text, mode, key, ivText, format) {
  var useIv = mode === 'cbc' ? Buffer.from(ivText || IV, 'utf8') : null;
  var cipher = crypto.createCipheriv('aes-128-' + mode, Buffer.from(key, 'utf8'), useIv);
  var out = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
  if (format === 'hex') return out.toString('hex').toUpperCase();
  return out.toString('base64');
}

// AES 解密（eapi 响应若开启加密时使用）
function aesDecrypt(hexText, key, mode) {
  var decipher = crypto.createDecipheriv('aes-128-' + (mode || 'ecb'), Buffer.from(key, 'utf8'), null);
  return Buffer.concat([decipher.update(Buffer.from(hexText, 'hex')), decipher.final()]);
}

// RSA 无填充加密（对应 node-forge 的 encrypt(str, 'NONE')：左侧补 0x00 至密钥长度）
function rsaEncryptNoPadding(text) {
  var buf = Buffer.from(text, 'utf8');
  var blockSize = 128; // 1024-bit
  var padded = Buffer.concat([Buffer.alloc(blockSize - buf.length), buf]);
  return crypto.publicEncrypt({ key: PUBLIC_KEY_PEM, padding: crypto.constants.RSA_NO_PADDING }, padded)
    .toString('hex')
    .toUpperCase();
}

function randomSecretKey() {
  var secretKey = '';
  for (var i = 0; i < 16; i++) {
    secretKey += BASE62.charAt(Math.round(Math.random() * 61));
  }
  return secretKey;
}

// weapi 加密：返回 { params, encSecKey }
function weapi(object) {
  var text = JSON.stringify(object);
  var secretKey = randomSecretKey();
  return {
    params: aesEncrypt(aesEncrypt(text, 'cbc', PRESET_KEY, IV), 'cbc', secretKey, IV),
    encSecKey: rsaEncryptNoPadding(secretKey.split('').reverse().join(''))
  };
}

// eapi 加密：返回 { params }（params 为十六进制大写密文）
function eapi(uri, object) {
  var text = typeof object === 'object' ? JSON.stringify(object) : object;
  var message = 'nobody' + uri + 'use' + text + 'md5forencrypt';
  var digest = crypto.createHash('md5').update(message).digest('hex');
  var data = uri + '-36cd479b6b5-' + text + '-36cd479b6b5-' + digest;
  return {
    params: aesEncrypt(data, 'ecb', EAPI_KEY, '', 'hex')
  };
}

module.exports = {
  weapi: weapi,
  eapi: eapi,
  aesEncrypt: aesEncrypt,
  aesDecrypt: aesDecrypt,
  EAPI_KEY: EAPI_KEY
};