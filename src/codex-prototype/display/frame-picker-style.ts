/** DSH165 webview.ts:771–783, scoped hidden/focus additions for this host. */
export const FRAME_PICKER_STYLE=`
.frame-picker[hidden],.frame-picker.hidden{display:none!important}
.frame-picker { position: fixed; inset: 0; z-index: 52; display: grid; place-items: center; background: rgba(0, 0, 0, .55); }
.frame-picker-box { width: min(420px, calc(100vw - 24px)); max-height: min(70vh, 560px); display: flex; flex-direction: column; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-menu-background, var(--vscode-editor-background)); box-shadow: 0 8px 24px var(--vscode-widget-shadow); }
.frame-picker-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--vscode-widget-border, transparent); font-size: 12px; font-weight: 600; }
.frame-picker-grid { flex: 1; min-height:0; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 6px; padding: 10px; }
.frame-picker-cell { padding: 2px; border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px; background: transparent; cursor: pointer; }
.frame-picker-cell:hover { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
.frame-picker-cell.selected { border-color: var(--vscode-charts-blue, #4d6bfe); }
.frame-picker-cell img { display: block; width: 100%; height: 44px; object-fit: contain; }
.frame-picker-cell span { display: block; text-align: center; font-size: 9px; color: var(--vscode-descriptionForeground); }
.frame-picker-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--vscode-widget-border, transparent); }
.frame-picker-info { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; color: var(--vscode-descriptionForeground); }
.frame-picker #framePickerDefault{flex:0 0 auto;min-height:28px;padding:4px 8px;font-size:12px;font-weight:400;line-height:18px;white-space:nowrap;border-radius:6px}
.frame-badge { flex: 0 0 auto; white-space: nowrap; margin-left: 4px; padding: 0 5px; border: 1px solid var(--vscode-charts-blue, #4d6bfe); border-radius: 999px; color: var(--vscode-charts-blue, #4d6bfe); font-size: 9px; line-height: 15px; }
.frame-picker button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
`;
