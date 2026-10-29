import {DISPLAY_STYLE} from './display/style';
import {DISCLOSURE_STYLE} from './display/disclosure-style';
import {mathjaxSourceTag} from './display/dsh-math-export';
import {FORMULA_EXPORT_TIMEOUT_MS} from './formula-export-limits';
import {SETTINGS_STYLE,SETTINGS_SIDEBAR_STYLE} from './display/settings-style';
import {SEND_ACK_TIMEOUT_MS} from './send-request';
import {SESSION_STYLE,SESSION_BAR_HTML} from './display/session-style';
import {TURN_RAIL_STYLE} from './display/turn-rail-style';
import {SEARCH_STYLE} from './display/search-style';
import {QUEUE_STYLE} from './display/queue-panel';
import {DICTATION_STYLE} from './display/dictation-style';
import {TOKENS_STYLE} from './display/tokens';
import {FRAME_PICKER_STYLE} from './display/frame-picker-style';
import {MODEL_PICKER_STYLE} from './display/model-picker';
import {PERMISSION_PICKER_STYLE} from './display/permission-picker';
import {NATIVE_USER_INPUT_STYLE} from './display/native-user-input-panel';
import {EDITOR_CONTEXT_STYLE} from './display/editor-attachment-control';
import {NATIVE_SKILLS_STYLE} from './display/native-skills';
import {PAGE_CHROME_STYLE} from './display/page-chrome-style';
import {ATTACHMENT_COUNT} from './attachment-policy';
export function html(nonce: string, scripts: {vendor:string;display:string;mathjax?:string}): string {
  const script=(s:string)=>s.replace(/<\/script/gi,'<\\/script');
  return String.raw`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; worker-src blob:; connect-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:; font-src data:; base-uri 'none'; form-action 'none';">
<meta name="viewport" content="width=device-width,initial-scale=1"><style nonce="${nonce}">
body{font:var(--vscode-font-size)/1.5 var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:0;box-sizing:border-box;height:100vh;display:flex;flex-direction:column;gap:10px}
button,select,textarea{font:inherit;color:inherit;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:5px;padding:6px}button{cursor:pointer}button:focus,textarea:focus,select:focus{outline:1px solid #617ce5}button:disabled{opacity:.5;cursor:default}.primary{background:#4d63b5;color:white}header,nav,footer{display:flex;gap:6px;flex-wrap:wrap;align-items:center}#history{flex:1;min-height:40px;overflow:auto;overscroll-behavior:contain}article{border:1px solid var(--vscode-widget-border,#444);border-radius:7px;margin:8px 0;padding:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}img{max-width:100%;max-height:220px}#approvals article{border-color:#b68b49;max-height:260px;overflow:auto}#error{color:var(--vscode-errorForeground);white-space:pre-wrap}textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:72px}.muted{opacity:.7;font-size:.9em}#threads{max-width:220px}#draft-image{max-width:120px;max-height:80px}h1{font-size:1.1em;margin:0}
${TOKENS_STYLE}
${DISPLAY_STYLE}
${SETTINGS_STYLE}${SETTINGS_SIDEBAR_STYLE}
${SESSION_STYLE}
${TURN_RAIL_STYLE}
${SEARCH_STYLE}
${QUEUE_STYLE}
${DICTATION_STYLE}
${FRAME_PICKER_STYLE}
${MODEL_PICKER_STYLE}
${PERMISSION_PICKER_STYLE}
${NATIVE_USER_INPUT_STYLE}
${EDITOR_CONTEXT_STYLE}
${NATIVE_SKILLS_STYLE}
${PAGE_CHROME_STYLE}
${DISCLOSURE_STYLE}
</style></head><body>
<header><h1>Codex</h1></header>
${SESSION_BAR_HTML}<nav id="legacy-thread-nav"><button id="new" disabled>新建测试线程</button><select id="threads" aria-label="本任务线程"></select><button id="restore" disabled>恢复</button><button id="restart" disabled title="待审批操作将失效并停止，不会自动重发">重启本原型连接</button></nav>
<div id="status" role="status">未连接</div><div id="tools" class="runtime-status status notice" role="note" hidden></div><div id="experience" role="note" hidden><span id="experience-note"></span><button id="experience-open" type="button">离线交互体验</button></div><div id="error" role="alert" hidden></div><div id="copy-status" class="muted" role="status"></div><div id="scroll-status" class="muted" role="status" hidden></div><div id="approvals"></div><main id="history"></main>
<div class="composer-wrap"><section id="composer" class="prototype-composer"><div class="draft-zone"><div id="draft-images" class="attachments"><div id="draft-attachment" class="attachment-chip" hidden><button id="draft-preview" type="button" title="点击预览" disabled><img id="draft-image" class="attach-thumb" hidden></button><span id="attachment" class="attachment-name"></span><button id="draft-remove" type="button" class="attachment-remove" title="移除附件" aria-label="移除附件">✕</button></div></div><div id="draft-files" class="context-chips" hidden></div></div><textarea id="prompt" aria-label="消息" placeholder="输入消息；未连接时仅保存本地草稿"></textarea>
<input id="attachment-input" type="file" multiple hidden aria-label="选择图片或文件"><footer class="composer-row"><div class="left-actions"><button id="attach" class="icon-button" title="附加图片或文件（也可直接拖入 / 粘贴）；图片来源≤25 MiB，发送副本≤5 MiB；文件≤5 MiB，侧栏本地图片和文件合计最多${ATTACHMENT_COUNT}项（非模型上限）" aria-label="附加图片或文件" disabled><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button><button id="settingsOpen" class="icon-button" title="设置" aria-label="设置" disabled><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button></div><span id="composer-model" class="muted"></span><div class="prototype-run-actions"><span id="usage-control"></span><button id="stop" class="icon-button" title="停止" aria-label="停止"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"/></svg></button><button id="send" class="icon-button primary" title="发送（Enter）" aria-label="发送" disabled><svg viewBox="0 0 24 24"><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/></svg></button></div></footer><div id="usage" class="muted"></div><div id="attachment-status" class="muted" role="status"></div><div id="draft-status" class="muted" role="status"></div><div id="draft-recovery" hidden><span id="draft-memory-status" class="muted" role="status"></span><button id="draft-retry" hidden>重试保存／恢复</button><button id="draft-review" hidden title="先检查历史中是否已有这条消息；此操作仅解除草稿保护，不会发送消息">已核对历史，保留为草稿</button></div></section>
</div>${mathjaxSourceTag(scripts.mathjax??'',nonce)}<script nonce="${nonce}">${script(scripts.vendor)}</script><script nonce="${nonce}">${script(scripts.display)}</script>
<script nonce="${nonce}" data-main>
document.addEventListener('pointerdown',()=>{document.body.dataset.input='pointer';});
document.addEventListener('keydown',event=>{if(event.key==='Tab')document.body.dataset.input='keyboard';});
window.__codexDisplay.startPage(${SEND_ACK_TIMEOUT_MS},${FORMULA_EXPORT_TIMEOUT_MS});
</script></body></html>`;
}
