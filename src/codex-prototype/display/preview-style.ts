/** Static selectors copied from DSH 0.1.165 webview.ts:749–789.
 * Shared box sizing/focus are scoped to the preview; theme values stay VS Code-owned. */
export const ANIMATION_PREVIEW_STYLE=`
.preview-controls { display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap:wrap; }
.preview-controls .preview-action { width: auto; height: 22px; padding: 0 9px; margin-left: 0; font-size: 11px; white-space: nowrap; }
.preview-frame-label { color: var(--vscode-descriptionForeground); font-size: 11px; }
.preview-select { display: inline-flex; align-items: center; gap: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; cursor: pointer; }
.preview-controls[hidden],.preview-select[hidden]{display:none!important}
.image-preview[data-frame-count] .image-preview-hint{max-width:100%;white-space:normal;flex-wrap:wrap;justify-content:center}
.image-preview[data-frame-count] .preview-hint-text{min-width:0;max-width:100%;text-align:center}
`;
export const PREVIEW_STYLE = `
.image-preview[hidden],.image-preview.hidden{display:none!important}
.image-preview,.image-preview *{box-sizing:border-box}
.image-preview { position: fixed; inset: 0; z-index: 50; overflow: hidden; background: rgba(0, 0, 0, .72); cursor: move; touch-action: none; user-select: none; }
.image-preview-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.preview-bar { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - 16px); display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-editorWidget-background, #252526); cursor: default; }
.image-preview-hint { display: inline-flex; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); font-size: 11px; white-space: nowrap; cursor: default; }
.preview-action { display: inline-grid; place-items: center; width: 20px; height: 20px; margin-left: 6px; padding: 0; vertical-align: middle; border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: var(--vscode-textButton-background, transparent); color: var(--vscode-descriptionForeground); font-size: 13px; line-height: 1; cursor: pointer; }
.preview-action:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
.image-preview button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
@media(max-width:560px){
 .image-preview[data-gallery-multiple="true"] .image-preview-hint{max-width:100%;white-space:normal;flex-wrap:wrap;justify-content:center}
 .image-preview[data-gallery-multiple="true"] .preview-hint-text{min-width:0;max-width:100%;text-align:center}
 .image-preview[data-gallery-multiple="true"] .preview-action{flex:0 0 20px}
}
${ANIMATION_PREVIEW_STYLE}`;
