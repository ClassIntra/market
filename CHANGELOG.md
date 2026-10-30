# 变更记录

## 未发布

- 新增 `plugins/` 目录，接收主仓库迁出的服务端插件源码（`astrbot-relay`、`campusbili-bridge`）。
- 补充仓库定位说明与插件清单，明确 catalog 只索引应用、插件按目录复制安装。
- 新增 `.gitignore`（依赖、环境变量、日志与数据库不入库）。
- 完善市场仓库说明，补充 Gitee 镜像、catalog、应用发布流程和 iFlyCompass 致谢。
- 更新五子棋应用目录元数据，明确房间联机、观战、实时同步和断线恢复能力。
- 新增网页代理插件 `web-proxy`（作者 [yujing0208](https://github.com/yujing0208)）：内置纯 Node 网页代理，超能岛浏览器自动为外网站点改走代理，可打开被防盗链、跨域或 iframe 限制的站点；默认监听 `9005`（占用自动顺延 `9006`–`9009`），随 ClassIntra 启动自动运行，兼容 iFlyCompass 的 `getassets/<scheme>/<host>/<path>` 地址形态（详见插件 README「出处与致谢」）。
- `index.json` 升至 `4`，登记 `web-proxy` 插件条目。
- `netease-music` 升至 `1.1.6`：修复 `GET/POST /admin/config` 永久 `401`（补挂 `requireAuth`；插件路由直挂时无全局认证，单挂 `requireAdmin` 会因 `req.user` 缺失而拒绝）。
- `index.json` 升至 `5`，更新 `netease-music` 版本号。
- `web-proxy` 升至 `1.0.1`：`canDisable` 改为 `true`，插件不再强制常开——管理员可在应用市场「服务端插件」中随时暂停或恢复，暂停后插件后端接口即时下线、无需重启。
- `index.json` 升至 `6`，更新 `web-proxy` 版本号。
- `web-proxy` 升至 `1.0.13`：兼容模式体验优化——启用 GPU 合成与焦点仿真（动画页实测 60fps）、丢帧后主动补拍避免「停在中途旧画面」、双指缩放改用 `Emulation.setPageScaleFactor`、声音升为 24kHz（约 43ms 一包）。

- `web-proxy` 升至 `1.0.14`：按需帧率（输入后 1.5 秒 60fps、静置 30fps，媒体在播自动保持高帧率），静置时出帧数与带宽减半（30 秒动画页 1756→880 帧）；无会话空闲回收从 5 分钟缩短到 90 秒，及时归还约 500MB 内存与后台进程。
- `index.json` 升至 `7`，更新 `web-proxy` 版本号。
- `web-proxy` 升至 `1.0.15`：修复「关闭声音后整台电脑失声」——宿主静音不再用浏览器启动参数 `--mute-audio`（该参数会让 Chromium 以静音会话占用系统音频端点，部分 Windows 驱动 / 蓝牙设备下会把整机音频一起拉哑），改为页面级静音（媒体元素强制 `muted` + 页面 WebAudio 出口接 0 增益）；采集上下文改用设备默认采样率，关闭声音时只断开采集接线、不再挂起 `AudioContext`，避免反复开关音频流把默认播放设备卡在无声。
- `index.json` 升至 `8`，更新 `web-proxy` 版本号。
- `web-proxy` 升至 `1.0.16`：兼容模式使用管理——应用市场「已安装插件」的网页代理卡片新增班管 / 管理员专用「管理」按钮，浮窗展示当前所有兼容会话（使用者、站点、已用时长、声音状态），支持单个或全部断开；会话身份由前端 WS 握手携带 `uid` / `uname`，新增 `GET /api/web-proxy/sessions`、`POST /api/web-proxy/sessions/:id/close`、`POST /api/web-proxy/sessions/close-all` 三个班管接口。
- `index.json` 升至 `9`，更新 `web-proxy` 版本号。
- `web-proxy` 升至 `1.0.17`：兼容模式按账号隔离浏览器 profile——每个账号使用独立 `--user-data-dir` 的渲染实例，不同账号的 Cookie / 登录态 / 本地存储互不相通，账号内多标签页仍共用同一实例；同时保留实例数上限 3（LRU 回收无会话实例），空闲 90 秒回收对应账号进程，profile 目录跨重启保留以延续登录态。
- `index.json` 升至 `10`，更新 `web-proxy` 版本号。
- `web-proxy` 升至 `1.0.18`：①「可使用者」白名单——兼容模式管理浮窗新增全班可用 / 仅指定成员两种模式，支持按昵称 / 姓名 / 学号搜索勾选，保存立即生效，管理员与班管始终可用；设置存于 `server/database/web-proxy-access.json`（避免市场更新插件时被清掉）；渲染 WS 握手改用 query `token` 校验真实 `user_id` 后放行，未授权直接拒绝（新增 `GET/POST /api/web-proxy/access`、`GET /api/web-proxy/users`）。②云游戏画质——工具栏新增「云游戏」按钮，热切换为 JPEG 92 / 恒 60fps / dpr 上限 3 / 编码上限 3840×2160 / 6MB 帧缓冲，并跳过自适应降档，适合串流游戏与视频。
- `index.json` 升至 `11`，更新 `web-proxy` 版本号。
- `web-proxy` 升至 `1.0.19`：修复云游戏画质「开了但画面没变清晰」——Chromium 的 `Page.startScreencast` 帧尺寸恒等于视口 CSS 像素，`deviceScaleFactor` 只影响截图与页面光栅化、不放大帧流（实测 DSF 1/2/3 帧尺寸均为 1000×700）。改为云游戏模式下把视口按画布尺寸放大 2 倍（夹在 3840×2160 内等比收缩），前端按 `compatViewW/H` 等比缩小显示，鼠标坐标与滚轮增量自动换算；新增 `baseWidth/baseHeight` 协议字段区分画布尺寸与实际编码视口，热切换与窗口 resize 均按 base 口径重算。实测云游戏帧由 1000×700 提升到 2000×1400，切回普通模式恢复原尺寸。
- `index.json` 升至 `12`，更新 `web-proxy` 版本号。
- `web-proxy` 升至 `1.0.20`：修复「兼容模式不支持多点触摸」——客户端此前把双指手势直接吞成页面缩放，页面从未收到第二根手指，云游戏「左手摇杆 + 右手按键」无法同时按住。改为 **1~2 指原样转发**（每指独立稳定 `id`，服务端按 id 差集合成），**3 指及以上**才走页面缩放；部分抬起只上报剩余手指，多指序列不做甩动惯性。已用 CDP 实测确认 `touchEnd` 传剩余点时浏览器只抬起缺少的那根。
- `index.json` 升至 `13`，更新 `web-proxy` 版本号。
- `web-proxy` 升至 `1.0.21`：修复云游戏画质「点了没变化」——此前固定放大 2 倍，在 `devicePixelRatio` 为 3 的手机上帧仍小于物理像素，观感与普通模式差别不大。改为按**设备真实像素密度**放大编码视口（`pd`，夹在 2–3 倍，仍夹在 3840×2160 内等比收缩），握手 query 与 `mode` 消息均带上 `pd`；切换后画面底部弹出回执，显示实际编码尺寸与帧率（如 `云游戏画质已开启 · 1170×2100 · 60fps`），服务端 3 秒无响应时提示「插件后端需重启后生效」。已用 CDP 探针实测：视口 400×700 → 800×1400 时帧尺寸同步变为 800×1400。
- `index.json` 升至 `14`，更新 `web-proxy` 版本号。
- `web-proxy` 升至 `1.0.22`：超能岛浏览器的历史 / 收藏 / 首页改为**按账号存到服务端**，同一账号在手机 / 平板 / 教室电脑登录后自动看到同一份记录（此前只存设备本地 `localStorage`，换设备就丢）；存储于 `server/database/web-proxy-browser-data.json`（随数据库目录备份，插件更新不覆盖），写入按 url 合并而不是整包覆盖，避免多设备互相冲掉；前端进入浏览器拉取一次、变更防抖 1.2 秒上传、窗口重新获得焦点再拉取（5 秒节流），未登录仍只走本地存储。兼容模式的 Cookie / 登录态本就按账号共用同一份服务端 profile，跨设备天然同步，README 已补说明。
- `index.json` 升至 `15`，更新 `web-proxy` 版本号（新增文件 `backend/browser-data.js`）。

- `web-proxy` 1.0.22 补充：删除同步——删历史 / 取消收藏时提交「删后的完整列表」并带 `replaceHistory` / `replaceBookmarks`，服务端按整表替换而不是并集合并，否则刚删的条目会被并集重新合回来；拉取时用服务端 `updatedAt` 判断别处是否改过，改过则以服务端为准、只保留本机在那之后新产生的记录，实现删除在多设备间生效；本机已有的旧记录首次同步时一次性补传上云。
- `index.json` 升至 `16`，更新 `web-proxy` 文件哈希（`backend/browser-data.js`）。
- `index.json` 升至 `17`，更新 `web-proxy` README 哈希（补充删除同步与首次补传说明）。
- `web-proxy` 升至 `1.0.23`：修复「云游戏画质开启后页面内容变小」——此前为提升清晰度把无头浏览器视口按设备像素密度（`pd`）放大 2–3 倍，站点因此按更宽视口排版、切到桌面版，文字整体变小，前端再把帧缩回画布，观感是「开了更高画质反而看不清」。改为渲染浏览器以启动参数 `--force-device-scale-factor=2` 运行，合成表面恒为视口 CSS 像素的 2 倍：**排版宽度 / 媒体查询 / 字号 / 输入坐标与普通模式完全一致**，云游戏模式只把 screencast 的 `maxWidth/maxHeight` 给到 2 倍，帧由 400×700 提升到 800×1400（已端到端实测：两种模式下 `innerWidth / clientWidth / 正文 14px / max-width:400px 媒体查询` 全部相同，帧尺寸翻倍）。同时移除 `pd` 协议字段与视口放大逻辑；普通模式取帧时 Chromium 自动把 2 倍表面缩回 1 倍（实测带宽基本不变），丢帧补拍改用 `clip.scale` 保证与帧同尺寸，避免画布尺寸跳变闪烁。
- `index.json` 升至 `18`，更新 `web-proxy` 版本号与 `backend/render.js` / `manifest.json` / `README.md` 哈希。
- `web-proxy` 升至 `1.0.24`：修复「滑动会飘移，划一点却移动很多」——前端此前在抬手时按最近 120ms 的采样速度补 6 步衰减位移来「模拟惯性」，而 CDP 触摸序列进页面后浏览器自己也会算惯性，两段叠加就是放大位移。现在触摸严格 1:1 转发，抬手只发 `touchend`。同时补齐**长按手势**：单指按住 600ms 且位移不超过原生 slop（8 CSS px）判为长按，客户端下发 `{type:'longpress', x, y}`，服务端先查注入探针记录的 `window.__ciCtxAt`，1.5 秒内页面已自行响应 `contextmenu` 就不再补，否则补一次右键并回 `{type:'longpress-state', fired}`；触发后本次手势不再转发移动、抬手用 `touchCancel` 收尾，避免合成点击把菜单点掉；云游戏模式不补右键（长按即按住开火 / 蓄力键），连续长按靠页面内 `window.__ciCtxMark()` 区分自发右键，不会出现「第二次长按没反应」。
- `index.json` 升至 `19`，更新 `web-proxy` 版本号与 `backend/render.js` / `manifest.json` / `README.md` 哈希。
- `web-proxy` 升至 `1.0.25`：打磨长按手势细节——①长按触发后不再无限期冻结移动，位移超过 24 CSS px 自动解冻恢复转发（贴近原生「长按后继续拖动仍派发 move」的手感，避免页面「卡到抬手」），24px 内仍冻结以免刚弹出的菜单被 move 拖走；②云游戏模式完全不参与长按（那里长按就是按住开火 / 蓄力键，冻结 600ms 会让摇杆 / 视角出现「黏一下」的顿感），服务端同样兜底不补右键；③长按触发后再落下第二根手指时整体复位（此前 `_compatHoldPending` 残留会把后续移动永久吞掉，表现为「加了第二根手指后页面完全不动」）；④多指序列中剩余手指抬起时不再清 `_compatHoldFired`，保证最后收尾仍用 `touchCancel`，否则合成的 clicked 会把长按菜单点掉；⑤长按触发时加 15ms 触觉反馈（不支持振动的设备静默跳过）。
- `index.json` 升至 `20`，更新 `web-proxy` 版本号与 `manifest.json` / `README.md` 哈希。
- `web-proxy` 升至 `1.0.26`：网页代理改为**手动开关**——超能岛浏览器不再自动把外网站点改走代理，默认直连，需要时点工具栏「闪电」按钮才让当前站点经代理转发（偏好按账号记忆，切换后立即重载当前页）；兼容模式本身不经代理改写，故该按钮在兼容模式下隐藏。仍然排除 CampusBili（含 9002 端口）、与 ClassIntra 同主机名的页面、已是代理地址，避免二次包装与桥接失效。同时**局域网 / 内网地址也显示兼容模式入口**——此前 `compatCapable` 与代理判定里的 `isLanHost` 会把 localhost、私有 IP、单标签主机名一律排除，但渲染浏览器本就运行在服务器侧（通常就在同一内网），局域网页面同样可以兼容渲染；`shouldProxyUrl` 相应改名为 `canProxyUrl`，只判断「是否可以代理」，局域网不再强制直连。
- `index.json` 升至 `21`，更新 `web-proxy` 版本号与 `manifest.json` / `README.md` 哈希。
- `web-proxy` 升至 `1.0.27`：精简代理排除规则——只排除端口 `9000–9999`（ClassIntra 自研主服务段，CampusBili `9002` 桥接与代理自身 `9101` 都在其中），不再按主机名排除 CampusBili、也不再排除与 ClassIntra 同主机名的页面；其余地址（含局域网 / 内网 / 本机）只要手动开启开关都可走代理。
- `index.json` 升至 `22`，更新 `web-proxy` 版本号与 `manifest.json` / `README.md` 哈希。

## 1.1.0

- 支持创建、加入和观战房间。
- 支持 15、19、21 路棋盘，以及房间成员、换色、重开和历史接口。
- 通过 ClassIntra WebSocket 进行房间订阅、落子广播和连接恢复，并保留 HTTP API 兼容路径。
