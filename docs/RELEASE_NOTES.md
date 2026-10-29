# 0.1.78-dev.22 · 独立预览版

Codex Sidebar 首个独立仓库预览版，基于已验证的 dev.21 功能基线。

- 显示名称独立为 Codex Sidebar，保留 `lixxx1-lab.dsh-codex-experiment` 扩展 ID。
- 提取独立构建与功能测试，保留 DSH MIT 来源和第三方声明。
- 后端改为可以公开取得的官方 Windows x64 构建，继续校验精确 SHA-256。
- 修复干净 Codex 配置下禁用服务缺少传输字段而无法启动的问题。
- 提供后端安装脚本、中文 README、详细手册与示例界面图片。
- 使用本项目原创侧栏图形；文件类型图标另行保留来源与许可。

本候选需要 Windows x64、VS Code 1.125.0 或以上、有效 Codex 登录及可用模型。尚未进行新账号在线发送、真实 VS Code 首装／升级、系统剪贴板及语音质量验收。Apps 调用仍关闭，MCP 仅当前项目文件只读，Chat／Dot 未集成；对话回退不恢复磁盘文件。

发布文件：VSIX、SHA256SUMS.txt、setup-backend.mjs 和源码归档；源码同时由独立仓库提供。后端从 OpenAI 官方渠道获取，不混入本项目上传包。

发布整理补充：`main` 分支及随附源码 ZIP 包含首次 GitHub 验证发现的 Windows 检出换行与测试临时目录配置修正；标签保留初始代码快照。VSIX 运行代码不变，包内说明更新为已公开的仓库地址。开发与 CI 请使用 `main` 或随附源码 ZIP。
