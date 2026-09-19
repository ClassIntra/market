// 网易云音乐插件 - 统一错误类型（re-export 插件 SDK 共享实现）
// 实现已下沉到 plugins/_sdk/backend/errors.js，保留本文件兼容
// gateway.js 等既有 require('./errors') 引用点。

module.exports = require('../../_sdk/backend/errors');
