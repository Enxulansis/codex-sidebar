import {IMAGE_ASSETS} from './image-assets';
import type {DisplayEvent} from './replay';
import type {DisplayImage} from '../display/image-preview';
export const FINAL_MARKDOWN = '# 离线显示回放\n\n这段 **最终正文** 来自合成事件，支持 *强调*、`行内代码` 和表格。\n\n> 引用第一行\n> 引用第二行\n\n10. 保留起始编号\n11. 不触发任何工具\n\n- [x] PNG / JPEG 仅显示\n- [ ] 不代表 JPEG 模型输入已验收\n\n| 项目 | 状态 |\n|:---|---:|\n| Markdown | 已渲染 |\n| 真实调用 | 0 |\n\n```typescript\nconst message = "offline-only";\nconsole.log(message);\n```\n\n[外部链接](https://example.invalid/no-request) · [命令链接](command:workbench.action.reloadWindow)\n\n![外部图片](https://example.invalid/no-image.png)\n\n<script>window.__unsafeExecuted=true</script>\n\n最终校正：正文以完成事件为准。';
const start=(threadId:string,role:'assistant'|'user',text:string,images:string[]=[]):DisplayEvent=>({method:'item/started',params:{threadId,turnId:'turn-1',itemId:role==='assistant'?'same-message-id':'user-1',role,text,images}});
export const FORMULA_MARKDOWN=[
 '# 更多图片与公式（合成案例）',
 '完成后直接点击公式复制 Markdown。播放回放可以观察未闭合到最终公式的过渡；流式期间复制禁用。',
 String.raw`紧贴中文$E=mc^2$，分数$\frac{a+b}{c}$，上下标$x_i^{2}+y_j$与根号$\sqrt{1+x^2}$。`,
 String.raw`括号式 \(\alpha+\beta=\gamma\)，转义价格 \$5；纯数字 $123$ 不当公式；未闭合 $x+1 保留原文。`,
 String.raw`$$\sum_{i=1}^{n}i=\frac{n(n+1)}{2}$$`,
 String.raw`$$
\int_0^1 x^2\,dx=\frac13
$$`,
 String.raw`\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\]`,
 String.raw`$$\begin{aligned}f(x)&=x^2+2x+1\\&=(x+1)^2\end{aligned}$$`,
 String.raw`> 引用里$\theta=\pi/2$，列表同样可点。`,
 String.raw`- 向量$\vec v=(v_x,v_y)$
- 极限$\lim_{n\to\infty}(1+1/n)^n=e$`,
 String.raw`| 类型 | 示例 |
|:---|:---|
| 模长 | $\lVert x\rVert$ |
| 概率 | $P(A\mid B)$ |`,
 '行内代码 `$not_math$` 与双反引号 `` $also_not_math$ `literal` `` 必须保留。',
 '```latex\n$$\\frac{a}{b}$$\n\\(literal\\)\n```',
 '```typescript\n// 中文注释与 English 123 保持原版字体回退\nconst sample = "mixed-language";\n```',
 '## 异常与资源限制样例（预期提示）\n\n以下未知命令及被限制的链接会显示红色提示；末尾“损坏 PNG / 缺失图片”也刻意不可加载。它们用于验证出错时正文仍可使用。',
 String.raw`异常公式$\notARealCommand{x}$可见提示，正文不能崩溃。`,
 String.raw`受限公式$\href{command:workbench.action.reloadWindow}{unsafe}$不能执行链接；$\includegraphics{https://example.invalid/blocked.png}$不能加载资源。`,
 '[命令链接](command:workbench.action.reloadWindow) · ![外部图片](https://example.invalid/blocked.png)',
 '最终校正：本线程只有合成显示内容，宽图、长图、透明 PNG、渐变 JPEG、小图和缺失/损坏图片可分别预览。',
].join('\n\n');
export const BLOCK_COPY_MARKDOWN=[
 '# 块复制合成案例',
 '悬停可见原版复制胶囊。右键按块提供 Markdown / 纯文本；表格提供 Markdown / TSV / CSV。',
 String.raw`普通段落 **加粗**、行内代码 \`$literal$\` 和公式 $E=mc^2$。
第二行软换行保留原Markdown、纯文本合并为空格。`.replace(/\\`/g,'`'),
 String.raw`$$
\frac{a+b}{c}
$$`,
 '## 跨行公式后的标题',
 '> 引用第一行 $x_i$\n> 引用第二行\n>\n> - 嵌套引用列表\n>   - 子项',
 '- 第一项\n  - 子列表项\n- 第二项',
 '10. 起始编号保留\n11. 第二个有序项',
 '| A | B |\n|---|---|\n| 1,2 | "x" |\n| plain | $a+b$ |',
 '```typescript\nconst literal = "$not_math$";  \nconsole.log(literal);\n\n```',
 '    indented-code\n    second-line',
 '[命令链接](command:workbench.action.reloadWindow) · ![外部图片](https://example.invalid/no-load.png)',
].join('\n\n');
export const BLOCK_FOLD_MARKDOWN=[
 '# 超高块折叠合成案例',
 '悬停代码、引用或表格的右侧胶囊，体验折叠与展开；折叠后复制仍然包含全文。设置可调门槛，切换线程及 Reload 后保留手动态。',
 '```typescript\nconst first = 1;\nconst second = 2;\nconst third = 3;\nconst fourth = 4;\nconsole.log(first + second + third + fourth);\n```',
 '> 引用第一行\n> 引用第二行\n> 引用第三行\n> 引用第四行\n> 引用第五行',
 '| 序号 | 内容 |\n|---|---|\n| 1 | 第一行 |\n| 2 | 第二行 |\n| 3 | 第三行 |\n| 4 | 第四行 |\n| 5 | 最后一行也应复制 |',
 '## 恰好三行，不显示折叠按钮',
 '```text\n第一行\n第二行\n第三行\n\n```',
 '    缩进代码第一行\n    缩进代码第二行\n    缩进代码第三行\n    缩进代码第四行',
].join('\n\n');
export const MARKDOWN_BASE_CASES=[
 '# 一级标题 · 基础 Markdown 合成案例',
 '普通段落、**加粗**、*斜体*、~~删除线~~和`inline $literal$`。这里只核验显示，不调用模型。',
 '## 二级标题',
 '段落之间沿用原间距。',
 '### 三级标题',
 '#### 四级标题',
 '##### 五级标题',
 '###### 六级标题',
 '- 普通列表第一项\n  - 嵌套普通列表\n- 普通列表第二项',
 '7. 从七开始\n8. 有序列表第二项',
 '- [x] 已完成任务\n- [ ] 未完成任务\n  - [x] 已完成子任务\n  - [ ] 未完成子任务',
 '---',
 '> 引用保留第一行\n> 引用保留第二行',
 '```python\n# 合成中文注释\nvalue = 1\n\nprint(value)\n```',
 '```unsupported_language\nplain $literal$\nsecond line\n```',
 '    indented code\n    second indented line',
 '| 左列 | 居中列 | 右列 |\n|:---|:---:|---:|\n| table | center | 1 |',
 '[命令链接](command:workbench.action.reloadWindow) · ![外部图片](https://example.invalid/no-image.png)',
 '<input type="checkbox" checked onclick="window.__unsafeExecuted=true">\n<script>window.__unsafeExecuted=true</script>',
 '最终合成正文。原始链接仍不执行，外部资源仍不加载。',
].join('\n\n');
export const USER_FOLD_TEXT=Array.from({length:80},(_,i)=>`长用户消息第 ${i+1} 行 · 合成正文，只用于展开、收起和记忆验证。`).join('\n');
export const USER_COPY_TEXT='用户原文 **Markdown**、`inline $literal$`、中文😀与空行：\n\n'+Array.from({length:600},(_,i)=>`整条复制第${i+1}行：折叠只影响显示，复制必须包含全部正文；不会复制图片路径或启动任何工具。`).join('\n')+'\n最后一行仍应复制。\n';
export const TIMELINES:Record<string,DisplayEvent[]>={
 'offline-assistant-copy':[start('offline-assistant-copy','assistant',''),{method:'item/agentMessage/delta',params:{threadId:'offline-assistant-copy',turnId:'turn-1',itemId:'same-message-id',delta:'# 完整回复复制\n\n生成中先禁用。'}},{method:'item/completed',params:{threadId:'offline-assistant-copy',turnId:'turn-1',itemId:'same-message-id',text:'# 完整合成回复\n\n```text\n'+USER_COPY_TEXT+'\n```\n\n**末尾也必须复制** $x^2$\n'}}],
 'offline-user-copy':[
  {method:'item/started',params:{threadId:'offline-user-copy',turnId:'long',itemId:'user-copy',role:'user',text:USER_COPY_TEXT,images:['png']}},
  {method:'item/completed',params:{threadId:'offline-user-copy',turnId:'long',itemId:'user-copy',text:USER_COPY_TEXT}},
  {method:'item/started',params:{threadId:'offline-user-copy',turnId:'image',itemId:'user-image-only',role:'user',text:'',images:['png']}},
  {method:'item/completed',params:{threadId:'offline-user-copy',turnId:'image',itemId:'user-image-only',text:''}},
 ],
 'offline-user-fold':[
  {method:'item/started',params:{threadId:'offline-user-fold',turnId:'short',itemId:'user-short',role:'user',text:'短消息保留全文。'}},
  {method:'item/completed',params:{threadId:'offline-user-fold',turnId:'short',itemId:'user-short',text:'短消息保留全文。'}},
  {method:'item/started',params:{threadId:'offline-user-fold',turnId:'long',itemId:'user-long',role:'user',text:USER_FOLD_TEXT,images:['png']}},
  {method:'item/completed',params:{threadId:'offline-user-fold',turnId:'long',itemId:'user-long',text:USER_FOLD_TEXT}},
  {method:'item/started',params:{threadId:'offline-user-fold',turnId:'latest',itemId:'user-latest',role:'user',text:USER_FOLD_TEXT}},
  {method:'item/completed',params:{threadId:'offline-user-fold',turnId:'latest',itemId:'user-latest',text:USER_FOLD_TEXT}},
 ],
 'offline-markdown':[start('offline-markdown','assistant',''),{method:'item/agentMessage/delta',params:{threadId:'offline-markdown',turnId:'turn-1',itemId:'same-message-id',delta:MARKDOWN_BASE_CASES.slice(0,320)}},{method:'item/completed',params:{threadId:'offline-markdown',turnId:'turn-1',itemId:'same-message-id',text:MARKDOWN_BASE_CASES}}],
 'offline-fold':[start('offline-fold','assistant',''),{method:'item/agentMessage/delta',params:{threadId:'offline-fold',turnId:'turn-1',itemId:'same-message-id',delta:BLOCK_FOLD_MARKDOWN}},{method:'item/completed',params:{threadId:'offline-fold',turnId:'turn-1',itemId:'same-message-id',text:BLOCK_FOLD_MARKDOWN}}],
 'offline-copy':[start('offline-copy','assistant',''),{method:'item/agentMessage/delta',params:{threadId:'offline-copy',turnId:'turn-1',itemId:'same-message-id',delta:BLOCK_COPY_MARKDOWN.slice(0,140)}},{method:'item/completed',params:{threadId:'offline-copy',turnId:'turn-1',itemId:'same-message-id',text:BLOCK_COPY_MARKDOWN}}],
 'offline-alpha':[
  start('offline-alpha','user','请回放 Markdown 和图片显示。所有内容与图片均为合成素材。',['png','jpeg','missing']),
  {method:'item/completed',params:{threadId:'offline-alpha',turnId:'turn-1',itemId:'user-1',text:'请回放 Markdown 和图片显示。所有内容与图片均为合成素材。'}},
  start('offline-alpha','assistant',''),
  ...['# 离线显示回放\n\n','正在逐步显示 **正文**。\n\n','```typescript\nconst message = "streaming";\n','console.log(message);\n```\n'].map(delta=>({method:'item/agentMessage/delta' as const,params:{threadId:'offline-alpha',turnId:'turn-1',itemId:'same-message-id',delta}})),
  {method:'item/completed',params:{threadId:'offline-alpha',turnId:'turn-1',itemId:'same-message-id',text:FINAL_MARKDOWN}},
 ],
 'offline-beta':[start('offline-beta','user','这是线程 B，消息 ID 故意与 A 重复。'),start('offline-beta','assistant',''),{method:'item/completed',params:{threadId:'offline-beta',turnId:'turn-1',itemId:'same-message-id',text:'## 线程 B\n\n这里只属于 **B**。A 的迟到正文、代码复制结果和图片预览不会进入本线程。\n\n```text\nB-only\n```'}}],
 'offline-cases':[
  start('offline-cases','user','新增素材只用于离线显示，不是模型图片输入验收。',['wide','tall','transparent','gradient','tiny','missing','corrupt']),
  {method:'item/completed',params:{threadId:'offline-cases',turnId:'turn-1',itemId:'user-1',text:'新增素材只用于离线显示，不是模型图片输入验收。'}},
  start('offline-cases','assistant',''),
  ...['# 公式流式过渡\n\n已闭合 $E=mc^2$。\n\n未闭合 $$\\frac{','a+b}{c}', '$$\n\n最终正文会补入矩阵与更多案例。'].map(delta=>({method:'item/agentMessage/delta' as const,params:{threadId:'offline-cases',turnId:'turn-1',itemId:'same-message-id',delta}})),
  {method:'item/completed',params:{threadId:'offline-cases',turnId:'turn-1',itemId:'same-message-id',text:FORMULA_MARKDOWN}},
 ],
};
export function syntheticImages():Record<string,DisplayImage>{return {...IMAGE_ASSETS};}
