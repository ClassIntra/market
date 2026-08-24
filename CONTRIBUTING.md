# 贡献指南

感谢参与 ClassIntra Market。请先确认改动范围，仅提交与应用包、catalog 或发布流程直接相关的文件。

## 提交前

- 确认应用目录结构和 manifest 文件清单一致。
- 根据实际功能更新应用版本和 `index.json` 中对应条目。
- 更新 `CHANGELOG.md`，说明用户可见的新增、修复或变更。
- 不提交密钥、令牌、个人数据、构建产物或无关格式化改动。
- 保持前端、后端与现有运行时 SDK 约定一致。

## 应用发布

1. 在 `apps/<app-name>/manifest.json` 中维护应用元数据和入口。
2. 在根目录 `index.json` 中登记应用版本、描述和完整文件清单。
3. 在本地完成必要的 JavaScript、JSON 语法检查。
4. 运行 `git diff --check`，确认没有空白错误。
5. 提交变更并等待市场目录审核后再发布。

市场会通过 [Gitee 镜像](https://gitee.com/classintra/market) 的 raw 地址优先获取 catalog，GitHub 仓库作为备用来源。catalog 发布后，ClassIntra 班级服务器会根据文件清单下载并安装应用。

## 代码与致谢

涉及 iFlyCompass 参考内容时，请保留 [iFlyCompass](https://github.com/MoyuZJ912/iFlyCompass) 致谢，并遵守其许可证及署名要求。新增应用也应在 README 中说明外部参考和许可证信息。
