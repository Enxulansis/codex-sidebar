# 开发说明

本工程已从 DSH 开发目录提取，保留实际运行依赖、功能测试及必要的来源夹具。原工程和 Git 历史未搬入。

## 已确认的构建基线

使用 Node.js `>=22.19.0`、`pnpm@11.7.0`。在工程根目录运行：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm package
```

打包结果位于 `output/candidate/`。为避免覆盖证据，输出目录已存在时打包会停止；可用 `node scripts/package.mjs output/另一个目录` 指定新位置。构建输出位于 `experiments/codex-panel/dist/`，该路径名称是沿用的工程布局，不代表要依赖原 DSH 工程。

`pnpm-workspace.yaml` 只允许 esbuild 的必要构建脚本；VSCE 签名和凭据存储相关可选构建关闭，因为本流程只生成本地未签名 VSIX。

## 测试范围

`pnpm test` 执行 `tests/codex*.spec.ts` 中的 Codex 功能测试。原工程 18 个 DSH 全界面对照／旧发布器／旧启动器测试未纳入独立工程：相关旧实现已经不在本仓库。数学扫描器和搜索语义所需的小型 DSH 参考夹具仍保留署名及比对，不使用新实现生成预期值。

公开后端位置、客户端身份及干净配置修复使用独立 dev.22 指纹记录，原 dev.21 和此前的受保护基线保留。首轮提取发现的依赖缺口、固定路径和指纹差异已修正；未通过项不会被隐藏成跳过。

浏览器检查使用 `scripts/check-ui.mjs`，需自行准备 Playwright 和 Chromium／Edge：

```powershell
node scripts/check-ui.mjs --source=. --out=_temp/ui-check --playwright=<Playwright模块目录> --browser=<浏览器可执行文件>
```

输出目录必须为新目录。可加 `--docs=docs/images` 重新生成文档图片。该检查使用合成宿主、虚构内容，并阻止外部网页请求；不代表真实 VS Code 或在线模型调用。浏览器依赖不写入运行时包。

`.github/workflows/validate.yml` 提供 Windows 的类型、功能测试、构建和打包检查。公开基线已在 GitHub 全新 Windows 环境通过，记录见 [Actions](https://github.com/Enxulansis/codex-sidebar/actions)；工作流不含上传或发布步骤。

## 独立整理原则

- 保留实际编译依赖、测试和必要第三方资源；原 DSH 用户入口及个人过程记录不作为本项目说明。
- 扩展 ID 不变，展示名称改为 Codex Sidebar；不要通过改 ID 造成历史与草稿看似丢失。
- 后端精确校验继续保留。公开构建适配需要协议与连接验证，不能仅替换哈希后宣布完成。
- 不复制后端二进制、登录文件、真实聊天数据、node_modules 或原仓库 Git 历史到上传材料。
- 测试数据、示例路径和截图使用虚构内容。合成宿主截图明确标注，不宣称真实 VS Code 或在线功能验收。
- 验证记录必须对应最终源码和包；源码有相关变更后，不复用旧包结果。

远端创建、推送、Release 上传和 Marketplace 发布均不属于自动构建步骤。用户先审核 README，再单独授权上传。
