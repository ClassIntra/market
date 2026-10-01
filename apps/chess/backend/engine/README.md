# 象棋人机引擎（Pikafish）

本目录存放 `chess` 应用「人机练习」所用的服务端 UCI 引擎。**二进制与权重不入库**：
它们既不进主仓（`market-apps/` 整体被 gitignore），也不进市场仓
（`apps/*/backend/engine/*.exe`、`*.nnue` 已被 market 仓 `.gitignore` 忽略），
SyncThing 同样忽略（18i↔8i 只剩 DERP 隧道，57MB 同步不现实）。

## 装一次

```bash
# 在主仓根目录执行（会自动下载 + 解压 + 跑 UCI 自检）
node scripts/chess-engine-setup.mjs          # 已装好则跳过
node scripts/chess-engine-setup.mjs --check  # 只自检：文件在不在 + 能否出着
node scripts/chess-engine-setup.mjs --from <本地.Pikafish.7z>   # 离线安装
```

装完应当是：

| 文件 | 大小 | 说明 |
|---|---|---|
| `pikafish.exe` | ≈6.6 MB | Pikafish `x86-64-universal`（运行时按 CPU 特性派发，无需按机器分版本） |
| `pikafish.nnue` | ≈48 MB | NNUE 评估权重，**必须与 exe 同目录**（缺了引擎会启动即退出） |
| `Copying.txt` / `NNUE-License.md` / `AUTHORS` | — | GPL-3 与权重授权原文，随二进制一起保留 |

当前版本：**Pikafish 2026-09-06**
- 引擎来源：https://github.com/official-pikafish/Pikafish （GPL-3.0，作者与许可证原文见同目录 `AUTHORS` / `Copying.txt`）
- 权重来源：https://github.com/official-pikafish/Networks 的 `master-net` 发布（许可见 `NNUE-License.md`）

> 出处约定：本应用借鉴的第三方成果（引擎、权重、界面参考等）统一登记在
> [`../../README.md`](../../README.md) 的「出处与致谢」章节，新增引用时同步更新。

## 其它机器的注意事项

- **8i**：SyncThing 不传这两个文件 → 在 8i 的 CI 目录里同样跑一次安装脚本；
  没装也不会坏，应用会自动回落内置 AI（副标题显示「内置引擎」）。
- 想换版本：`node scripts/chess-engine-setup.mjs --tag Pikafish-YYYY-MM-DD --force`。
  换完**不需要重启** `classintra-server`：引擎进程按需拉起，空闲 10 分钟自动回收。
- 临时停用（不删文件）：给服务加环境变量 `CHESS_ENGINE_DISABLE=1` 再重启。

## 为什么不把引擎放进市场包

1. 57MB 的第三方二进制进公开仓，会让每个装游戏的学生多下 57MB；
2. GPL-3 产物随包分发要连带源码与许可证义务，而我们并不需要分发它——
   引擎跑在服务端，学生端只是发一个 HTTP 请求。
