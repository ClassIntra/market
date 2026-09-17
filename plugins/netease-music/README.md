# 网易云音乐接入插件（netease-music）

为 ClassIntra 音乐应用提供网易云在线曲库能力。核心目标：**内网环境下可用** —— 客户端零外网依赖，全部网易云流量由 ClassIntra 服务器中转。

## 功能

| 能力 | 说明 |
|------|------|
| 搜索 | 单曲 / 专辑 / 歌手 / 歌单，关键词联想 |
| 播放 | 服务端取真实播放地址后同源中转（`/stream`），支持 Range 拖动、磁盘缓存 |
| 歌词 | 原文 + 翻译 |
| 红心收藏 | 云端红心 + 本地 SQLite 镜像（离线可查） |
| 歌单 | 我的网易云歌单、歌单详情、全部歌曲（分页） |
| 推荐 | 每日推荐歌曲、推荐歌单、排行榜 |
| 扫码登录 | 二维码由**内置编码器**生成（离线可用），登录态按系统用户隔离存储 |
| 离线回退 | 接口缓存 stale 兜底；收藏列表走本地镜像 |
| 引擎 | `builtin`（内置协议实现）/ `upstream`（转发上游 NCM API 服务）/ `auto` |

## 架构

```
plugins/netease-music/
├── manifest.json
└── backend/
    ├── routes.js        # HTTP 端点（挂载 /api/netease-music）
    ├── gateway.js       # 引擎选择（builtin/upstream/auto）+ 缓存 + 降级 + 用户上下文
    ├── store.js         # SQLite 存储层（登录态 / 缓存 / 配置 / 收藏镜像）
    ├── stream.js        # 音频（Range + 磁盘缓存）与图片中转
    └── ncm/             # 内置网易云协议实现（仅 Node 内置模块，零依赖）
        ├── crypto.js    # weapi / eapi 加密（移植自 api-enhanced）
        ├── engine.js    # HTTP 引擎（直连 / 代理 / cookie 处理 / 响应解析）
        ├── api.js       # 接口封装（搜索 / 详情 / 播放地址 / 收藏 / 登录…）
        └── qrcode.js    # 自研二维码编码器（字节模式，v1-10，已与 qrcode 库对拍验证）
```

数据表（主库 `classintra.db`，自动建表）：

- `netease_accounts` — 每个系统用户的网易云登录态（cookie / profile）
- `netease_cache` — 接口响应缓存（各端点独立 TTL；播放地址 12 分钟 < 官方 20 分钟有效期）
- `netease_config` — 插件配置
- `netease_likes` — 本地收藏镜像（歌 ID + 元数据快照）

## 配置（管理端 `POST /api/netease-music/admin/config`）

| 键 | 默认 | 说明 |
|----|------|------|
| `engine` | `auto` | `builtin`：本机直连网易云；`upstream`：转发上游；`auto`：builtin 失败回退 upstream |
| `upstreamUrl` | 空 | upstream 模式的上游地址（api-enhanced / NeteaseCloudMusicApi 兼容服务） |
| `proxy` | 空 | 服务器出站 HTTP(S) 代理（可选） |
| `quality` | `standard` | 音质：`standard/higher/exhigh/lossless/hires` |
| `cacheEnabled` | `1` | 接口响应缓存 |
| `audioCache` | `1` | 音频磁盘缓存（`server/database/netease-cache/`） |
| `audioCacheMaxMB` | `512` | 音频缓存上限，超出按最久未使用清理 |
| `requestTimeout` | `8000` | 上游请求超时（毫秒） |

## 前端接入

音乐应用（`apps/music`）在「在线音乐」标签下使用本插件 API：

- 搜索：`GET /api/netease-music/search?keywords=`
- 播放：`GET /api/netease-music/song/url?id=`（返回同源 `/stream` 地址，`<audio>` 直接可播）
- 红心：`POST /api/netease-music/like`
- 登录：`POST /api/netease-music/login/qr/create` + `GET /login/qr/check`

完整端点清单见 `backend/routes.js` 头部注释。
