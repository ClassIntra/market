# ClassIntra Market

ClassIntra 第三方市场应用仓库，托管应用包及市场目录索引。当前包含五子棋应用 `gomoku`。

## 目录

- [市场目录](./index.json)
- [五子棋应用](./apps/gomoku)
- [Gitee 镜像](https://gitee.com/classintra/market)
- [GitHub 主仓库](https://github.com/ClassIntra/market)

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
