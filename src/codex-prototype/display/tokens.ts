/** Shared design tokens and the three base surfaces: panel, row and action bar. */
export const TOKENS_STYLE = String.raw`
    :root {
      --ds-font-11: 11px;
      --ds-font-12: 12px;
      --ds-font-13: 13px;
      --ds-radius-sm: 4px;
      --ds-radius-md: 6px;
      --ds-radius-lg: 8px;
      --ds-space-1: 4px;
      --ds-space-1-5: 6px;
      --ds-space-2: 8px;
      --ds-space-3: 12px;
      --ds-control-sm: 24px;
      --ds-control-md: 28px;
      --ds-panel-border: var(--vscode-widget-border);
      --ds-panel-bg: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      --ds-panel-shadow: 0 2px 10px var(--vscode-widget-shadow);
      --ds-muted: var(--vscode-descriptionForeground);
      --ds-accent: var(--vscode-button-background);
      --ds-accent-fg: var(--vscode-button-foreground);
    }
    .ds-panel { box-sizing:border-box; border:1px solid var(--ds-panel-border); border-radius:var(--ds-radius-lg); background:var(--ds-panel-bg); box-shadow:var(--ds-panel-shadow); }
    .ds-panel-head { display:flex; align-items:center; gap:var(--ds-space-2); padding:var(--ds-space-2) var(--ds-space-3); border-bottom:1px solid var(--ds-panel-border); }
    .ds-panel-body { padding:var(--ds-space-3); }
    .ds-row { display:flex; align-items:flex-start; justify-content:space-between; gap:var(--ds-space-3); padding:var(--ds-space-1) 0; }
    .ds-row-text { min-width:0; display:flex; flex-direction:column; gap:2px; }
    .ds-row-label { font-size:var(--ds-font-12); line-height:1.45; }
    .ds-row-hint { font-size:var(--ds-font-11); line-height:1.45; color:var(--ds-muted); }
    .ds-actions { display:flex; align-items:center; gap:var(--ds-space-1); }
    .ds-button { box-sizing:border-box; height:var(--ds-control-sm); padding:0 var(--ds-space-2); border:1px solid var(--vscode-button-border, transparent); border-radius:var(--ds-radius-sm); font:inherit; font-size:var(--ds-font-12); color:var(--vscode-foreground); background:transparent; }
    .ds-button:hover:not(:disabled) { background:var(--vscode-toolbar-hoverBackground); }
    .ds-button-primary { color:var(--ds-accent-fg); background:var(--ds-accent); border-color:transparent; }
    .ds-button-primary:hover:not(:disabled) { background:var(--vscode-button-hoverBackground); }
    .ds-icon-button { width:var(--ds-control-sm); height:var(--ds-control-sm); padding:0; display:grid; place-items:center; border:0; border-radius:var(--ds-radius-sm); background:transparent; color:var(--vscode-icon-foreground); }
    .ds-icon-button:hover { background:var(--vscode-toolbar-hoverBackground); }
`;
