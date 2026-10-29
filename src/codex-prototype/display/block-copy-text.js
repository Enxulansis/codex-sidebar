/** DSH 0.1.165 blockSource, token walker and TSV/CSV; original bodies retained. */
export function createBlockText(plainMathText){
const TEXT_BLOCK_BREAK = new Set(['paragraph_open', 'heading_open', 'list_item_open', 'bullet_list_open', 'ordered_list_open', 'blockquote_open']);
function blockSource(source, srcLine, map) {
      if (!map || map.length < 2) return '';
      const rows = String(source || '').replace(/\r/g, '').split('\n');
      /* G27 round2 (0.0.44): 跨行公式占位行 srcLine 存 {from,to}（整段公式源行范围）——
         段落 map 覆盖占位符行时按 to 展开，复制得到完整公式块而非只有起始行。 */
      const conv = (n) => { const v = srcLine ? srcLine[n] : undefined; return (v && typeof v === 'object') ? v.from : (v ?? n); };
      const convEnd = (n) => { const v = srcLine ? srcLine[n] : undefined; return (v && typeof v === 'object') ? v.to : (v ?? n); };
      return rows.slice(conv(map[0]), convEnd(map[1] - 1) + 1).join('\n').trimEnd();
    }
    function tsvToCsv(text) {
      return String(text).split('\n').map(line => line.split('\t').map(cell => (
        /[",\n]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell
      )).join(',')).join('\n');
    }
    function blockPlainText(tokens, openIndex) {
      const parts = [];
      let depth = 0; let inTr = false; let firstCell = true;
      /* 0.0.167（B4 补档）：列表纯文本保留符号与缩进——旧实现丢 bullet/序号/缩进，
         粘贴后看不出层级。listStack 记每层列表的序号状态；itemPrefixPending 防
         "符号与正文之间插入多余换行"（列表项内首个段落 open 不触发 pushLine）。 */
      const listStack = [];
      let itemPrefixPending = false;
      const pushLine = () => {
        if (itemPrefixPending) return;
        if (parts.length > 0 && parts[parts.length - 1] !== '\n') parts.push('\n');
      };
      for (let k = openIndex; k < tokens.length; k += 1) {
        const tk = tokens[k];
        if (tk.type === 'bullet_list_open') { listStack.push({ ordered: false, index: 0 }); depth += 1; continue; }
        if (tk.type === 'ordered_list_open') { listStack.push({ ordered: true, index: 0 }); depth += 1; continue; }
        if (tk.type === 'bullet_list_close' || tk.type === 'ordered_list_close') { listStack.pop(); depth -= 1; if (depth <= 0) break; continue; }
        if (tk.type === 'list_item_open') {
          pushLine();
          const listCtx = listStack[listStack.length - 1];
          let prefix = '';
          if (listCtx !== undefined) {
            listCtx.index += 1;
            prefix = '  '.repeat(Math.max(0, listStack.length - 1)) + (listCtx.ordered ? String(listCtx.index) + '. ' : '- ');
          }
          parts.push(prefix);
          itemPrefixPending = true;
          depth += 1;
          continue;
        }
        if (tk.type === 'tr_open') { if (inTr) pushLine(); inTr = true; firstCell = true; depth += 1; continue; }
        if (tk.type === 'th_open' || tk.type === 'td_open') { if (inTr && !firstCell) parts.push('\t'); if (inTr) firstCell = false; depth += 1; continue; }
        if (tk.type === 'inline' && tk.children) {
          itemPrefixPending = false;
          for (const c of tk.children) {
            if (c.type === 'text') parts.push(plainMathText(c.content));
            else if (c.type === 'code_inline') parts.push(c.content);
            else if (c.type === 'math') parts.push(c.tex != null ? c.tex : (c.content || ''));
            else if (c.type === 'softbreak') parts.push(' ');
            else if (c.type === 'hardbreak') parts.push('\n');
          }
          continue;
        }
        if (TEXT_BLOCK_BREAK.has(tk.type)) pushLine();
        if (tk.type.endsWith('_open')) { depth += 1; continue; }
        if (tk.type.endsWith('_close')) { depth -= 1; if (depth <= 0) break; }
      }
      return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n+/g, '\n').trim();
    }
    /* G27 round2 (0.0.48): 块级右键菜单动作注册表——hover 工具条取前 ≤2 个高频动作
       （复制+折叠，见 attachBlockActions），右键菜单承载全部（复制为 Markdown / 复制纯文本 /
       复制 LaTeX）；未来新增动作只改这里（平移官方 menus.webview/context 时映射 webviewSection）。 */

return {blockSource,blockPlainText,tsvToCsv};
}
