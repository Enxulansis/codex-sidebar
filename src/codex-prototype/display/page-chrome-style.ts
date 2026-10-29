/** DSH 165 page defaults and composer surround; session/runtime controls keep their own styles. */
export const PAGE_CHROME_STYLE=String.raw`
    :root { color-scheme: light dark; --quota-color-lightness:68%; --editor-font: 'DSH CJK', var(--vscode-editor-font-family); }
    /* Native popups follow the editor theme even when the OS uses the opposite scheme. */
    body.vscode-dark, body.vscode-high-contrast, body[data-vscode-theme-kind="vscode-dark"], body[data-vscode-theme-kind="vscode-high-contrast"] { color-scheme:dark; --quota-color-lightness:68%; }
    body.vscode-light, body.vscode-high-contrast-light, body[data-vscode-theme-kind="vscode-light"], body[data-vscode-theme-kind="vscode-high-contrast-light"] { color-scheme:light; --quota-color-lightness:28%; }
    * { box-sizing: border-box; }
    [hidden] { display:none !important; }
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 13px/1.5 var(--vscode-font-family); }
    button, select, textarea, input { font: inherit; color: inherit; }
    select, select option, select optgroup { color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground,var(--vscode-foreground))); background-color:var(--vscode-dropdown-background,var(--vscode-input-background,var(--vscode-editor-background))); }
    select { border-color:var(--vscode-dropdown-border,var(--vscode-input-border,var(--vscode-widget-border))); }
    button { cursor: pointer; }
    body { display:flex; flex-direction:column; gap:0; }
    body > header { display:none; }
    button:focus { outline:none; }
    .icon-button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible, button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    body[data-input="pointer"] :focus-visible:not(input):not(textarea):not(select) { outline: none; }
    #status { flex-shrink:0; padding:4px 12px; font-size:12px; }
    #tools { flex-shrink:0; margin:4px 8px; }
    #copy-status:empty, #approvals:empty { display:none; }
    #copy-status:not(:empty), #scroll-status:not([hidden]) { padding:4px 12px; }
    #history { overflow-x:hidden; }
    #experience { flex:none; display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding:6px 12px; font-size:12px; color:var(--vscode-descriptionForeground); }
    #experience button { flex-shrink:0; padding:3px 7px; }
    #composer .usage-trigger svg { width:14px; height:14px; }
    .composer-wrap { width:100%; min-width:0; padding:0 10px 10px; position:relative; flex-shrink:0; background:linear-gradient(transparent,var(--vscode-sideBar-background) 18px); }
`;
