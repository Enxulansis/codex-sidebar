# Codex Sidebar

非官方 Windows x64 Codex 侧栏，源自 DSH。支持长对话阅读、草稿与附件保护、图片和文档文本、搜索、规划、对话回退与后台额度更新。

本包为 0.1.78-dev.23 有限验证预览版，不由 OpenAI 提供或背书。保留扩展 ID `lixxx1-lab.dsh-codex-experiment`，需要 VS Code 1.125.0 或以上、本地受信任工作区、受支持 Codex 后端及有效登录。

## 后端准备

本包不含 Codex 二进制或账号凭据。使用随发布材料提供的 `setup-backend.mjs` 准备受支持后端，再运行后端的 `login` 命令。安装脚本需要 Node.js 22.19.0 或以上，不修改 VS Code、不自动登录。

支持的官方构建为 `codex-cli 0.163.0-alpha.10.2`，Windows x64 可执行文件 SHA-256：

```text
76b4bfc83785f31c59ec384760003109410132bab602a2115d83e88e04a6dc47
```

完整安装说明、使用手册和示例图片包含在 [源码仓库](https://github.com/Enxulansis/codex-sidebar) 及本包的 `docs/` 目录。

## 已知范围

- Apps 仅目录和状态展示，调用关闭；MCP 仅当前工作区文件只读。
- ChatGPT Chat／Dot 未集成。对话回退不恢复磁盘文件。
- 文件审批和命令执行仍有范围限制，不代表开放了所有原生工具。
- 文档提取文字，不执行 OCR 或宏，不把文档内图片自动作为图像输入。
- 新账号在线对话、真实编辑器首装／升级、系统剪贴板及语音质量尚未完成验收。

运行“Codex: 显示加载信息”确认当前窗口实际加载版本。不要通过删除历史、清空草稿或关闭后端校验解决普通连接问题。

项目许可为 MIT；DSH、Material Icon Theme 和其他依赖来源与许可见包内 LICENSE 及 THIRD_PARTY_NOTICES.md。
