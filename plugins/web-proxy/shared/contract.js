// Web Proxy 联动契约（v1.0）
// =====================================
// 网页代理插件与宿主（ClassIntra 超能岛浏览器 / 被代理页面）之间 postMessage 通信的权威定义。
//
// 消息流向：
//   ClassIntra（父） → 被代理页面（iframe 子） ：proxy-status / url-rewrite 查询
//   被代理页面（子） → ClassIntra（父）       ：page-info（真实 URL/标题上报）、ping
//
// 说明：
//   本插件的资源改写与链接代理由代理服务器在响应阶段完成（服务端注入 hook），
//   因此联动协议只承担"状态同步"职责，不参与资源改写决策。

// ========== 协议常量 ==========
var PROTOCOL_VERSION = '1.0';
var MSG_TYPE = 'web-proxy';

var SOURCE_CLASSINTRA = 'classintra-browser';
var SOURCE_PROXY_PAGE = 'web-proxy-page';

// ========== 动作枚举 ==========
// 父→子（ClassIntra → 被代理页面）下发的指令
var ACTIONS_PARENT_TO_CHILD = {
  // 请求上报当前页面真实地址与标题
  REQUEST_PAGE_INFO: 'request-page-info',
  // 请求上报代理开关状态
  REQUEST_PROXY_STATUS: 'request-proxy-status'
};

// 子→父（被代理页面 → ClassIntra）上报的事件
var ACTIONS_CHILD_TO_PARENT = {
  // 握手发起
  HELLO: 'handshake-hello',
  // 握手完成
  READY: 'handshake-ready',
  // 页面信息上报（payload: { url, title }）
  PAGE_INFO: 'web-proxy-page-info',
  // 代理状态上报（payload: { running, port }）
  PROXY_STATUS: 'web-proxy-status',
  // 子页面 ping 父窗口
  PING: 'web-proxy-ping'
};

// 合并所有动作名（用于校验）
var ALL_ACTIONS = {};
Object.keys(ACTIONS_PARENT_TO_CHILD).forEach(function (k) { ALL_ACTIONS[ACTIONS_PARENT_TO_CHILD[k]] = true; });
Object.keys(ACTIONS_CHILD_TO_PARENT).forEach(function (k) { ALL_ACTIONS[ACTIONS_CHILD_TO_PARENT[k]] = true; });

// ========== 通道能力映射 ==========
var CHANNEL_ACTIONS = {
  'handshake': ['handshake-hello', 'handshake-welcome', 'handshake-ready'],
  'page-info': ['web-proxy-page-info', 'request-page-info'],
  'proxy-status': ['web-proxy-status', 'request-proxy-status'],
  'ping': ['web-proxy-ping']
};

var DEFAULT_CHANNELS = Object.keys(CHANNEL_ACTIONS);

// ========== 工厂函数 ==========

/**
 * 创建联动消息
 * @param {string} source - 来源标识
 * @param {string} action - 动作枚举
 * @param {Object} [payload] - 消息体
 * @returns {Object} 标准消息对象
 */
function createMessage(source, action, payload) {
  return {
    type: MSG_TYPE,
    v: PROTOCOL_VERSION,
    source: source,
    action: action,
    payload: payload || null,
    timestamp: Date.now()
  };
}

/**
 * 创建 HELLO 消息（子→父）
 * @param {string} childVersion
 * @returns {Object}
 */
function createHelloMessage(childVersion) {
  return createMessage(SOURCE_PROXY_PAGE, ACTIONS_CHILD_TO_PARENT.HELLO, {
    v: childVersion || PROTOCOL_VERSION
  });
}

/**
 * 创建页面信息上报消息（子→父）
 * @param {{url: string, title: string}} info
 * @returns {Object}
 */
function createPageInfoMessage(info) {
  return createMessage(SOURCE_PROXY_PAGE, ACTIONS_CHILD_TO_PARENT.PAGE_INFO, {
    url: (info && info.url) || '',
    title: (info && info.title) || ''
  });
}

// ========== 校验函数 ==========

/**
 * 校验消息格式
 * @param {Object} msg
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateMessage(msg) {
  var errors = [];
  if (!msg || typeof msg !== 'object') {
    return { valid: false, errors: ['消息必须是对象'] };
  }
  if (msg.type !== MSG_TYPE) {
    return { valid: false, errors: ['type 不匹配，期望 "' + MSG_TYPE + '"'] };
  }
  if (!msg.action || typeof msg.action !== 'string') {
    errors.push('action 缺失或非字符串');
  } else if (!ALL_ACTIONS[msg.action]) {
    errors.push('action "' + msg.action + '" 未注册');
  }
  if (msg.source !== SOURCE_CLASSINTRA && msg.source !== SOURCE_PROXY_PAGE) {
    errors.push('source "' + msg.source + '" 不在白名单');
  }
  if (typeof msg.timestamp !== 'number' || msg.timestamp <= 0) {
    errors.push('timestamp 缺失或非正数');
  }
  return { valid: errors.length === 0, errors: errors };
}

/**
 * 判断动作是否被允许的通道集合覆盖
 * @param {string} action
 * @param {string[]} allowedChannels
 * @returns {boolean}
 */
function isActionAllowed(action, allowedChannels) {
  if (!Array.isArray(allowedChannels) || allowedChannels.length === 0) return true;
  var channels = Object.keys(CHANNEL_ACTIONS);
  for (var i = 0; i < channels.length; i++) {
    var actions = CHANNEL_ACTIONS[channels[i]];
    if (actions.indexOf(action) === -1) continue;
    return allowedChannels.indexOf(channels[i]) !== -1;
  }
  return false;
}

// ========== 工具函数 ==========

/**
 * 从 URL 提取 origin
 * @param {string} url
 * @returns {string}
 */
function extractOrigin(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    var match = url.match(/^(https?:\/\/[^/]+)/i);
    return match ? match[1].toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

// ========== 导出 ==========
var exportsObj = {
  PROTOCOL_VERSION: PROTOCOL_VERSION,
  MSG_TYPE: MSG_TYPE,
  SOURCE_CLASSINTRA: SOURCE_CLASSINTRA,
  SOURCE_PROXY_PAGE: SOURCE_PROXY_PAGE,
  ACTIONS_PARENT_TO_CHILD: ACTIONS_PARENT_TO_CHILD,
  ACTIONS_CHILD_TO_PARENT: ACTIONS_CHILD_TO_PARENT,
  CHANNEL_ACTIONS: CHANNEL_ACTIONS,
  DEFAULT_CHANNELS: DEFAULT_CHANNELS,
  createMessage: createMessage,
  createHelloMessage: createHelloMessage,
  createPageInfoMessage: createPageInfoMessage,
  validateMessage: validateMessage,
  isActionAllowed: isActionAllowed,
  extractOrigin: extractOrigin
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = exportsObj;
}

export {
  PROTOCOL_VERSION,
  MSG_TYPE,
  SOURCE_CLASSINTRA,
  SOURCE_PROXY_PAGE,
  ACTIONS_PARENT_TO_CHILD,
  ACTIONS_CHILD_TO_PARENT,
  CHANNEL_ACTIONS,
  DEFAULT_CHANNELS,
  createMessage,
  createHelloMessage,
  createPageInfoMessage,
  validateMessage,
  isActionAllowed,
  extractOrigin
};
