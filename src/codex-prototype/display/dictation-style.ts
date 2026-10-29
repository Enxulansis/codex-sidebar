/** Compact voice-input bar above the composer; panel and actions come from tokens. */
export const DICTATION_STYLE = String.raw`
    .dictation-bar { box-sizing:border-box; width:min(100%,var(--column-available,100%)); max-width:var(--content-max,760px); margin:0 auto var(--ds-space-1-5); display:flex; flex-wrap:wrap; align-items:center; gap:var(--ds-space-1-5); padding:var(--ds-space-1-5) var(--ds-space-2); box-shadow:none; color:var(--vscode-foreground); }
    .dictation-bar[hidden] { display:none; }
    .dictation-dot { width:8px; height:8px; flex:0 0 8px; border-radius:50%; background:var(--vscode-disabledForeground); }
    .dictation-bar[data-active="true"] .dictation-dot { background:var(--vscode-errorForeground); animation:dictation-pulse 1.2s ease-in-out infinite; }
    .dictation-bar[data-state="error"] .dictation-dot { background:var(--vscode-errorForeground); animation:none; }
    .dictation-status { font-size:var(--ds-font-12); line-height:16px; white-space:nowrap; }
    .dictation-bar[data-state="error"] .dictation-status { flex:1 1 auto; min-width:0; white-space:normal; overflow-wrap:anywhere; }
    .dictation-live { flex:1 1 100%; order:1; min-width:0; font-size:var(--ds-font-12); line-height:16px; color:var(--vscode-descriptionForeground); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .dictation-language-wrap { position:relative; flex:0 1 auto; min-width:0; max-width:220px; }
    .dictation-language-trigger { box-sizing:border-box; width:100%; height:var(--ds-control-sm); display:flex; align-items:center; gap:var(--ds-space-1); padding:0 var(--ds-space-1-5); font:inherit; font-size:var(--ds-font-12); color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground)); background:var(--vscode-dropdown-background,var(--vscode-input-background)); border:1px solid var(--vscode-dropdown-border,var(--vscode-input-border,var(--vscode-widget-border))); border-radius:var(--ds-radius-sm); cursor:pointer; }
    .dictation-language-trigger:disabled { opacity:.55; cursor:default; }
    .dictation-language-label { min-width:0; flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; }
    .dictation-caret { flex:0 0 auto; display:flex; align-items:center; opacity:.8; }
    .dictation-language-menu { position:absolute; left:0; bottom:calc(100% + var(--ds-space-1)); z-index:60; min-width:100%; max-width:260px; max-height:180px; overflow:auto; padding:var(--ds-space-1); border:1px solid var(--vscode-widget-border); border-radius:var(--ds-radius-md); background:var(--vscode-menu-background,var(--vscode-editorWidget-background,var(--vscode-sideBar-background))); box-shadow:0 4px 14px var(--vscode-widget-shadow); }
    .dictation-language-menu[hidden] { display:none; }
    .dictation-language-option { box-sizing:border-box; width:100%; display:block; padding:4px 6px; border:0; border-radius:var(--ds-radius-sm); background:transparent; color:inherit; font:inherit; font-size:var(--ds-font-12); text-align:left; white-space:nowrap; cursor:pointer; }
    .dictation-language-option:hover, .dictation-language-option[aria-selected="true"] { background:var(--vscode-toolbar-hoverBackground); }
    .dictation-language-native { position:absolute; inset:0; width:100%; height:100%; opacity:0; pointer-events:none; border:0; padding:0; background:var(--vscode-dropdown-background,var(--vscode-input-background)); color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground)); }
    .dictation-primary { margin-left:auto; }
    @keyframes dictation-pulse { 0%,100% { opacity:.35; } 50% { opacity:1; } }
    @media(prefers-reduced-motion:reduce) { .dictation-bar[data-active="true"] .dictation-dot { animation:none; } }
    [data-motion="off"] .dictation-bar[data-active="true"] .dictation-dot { animation:none; }
`;
