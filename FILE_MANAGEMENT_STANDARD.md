# 文件管理规范

适用于采用此模板的项目；文件位置以 `FILE_PLACEMENT_POLICY.md` 为准。不要为了满足元数据规范修改格式受约束的第三方文件。

## 文档元数据

需要持续维护的项目说明、交接记录和草稿可使用 `_file` frontmatter：

```yaml
---
_file:
  created: "YYYY-MM-DD HH:MM"
  updated: "YYYY-MM-DD HH:MM"
  timezone: "Asia/Shanghai"
  status: active
---
```

- 状态：`active`（维护中）、`draft`（草稿）、`final`（定稿）、`superseded`（已替代）。按实际状态填写。
- 更新时保留真实创建时间，仅改 `updated`；历史时间无法确认时省略，不补编造分钟。
- `AGENTS.md`、`SKILL.md`、README、引入的论文原文和工具规定格式的文件不强制追加 `_file`。
- `SKILL.md` 保留其 `name`、`description` 等标准 frontmatter，不加入 Claude 专用字段（如 `user-invocable`）。
- 元数据是本地维护约定，不代表 Codex 自动读取全部文档或实现版本管理。

## 真实时间

写入前读取真实时钟，并转换到用户时区。PowerShell 7 示例：

```powershell
$ErrorActionPreference = 'Stop'
$taskTime = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date).ToUniversalTime(), 'Asia/Shanghai')
$taskTime.ToString('yyyy-MM-dd HH:mm')
```

长会话或跨日时重新读取。归档文件名可用 `name_yyyyMMdd-HHmmss-fff.ext`，防止同分钟重名。

## 生命周期和恢复

- 保留用户原始输入；原始资料和未提交的重要文件覆盖前先显式备份。
- 旧草稿有保存价值时放 `_temp/archive/`；已经受 Git 保护的废弃实现从活跃目录移除，避免维持双份逻辑。
- 临时缓存和失败产物按任务需要清理；不设置“一切永不删除”的要求，也不自动删除用户资料。
- `.gitignore` 只影响 Git 跟踪，不是备份或访问保护。忽略 `_temp/` 意味着其中的内容通常无法用 Git 恢复。
- 初始化脚本不自动 `git init`、提交或推送。用户要求版本控制操作时，检查实际状态再执行。
- 不在代码、文档或日志中写入密钥。需要凭据时使用环境变量或产品支持的凭据存储。

## 交付检查

核对实际文件数量、格式、相对引用、关键内容和项目所需验证；记录已运行的检查及其结果。没有运行的检查明确记为未执行。
有实质变更才追加日志；尚未完成的工作写入 `待完成/_index.md`，避免把全量工具日志当作项目记忆。
