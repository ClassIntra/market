// ClassIntra 插件 SDK - 统一错误类型
// 所有插件的「业务错误」使用一致的结构 { code, message, cause }：
//   - 路由层 sendError 依赖 err.code/err.message 判断，PluginError 天然兼容
//   - 调用方 e.code === 503 判断不受影响
//   - cause 保留原始错误（网络异常等），诊断时能看到完整链路

class PluginError extends Error {
  // code: HTTP 语义状态码（400-599，路由层直接用作响应状态）
  // message: 面向用户的中文提示
  // cause: 原始错误对象（可选），便于日志诊断
  constructor(code, message, cause) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    this.cause = cause || null;
  }
}

// 判定是否为「网络级失败」（可回退 upstream / 缓存 stale），
// 业务错误（如 VIP 限制、参数错误）不算——业务错误应直接抛给调用方。
function isNetworkError(err) {
  var msg = String((err && err.message) || '');
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|超时|网络|fetch failed|socket hang up/i.test(msg);
}

module.exports = {
  PluginError: PluginError,
  isNetworkError: isNetworkError
};
