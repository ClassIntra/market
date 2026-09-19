// 网易云音乐插件 - 媒体中转层（基于插件 SDK）
// 职责：客户端零外网依赖，所有网易云音频 / 图片流量由 ClassIntra 服务器中转。
// 通用能力（CONNECT 代理隧道 / http(s) 出站请求 / Range 断点续传 / 磁盘缓存 LRU /
// 一次性取流票据）已下沉到 plugins/_sdk/backend/stream-relay.js，
// 本文件仅做插件侧装配：
//   - 缓存目录 / 音频缓存上限 / 出站代理来自插件配置（store.getConfig）
//   - 图片白名单限定网易云 CDN（*.music.126.net），携带 Referer 防盗链
// 导出签名与旧版保持兼容（ncm/api.js、gateway.js、routes.js 引用点无需改动）。

var sdk = require('../../_sdk/backend/stream-relay');
var store = require('./store');

// 图片中转白名单（网易云 CDN 域）
var IMAGE_HOST_RE = /(^|\.)music\.126\.net$/i;

// 中转器：配置实时读插件配置（管理端改配置即时生效）
var relay = sdk.createRelay({
  getConfig: function () { return store.getConfig(); },
  imageHostAllow: IMAGE_HOST_RE,
  imageHeaders: { 'Referer': 'https://music.163.com' }
});

// 取流票据：复用插件缓存表存储，键前缀隔离票据键空间
var tickets = sdk.createTicketKit(store, 'streamticket:');

module.exports = {
  streamAudio: relay.streamAudio,
  streamImage: relay.streamImage,
  proxyConnect: sdk.proxyConnect,
  fetchRaw: sdk.fetchRaw,
  createStreamTicket: function (payload) { return tickets.create(payload); },
  verifyStreamTicket: tickets.verify
};
