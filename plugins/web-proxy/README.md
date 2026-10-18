# 网页代理（web-proxy）

内置网页代理服务插件。把任意外网站点经本机代理转发，并在响应阶段重写页面内的资源链接，
使 **超能岛浏览器** 可以正常打开被防盗链、跨域、`X-Frame-Options` 或 `CSP` 限制的站点。

- **纯 Node 实现**：不依赖 Python / mitmproxy / 浏览器扩展，随便携包一起运行
- **默认随启动自动运行**：插件被加载即启动代理，无需手工操作；管理员可在应用市场「服务端插件」中随时暂停或恢复（暂停后接口即时下线，无需重启）
- **自动启用**：超能岛浏览器打开外网站点时自动改走代理，内网与 CampusBili 保持直连

## 架构

```
超能岛浏览器 iframe
        │  src = http://<classintra-host>:9005/https/example.com/page
        ▼
web-proxy (Node http server, 0.0.0.0:9005)
        │  Node https 客户端发起真实请求（不做 TLS 拦截）
        ▼
     目标站点 example.com
```

- **服务端改写**：HTML 的 `href/src/action/poster/background/srcset/formaction/srcdoc/data/codebase/icon/manifest/xlink:href`、CSS 的 `url()`/`@import`、
  JS 的 `__webpack_public_path__`、3xx 的 `Location` 全部改写为代理地址
- **客户端 hook**：注入的 `hook.js` 拦截 `XMLHttpRequest`、`fetch`、`WebSocket`、`EventSource`、`window.open`、
  `history.pushState/replaceState`、`Image.src`、`setAttribute` 与动态插入节点
- **Cookie 兼容**：剥离上游 `Domain` / `Secure` / `SameSite=None`，保证在代理域名下正常下发
- **WebSocket 支持**：代理服务器支持 WebSocket 协议的转发与改写

## 目录

```
web-proxy/
├── manifest.json                 # 插件声明（mountPath /api/web-proxy，隐藏类插件）
├── README.md                     # 插件说明
├── backend/
│   ├── routes.js                 # Express 路由，require 时自动启动代理
│   ├── proxy-server.js           # 代理服务器（请求转发、响应头处理、编码转换、WebSocket 支持）
│   ├── rewrite.js                # HTML/CSS/JS 链接改写（含 meta 标签处理、媒体元素、srcdoc 递归）
│   └── hook.js                   # 注入被代理页面的客户端脚本（拦截 XHR/fetch/WebSocket/window.open/history、MutationObserver）
├── frontend/
│   └── bridge.js                 # ClassIntra 侧 postMessage 桥接（状态同步）
└── shared/
    └── contract.js               # 联动契约（协议 1.0）
```

> 注：客户端集成入口（`clientEntry`）为 `client/src/integrations/web-proxy-client.js`，该文件随 ClassIntra 主仓库一同维护（位于主仓 `client/src/integrations/` 下），本插件包内不含该文件。

## 接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/web-proxy/status` | 公开 | 运行状态、端口、请求/错误计数 |
| GET | `/api/web-proxy/config` | 公开 | 轻量配置（是否启用、端口、模式） |
| GET | `/api/web-proxy/resolve?url=` | 公开 | 把真实 URL 转成代理 URL |
| POST | `/api/web-proxy/start` | 管理员 | 手动启动 |
| POST | `/api/web-proxy/stop` | 管理员 | 手动停止 |

代理本身不经过 `/api` 前缀，直接监听独立端口：

```
http://<host>:9005/                    代理首页（状态页）
http://<host>:9005/https/example.com/  经代理访问 example.com
http://<host>:9005/http/example.com/   经代理访问 http 站点
```

兼容 iFlyCompass 的 `getassets/<scheme>/<host>/<path>` 形态。

## 超能岛浏览器接入

1. `index.html` 预取 `/api/web-proxy/status`，把代理地址写入 `window.__WEB_PROXY__`
2. `Browser` 组件的 `navigateTo` 在判断为外网站点时改写为代理 URL：
   - `currentUrl`（iframe `src`）= 代理地址
   - `urlText`（地址栏显示）= 原始地址
   - 历史记录与书签保存原始地址
3. 被代理页面上报真实地址后，地址栏与标题同步更新

判定规则（`shouldProxy`）：

- 不是 `http/https` → 不代理
- `campusbili` 或端口 `9002` → 不代理（走原有 CampusBili 桥接）
- 与 ClassIntra 同主机名 → 不代理（内部页面）
- 已经是代理地址 → 不代理（避免二次包装）
- 其余外网站点 → 代理

## 安全响应头处理

代理服务器会自动剥离以下安全响应头，防止目标站点的安全策略干扰代理渲染：

| 响应头 | 说明 |
| --- | --- |
| `X-Frame-Options` | 禁止 iframe 嵌入 |
| `Content-Security-Policy` | CSP 策略 |
| `Content-Security-Policy-Report-Only` | CSP 报告模式 |
| `X-Content-Type-Options` | MIME 类型嗅探防护 |
| `Referrer-Policy` | 引用策略 |
| `Permissions-Policy` | 权限策略 |
| `Cross-Origin-Opener-Policy` | COOP |
| `Cross-Origin-Embedder-Policy` | COEP |
| `Cross-Origin-Resource-Policy` | CORP |
| `X-XSS-Protection` | XSS 过滤 |
| `X-Download-Options` | 下载选项 |
| `X-Permitted-Cross-Domain-Policies` | 跨域策略 |

同时剥离以下 CORS 响应头，防止跨域限制：

| 响应头 |
| --- |
| `Access-Control-Allow-Origin` |
| `Access-Control-Allow-Methods` |
| `Access-Control-Allow-Headers` |
| `Access-Control-Allow-Credentials` |
| `Access-Control-Max-Age` |
| `Access-Control-Expose-Headers` |
| `Access-Control-Request-Method` |

## meta 标签处理

- `<meta http-equiv="refresh" content="0;url=...">` — 重写 URL 为代理地址
- `<meta http-equiv="Content-Security-Policy" content="...">` — 剥离
- `<meta http-equiv="X-Frame-Options" content="...">` — 剥离
- `<meta http-equiv="Content-Security-Policy-Report-Only" content="...">` — 剥离

## 端口

默认 `9005`，被占用时自动顺延到 `9006`–`9009`。局域网内其他设备访问时，
需在宿主机手动放行该端口（本插件包内不含防火墙配置脚本）。

## 安全说明

- **监听范围**：代理默认监听 `0.0.0.0:9005`，即对**本机所在局域网内的所有主机**开放。
  这样同网段的其他设备也能经代理访问外网；请**勿把 9005 端口映射到公网**，
  必要时可在防火墙层限制来源网段。
- **上游 TLS 校验**：默认**开启**（`rejectUnauthorized: true`），HTTPS 站点由 Node 客户端
  直连上游并校验证书链，不拦截、不解密。仅在目标站点使用自签证书 / 证书异常导致无法代理时，
  才可显式设置 `WEB_PROXY_INSECURE_TLS=1` 降级为不校验——这是异常场景的兼容降级，
  正常环境不生效，请勿长期开启。
- **凭据风险**：页面经代理渲染，**请勿用"记住密码"的方式登录银行 / 支付类站点**。
- **运行控制**：推荐在应用市场「服务端插件」中暂停/恢复（即时生效、无需重启）；亦可用 `WEB_PROXY_AUTOSTART=0` 关闭随启动自动运行（改为经管理接口手动启动）。

## 已知限制

- GBK/GB2312 页面统一按 UTF-8 输出并同步修正 `charset` 声明
- 内联脚本只改写 `"https://..."` 字符串字面量，不修改业务逻辑
- 页面若使用 Service Worker 自行拦截请求，其作用域仍在代理域下，可能影响部分离线站点
- 单响应体超过 12MB 时退化为透传（不再改写）
- 多个站点共用同一代理域：Cookie 已按 `/https/<host>` 路径隔离，但 `localStorage` 仍共享，
  少数强依赖 `localStorage` 的站点可能出现串号；同时登录多个站点不建议
- 目标站点使用自签证书 / 证书链异常时默认会代理失败；此时可设置 `WEB_PROXY_INSECURE_TLS=1` 降级（降低安全性）
- 页面自带的"禁止被 iframe 嵌入"脚本（framebuster）无法完全绕过，个别站点仍会跳转

## 出处与致谢

- **开发者**：本插件由 **yujing0208**（<https://github.com/yujing0208>）开发并贡献至 ClassIntra 插件市场。
- **iFlyCompass** —— 来源：<https://github.com/MoyuZJ912/iFlyCompass>；
  许可：**GNU General Public License v3.0（GPL-3.0）**；
  用途：兼容其 `getassets/<scheme>/<host>/<path>` 代理地址形态（见 `backend/proxy-server.js` 的 `parseTarget`），
  并参考其"服务端改写 + 客户端 hook"的整体思路；
  是否复制：本项目为纯 Node 实现，**未复制其源码与素材**，仅借鉴地址约定与思路，故不受 GPL-3.0 传染。
  按 ClassIntra 约定，涉及 iFlyCompass 参考内容时保留本致谢。
- **ClassIntra** —— 宿主平台，提供插件运行时、超能岛浏览器宿主与联动契约（`shared/contract.js`，协议 1.0）。
