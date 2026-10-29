import {PREVIEW_STYLE} from '../display/preview-style';
import {MATH_STYLE} from '../display/math-style';
import {TEXT_STYLE} from '../display/text-style';
import {mathjaxSourceTag} from '../display/dsh-math-export';
import {SETTINGS_STYLE,SETTINGS_SIDEBAR_STYLE} from '../display/settings-style';
import {BLOCK_COPY_STYLE} from '../display/block-copy-style';
import {BLOCK_FOLD_STYLE} from '../display/block-fold';
import {BLOCK_LAYOUT_STYLE} from '../display/block-layout-style';
import {MARKDOWN_STYLE} from '../display/markdown-style';
import {USER_MESSAGE_FOLD_STYLE} from '../display/user-message-fold';
import {MESSAGE_ACTION_STYLE} from '../display/message-actions';
import {CLOCK_STYLE} from '../display/message-tail';
import {USAGE_STYLE} from '../display/usage-details';
import {COMPOSER_STYLE} from '../display/composer';
import {MESSAGE_LAYOUT_STYLE} from '../display/message-layout';
import {ACTIVITY_STYLE} from '../display/activity';
import {FILE_REFERENCE_STYLE} from '../display/file-references';
import {DISCLOSURE_STYLE} from '../display/disclosure-style';
export function offlineHtml(vendor:string,browser:string,nonce:string,mathjax=''):string {
  // A self-contained document: no server, fetch, URL navigation or external resources.
  const script=(s:string)=>s.replace(/<\/script/gi,'<\\/script');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; worker-src blob:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; font-src data:; base-uri 'none'; form-action 'none';">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Codex 离线显示演示</title>
<style nonce="${nonce}">
${DISCLOSURE_STYLE}
:root{color-scheme:dark;font-family:var(--vscode-font-family,system-ui);font-size:var(--vscode-font-size,15px);color:var(--vscode-foreground,#ddd);background:var(--vscode-editor-background,#181a20)}*{box-sizing:border-box}body{margin:0;padding:20px;max-width:960px;margin-inline:auto}h1{font-size:22px;margin:0}header p{margin:7px 0;color:#aeb6cf}nav{display:flex;gap:8px;flex-wrap:wrap;position:sticky;top:0;background:#181a20;padding:14px 0;z-index:2}button,select{font:inherit;color:inherit;background:#252936;border:1px solid #454c63;border-radius:6px;padding:7px 12px;cursor:pointer}button:hover{border-color:#7188e7}button:focus-visible,select:focus-visible{outline:2px solid #7188e7}button:disabled{cursor:default;opacity:.7}.primary{background:#5268bc;border-color:#667bd5}#progress,#copy-result{color:#aeb6cf;font-size:13px;min-height:20px}article{background:#20232b;border:1px solid #353b4e;border-radius:10px;padding:18px;margin:12px 0}.message-label{font-size:13px;color:#9caedc;margin-bottom:10px}.plain-body{white-space:pre-wrap;overflow-wrap:anywhere}.markdown{overflow-wrap:anywhere}.inert-link{color:#90a7ed;text-decoration:underline dotted;cursor:default}.missing-image{color:#d2b48c}.image-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.image-card{display:flex;flex-direction:column;align-items:flex-start;gap:6px;max-width:230px}.image-card img{max-width:200px;max-height:130px}${PREVIEW_STYLE}.notice{font-size:13px;color:#aeb6cf;border:1px solid #39445f;padding:10px;border-radius:8px}
${MATH_STYLE}${TEXT_STYLE}${BLOCK_COPY_STYLE}${BLOCK_FOLD_STYLE}${BLOCK_LAYOUT_STYLE}${MARKDOWN_STYLE}${USER_MESSAGE_FOLD_STYLE}${MESSAGE_ACTION_STYLE}${CLOCK_STYLE}${USAGE_STYLE}${COMPOSER_STYLE}${SETTINGS_STYLE}${SETTINGS_SIDEBAR_STYLE}${MESSAGE_LAYOUT_STYLE}${ACTIVITY_STYLE}${FILE_REFERENCE_STYLE}.conversation{overflow:clip}.conversation .msg-fold-toggle{z-index:1}</style></head><body><header><h1>Codex 离线显示演示</h1><p>DSH Markdown、公式与静态图片预览 · 脱敏显示事件 / 合成素材</p><div class="notice">离线模式：不启动 App Server，不调用模型或 MCP，两批12/12与2/2账本不变。外链不执行、外部资源不加载；本地文件引用仅限受控工作区，不发送给模型。JPEG 仅验证显示。</div></header>
<nav><select id="threads" aria-label="离线线程"><option value="offline-alpha">线程 A · Markdown 与图片</option><option value="offline-beta">线程 B · 身份隔离</option><option value="offline-cases">线程 C · 更多图片与公式</option><option value="offline-copy">线程 D · 块复制案例</option><option value="offline-fold">线程 E · 超高块折叠</option><option value="offline-markdown">线程 F · 基础 Markdown</option><option value="offline-user-fold">线程 G · 长用户消息</option><option value="offline-user-copy">线程 H · 用户消息复制</option><option value="offline-assistant-copy">线程 I · 整条回复复制</option></select><button id="replay" class="primary">播放流式回放</button><button id="next">下一事件</button><button id="finish">显示最终正文</button><button id="reset">重置回放</button><button id="plain">对比原纯文本</button></nav>
<div id="progress" role="status"></div><div id="copy-result" role="status"></div><main id="history" class="conversation"></main>
<footer id="offline-usage" class="offline-usage-footer"></footer>
${mathjaxSourceTag(mathjax,nonce)}<script nonce="${nonce}">${script(vendor)}</script><script nonce="${nonce}">${script(browser)}</script></body></html>`;
}
