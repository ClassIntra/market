# ClassIntra 插件目录

插件是 ClassIntra 的**独立扩展模块**，与应用（apps/）和主题（themes/）相互独立。

## 与应用的区别

| 维度 | 应用（apps/） | 插件（plugins/） |
|------|---------------|------------------|
| 前端页面 | 有（`frontend/`） | 无 |
| 后端路由 | 可选（`backend/`） | 必有（`backend/`） |
| 桌面图标 | 显示在桌面 | 不显示（category: hidden） |
| 小组件 | 可携带 widgets | 不携带 |
| manifest.type | `app` / `system` | `plugin` |
| 联动契约 | 无 | 可选（`integration` 字段） |

## 快速开始：30 秒生成新插件

```powershell
# 1. 一键生成插件骨架（manifest + 路由样板 + 开发指引）
node plugins/_sdk/init.js my-plugin --label "我的插件"

# 2. 语法检查
node --check plugins/my-plugin/backend/routes.js

# 3. 重启服务器（cd server; node src/app.js），访问 /api/my-plugin/status 验证挂载

# 4. 同步到 market 仓（主仓 .gitignore 忽略 plugins/，这步必须做）
.\scripts\sync-market.ps1 -Commit "feat: 新增 my-plugin 插件"
```

## 插件 SDK（plugins/_sdk/）

通用能力已抽取为共享 SDK，**新插件一律复用，勿复制实现**：

| 模块 | 能力 | 用法 |
|------|------|------|
| `backend/stream-relay.js` | `createRelay(options)` | 音频中转（Range 断点续传 + 磁盘缓存 LRU）+ 图片白名单透传 |
| | `createTicketKit(store, prefix)` | 一次性取流票据（弥补 `<audio>/<img>` 无法携带 Authorization 头） |
| | `proxyConnect / fetchRaw / httpGetJson` | 出站请求：HTTP CONNECT 代理隧道、http/https 双协议、302 跟随 |
| `backend/errors.js` | `PluginError(code, message, cause)` | 统一业务错误结构，路由层 sendError / e.code 判断天然兼容 |
| `init.js` | 插件脚手架 | `node plugins/_sdk/init.js <name> [--label "显示名"]` |

SDK 使用示例（netease-music/backend/stream.js 是完整的装配参考）：

```js
var sdk = require('../../_sdk/backend/stream-relay');

var relay = sdk.createRelay({
  getConfig: function () { return store.getConfig(); },  // 需含 proxy/audioCache/cacheDir 等
  imageHostAllow: /(^|\.)example\.cdn$/i,               // 图片白名单
  imageHeaders: { 'Referer': 'https://...' }            // 可选防盗链
});

var tickets = sdk.createTicketKit(store, 'streamticket:');
```

注意：`_sdk/` 目录没有 manifest.json，不会被宿主 manifest-loader 误扫描。

## 推荐样板（生成骨架已内置）

```js
// 统一响应：ok(res, data) → { code: 200, ...data }
// 统一错误：throw new PluginError(400, '中文提示')，由 wrap + sendError 兜底
// 鉴权：requireAuth（登录态）/ requireAdmin（管理员），req.user.user_id 取当前用户
```

## 调试与诊断（参考 netease-music/cli.js）

netease-music 插件带完整诊断 CLI，可作为新插件 CLI 的模板：

```bash
node plugins/netease-music/cli.js diag all                      # 全端点健康巡检（观察风控簇状态）
node plugins/netease-music/cli.js diag search '{"keywords":"周杰伦"}' --fresh
node plugins/netease-music/cli.js status                        # 配置摘要
node plugins/netease-music/cli.js config debug=1                # 开启详细日志（缓存命中/引擎回退/风控拦截）
node plugins/netease-music/cli.js cache list|get <key>|clear    # 缓存管理（含脏缓存检查）
```

CLI 免启动服务器、免 JWT_SECRET、按匿名上下文执行。

## 缓存规范（防脏数据事故）

- 响应缓存**成功才写入**：`store.cacheSetIfOk(key, payload, ttl)` 自动拦截负数 code（如 -462 风控）
- 读取侧同样拦截负数 code：防御历史脏缓存毒害整个 TTL 周期
- 票据等非响应体数据（无 code 字段）不受影响，用普通 `cacheSet`

## 双仓同步与版本号

- 主仓 `.gitignore` 忽略 `plugins/`，插件文件只进 market 仓（`D:\NetWork\Integration\market`）
- **改完插件必须同步**：`.\scripts\sync-market.ps1 -Commit "提交信息"`（自动防嵌套复制、跳过 node_modules；`-Health` 附带 b→o 检查）
- 插件 `manifest.json` 的 `version` **独立语义化递增**：功能新增 MINOR+1、Bug 修复 PATCH+1（与主仓 `server/version.json` 无关）
- 历史教训：双仓不同步会导致插件文件回退、运行时引用错乱（如 `engine is not defined` 事故），同步脚本是唯一防线

## 加载机制

- **后端**：`server/src/core/manifest-loader.js` 扫描 `plugins/*/manifest.json`，`route-aggregator.js` 按 `backend.mountPath` 挂载到 Express（支持 `rateLimit` / `extraBackends`）
- **前端桥接**：客户端通过 `client/src/integrations/<name>-client.js` re-export 插件桥接模块
- **前端聚合**：插件不参与前端 manifest 聚合（无路由页面）；应用内小组件归属 `apps/<name>/frontend/widgets/`

## 现有插件

| 插件 | 功能 |
|------|------|
| `netease-music` | 网易云音乐接入：服务器中转全部流量、抗风控级联、扫码登录、SQLite 缓存 + 离线回退 |
| `campusbili-bridge` | ClassIntra 与 CampusBili 联动（postMessage 契约驱动） |
| `astrbot-relay` | AstrBot 中继 |

## 联动架构（campusbili-bridge 示例）

campusbili-bridge 插件是 ClassIntra 与 CampusBili 之间联动的**单一职责入口**：

```
[ClassIntra Browser.vue]
        │
        ▼
[client/src/integrations/campusbili-bridge-client.js]  ← 客户端集成入口（re-export）
        │
        ▼
[plugins/campusbili-bridge/frontend/bridge.js]           ← 前端桥接模块（postMessage 封装）
        │
        ▼ postMessage（契约驱动）
        │
[CampusBili client/src/utils/classintra-bridge.js]      ← CampusBili 侧桥接工具
        │
        ▼
[CampusBili VideoView.vue]                              ← 业务页面
```

### 联动契约（shared/contract.js）

- **消息格式**：`{ type, v, source, action, payload, timestamp }`
- **来源标识**：`SOURCE_CLASSINTRA = 'classintra-browser'`、`SOURCE_CAMPUSBILI = 'campusbili'`
- **父→子动作**：request-mute / video-control / request-playback-status / request-page-info
