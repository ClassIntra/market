# ClassIntra Market

ClassIntra 第三方生态仓库：托管市场应用包、服务端插件、主题，以及市场目录 `index.json`。

**当前内容**（以 `index.json` 为准）：

| 分区 | 数量 | 说明 |
|---|---|---|
| `apps/` | 3 | `chess`（国际象棋，含 Pikafish 引擎）、`gomoku`（五子棋）、`pet`（桌宠） |
| `plugins/` | 4 | `astrbot-relay`、`campusbili-bridge`、`netease-music`、`web-proxy`（纯后端，无页面） |
| `themes/` | 0 | 纯数据 JSON 主题包，等待第一位作者 |

## 目录

- [市场目录](./index.json)
- [服务端插件源码](./plugins) · [插件开发约定](./plugins/README.md)
- [应用开发文档](https://classintra.github.io/development/third-party)
- [GitHub 主仓库](https://github.com/ClassIntra/ClassIntra) · [Gitee 镜像](https://gitee.com/classintra/market)

## 应用预览

| 象棋（chess） | 五子棋（gomoku） | 桌宠（pet） |
|---|---|---|
| ![象棋](apps/chess/screenshots/02-light.png) | ![五子棋](apps/gomoku/screenshots/02-light.png) | ![桌宠](apps/pet/screenshots/01-overview.png) |

截图均为 1043×787 校园平板横屏真机画面；每个应用目录下另有深色版本。

## 三种包

| 类型 | 位置 | 形态 | 安装后 |
|---|---|---|---|
| 应用 `app` | `apps/<name>/` | 微前端 `entry.js` / 静态站 / 独立端口服务 | 桌面图标 + 可选后端 |
| 插件 `plugin` | `plugins/<name>/` | **只有后端路由**，没有页面 | 无图标，热挂载 `/api/<name>` |
| 主题 `theme` | `themes/<id>/` | 纯数据 `tokens.json` | 出现在全班主题选择里 |

> 需要页面的扩展就做成**应用**；插件刻意保持 backend-only。

## 安装方式

班级服务器读取本仓 `index.json`，按 `files` 清单逐文件下载、比对 sha256，原子替换到运行时目录并热挂载，
**不需要克隆本仓、也不需要重启服务**。

默认市场源：

```text
https://gitee.com/classintra/market/raw/main/index.json            # 默认（Gitee）
https://raw.githubusercontent.com/ClassIntra/market/main/index.json # 备用（GitHub）
```

自 2026-10 起班级也可以添加**自建市场源**（管理端市场页 →「源」），第三方可独立分发，不必等官方合仓。

## 提交前自检（CI 同款）

```bash
node tools/check.mjs          # 零依赖；PR 会自动跑
```

检查内容：

- `index.json` ↔ 实际文件 ↔ `manifest.json` 三方一致（名称、版本、类型、路径归属）
- 逐文件 sha256 与 `hashes` 匹配
- 前端路由 / 后端挂载点 / 进程端口冲突
- 包体限制：300 文件 / 单文件 60MB / 总量 80MB
- **Chrome 80 语法红线**（模板字符串、`const`/`let`、箭头函数、`?.`、`??`、`class`、`async/await`）→ 错误
- CSS 兼容（flex `gap`、`:is()`、`aspect-ratio`、`transition: all`）→ 警告

本地开发可选用独立工具链（不需要克隆主仓）：

```bash
npx classintra-devkit create app my-app --label "我的应用"
npx classintra-devkit check my-app
npx classintra-devkit pack my-app --write index.json
```

## 发布流程

1. 把包放进对应目录（`apps/<name>/`、`plugins/<name>/`、`themes/<id>/`）
2. 抬高 `manifest.json` 的 `version`
3. 重新生成清单与哈希：`node scripts/market-index-gen.mjs`（主仓）或 `npx classintra-devkit pack . --write index.json`
4. 需要验签时：`node scripts/market-sign.mjs`（维护者私钥，绝不入仓）
5. 提交 PR；CI 通过后由维护者合并

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。涉及第三方参考实现时，请在包内 README 保留来源与许可证说明。

## 致谢

五子棋与棋类应用的方向、交互参考和部分实现思路来自
[MoyuZJ912/iFlyCompass](https://github.com/MoyuZJ912/iFlyCompass)。市场协议、catalog、
动态运行时与应用生命周期由 ClassIntra 项目独立完成；使用或再分发相关代码时请遵守各自许可证。
