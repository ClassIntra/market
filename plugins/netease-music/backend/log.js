// 网易云音乐插件 - 统一日志工具
// 受插件配置 debug 开关控制（netease_config 表 / 管理端 /admin/config 或 CLI 设置）：
//   debug='1' 时输出详细日志：风控触发、通道冷却、引擎回退、缓存命中等诊断信息。
// 读取 debug 标志带 30s 缓存，避免高频日志判断每次查库。

var store = require('./store');

var CHECK_INTERVAL = 30 * 1000;
var lastCheck = 0;
var debugOn = false;

function isDebug() {
  var now = Date.now();
  if (now - lastCheck > CHECK_INTERVAL) {
    try { debugOn = store.getConfig().debug === '1'; } catch (e) { debugOn = false; }
    lastCheck = now;
  }
  return debugOn;
}

// debug 日志（受开关控制）：log.debug('gateway', '缓存命中', cacheKey)
function debug() {
  if (!isDebug()) return;
  var args = ['[netease-music]'].concat([].slice.call(arguments));
  console.log.apply(console, args);
}

// 错误日志（始终输出）
function error() {
  var args = ['[netease-music]'].concat([].slice.call(arguments));
  console.error.apply(console, args);
}

module.exports = { debug: debug, error: error, isDebug: isDebug };
