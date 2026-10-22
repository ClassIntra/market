# 网页代理插件（web-proxy）贡献说明

本插件为 ClassIntra 提供了一个内置的网页代理服务，使超能岛浏览器可以正常打开被防盗链、跨域或 iframe 限制的站点。

## 文件结构

```
web-proxy/
├── manifest.json                 # 插件声明
├── README.md                     # 插件文档
├── backend/                      # 服务端（Node.js）
│   ├── routes.js                 # Express 路由 + 自动启动
│   ├── proxy-server.js           # 代理服务器核心
│   ├── rewrite.js                # 响应内容改写
│   └── hook.js                   # 客户端注入脚本
├── frontend/                     # ClassIntra 侧
│   └── bridge.js                 # postMessage 桥接
└── shared/
    └── contract.js               # 通信契约
```

> `client/src/integrations/web-proxy-client.js`（`manifest.clientEntry`）需保留在 ClassIntra 主项目中。

## 工作原理

1. 超能岛浏览器以 `http://<host>:9101/https/example.com/page` 作为 iframe src
2. `routes.js` 被 require 时自动启动 `proxy-server`（默认 `0.0.0.0:9101`）
3. 服务端转发请求到真实目标，响应经 `rewrite.js` 改写所有资源链接为代理地址
4. `hook.js` 注入到 HTML 中，拦截客户端请求（XHR/fetch/WebSocket/window.open/history）
5. `frontend/bridge.js` 通过 postMessage 与 `web-proxy-client.js` 同步代理状态

## 关键特性

- **纯 Node 实现**：无 Python/mitmproxy 依赖
- **自动启用**：插件加载即启动，无需手动操作
- **智能分流**：仅代理外站 URL，内网与 CampusBili 保持直连
- **Cookie 兼容**：剥离上游 Domain/Secure/SameSite 限制
- **WebSocket 支持**：完整代理 WebSocket 连接
- **动态节点拦截**：MutationObserver 监控并改写动态插入的资源

## 集成方式

在 `manifest.json` 中声明：

```json
{
  "name": "web-proxy",
  "type": "plugin",
  "category": "hidden",
  "defaultEnabled": true,
  "canDisable": false,
  "backend": {
    "mountPath": "/api/web-proxy",
    "entry": "./backend/routes.js"
  },
  "integration": {
    "contract": "./shared/contract.js",
    "frontendBridge": "./frontend/bridge.js",
    "clientEntry": "client/src/integrations/web-proxy-client.js"
  }
}
```

## 注意事项

- 客户端入口 `web-proxy-client.js` 需在 ClassIntra 主项目的 `client/src/integrations/` 中维护
- 默认监听端口 `9101`（ClassIntra 第三方应用段），可用环境变量 `WEB_PROXY_PORT` 覆盖，勿写死在源码
- 代理仅处理完整 URL（`http://` / `https://`），不拦截相对路径
