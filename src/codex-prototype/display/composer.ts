/** Original 165 idle shortcuts. Busy queue/steer and command routing stay outside display. */
export const PROMPT_MAX_HEIGHT=220;
export function promptSendKey(e:Pick<KeyboardEvent,'key'|'shiftKey'|'isComposing'|'keyCode'|'repeat'>){return e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229&&!e.repeat;}
export class PromptComposer{
 private observer:ResizeObserver;private composing=false;
 constructor(private prompt:HTMLTextAreaElement,private send:HTMLButtonElement){prompt.addEventListener('input',this.resize);prompt.addEventListener('keydown',this.key);prompt.addEventListener('compositionstart',this.start);prompt.addEventListener('compositionend',this.end);this.observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width!==this.width){this.width=width;this.resize();}});this.observer.observe(prompt);this.resize();window.addEventListener('pagehide',this.dispose,{once:true});}
 private width:number|undefined;
 resize=()=>{this.prompt.style.height='auto';this.prompt.style.height=Math.min(this.prompt.scrollHeight,PROMPT_MAX_HEIGHT)+'px';};
 private start=()=>{this.composing=true;};private end=()=>{this.composing=false;this.resize();};
 private key=(e:KeyboardEvent)=>{if(this.composing||e.isComposing||e.keyCode===229||e.shiftKey||e.key!=='Enter')return;if(e.repeat){e.preventDefault();return;}if(promptSendKey(e)){e.preventDefault();if(!this.send.disabled)this.send.click();}};
 dispose=()=>{this.observer.disconnect();this.prompt.removeEventListener('input',this.resize);this.prompt.removeEventListener('keydown',this.key);this.prompt.removeEventListener('compositionstart',this.start);this.prompt.removeEventListener('compositionend',this.end);window.removeEventListener('pagehide',this.dispose);};
}

export const COMPOSER_STYLE=`
    /* DSH conversation gutter, shared by messages, process bars and tool cards. */
    #history { box-sizing:border-box; padding-inline:14px; scrollbar-gutter:stable both-edges; }
    #history > article { box-sizing:border-box; width:100%; max-width:var(--content-max,760px); margin-inline:auto; }
    #composer { position:relative; box-sizing:border-box; width:min(100%,var(--column-available,100%)); min-width:0; max-width:var(--content-max,760px); margin:0 auto; border:1px solid var(--vscode-input-border,var(--vscode-widget-border)); border-radius:12px; background:var(--vscode-input-background); box-shadow:0 2px 10px color-mix(in srgb,var(--vscode-widget-shadow) 75%,transparent); gap:0; flex-shrink:0; }
    #composer textarea { width:100%; min-height:72px; max-height:220px; resize:none; display:block; padding:11px 12px 4px; border:0; outline:0; background:transparent; color:var(--vscode-input-foreground); }
    #composer textarea:focus, #composer textarea:focus-visible { outline:none; }
    #composer footer { min-width:0; padding:4px 6px 6px; min-height:39px; box-sizing:border-box; }
    #composer #image-path { font:inherit; color:var(--vscode-input-foreground); background:var(--vscode-input-background); border:1px solid var(--vscode-input-border,var(--vscode-widget-border)); border-radius:6px; padding:5px 6px; max-width:100%; box-sizing:border-box; }
    #composer .composer-row { width:100%; min-width:0; min-height:39px; padding:4px 6px 6px; display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:5px; }
    #composer .left-actions { display:flex; align-items:center; gap:2px; min-width:0; }
    #composer .icon-button { width:28px; height:28px; min-width:28px; padding:0; display:grid; place-items:center; border:0; border-radius:6px; background:transparent; color:var(--vscode-icon-foreground); }
    #composer .icon-button:hover { background:var(--vscode-toolbar-hoverBackground); }
    #composer .icon-button svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
    #composer #send { border-radius:8px; color:var(--vscode-button-foreground,#fff); background:var(--vscode-button-background,#4d6bfe); }
    #composer #send:hover:not(:disabled) { background:var(--vscode-button-hoverBackground,var(--vscode-button-background,#4d6bfe)); }
    #composer #stop { color:var(--vscode-errorForeground); }
    #composer #stop:disabled { display:none; }
    #composer #composer-model { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; }
    #composer #usage { min-width:0; padding:0 12px 8px; color:var(--vscode-descriptionForeground); font-size:10px; line-height:14px; }
    #composer #workspace-image { position:relative; flex:0 0 auto; font-size:11px; color:var(--vscode-descriptionForeground); }
    #composer #workspace-image summary { cursor:pointer; padding:4px; list-style:none; border-radius:6px; white-space:nowrap; }
    #composer #workspace-image summary:hover { background:var(--vscode-toolbar-hoverBackground); }
    #composer #workspace-image > div { position:absolute; z-index:35; left:0; bottom:calc(100% + 8px); width:min(290px,calc(100vw - 70px)); display:flex; flex-wrap:wrap; gap:5px; padding:8px; border:1px solid var(--vscode-widget-border); border-radius:8px; background:var(--vscode-menu-background,var(--vscode-editor-background)); box-shadow:0 5px 18px var(--vscode-widget-shadow); }
    #composer #workspace-image:not([open]) > div { display:none; }
    #composer #workspace-image input { width:100%; }
    #composer #draft-files { display:flex; flex-wrap:wrap; gap:5px; padding:8px 10px 0; }
    #composer #draft-files[hidden] { display:none; }
    #composer .draft-file-chip { min-width:0; max-width:100%; display:flex; align-items:center; gap:5px; padding:3px 5px 3px 8px; border:1px solid var(--vscode-widget-border); border-radius:6px; color:var(--vscode-descriptionForeground); background:var(--vscode-editor-background); }
    #composer .chip-file { cursor:pointer; }
    #composer .chip-file:hover { border-color:color-mix(in srgb,var(--vscode-charts-blue,#4d6bfe) 45%,var(--vscode-widget-border)); }
    #composer .chip-file.unavailable { color:var(--vscode-disabledForeground); }
    #composer .draft-file-chip .context-icon { flex:0 0 auto; }
    #composer .draft-file-chip.importing { cursor:progress; }
    #composer .draft-file-chip.importing .connection-spinner { flex:0 0 11px; }
    #composer .draft-file-chip .context-icon img { width:16px; height:16px; display:block; margin:0 auto; }
    #composer .draft-file-chip .attachment-name { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    #composer .draft-file-chip .attachment-remove { width:18px; height:18px; padding:2px 0; border:0; border-radius:4px; background:transparent; display:inline-flex; align-items:center; justify-content:center; font-size:13px; line-height:1; flex:0 0 auto; }
    #composer .draft-file-chip .attachment-remove:hover { background:var(--vscode-toolbar-hoverBackground); }
    #composer.file-drag { border-color:#4d6bfe; box-shadow:0 0 0 1px color-mix(in srgb,#4d6bfe 35%,transparent); }
    #attachment-status:empty { display:none; }
    #attachment-status:not(:empty)[data-kind="progress"] { color:var(--vscode-descriptionForeground); }
    #attachment-status:not(:empty) { position: absolute; left: 2px; right: 2px; bottom: calc(100% + 4px); z-index: 6; box-sizing: border-box; max-height: 30vh; overflow: auto; padding: 6px 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-editorWidget-background, #252526); color: var(--vscode-editorWarning-foreground, #cca700); font-size: 11px; box-shadow: 0 2px 10px var(--vscode-widget-shadow, rgba(0, 0, 0, .35)); pointer-events: none; overflow-wrap:anywhere; }
    #draft-status:empty { display:none; }
    #draft-status:not(:empty) { padding:0 12px 8px; color:var(--vscode-descriptionForeground); overflow-wrap:anywhere; }
    #draft-recovery:not([hidden]) { display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding:0 12px 8px; }
    #draft-recovery span { flex:1 1 240px; overflow-wrap:anywhere; color:var(--vscode-descriptionForeground); }
    #draft-recovery button { font-size:.9em; padding:3px 6px; }
    /* Local draft controls also exist before a model picker is available. */
    @media(max-width:480px) {
      #composer .composer-row { display:flex; flex-wrap:wrap; }
      #composer .left-actions { flex:0 1 auto; flex-wrap:wrap; max-width:100%; }
      #composer #composer-model { flex:0 0 100%; width:100%; order:-1; margin-left:0; }
      #composer .prototype-run-actions { flex:0 1 auto; max-width:100%; margin-left:auto; }
    }
`;
