/** Verbatim 165 paragraph/quote/table layout rules, webview.ts:475–476,480,484,486–491,500. */
export const BLOCK_LAYOUT_STYLE=`
    .markdown > :first-child { margin-top: 0; }
    .markdown > :last-child { margin-bottom: 0; }
    .markdown p { margin: 0 0 9px; }
    .markdown blockquote { margin: 8px 0; padding: 2px 10px; border-left: 2px solid var(--vscode-textBlockQuote-border); color: var(--vscode-descriptionForeground); background: var(--vscode-textBlockQuote-background); }
    .markdown table { border-collapse: collapse; border-spacing: 0; width: 100%; font-size: 12px; }
    .markdown th, .markdown td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; vertical-align: top; }
    .markdown th { background: var(--vscode-textBlockQuote-background, transparent); font-weight: 600; }
    .markdown th, .markdown td { overflow-wrap: anywhere; }
    .markdown li > p { margin-bottom: 0; }
`;
