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

## 1.1.0

- 支持创建、加入和观战房间。
- 支持 15、19、21 路棋盘，以及房间成员、换色、重开和历史接口。
- 通过 ClassIntra WebSocket 进行房间订阅、落子广播和连接恢复，并保留 HTTP API 兼容路径。
