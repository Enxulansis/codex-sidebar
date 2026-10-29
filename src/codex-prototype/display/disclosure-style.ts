/** One chevron for native disclosures and explicit fold buttons; menus point down/up. */
export const DISCLOSURE_STYLE=`
summary{list-style:none;cursor:pointer}
summary::-webkit-details-marker{display:none}
summary::before,.disclosure-toggle::before,.disclosure-caret::before{
 content:'';display:inline-block;box-sizing:border-box;width:5.5px;height:5.5px;flex:0 0 5.5px;
 border:solid currentColor;border-width:0 1.25px 1.25px 0;margin:0 6px 1px 2px;
 transform:rotate(-45deg);vertical-align:middle;pointer-events:none
}
details[open]>summary::before,.disclosure-toggle[aria-expanded="true"]::before{transform:rotate(45deg)}
summary:focus-visible,.disclosure-toggle:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px;border-radius:4px}
summary:hover{color:var(--vscode-foreground)}
.tool.empty>summary::before{display:none}
.disclosure-caret{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;flex:0 0 12px}
.disclosure-caret::before{margin:0 0 2px;transform:rotate(45deg)}
[aria-expanded="true"]>.disclosure-caret::before{margin:2px 0 0;transform:rotate(225deg)}
.disclosure-caret[hidden]{display:none!important}
.fold-block.disclosure-toggle::before{margin:0}
`;
