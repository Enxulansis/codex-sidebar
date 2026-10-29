/** DSH 165 block folding. Persistence is supplied by the experimental display host. */
export interface BlockFoldOptions {
 blockMinLines?:number;
 blockOwner?:readonly [string,string,string];
 foldedBlock?:(key:string)=>boolean;
 saveBlockFold?:(key:string,folded:boolean)=>Promise<void>;
}
export function contentLines(text:string){const rows=String(text||'').split('\n');while(rows.length&&rows[rows.length-1]!.trim()==='')rows.pop();return rows.length;}
export function blockFoldable(kind:string,token:any,tokens:any[],index:number,threshold=3){
 if(kind==='code')return contentLines(token.content)>threshold;
 if(kind==='quote')return !!token.map&&token.map[1]-token.map[0]>threshold;
 if(kind==='table'){let rows=0,inBody=false;for(let i=index+1;i<tokens.length;i++){const type=tokens[i].type;if(type==='table_close')break;if(type==='tbody_open')inBody=true;if(type==='tr_open'&&inBody)rows++;}return rows>threshold;}
 return false;
}
let selectionTextAtDown='';
if(typeof document!=='undefined')document.addEventListener('mousedown',()=>{selectionTextAtDown=String(window.getSelection()?.toString()||'');},true);
/** Keyboard/assistive activation and programmatic search reveal have no mouse click count. */
export function selectionDragEnded(event:MouseEvent){if(event.detail===0)return false;const selected=String(window.getSelection()?.toString()||'');return selected!==''&&selected!==selectionTextAtDown;}
export function foldButton(host:HTMLElement,valid:()=>boolean,options:BlockFoldOptions,line:number){
 const button=document.createElement('button');button.type='button';button.className='msg-action fold-block disclosure-toggle';
 const key=options.blockOwner?JSON.stringify([...options.blockOwner,line]):undefined;
 if(key)host.dataset.mk=key;
 const apply=(folded:boolean)=>{host.classList.toggle('folded',folded);button.title=folded?'展开':'收起';button.setAttribute('aria-label',button.title);button.setAttribute('aria-expanded',folded?'false':'true');};
 apply(key!==undefined&&options.foldedBlock?.(key)===true);let saving=false;
 button.addEventListener('click',async event=>{
  if(!valid()||saving||selectionDragEnded(event))return;
  const previous=host.classList.contains('folded'),folded=!previous;apply(folded);
  if(key&&options.saveBlockFold){saving=true;try{await options.saveBlockFold(key,folded);}catch{if(valid())apply(previous);}finally{saving=false;}}
 });return button;
}
export const BLOCK_FOLD_STYLE=`
.markdown .code-wrap > pre { transition: max-height .15s ease; }
.markdown .code-wrap.folded > pre { max-height: 56px; overflow: hidden; }
.markdown .table-wrap.folded { max-height: 70px; overflow: hidden; }
.markdown blockquote.folded { max-height: 3.4em; overflow: hidden; }
.markdown .folded::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 16px; pointer-events: none; background: linear-gradient(to bottom, transparent, var(--vscode-sideBar-background, var(--vscode-editor-background, #252526))); }
`;
