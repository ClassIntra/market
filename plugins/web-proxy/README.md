# 网页代理（web-proxy）

内置网页代理服务插件。把任意外网站点经本机代理转发，并在响应阶段重写页面内的资源链接，
使 **超能岛浏览器** 可以正常打开被防盗链、跨域、`X-Frame-Options` 或 `CSP` 限制的站点。

- **纯 Node 实现**：不依赖 Python / mitmproxy / 浏览器扩展，随便携包一起运行
- **默认随启动自动运行**：插件被加载即启动代理，无需手工操作；管理员可在应用市场「服务端插件」中随时暂停或恢复（暂停后接口即时下线，无需重启）
- **手动开关（1.0.26+）**：默认**直连**，需要时点浏览器工具栏的「闪电」按钮才让当前站点经代理转发（按账号记忆偏好）；CampusBili 与 ClassIntra 自身页面始终直连

## 架构

```
超能岛浏览器 iframe
        │  src = http://<classintra-host>:9101/https/example.com/page
        ▼
web-proxy (Node http server, 0.0.0.0:9101)
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
│   ├── hook.js                   # 注入被代理页面的客户端脚本（拦截 XHR/fetch/WebSocket/window.open/history、MutationObserver）
│   ├── render.js                 # 兼容模式渲染引擎（CDP + 系统 Edge/Chrome + JPEG 帧流 + 输入回灌）
│   ├── audio-inject.js           # 兼容模式页面内音频采集脚本（24kHz 单声道 PCM）
│   └── access.js                 # 兼容模式「可使用者」设置（全班 / 白名单，存 server/database）
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
| GET | `/api/web-proxy/sessions` | 班管 / 管理员 | 会话列表 + 可使用者设置 |
| POST | `/api/web-proxy/sessions/:id/close` | 班管 / 管理员 | 断开单个会话 |
| POST | `/api/web-proxy/sessions/close-all` | 班管 / 管理员 | 断开全部会话 |
| GET | `/api/web-proxy/access` | 班管 / 管理员 | 读取「可使用者」设置 |
| POST | `/api/web-proxy/access` | 班管 / 管理员 | 保存「可使用者」设置 |
| GET | `/api/web-proxy/users?q=` | 班管 / 管理员 | 搜索成员（昵称 / 姓名 / 学号） |
| GET | `/api/web-proxy/browser-data` | 登录用户 | 读取本人的历史 / 收藏 / 首页（跨设备同步） |
| POST | `/api/web-proxy/browser-data` | 登录用户 | 合并保存本人的历史 / 收藏 / 首页 |

代理本身不经过 `/api` 前缀，直接监听独立端口：

```
http://<host>:9101/                    代理首页（状态页）
http://<host>:9101/https/example.com/  经代理访问 example.com
http://<host>:9101/http/example.com/   经代理访问 http 站点
```

兼容 iFlyCompass 的 `getassets/<scheme>/<host>/<path>` 形态。

## 超能岛浏览器接入

1. `index.html` 预取 `/api/web-proxy/status`，把代理地址写入 `window.__WEB_PROXY__`
2. 工具栏「闪电」按钮为**手动代理开关**（默认关闭 = 直连，偏好按账号存 `proxy-enabled`）。
   开启后 `Browser` 组件的 `navigateTo` 才把可代理地址改写为代理 URL：
   - `currentUrl`（iframe `src`）= 代理地址
   - `urlText`（地址栏显示）= 原始地址
   - 历史记录与书签保存原始地址
3. 被代理页面上报真实地址后，地址栏与标题同步更新
4. 兼容模式本身不经过代理改写，因此开关在兼容模式下隐藏

判定规则（`canProxyUrl`，仅决定「是否**可以**代理」，是否真的代理由开关决定）：

- 不是 `http/https` → 不可代理
- `campusbili` 或端口 `9002` → 不可代理（走原有 CampusBili 桥接）
- 与 ClassIntra 同主机名 → 不可代理（内部页面）
- 已经是代理地址 → 不可代理（避免二次包装）
- **局域网 / 内网地址不再强制直连**——是否多绕一层由使用者自己决定

兼容模式入口（`compatCapable`）只要求页面是 `http/https`：
**局域网 / 内网地址同样显示兼容按钮**（渲染浏览器运行在服务器侧，通常就在同一内网）。

## 浏览器数据跨设备同步（1.0.22+）

超能岛浏览器的历史 / 收藏 / 首页此前只存在设备本地 `localStorage`，同一账号换台设备
（手机 → 平板 → 教室电脑）就看不到自己之前的记录。1.0.22 起按账号存到服务端：

- 存储位置：`server/database/web-proxy-browser-data.json`（与 SQLite 同目录，随数据备份；
  插件更新整体替换 `plugins/web-proxy` 目录时不会丢）
- 写入语义：新增记录**按 url 合并**而不是整包覆盖——历史保留较新的浏览时间，收藏保留最早的收藏时间，
  避免 A 设备上传时把 B 设备刚加的记录冲掉
- 删除语义：删历史 / 取消收藏时前端提交「删后的完整列表」并带 `replaceHistory` / `replaceBookmarks`，
  服务端按整表替换；拉取时用服务端 `updatedAt` 判断别处是否改过，改过则以服务端为准、只保留本机
  在那之后新产生的记录，因此删除也会同步到其他设备，不会被并集合并复活
- 首次同步：本机已有旧记录而服务端为空（或别处没有这些记录）时一次性补传上云，避免「本机有、别处没有」
- 前端：登录后进入浏览器即拉取一次；本地变更防抖 1.2 秒上传；窗口重新获得焦点时再拉取一次
  （5 秒节流），所以另一台设备的改动切回来就能看到
- 未登录（guest）不参与同步，仍只走设备本地存储；断网 / 插件未安装时本地缓存照常可用

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

默认 `9101`，被占用时自动顺延到 `9102`–`9105`。可用环境变量 `WEB_PROXY_PORT` 覆盖。
该段（`9100–9199`）是 ClassIntra 第三方应用/插件专用段，从 `9101` 起分配，
不得占用 `9000–9099` 自研主服务段（见仓库 `docs/PORT-REGISTRY.md` §2.3）。
局域网内其他设备访问时，
需在宿主机手动放行该端口（本插件包内不含防火墙配置脚本）。

## 安全说明

- **监听范围**：代理默认监听 `0.0.0.0:9101`，即对**本机所在局域网内的所有主机**开放。
  这样同网段的其他设备也能经代理访问外网；请**勿把 9101 端口映射到公网**，
  必要时可在防火墙层限制来源网段。
- **上游 TLS 校验**：默认**开启**（`rejectUnauthorized: true`），HTTPS 站点由 Node 客户端
  直连上游并校验证书链，不拦截、不解密。仅在目标站点使用自签证书 / 证书异常导致无法代理时，
  才可显式设置 `WEB_PROXY_INSECURE_TLS=1` 降级为不校验——这是异常场景的兼容降级，
  正常环境不生效，请勿长期开启。
- **凭据风险**：页面经代理渲染，**请勿用"记住密码"的方式登录银行 / 支付类站点**。
- **渲染浏览器隔离**：兼容模式按账号使用独立的临时 profile（未登录为 `%TEMP%\classintra-render-profile`，登录用户为 `%TEMP%\classintra-render-profile-u<用户ID>`），不同账号的 Cookie / 登录态 / 本地存储互不相通；该 profile 与用户日常浏览器完全隔离。为采集跨域 CDN 音源，渲染实例开启了 `--disable-web-security`（关闭同源策略），因此**同一账号**的无头实例内不保证同源隔离——仅用于渲染兜底页面，请勿在该模式内登录敏感账号。
- **运行控制**：推荐在应用市场「服务端插件」中暂停/恢复（即时生效、无需重启）；亦可用 `WEB_PROXY_AUTOSTART=0` 关闭随启动自动运行（改为经管理接口手动启动）。

## 兼容模式（无头渲染，1.0.6+）

少数站点（腾讯、网易等）会返回 JS 挑战页 / WAF 拦截页，纯静态改写无法通过。
兼容模式复用**系统已安装的 Edge / Chrome**，以 headless 方式真实执行页面脚本，
再把画面以 JPEG 帧流推给前端 `<canvas>`，并把鼠标 / 滚轮 / 键盘输入回灌给浏览器。

- **零额外体积**：不下载 Chromium，不新增依赖（`ws` 已随 server 提供）
- **按需启用**：仅当某站点普通模式打不开时，在浏览器工具栏点「兼容」按钮切换
- **自适应视口**：视口按前端可用区域下发（宽 320–1600、高 320–1200）；触摸设备自动切移动 UA + 触摸仿真 + `mobile` 布局
- **通道**：`ws://<host>:<port>/__render__?url=<目标地址>&w=<宽>&h=<高>&dpr=<倍率>&touch=1&uid=<用户ID>&uname=<昵称>&token=<登录令牌>&mode=normal|game`，首帧前下发 `{type:'ready'}`（含实际视口尺寸 `width/height`、画布尺寸 `baseWidth/baseHeight`、触摸标记、`game` 与 `dpr`）。`token` 由服务端 `jwtUtil.verifyToken` 校验后取**真实** `user_id`，用于「可使用者」白名单判断；渲染通道在独立端口，浏览器不会自动带 cookie，只能放在 query 里。`uid` 决定使用哪个账号的浏览器 profile（缺省为 guest），`uname` 仅用于班管查看使用情况；无 token 的旧客户端回退使用 `uid`（1.0.18+）
- **会话上限**：默认 3 个（单个渲染实例实测约 500MB）；无会话空闲 90 秒后自动关闭对应账号的浏览器进程（1.0.14+，尽早归还内存与后台进程，冷启动 2–3 秒）
- **按账号隔离 profile（1.0.17+）**：每个账号一个独立 `--user-data-dir` 的浏览器实例，账号内多标签页共用同一实例；不同账号的 Cookie / 登录态 / 本地存储互相隔离。同时保留的实例数上限 3（`MAX_PROFILES`），超限时优先回收最久未用且无会话的实例。profile 目录跨服务重启保留，同一账号下次打开仍保持登录态。**同一账号在不同设备上打开兼容模式时用的是同一份服务端 profile**（目录按账号 ID 命名，不区分设备），因此站点登录态 / Cookie / 页面 localStorage 天然跨设备同步
- **输入协议**：`mouse`（mouseMoved/Pressed/Released）、`wheel`、`touch`（start/move/end/cancel，**支持多指**：`points` 数组每根手指一个稳定 `id`，服务端按 id 集合差集合成各指动作）、`pinch`（页面缩放，增量倍率）、`text`、`key`、`navigate`、`reload`、`back`、`forward`、`resize`
- **页内导航**：兼容模式内跳转复用同一会话（保留页内历史，比重新建会话快）；服务端回传 `{type:'history'}` 告知前进/后退是否可用，顶部返回到首站后才退出浏览
- **刷新**：地址栏地址未变化时「转到」按钮自动变为「刷新」，不额外占用工具栏；`reload` 保留会话与历史
- **视口自适应**：前端监听可用区域尺寸（手机旋转 / 窗口缩放），防抖后下发 `resize`；服务端重设视口并重开帧流，回传 `{type:'resized'}`
- **标题同步**：页面加载后回传 `{type:'title'}`（及 `history.title`），分享到聊天 / 社区时带上真实标题
- **移动端文字输入**：画面流无法唤起系统键盘。点到页面输入框时服务端下发 `{type:'focus'}`，前端自动展开中转输入条；也可点右下角悬浮键盘按钮手动展开（输入法组合结束后一次性插入，空内容退格转发为按键）
- **声音（1.0.9+，1.0.13 提升音质，1.0.15 改页面级静音）**：兼容模式默认静音。工具栏「声音」按钮开启后，服务端在页面内注入采集脚本，把 `<audio>/<video>` 媒体与 Web Audio 图输出的声音降采样为 **24kHz 单声道 PCM（每包 1024 帧，约 43ms）**，经同一 WS 通道以 `{type:'audio', rate, data}` 回传，前端用 Web Audio 排期播放；关闭即停止采集。页面刷新 / 页内跳转后由服务端自动重启采集（`Page.loadEventFired` + 新执行上下文），无需重新点开关
- **声音协议**：客户端发 `{type:'audio', enabled:true|false}`；服务端回 `{type:'audio-state', enabled, available, rate}`，`available:false` 表示当前页面环境采集不可用，前端按钮自动置灰
- **后台暂停**：页面切到后台 / 手机锁屏时前端下发 `pause`，服务端停止 screencast 与声音采集；回到前台下发 `resume` 自动恢复，避免后台空转编码帧；后台被回收后回到前台会自动重建会话
- **帧积压丢弃（1.0.12+）**：客户端 WS 缓冲超过 1.5MB 时直接丢弃当前帧（触摸会话降到 700KB），仍回 ACK 让浏览器继续渲染；宁可丢中段帧也保证最新画面到达，避免旧帧排队造成「越看越延迟 / 滑不动」
- **自适应画质（1.0.11+，1.0.14 起只管画质）**：每 2 秒统计一次丢帧比例，持续丢帧（≥25%）自动降一档（画质 55→48→40），连续 12 秒不丢帧再逐档回升。帧率不再随画质降档，改由下面的按需帧率控制
- **按需帧率（1.0.14+）**：触摸 / 鼠标 / 滚轮 / 键盘输入后 1.5 秒内以 60fps（`everyNthFrame=1`）出帧保证跟手，静置后降到 30fps（`everyNthFrame=2`）；只在档位真正变化时才重开 screencast，切换实测最大帧间隔约 50ms，无可见卡帧。静置时帧数与带宽减半（30 秒动画页实测 1756→880 帧）
- **媒体在播保持高帧率（1.0.14+）**：每 3 秒轻量查询页面 `video,audio` 是否在播（`!paused && !ended && readyState>2`），在播则把高帧率窗口续期 5 秒，避免视频 / 音乐被抽帧成 15fps；播完自然回落 30fps
- **云游戏画质（1.0.18+，1.0.23 改为 2 倍合成表面）**：工具栏「云游戏」按钮**热切换**，不重建会话（保留页面与滚动位置）。开启后 JPEG 质量 92（普通 55）、恒定 60fps（不再静置降帧）、在途帧缓冲放宽到 6MB，并跳过自适应降档（避免画面忽清忽糊）。**清晰度与排版尺寸彻底解耦**：渲染浏览器以 `--force-device-scale-factor=2` 启动，合成表面恒为视口 CSS 像素的 2 倍；云游戏模式把 screencast 的 `maxWidth/maxHeight` 给到 2 倍（夹在 3840×2160 内等比收缩）即可拿到原生 2 倍帧，而**视口宽度 / 媒体查询 / 字号 / 输入坐标与普通模式完全一致**（实测 400×700 视口：普通模式帧 400×700，云游戏帧 800×1400，两种模式下 `innerWidth / clientWidth / 正文 14px / max-width:400px 媒体查询` 全部相同）。普通模式仍按视口尺寸取帧，Chromium 自动把 2 倍表面缩回 1 倍，带宽基本不变（实测 JPEG 体积相当）。历史教训：1.0.19–1.0.22 为了「高清」把视口按 `pd` 放大，站点因此切到桌面版排版、文字整体变小，前端再把帧缩回画布，观感就是「开了更高画质反而看不清」，1.0.23 起废弃该做法。切换协议：客户端 `{type:'mode', game:true|false, dpr}`，服务端回 `{type:'mode-state', game, dpr, width, height, frameWidth, frameHeight, quality, fps}`（`width/height` 为排版视口，`frameWidth/frameHeight` 为帧真实像素）
- **输入按帧合并**：指针移动与滚轮增量按 `requestAnimationFrame` 合并，高频触控板采样不再逐事件过通道；触摸移动改为**逐条直发**（单指位移阈值 1px，多指每帧全量上报），**抬手不再补甩动惯性（1.0.24 起）**：CDP 触摸序列进页面后浏览器自己会算出惯性，前端再补一段 6 步补间就会叠加成「划一点却滑出去很远」的飘移，抬手只发 `touchend` 即止
- **画面帧二进制传输（1.0.12+）**：服务端把 screencast 的 base64 JPEG 解码一次后以二进制 WS 帧下发，前端直接 `createImageBitmap`，省掉客户端逐字节 `atob` 转换——这是此前大帧阻塞主线程、触摸事件排队的主因
- **宿主静音（1.0.12+，1.0.15 重做）**：页面声音只经采集管道回传给学生的手机，教室电脑扬声器不出声。1.0.15 起不再用浏览器启动参数 `--mute-audio`（该参数会让 Chromium 以「静音会话」占用系统音频端点，在部分 Windows 驱动 / 蓝牙耳机上会把**整台电脑**的音频一起拉哑），改为页面内静音：媒体元素在属性层强制 `muted`，页面 WebAudio 的扬声器出口改接 0 增益节点。实测两者都不影响 `captureStream` / 旁路采集（已用 440Hz 音源 + 660Hz 振荡器端到端验证，采集电平不变）
- **不再触碰系统音频端点（1.0.15+）**：采集上下文使用设备默认采样率（不再强制 24kHz，避免驱动重新协商格式），关闭声音时只断开采集接线、**不挂起 AudioContext**（挂起会让浏览器关闭音频输出流，部分驱动反复开关流后会把默认播放设备卡在无声状态）。降采样到 24kHz 回传在采集脚本内完成
- **后台标签不节流（1.0.12+）**：`--disable-background-timer-throttling` / `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` 保证多会话共存时每个标签持续合成，不再出现「画面停在上一帧」
- **GPU 合成与焦点仿真（1.0.13+）**：渲染浏览器不再强制 `--disable-gpu`（headless=new 支持 GPU 合成，驱动不可用时 Chromium 自动回退软件渲染），并开启 `Emulation.setFocusEmulationEnabled`——无头标签默认被视为「未聚焦」会压低动画 / 定时器频率，开启后页面跑满帧率。实测动画页稳定 59fps
- **丢帧后主动补拍（1.0.13+）**：积压时丢的是旧帧，页面停手后不再出帧，屏幕会停在滑动中途的旧位置（主观就是「卡住」）。服务端标记 `needRefresh`，等发送缓冲回落到低水位后用 `Page.captureScreenshot` 补拍一张最新 JPEG，保证松手 / 动画结束后的最终画面一定到达
- **长按手势（1.0.24+）**：单指按住 600ms 且位移不超过原生 touch slop（8 CSS px）判为长按，前端下发 `{type:'longpress', x, y}`。服务端先读注入探针记录的 `window.__ciCtxAt`：1.5 秒内页面**已自行响应**过 `contextmenu` 就不再补，否则补一次右键（`Input.dispatchMouseEvent` 的 right `mousePressed` / `mouseReleased`），并回 `{type:'longpress-state', fired}` 告知前端。触发后本次手势的移动先冻结，避免刚弹出的菜单被后续 move 拖走；但位移超过 24px 说明用户其实想继续拖，此时自动解冻恢复转发（否则页面会一直卡到抬手）。抬手用 `touchCancel` 收尾——否则合成的 `touchend` 会再点一下，把刚弹出的菜单点掉。**云游戏模式不参与长按**（那里长按就是按住开火 / 蓄力键，冻结会造成「黏一下」的顿感）；长按触发后若用户再落下第二根手指，长按状态会整体复位，不会把后续移动全部吞掉。连续长按由页面内的 `window.__ciCtxMark()` 标记区分：自己补的右键触发的那次 `contextmenu` 不会被算成「页面已处理」
- **多指直通（1.0.20+）**：**1~2 指原样转发**给页面（每根手指独立 `id`），云游戏「左手摇杆 + 右手按键」可以同时按住；**3 指及以上**才转为页面缩放。此前 2 指就被吞成捏合，页面从未收到第二根手指，表现为「不支持多点触摸」。部分抬起时只上报剩余手指，服务端按 id 差集只抬起离开的那根；多指序列不做甩动惯性（避免两指交替滑动把页面甩飞）
- **页面缩放（1.0.13+，1.0.20 起改为三指及以上）**：前端识别指距变化并按增量下发 `{type:'pinch', x, y, scaleFactor}`（累计变化 <2% 或间隔 <50ms 不下发）；服务端累计为绝对倍率后用 `Emulation.setPageScaleFactor` 应用（1–3 倍）。无头环境里 `Input.synthesizePinchGesture` 实测不改变 `visualViewport.scale`，故不采用
- **断线重连**：通道异常断开（切网 / 服务端回收）时自动重建会话（间隔 0.6s，最多两次），无需手动刷新
- **能力探测**：`GET /api/web-proxy/status` 的 `data.render.available` 为 `true` 时前端才展示入口
- **浏览器启动发现（1.0.12+）**：先按 profile 下的 `DevToolsActivePort` 探活并复用仍存活的渲染浏览器，探活失败才冷启动。新版 Edge/Chrome 在已有实例时会把启动请求转交给子进程并立即退出（code 0），且不再向 stderr 输出 `DevTools listening on`——只解析日志会把这种情况误判成启动失败
- **不影响主链路**：渲染引擎加载失败或浏览器缺失时只在日志提示，普通代理照常工作

## 兼容模式使用管理（1.0.16+）

- **入口**：应用市场 → 插件 → 已安装插件 → 网页代理卡片上的「管理」按钮。仅班管 / 管理员可见；插件暂停时入口隐藏
- **浮窗内容**：代理运行状态、会话数 / 上限、兼容浏览器是否可用；每个会话展示使用者昵称（缺失时显示「未知用户」）、站点 URL、已用时长、声音开 / 关
- **管理动作**：单个「断开」或「全部断开」。断开后对应成员需要重新打开兼容模式；无操作 3 分钟的会话仍由服务端自动回收
- **刷新**：浮窗打开期间每 3 秒拉取一次，关闭或离开页面即停止
- **接口与权限**：`GET /api/web-proxy/sessions`、`POST /api/web-proxy/sessions/:id/close`、`POST /api/web-proxy/sessions/close-all`，均要求登录且为班管 / 管理员；未授权返回 401/403
- **身份来源**：前端建立兼容 WS 时带上 `uid` / `uname`，服务端仅存入会话用于展示

### 可使用者（1.0.18+）

- **入口**：同一个「管理」浮窗内的「可使用者」区域，两种模式：
  - **全部成员**（默认）：全班都能使用兼容模式
  - **仅指定成员**：只放行白名单内的成员，支持按昵称 / 姓名 / 学号搜索后勾选，已选成员以标签形式展示、可单个移除
- **保存即生效**：点「保存」后立即写入，正在使用的会话不受影响（下次连接时校验）；未保存的编辑不会被 3 秒轮询覆盖
- **管理员与班管始终可用**：即使把白名单设为空，班管 / 管理员仍可进入，避免把自己锁在兼容模式之外
- **存储位置**：`server/database/web-proxy-access.json`，只保存用户 ID 与昵称，不含凭据。**刻意不放在插件目录内**——应用市场更新插件时会整体替换 `plugins/web-proxy`，目录内配置会被清掉
- **握手校验**：WS 握手在独立端口、不经过 Express 中间件，因此由 `render.js` 自行校验 query `token`（`jwtUtil.verifyToken` 取真实 `user_id`）再按白名单放行；未授权时下发 `{type:'error'}` 并立即关闭通道。无 token 的旧客户端回退使用 `uid`，此时以 URL 自报身份为准（不可信，仅用于兼容）
- **相关接口**：`GET` / `POST /api/web-proxy/access`、`GET /api/web-proxy/users?q=`，均要求登录且为班管 / 管理员；白名单上限 200 人

## 资源占用（实测，40 逻辑核开发机）

| 场景 | 渲染进程数 | 工作集内存 | CPU |
|------|-----------|-----------|-----|
| 无会话（空闲 90 秒后回收） | 0 | 0 | 0% |
| 静态页面 | 9 | 约 490MB | 0% |
| 动画页面 30fps（静置） | 9 | 约 500MB | 约 3% |
| 动画页面 60fps（操作中） | 9 | 约 500MB | 约 3% |

实测表明 CPU 主要花在页面自身的合成上，抽帧到 30fps 只略微降低 CPU，但能把
出帧数与带宽实打实减半（30 秒动画页 1756 → 880 帧），客户端解码与网络开销同步下降。
无会话时渲染浏览器 90 秒后退出，不长期占用内存与后台进程。

## 已知限制

- 兼容模式为**少数站点兜底**：画面为帧流（非完整视频），滚动/动画流畅度低于直连；会话总数上限 3
- **按账号隔离的代价（1.0.17+）**：同时活跃多个账号时，每个账号各占一个渲染实例（约 500MB），内存按活跃账号数线性增长；profile 目录会保留在系统临时目录，长期使用后可定期清理 `%TEMP%\classintra-render-profile*`（清理后对应账号需重新登录目标站点）
- 画面按**帧像素尺寸**编码：排版视口恒等于画布尺寸（普通模式与云游戏模式一致，站点排版 / 媒体查询 / 输入坐标不随画质开关变化）；普通模式帧 = 视口像素，云游戏帧 = 视口像素 × 2（受浏览器进程的 2 倍合成表面约束，编码尺寸上限 3840×2160，超限等比缩小）
- **云游戏画质的代价（1.0.23+）**：2 倍帧 + JPEG 质量 92 + 恒 60fps，像素数与编码 CPU / 带宽约为普通模式的 4 倍；渲染浏览器进程以 2 倍合成表面运行，普通模式也会多一次 2 倍→1 倍降采样（实测带宽基本不变），内存 / 合成开销略有上升。清晰度上限为 2 倍——`--force-device-scale-factor` 是进程级启动参数，所有会话共享，不能按设备单独调到 3 倍；建议在局域网 / 内网条件下开启，公网弱网更容易积压丢帧。切换后画面底部会给出实际帧尺寸（如 `800×1400 · 60fps`）作为回执
- GBK/GB2312 页面统一按 UTF-8 输出并同步修正 `charset` 声明
- 内联脚本只改写 `"https://..."` 字符串字面量，不修改业务逻辑
- 页面若使用 Service Worker 自行拦截请求，其作用域仍在代理域下，可能影响部分离线站点
- 单响应体超过 12MB 时退化为透传（不再改写）
- 多个站点共用同一代理域：Cookie 已按 `/https/<host>` 路径隔离，但 `localStorage` 仍共享，
  少数强依赖 `localStorage` 的站点可能出现串号；同时登录多个站点不建议
- 目标站点使用自签证书 / 证书链异常时默认会代理失败；此时可设置 `WEB_PROXY_INSECURE_TLS=1` 降级（降低安全性）
- 页面自带的"禁止被 iframe 嵌入"脚本（framebuster）无法完全绕过，个别站点仍会跳转
- 兼容模式声音为 24kHz 单声道 PCM 回传，延迟约 0.1–0.25 秒，音画同步要求极高的场景体验有限
- 受 DRM（Widevine 等）保护的音视频无法采集：无头浏览器不具备受保护媒体解码能力
- 兼容模式内页面被强制静音（宿主扬声器不出声），镜像画面里的播放器音量图标会显示为静音状态，属预期行为
- 极少数直接用 Web Speech API（`speechSynthesis`）朗读的页面不受静音与采集覆盖，这类页面在兼容模式下不会出声

## 出处与致谢

- **开发者**：本插件由 **yujing0208**（<https://github.com/yujing0208>）开发并贡献至 ClassIntra 插件市场。
- **iFlyCompass** —— 来源：<https://github.com/MoyuZJ912/iFlyCompass>；
  许可：**GNU General Public License v3.0（GPL-3.0）**；
  用途：兼容其 `getassets/<scheme>/<host>/<path>` 代理地址形态（见 `backend/proxy-server.js` 的 `parseTarget`），
  并参考其"服务端改写 + 客户端 hook"的整体思路；
  是否复制：本项目为纯 Node 实现，**未复制其源码与素材**，仅借鉴地址约定与思路，故不受 GPL-3.0 传染。
  按 ClassIntra 约定，涉及 iFlyCompass 参考内容时保留本致谢。
- **ClassIntra** —— 宿主平台，提供插件运行时、超能岛浏览器宿主与联动契约（`shared/contract.js`，协议 1.0）。
