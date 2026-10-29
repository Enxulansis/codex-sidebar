/** Original Codex Sidebar window/rail icon, distributed under the project MIT license. */
export function codexMark(): SVGSVGElement {
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 for(const [key,value]of Object.entries({viewBox:'0 0 24 24',width:'24',height:'24','aria-hidden':'true',focusable:'false',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(key,value);
 const path=document.createElementNS(ns,'path');path.setAttribute('d','M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5ZM15.5 4v16M7 9l3 3-3 3M11 15h1');svg.append(path);
 return svg;
}
