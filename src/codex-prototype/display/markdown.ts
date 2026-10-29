/** Minimal DOM path adapted from DSH webview renderInlineTokens/walkBlocks/renderFence.
 * Uses the unchanged DSH markdown-vendor-entry parser and highlighter.
 * No transport, file opening, approvals or resource fetching belongs here. */
import {appendMath,prepareMath} from './dsh-math';
import {attachBlockCopy,type BlockCopyOptions} from './block-copy';
import {markFileHref,bindFileReferences,type FileReferenceOptions} from './file-references';
import {syntaxTokens} from './syntax-token-cache';
export type CopyText = (text: string) => Promise<void>;
const node = (tag: string, cls = '', text?: string) => {
  const el = document.createElement(tag); el.className = cls;
  if (text !== undefined) el.textContent = text; return el;
};
export function renderMarkdown(source: string, copyText: CopyText, isCurrent: () => boolean, options:BlockCopyOptions&FileReferenceOptions = {}): HTMLElement {
  source=String(source).replace(/\r/g,'');
  const root = node('div', 'markdown'+(options.streaming?' streaming':''));
  const vendor = (window as any).__g15md;
  const md=vendor.createMd();let prepared:ReturnType<typeof prepareMath>;
  try{prepared=prepareMath(source,md);}catch{root.textContent=source;return root;}
  const tokens = md.parse(prepared.source, {});
  function inline(parent: HTMLElement, token: any) {
    const stack = [parent];
    for (const t of token.children ?? []) {
      const top = stack[stack.length - 1]!;
      switch (t.type) {
        case 'text': appendMath(top,t.content,prepared,copyText,isCurrent,options); break;
        case 'code_inline': top.append(node('code', '', t.content)); break;
        case 'strong_open': case 'em_open': case 's_open': { const el = node(t.tag); top.append(el); stack.push(el); break; }
        case 'link_open': { // Both experimental surfaces keep links inert, including HTTPS.
          const el = node('span', 'inert-link'); el.title = '受限显示：链接不执行、不访问'; markFileHref(el,t.attrGet('href'),options); top.append(el); stack.push(el); break;
        }
        case 'image': top.append(node('span', 'missing-image', '[图片: ' + (t.content || 'image') + ' · 外部资源已禁用]')); break;
        case 'softbreak': if (top.closest('blockquote')) top.append(node('br')); else top.append(document.createTextNode(' ')); break;
        case 'hardbreak': top.append(node('br')); break;
        case 'html_inline': { // Only the parser's task-list checkbox, never arbitrary HTML.
          if (/^<input\s[^>]*type="checkbox"[^>]*>$/.test(t.content)) {
            const el = document.createElement('input'); el.type = 'checkbox'; el.disabled = true;
            el.checked = /\bchecked(?:=""|="checked")?/.test(t.content); top.append(el);
          } break;
        }
        default: if (t.type.endsWith('_close') && stack.length > 1) stack.pop();
      }
    }
  }
  function code(token: any): HTMLElement {
    const wrap = node('div', 'code-wrap'); const pre = node('pre', 'shiki'); const body = node('code', '', token.content);
    pre.append(body); wrap.append(pre);
    const lang = String(token.info || '').trim().split(/\s+/)[0];
    if (lang) {wrap.dataset.markdownPending='syntax';void syntaxTokens(vendor,lang,token.content).then((lines: any) => {
      if (!lines || !isCurrent() || !body.isConnected) return;
      body.replaceChildren(); let last = lines.length - 1;
      while (last >= 0 && !lines[last]?.length) last--;
      for (let i = 0; i <= last; i++) {
        const row = node('span', 'shiki-line');
        for (const t of lines[i] ?? []) { const s = node('span', '', t.content); s.style.color = t.color; row.append(s); }
        body.append(row);
      }
    }).catch(() => {}).finally(()=>{delete wrap.dataset.markdownPending;});}
    return wrap;
  }
  // DSH's stack-based block walker, including ordered-list start and guarded table close.
  const stack = [root];
  const openTags: Record<string, string> = {paragraph_open:'p',bullet_list_open:'ul',ordered_list_open:'ol',list_item_open:'li',blockquote_open:'blockquote',table_open:'table',thead_open:'thead',tbody_open:'tbody',tr_open:'tr',th_open:'th',td_open:'td'};
  for (const [index,t] of tokens.entries()) {
    const top = stack[stack.length - 1]!;
    if (t.type === 'heading_open' || openTags[t.type]) {
      const el = node(t.type === 'heading_open' ? t.tag : openTags[t.type]!);
      if (t.type === 'ordered_list_open' && t.attrGet('start')) el.setAttribute('start', t.attrGet('start'));
      if (t.type === 'td_open' || t.type === 'th_open') { const align = /text-align:\s*(left|center|right)/.exec(t.attrGet('style') || ''); if (align) el.style.textAlign = align[1]!; }
      if(t.type==='table_open'){const wrap=node('div','table-wrap');wrap.append(el);top.append(wrap);attachBlockCopy(wrap,t,tokens,index,source,prepared,'table','复制表格(Markdown)',copyText,isCurrent,options);}
      else {top.append(el);const kinds:Record<string,[string,string]>={heading_open:['heading','复制标题'],paragraph_open:['paragraph','复制段落'],list_item_open:['list','复制列表项'],blockquote_open:['quote','复制引用']};const kind=t.type==='heading_open'?kinds.heading_open:kinds[t.type];if(kind&&!(t.type==='paragraph_open'&&['LI','BLOCKQUOTE'].includes(top.tagName)))attachBlockCopy(el,t,tokens,index,source,prepared,kind[0],kind[1],copyText,isCurrent,options);}
      stack.push(el);
    } else if (t.type === 'inline') {
      // 165 task-list handling: inline is inside LI > P, so find the nearest LI.
      const kids=t.children||[];
      const check=kids.length>0&&kids[0].type==='html_inline'&&kids[0].content.indexOf('checkbox')>=0;
      if(check){let liAt=stack.length-1;while(liAt>=0&&stack[liAt]!.tagName!=='LI')liAt--;
        if(liAt>=0){stack[liAt]!.classList.add('task-list-item');if(liAt>=1)stack[liAt-1]!.classList.add('contains-task-list');}}
      inline(top,t);
    }
    else if (t.type === 'fence' || t.type === 'code_block') {const wrap=code(t);top.append(wrap);attachBlockCopy(wrap,t,tokens,index,source,prepared,'code','复制代码块',copyText,isCurrent,options);}
    else if (t.type === 'hr') top.append(node('hr'));
    else if (t.type.endsWith('_close') && stack.length > 1) stack.pop();
    // html_block/html_inline are deliberately not inserted. No innerHTML renderer.
  }
  bindFileReferences(root,options.openFile,isCurrent);
  return root;
}
