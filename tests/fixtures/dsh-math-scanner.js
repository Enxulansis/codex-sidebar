// DSH MIT reference scanner, retained for independent parity testing.
const MATH_SENTINEL="\uE000";
function mathSegments(text) {
      const out = [];
      const src = String(text).split('\\$').join(MATH_SENTINEL);
      let last = 0;
      const flushText = (until) => {
        if (until > last) out.push({ type: 'text', text: src.slice(last, until) });
        last = until;
      };
      let i = 0;
      while (i < src.length) {
        const ch = src[i];
        if (ch === '$') {
          const display = src[i + 1] === '$';
          const openLen = display ? 2 : 1;
          const endMark = display ? '$$' : '$';
          let j = i + openLen; let content = ''; let closed = false;
          while (j < src.length) {
            if (src.startsWith(endMark, j)) { closed = true; break; }
            content += src[j]; j += 1;
          }
          if (closed && !display) {
            if (content !== content.trim() || content.indexOf('\n') >= 0) closed = false;
          }
          if (closed) {
            const trimmed = content.trim();
            if (trimmed.length === 0 || trimmed.length > 2000 || trimmed.endsWith(',') || /^[0-9]+$/.test(trimmed)) closed = false;
          }
          if (closed) {
            const tex = content.trim();
            flushText(i);
            /* G27 round2 (0.0.44): raw = trim 前的原文——srcLine 行号推进需真实行数
               （多行 $$ 块 tex 被 trim 后无换行，会少算 2 行 → 后续块复制错位）。 */
            out.push({ type: 'math', display, tex, raw: content });
            last = j + (display ? 2 : 1);
            i = last;
            continue;
          }
        }
        if (ch === '\\' && src[i + 1] === '(') {
          let j = i + 2; let content = ''; let closed = false;
          while (j < src.length) {
            if (src.startsWith('\\', j) && src[j + 1] === ')') { closed = true; break; }
            content += src[j]; j += 1;
          }
          if (closed && content.trim().length > 0 && content.trim().length <= 2000) {
            flushText(i); out.push({ type: 'math', display: false, tex: content, raw: content });
            last = j + 2; i = last; continue;
          }
        }
        if (ch === '\\' && src[i + 1] === '[') {
          let j = i + 2; let content = ''; let closed = false;
          while (j < src.length) {
            if (src.startsWith('\\', j) && src[j + 1] === ']') { closed = true; break; }
            content += src[j]; j += 1;
          }
          if (closed && content.trim().length > 0 && content.trim().length <= 2000) {
            flushText(i); out.push({ type: 'math', display: true, tex: content, raw: content });
            last = j + 2; i = last; continue;
          }
        }
        i += 1;
      }
      flushText(src.length);
      for (const seg of out) if (seg.type === 'text') seg.text = seg.text.split(MATH_SENTINEL).join('$');
      return out;
    }

module.exports=mathSegments;
