# 安装指南

本文对应 `0.1.78-dev.22` 预览候选。后端获取、校验、隔离配置初始化与只读 MCP 已测试；真实 VS Code 首装、新账号登录和在线发送尚未完整验收。

## 环境与身份

- 首发范围为 Windows x64、本地受信任工作区、VS Code 1.125.0 或以上。最低声明按本项目编译 API 基线收紧；不宣称已逐版本测试所有编辑器。
- Codex Sidebar 的扩展 ID 为 `lixxx1-lab.dsh-codex-experiment`。独立仓库名为 `codex-sidebar`，不会另建扩展身份。
- 后端独立运行，VSIX 不包含 Codex 可执行文件、登录资料或账号授权。
- 听写、朗读等 Windows 集成功能需要 PowerShell 7 及相应系统组件。构建用 Node.js／pnpm 与普通用户的运行前置条件分开说明。

## 准备后端

支持 `codex-cli 0.163.0-alpha.10.2`，来源为 [OpenAI 官方 Release](https://github.com/openai/codex/releases/tag/rust-v0.163.0-alpha.10.2)。`codex-x86_64-pc-windows-msvc.exe` 的 SHA-256 必须为：

```text
76b4bfc83785f31c59ec384760003109410132bab602a2115d83e88e04a6dc47
```

安装 Node.js 22.19.0 或以上，在保存了本项目 `setup-backend.mjs` 的目录运行：

```powershell
node .\setup-backend.mjs
```

源码开发者使用 `node scripts/setup-backend.mjs`。脚本从上述官方 Release 下载压缩包，先校验压缩包再校验可执行文件，安装到当前用户的：

```text
%USERPROFILE%\AppData\Local\CodexSidebar\backends\0.163.0-alpha.10.2-76b4bfc83785f31c\codex.exe
```

已存在且校验正确时直接返回；文件不同则停止，不覆盖。脚本不登录账号、不修改 VS Code、不安装扩展。网络下载超时为 3 分钟；失败后可重试。

也可下载同一官方 `.exe.tar.gz` 后运行 `node setup-backend.mjs --archive <本地压缩包路径>`。高级用户可以用 `--destination <目录>` 安装到其他位置，并在启动 VS Code 前设置 `CODEX_PROTOTYPE_BIN` 为该目录中的 `codex.exe` 绝对路径；仍须通过相同校验。

旧开发版使用另一份同版本文件。**相同版本字符串不足以证明可互换**；本候选只支持上面列出的公开构建，不读取或修改旧后端目录。不要通过删除校验处理版本不符。

## 登录

在 PowerShell 中启动已校验的后端，使用其官方登录流程：

```powershell
& "$env:USERPROFILE\AppData\Local\CodexSidebar\backends\0.163.0-alpha.10.2-76b4bfc83785f31c\codex.exe" login
```

若使用自定义目录，先把 `CODEX_PROTOTYPE_BIN` 设置为实际文件路径，再使用同一个文件登录：

```powershell
& "$env:CODEX_PROTOTYPE_BIN" login
```

已有有效 Codex 登录可由后端使用；侧栏不要求复制登录文件或填写令牌。账号及模型权限以服务端为准。首次默认模型为 `gpt-6-luna / low`，不保证所有账号可用；连接后请核对并主动选择可用模型。

官方接口参考：[App Server 文档](https://learn.chatgpt.com/docs/app-server)。文档描述接口能力，不代表当前插件已实现所有能力。

## 安装 VSIX

1. 下载本项目 Release 中的 VSIX 和 `SHA256SUMS.txt`，用 `Get-FileHash <VSIX路径> -Algorithm SHA256` 比对校验值。
2. 在 VS Code 扩展菜单中选择“从 VSIX 安装”，选择下载的文件。
3. 按提示重新加载，运行“Codex: 显示加载信息”核对版本；打开受信任工作区，进入侧栏、新建会话并核对模型与权限。

下载入口为 [Enxulansis/codex-sidebar Releases](https://github.com/Enxulansis/codex-sidebar/releases)，当前提供有限验证预览版。上述真实编辑器和在线步骤仍须首次使用验收；本地自动化通过不等于完整端到端通过。

## 升级、回退和资料

保留扩展 ID 的更新沿用原身份。升级前保留上一版 VSIX，并自行备份重要资料；“ID 不变”不等于自动备份。需要回退时安装所保留的上一版包，再核对加载版本。不要通过清空工作区数据解决普通连接失败。

安装成功不等于当前窗口已经加载新版本。仓库独立也不意味着会扫描、迁移或导入官方 Codex 的全部历史。
