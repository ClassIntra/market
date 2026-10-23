# 网页代理（web-proxy）

内置网页代理服务插件。把任意外网站点经本机代理转发，并在响应阶段重写页面内的资源链接，
使 **超能岛浏览器** 可以正常打开被防盗链、跨域、`X-Frame-Options` 或 `CSP` 限制的站点。

- **纯 Node 实现**：不依赖 Python / mitmproxy / 浏览器扩展，随便携包一起运行
- **默认随启动自动运行**：插件被加载即启动代理，无需手工操作；管理员可在应用市场「服务端插件」中随时暂停或恢复（暂停后接口即时下线，无需重启）
- **自动启用**：超能岛浏览器打开外网站点时自动改走代理，内网与 CampusBili 保持直连

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
http://<host>:9101/                    代理首页（状态页）
http://<host>:9101/https/example.com/  经代理访问 example.com
http://<host>:9101/http/example.com/   经代理访问 http 站点
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
- **渲染浏览器隔离**：兼容模式使用独立的临时 profile（`%TEMP%\classintra-render-profile`），与用户日常浏览器完全隔离。为采集跨域 CDN 音源，渲染实例开启了 `--disable-web-security`（关闭同源策略），因此该无头实例内**不保证同源隔离**——仅用于渲染兜底页面，请勿在该模式内登录敏感账号。
- **运行控制**：推荐在应用市场「服务端插件」中暂停/恢复（即时生效、无需重启）；亦可用 `WEB_PROXY_AUTOSTART=0` 关闭随启动自动运行（改为经管理接口手动启动）。

## 兼容模式（无头渲染，1.0.6+）

少数站点（腾讯、网易等）会返回 JS 挑战页 / WAF 拦截页，纯静态改写无法通过。
兼容模式复用**系统已安装的 Edge / Chrome**，以 headless 方式真实执行页面脚本，
再把画面以 JPEG 帧流推给前端 `<canvas>`，并把鼠标 / 滚轮 / 键盘输入回灌给浏览器。

- **零额外体积**：不下载 Chromium，不新增依赖（`ws` 已随 server 提供）
- **按需启用**：仅当某站点普通模式打不开时，在浏览器工具栏点「兼容」按钮切换
- **自适应视口**：视口按前端可用区域下发（宽 320–1600、高 320–1200）；触摸设备自动切移动 UA + 触摸仿真 + `mobile` 布局
- **通道**：`ws://<host>:<port>/__render__?url=<目标地址>&w=<宽>&h=<高>&dpr=<倍率>&touch=1`，首帧前下发 `{type:'ready'}`（含实际视口尺寸与触摸标记）
- **会话上限**：默认 3 个（单浏览器实测约 1.8GB 内存）；无会话空闲 90 秒后自动关闭浏览器进程（1.0.14+，尽早归还约 500MB 常驻内存与后台进程，冷启动 2–3 秒）
- **输入协议**：`mouse`（mouseMoved/Pressed/Released）、`wheel`、`touch`（start/move/end，单指）、`pinch`（双指缩放，增量倍率）、`text`、`key`、`navigate`、`reload`、`back`、`forward`、`resize`
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
- **输入按帧合并**：指针移动与滚轮增量按 `requestAnimationFrame` 合并，高频触控板采样不再逐事件过通道；触摸移动改为**逐条直发**（位移阈值 1px），松手后按最近 120ms 采样速度补 6 步衰减位移模拟原生惯性，解决「慢速滑动无响应 / 抬手即停」
- **画面帧二进制传输（1.0.12+）**：服务端把 screencast 的 base64 JPEG 解码一次后以二进制 WS 帧下发，前端直接 `createImageBitmap`，省掉客户端逐字节 `atob` 转换——这是此前大帧阻塞主线程、触摸事件排队的主因
- **宿主静音（1.0.12+，1.0.15 重做）**：页面声音只经采集管道回传给学生的手机，教室电脑扬声器不出声。1.0.15 起不再用浏览器启动参数 `--mute-audio`（该参数会让 Chromium 以「静音会话」占用系统音频端点，在部分 Windows 驱动 / 蓝牙耳机上会把**整台电脑**的音频一起拉哑），改为页面内静音：媒体元素在属性层强制 `muted`，页面 WebAudio 的扬声器出口改接 0 增益节点。实测两者都不影响 `captureStream` / 旁路采集（已用 440Hz 音源 + 660Hz 振荡器端到端验证，采集电平不变）
- **不再触碰系统音频端点（1.0.15+）**：采集上下文使用设备默认采样率（不再强制 24kHz，避免驱动重新协商格式），关闭声音时只断开采集接线、**不挂起 AudioContext**（挂起会让浏览器关闭音频输出流，部分驱动反复开关流后会把默认播放设备卡在无声状态）。降采样到 24kHz 回传在采集脚本内完成
- **后台标签不节流（1.0.12+）**：`--disable-background-timer-throttling` / `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` 保证多会话共存时每个标签持续合成，不再出现「画面停在上一帧」
- **GPU 合成与焦点仿真（1.0.13+）**：渲染浏览器不再强制 `--disable-gpu`（headless=new 支持 GPU 合成，驱动不可用时 Chromium 自动回退软件渲染），并开启 `Emulation.setFocusEmulationEnabled`——无头标签默认被视为「未聚焦」会压低动画 / 定时器频率，开启后页面跑满帧率。实测动画页稳定 59fps
- **丢帧后主动补拍（1.0.13+）**：积压时丢的是旧帧，页面停手后不再出帧，屏幕会停在滑动中途的旧位置（主观就是「卡住」）。服务端标记 `needRefresh`，等发送缓冲回落到低水位后用 `Page.captureScreenshot` 补拍一张最新 JPEG，保证松手 / 动画结束后的最终画面一定到达
- **双指捏合缩放（1.0.13+）**：前端识别两指距离变化并按增量下发 `{type:'pinch', x, y, scaleFactor}`（累计变化 <2% 或间隔 <50ms 不下发）；服务端累计为绝对倍率后用 `Emulation.setPageScaleFactor` 应用（1–3 倍）。无头环境里 `Input.synthesizePinchGesture` 实测不改变 `visualViewport.scale`，故不采用
- **断线重连**：通道异常断开（切网 / 服务端回收）时自动重建会话（间隔 0.6s，最多两次），无需手动刷新
- **能力探测**：`GET /api/web-proxy/status` 的 `data.render.available` 为 `true` 时前端才展示入口
- **浏览器启动发现（1.0.12+）**：先按 profile 下的 `DevToolsActivePort` 探活并复用仍存活的渲染浏览器，探活失败才冷启动。新版 Edge/Chrome 在已有实例时会把启动请求转交给子进程并立即退出（code 0），且不再向 stderr 输出 `DevTools listening on`——只解析日志会把这种情况误判成启动失败
- **不影响主链路**：渲染引擎加载失败或浏览器缺失时只在日志提示，普通代理照常工作

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

- 兼容模式为**少数站点兜底**：画面为帧流（非完整视频），滚动/动画流畅度低于直连；并发上限 3
- 画面按视口 CSS 尺寸编码（约为设备像素 1 倍），文字清晰度略低于本地原生渲染
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
