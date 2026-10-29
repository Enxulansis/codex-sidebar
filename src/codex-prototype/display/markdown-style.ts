/** 165 heading/list/task/code styles. Global code/pre rules are narrowed to Markdown. */
export const MARKDOWN_STYLE=`
    .markdown h1, .markdown h2, .markdown h3 { margin: 14px 0 7px; line-height: 1.3; }
    .markdown h1 { font-size: 17px; } .markdown h2 { font-size: 15px; } .markdown h3 { font-size: 13px; }
    .markdown ul, .markdown ol { margin: 5px 0 10px; padding-left: 22px; }
    .markdown h4, .markdown h5, .markdown h6 { margin: 12px 0 6px; line-height: 1.3; }
    .markdown h4 { font-size: 12.5px; } .markdown h5 { font-size: 12px; } .markdown h6 { font-size: 11.5px; color: var(--vscode-descriptionForeground); }
    .markdown s { color: var(--vscode-descriptionForeground); text-decoration: line-through; }
    .markdown li.task-list-item { list-style: none; margin-left: -4px; }
    .markdown li.task-list-item input[type=checkbox] { appearance: none; -webkit-appearance: none; width: 15px; height: 15px; margin-right: 7px; vertical-align: -5px; border: 2px solid var(--vscode-checkbox-border, #8c8c8c); border-radius: 4px; background-color: transparent; background-repeat: no-repeat; background-position: center; background-size: 11px; cursor: default; }
    .markdown li.task-list-item input[type=checkbox]:checked { border-color: var(--vscode-charts-blue, #4d6bfe); background-color: var(--vscode-charts-blue, #4d6bfe); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
    .markdown pre.shiki { padding: 9px 10px; }
    .markdown .shiki-line { display: block; min-height: 1.55em; white-space: pre; }
    .markdown code { padding: 1px 4px; border-radius: 4px; font-family: var(--editor-font); background: var(--vscode-textCodeBlock-background); }
    .markdown pre { max-width: 100%; margin: 7px 0; padding: 9px 10px; overflow: auto; white-space: pre; border-radius: 6px; color: var(--vscode-editor-foreground); background: var(--vscode-textCodeBlock-background); font: 12px/1.55 var(--editor-font); }
    .markdown pre code { padding: 0; background: transparent; }
`;
