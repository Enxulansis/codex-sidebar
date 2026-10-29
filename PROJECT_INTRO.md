---
_file:
  created: "2026-10-26 23:53"
  updated: "2026-10-29 20:51"
  timezone: "Asia/Shanghai"
  status: active
---

# Codex Sidebar

> 独立的 Windows VS Code Codex 侧栏项目；本地准备完成后先审核 README，再授权 GitHub 上传。保留 lixxx1-lab.dsh-codex-experiment 扩展 ID。

## 项目概述

- 目标：独立的 Windows VS Code Codex 侧栏项目；本地准备完成后先审核 README，再授权 GitHub 上传。保留 lixxx1-lab.dsh-codex-experiment 扩展 ID。
- 背景与约束：源自 DSH，独立仓库发布；保留扩展 ID。暂不上架 Marketplace。未经用户审核与明确授权不上传。
- 当前版本：dev.23，纳入设置重试焦点保护与大小写依赖目录排除。完整自动验证与本机安装通过；发布位置为 Enxulansis/codex-sidebar 的同版本预览 Release。
- 安装边界：安装清单与载荷核对通过，当前编辑器窗口未主动重载，实际加载版本待“Codex: 显示加载信息”核对。复查详情见 `docs/POST_RELEASE_REVIEW_20261029.md`。
- 项目根目录：本文所在目录。公开文档使用相对路径。

## 文件地图

| 路径 | 职责 |
|------|------|
| `AGENTS.md` | Codex 项目指令，结合全局指令生效 |
| `PROJECT_INTRO.md` | 项目目标、路径与当前状态入口 |
| `CHANGELOG.md` | 实质变更和验证结果 |
| `FILE_MANAGEMENT_STANDARD.md` | 文档元数据、归档与备份约定 |
| `FILE_PLACEMENT_POLICY.md` | 产物路径规则 |
| `.gitignore` | 临时文件和常见凭据忽略规则 |
| `specs/` | 项目基准要求和规格 |
| `output/` | 已验证的最终交付物 |
| `_temp/inbox/` | 待审查的外部资料 |
| `_temp/drafts/` | 草稿 |
| `_temp/prompts/` | 提示词和生成中间件 |
| `_temp/reviews/` | 验证记录与渲染结果 |
| `_temp/screenshots/` | 截图 |
| `_temp/backup/` | 显式备份；不自动轮转 |
| `_temp/archive/deep/` | 低价值历史中间件 |
| `待完成/_index.md` | 需跨对话继续的待办 |

源码在 `src/codex-prototype/`，共享资源在 `src/`；构建入口在 `experiments/codex-panel/`，公开工具脚本在 `scripts/`，测试在 `tests/`，用户文档在 `docs/`。临时后端下载和本机证据只在 `_temp/`，不公开。

## 常用工作流与验证

- 运行入口：`pnpm build`；打包：`pnpm package`。
- 验证：`pnpm typecheck`、`pnpm test`；浏览器检查见 `docs/DEVELOPMENT.md`。
- 依赖：Node.js >=22.19、pnpm 11.7.0；后端来源及精确校验见 `docs/INSTALLATION.md`。

## 当前交接

- 最近结果：本地后续修复的 135 个测试文件／2524 项测试、类型检查、构建与 17 组浏览器检查通过。已发布基线的 GitHub 全新 Windows 验证通过；两者版本状态分开记录。公开后端空配置初始化与工作区只读调用通过，无模型调用。
- 下一步：按需补充真实编辑器首装和账号在线对话验收，不将自动化结果冒充上述验收。
- 待办索引：`待完成/_index.md`。

## 技能与配置

技能由运行环境提供目录与元数据，无需复制全局技能清单。项目专用技能按需放 `.agents/skills/`。
本工具不修改模型、MCP、沙箱、审批策略，也不配置自动同步、自动提交或自动备份钩子。
