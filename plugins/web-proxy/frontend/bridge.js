// Web Proxy 前端桥接模块（v1.0）
// =====================================
// ClassIntra 侧的联动入口：封装与被代理页面（iframe）之间的 postMessage 通信。
//
// 职责边界：
//   1. 资源改写与链接代理由代理服务器在响应阶段完成，本模块不参与
//   2. 本模块只做状态同步：接收被代理页面上报的真实 URL / 标题，查询代理状态
//
// 使用方式（推荐订阅式）：
//   import { mountBridge } from '@/integrations/web-proxy-client';
//   var bridge = mountBridge(iframe, {
//     allowedChannels: ['handshake', 'page-info', 'proxy-status', 'ping']
//   });
//   bridge.on('page-info', function(payload) { this.urlText = payload.url; });
//   bridge.on('ready', function() { console.log('代理页面就绪'); });
//   bridge.destroy();

import {
  PROTOCOL_VERSION,
  MSG_TYPE,
  SOURCE_CLASSINTRA,
  SOURCE_PROXY_PAGE,
  ACTIONS_PARENT_TO_CHILD,
  ACTIONS_CHILD_TO_PARENT,
  DEFAULT_CHANNELS,
  createMessage,
  createHelloMessage,
  createPageInfoMessage,
  validateMessage,
  isActionAllowed,
  extractOrigin
} from '../shared/contract.js';

// ========== 桥接实例 ==========

/**
 * @param {HTMLIFrameElement} iframe - 被代理页面所在的 iframe
 * @param {Object} [opts] - { allowedChannels: string[] }
 */
function BridgeInstance(iframe, opts) {
  this._iframe = iframe || null;
  this._origin = '';
  this._allowedChannels = (opts && opts.allowedChannels) || DEFAULT_CHANNELS;
  this._handlers = {};
  this._started = false;
  this._onMessage = null;
  this._destroyed = false;
}

// 启动监听
BridgeInstance.prototype.mount = function () {
  var self = this;
  if (self._started || self._destroyed) return self;
  self._started = true;
  self._origin = extractOrigin(self._iframe && self._iframe.src);

  self._onMessage = function (event) {
    if (self._destroyed) return;
    if (self._iframe && event.source !== self._iframe.contentWindow) return;
    var msg = event.data;
    if (!msg || msg.type !== MSG_TYPE) return;
    var check = validateMessage(msg);
    if (!check.valid) return;
    if (!isActionAllowed(msg.action, self._allowedChannels)) return;

    if (msg.action === ACTIONS_CHILD_TO_PARENT.HELLO ||
        msg.action === ACTIONS_CHILD_TO_PARENT.PING) {
      self._send(ACTIONS_PARENT_TO_CHILD.REQUEST_PROXY_STATUS, null);
      self._emit('ready', null);
      return;
    }
    if (msg.action === ACTIONS_CHILD_TO_PARENT.PAGE_INFO) {
      self._emit('page-info', msg.payload);
      return;
    }
    if (msg.action === ACTIONS_CHILD_TO_PARENT.PROXY_STATUS) {
      self._emit('proxy-status', msg.payload);
      return;
    }
    self._emit('message', msg);
  };

  window.addEventListener('message', self._onMessage);
  return self;
};

// 订阅事件：page-info / proxy-status / ready / message
BridgeInstance.prototype.on = function (event, handler) {
  if (typeof handler !== 'function') return this;
  if (!this._handlers[event]) this._handlers[event] = [];
  this._handlers[event].push(handler);
  return this;
};

BridgeInstance.prototype.off = function (event, handler) {
  var list = this._handlers[event];
  if (!list) return this;
  if (!handler) {
    delete this._handlers[event];
    return this;
  }
  var idx = list.indexOf(handler);
  if (idx !== -1) list.splice(idx, 1);
  return this;
};

BridgeInstance.prototype._emit = function (event, payload) {
  var list = this._handlers[event];
  if (!list) return;
  for (var i = 0; i < list.length; i++) {
    try {
      list[i](payload);
    } catch (e) {
      // 单个订阅者异常不影响其他订阅者
      if (typeof console !== 'undefined') console.warn('[web-proxy bridge]', e);
    }
  }
};

// 发消息给被代理页面
BridgeInstance.prototype._send = function (action, payload) {
  if (!this._iframe || !this._iframe.contentWindow) return;
  var msg = createMessage(SOURCE_CLASSINTRA, action, payload);
  var target = this._origin || '*';
  try {
    this._iframe.contentWindow.postMessage(msg, target);
  } catch (e) {}
};

// 请求页面上报真实 URL 与标题
BridgeInstance.prototype.requestPageInfo = function () {
  this._send(ACTIONS_PARENT_TO_CHILD.REQUEST_PAGE_INFO, null);
  return this;
};

// 请求上报代理运行状态
BridgeInstance.prototype.requestProxyStatus = function () {
  this._send(ACTIONS_PARENT_TO_CHILD.REQUEST_PROXY_STATUS, null);
  return this;
};

// 卸载
BridgeInstance.prototype.destroy = function () {
  if (this._destroyed) return;
  this._destroyed = true;
  if (this._onMessage) {
    window.removeEventListener('message', this._onMessage);
    this._onMessage = null;
  }
  this._handlers = {};
};

// ========== 对外工厂 ==========

/**
 * 挂载桥接
 * @param {HTMLIFrameElement} iframe
 * @param {Object} [opts]
 * @returns {BridgeInstance}
 */
function mountBridge(iframe, opts) {
  var instance = new BridgeInstance(iframe, opts);
  return instance.mount();
}

/**
 * 卸载桥接
 * @param {BridgeInstance} bridge
 */
function unmountBridge(bridge) {
  if (bridge && typeof bridge.destroy === 'function') bridge.destroy();
}

export {
  PROTOCOL_VERSION,
  MSG_TYPE,
  SOURCE_CLASSINTRA,
  SOURCE_PROXY_PAGE,
  ACTIONS_PARENT_TO_CHILD,
  ACTIONS_CHILD_TO_PARENT,
  createHelloMessage,
  createPageInfoMessage,
  mountBridge,
  unmountBridge
};
