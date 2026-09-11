# ClassIntra Market

ClassIntra 第三方生态仓库，托管市场应用包、服务端插件源码及市场目录索引。当前包含五子棋应用 `gomoku`，以及 `astrbot-relay`、`campusbili-bridge` 两个服务端插件。

## 目录

- [市场目录](./index.json)
- [五子棋应用](./apps/gomoku)
- [服务端插件源码](./plugins)
- [Gitee 镜像](https://gitee.com/classintra/market)
- [GitHub 主仓库](https://github.com/ClassIntra/market)

## 插件（plugins/）

插件是 ClassIntra 班级服务器的**独立扩展模块**：无前端页面、必有后端路由（`manifest.type = "plugin"`），由班级服务器启动时扫描 `plugins/` 目录并挂载路由，不使用市场下载流程。

因此 `index.json` 的 catalog **只索引应用（apps）**，插件不在其中。插件以源码形式托管在本仓库 `plugins/<plugin-name>/`，安装方式为将插件目录复制到班级服务器的 `plugins/` 目录后重启服务。

| 插件 | 说明 |
|------|------|
| `astrbot-relay` | 将 AstrBot 机器人（独立账号，如"林晞"）接入 ClassIntra 私聊与公共聊天室；支持 OneBot 反向 WS 与 HTTP 直调两种管线模式 |
| `campusbili-bridge` | 校园 B 站内容桥接 |

插件自身的版本、入口与能力声明见各目录下的 `manifest.json`。


## 应用发布与安装

应用通过 `index.json` 发布。每个应用在 manifest 中声明版本、前端入口、样式、后端入口和文件清单；ClassIntra 班级服务器读取市场目录后，按文件清单下载、校验并安装应用，不要求用户克隆整个仓库，也不依赖 ClassIntra 提供公共应用服务器。

默认市场源为 Gitee 镜像：

```text
https://gitee.com/classintra/market/raw/main/index.json
```

GitHub 可作为备用源：

```text
https://raw.githubusercontent.com/ClassIntra/market/main/index.json
```

安装后的应用由班级服务器负责缓存、运行、更新、启用、禁用和卸载。应用发布时请同步更新 manifest 版本、根目录 catalog 版本及变更记录。

## 开发

应用代码位于 `apps/<app-name>/`。请保持 manifest 中的文件路径与实际文件一致，并在发布前运行语法检查和 `git diff --check`。

贡献流程和约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)。版本变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 致谢

五子棋应用的游戏方向、交互参考和部分实现思路来自 [MoyuZJ912/iFlyCompass](https://github.com/MoyuZJ912/iFlyCompass)。感谢 iFlyCompass 的开源代码与产品探索，为 ClassIntra 第三方应用生态建设提供参考。ClassIntra 市场协议、catalog、动态运行时和应用生命周期由 ClassIntra 项目独立完成；使用或再分发相关代码时，请遵守各自仓库的许可证和署名要求。
