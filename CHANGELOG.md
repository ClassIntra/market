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

## 1.1.0

- 支持创建、加入和观战房间。
- 支持 15、19、21 路棋盘，以及房间成员、换色、重开和历史接口。
- 通过 ClassIntra WebSocket 进行房间订阅、落子广播和连接恢复，并保留 HTTP API 兼容路径。
