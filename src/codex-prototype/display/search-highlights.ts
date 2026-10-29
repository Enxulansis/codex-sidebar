import {isPageItem,type PageItem} from '../page-model';
import type {SearchSource,SearchAttachment} from '../search-query';
import {isPublicToolKind,type PublicToolDisplayItem} from '../public-tool-types';
import {isPublicRecordDisplay} from '../public-record-types';
import {materializeToolCards} from './tool-cards';
import {agentSearchSources} from '../public-questions';
export const SEARCH_HIGHLIGHT_LIMIT=200;
/** DSH165 searchRangesAcrossHits caps the other rendered hits at sixty ranges. */
export const SEARCH_OTHER_HIGHLIGHT_LIMIT=60;
const searchPaintScopes=new Set<HTMLElement>();
/** DSH165 searchRelLuminance / SEARCH_FG_THRESHOLD at full, steady opacity. */
export function searchHighlightColors(value:unknown){
 if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))return undefined;
 const color=value.toLowerCase(),linear=(offset:number)=>{const c=parseInt(color.slice(offset,offset+2),16)/255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);};
 const luminance=.2126*linear(1)+.7152*linear(3)+.0722*linear(5);
 return{background:color,foreground:luminance>Math.sqrt(1.05*.05)-.05?'#000000':'#ffffff'};
}
function clearSearchScope(element:HTMLElement){element.style.removeProperty('--search-hit-bg');element.style.removeProperty('--search-hit-fg');}
function paintSearchColors(ranges:readonly Range[],value:unknown){
 const next=new Set<HTMLElement>();for(const range of ranges){const element=range.startContainer.parentElement;if(element?.isConnected)next.add(element.closest<HTMLElement>('[data-item-id]')??element);}
 for(const element of searchPaintScopes)if(!next.has(element))clearSearchScope(element);searchPaintScopes.clear();
 const colors=searchHighlightColors(value);for(const element of next){searchPaintScopes.add(element);if(!colors){clearSearchScope(element);continue;}for(const[key,color]of [['--search-hit-bg',colors.background],['--search-hit-fg',colors.foreground]] as const)if(element.style.getPropertyValue(key)!==color)element.style.setProperty(key,color);}
}
/** Local display text follows the shared page contract, independently of a harness protocol. */
export function pageSearchSources(item:PageItem,tools:boolean):SearchSource[]{
 if(isPageItem(item,'agentMessage'))return agentSearchSources(item.text,item.questionRecord);
 if(isPageItem(item,'plan'))return[{kind:'正文',text:item.text}];
 if(isPageItem(item,'userMessage'))return [...item.content.flatMap((input):SearchSource[]=>input.type==='text'?[{kind:'正文',text:input.text}]:input.type==='localImage'?[{kind:'图片',text:input.displayImage?.name??input.path.split(/[\\/]/).at(-1)??''}]:[]),...(item.files??[]).map(file=>({kind:'文件' as const,text:file.name}))];
 if(tools&&isPageItem(item,'commandExecution'))return[{kind:'工具',field:'调用',text:item.command},{kind:'工具',field:'结果',text:item.aggregatedOutput??''}];
 if(tools&&isPageItem(item,'fileChange'))return[{kind:'工具',field:'调用',text:item.changes.map(change=>change.path+(change.kind.type==='update'&&change.kind.move_path?' '+change.kind.move_path:'')).join(' ')},{kind:'工具',field:'结果',text:item.changes.map(change=>change.diff).join('\n')}];
 if(tools&&isPublicToolKind(item.type))return(item as PublicToolDisplayItem).searchSources??[];
 if(tools&&isPublicRecordDisplay(item))return item.searchSources;
 return[];
}
export function revealSearchRow(row:HTMLElement,history:HTMLElement,query:string){
 if(row.hidden&&row.dataset.workFoldKey){const bar=Array.from(history.children).find(e=>(e as HTMLElement).dataset.workKey===row.dataset.workFoldKey) as HTMLButtonElement|undefined;if(bar?.getAttribute('aria-expanded')==='false')bar.click();if(row.hidden)return false;}
 if(row.classList.contains('msg-folded'))row.querySelector<HTMLButtonElement>('.msg-fold-toggle')?.click();if(row.classList.contains('msg-folded'))return false;
 materializeToolCards(row);
 for(const details of row.querySelectorAll<HTMLDetailsElement>('details.tool'))if(!details.open)details.querySelector<HTMLElement>('summary')?.click();
 for(const block of row.querySelectorAll<HTMLElement>('.folded'))if((block.textContent??'').toLowerCase().includes(query.toLowerCase()))block.querySelector<HTMLButtonElement>('.fold-block[aria-expanded=false]')?.click();
 return !row.hidden;
}
/** Bound document text stays searchable through public history without duplicating it in the message DOM. */
export function attachmentSearchTarget(row:HTMLElement,query:string,kind:string,file?:SearchAttachment):HTMLElement|undefined{
 const cards=Array.from(row.querySelectorAll<HTMLElement>('.message-files .file-card'));
 if(file)return cards.find(card=>{try{return JSON.parse(card.dataset.fileId??'null')?.[1]===file.sha256&&card.querySelector('.card-name')?.textContent===file.name;}catch{return false;}});
 if(!cards.length||kind!=='文件'&&!cards.some(card=>card.dataset.textIncluded==='true'))return;
 const exact=cards.find(card=>(card.querySelector('.card-name')?.textContent??'').toLowerCase().includes(query.toLowerCase()));
 return exact??row.querySelector<HTMLElement>('.message-files')??undefined;
}
export function clearSearchHighlights(){for(const element of searchPaintScopes)clearSearchScope(element);searchPaintScopes.clear();if(typeof CSS!=='undefined'&&'highlights'in CSS)CSS.highlights.delete('dsh-search-match');}
function rowSearchRanges(row:HTMLElement,query:string){
  const body=row.querySelector('.message-body')??row.querySelector('details.tool')??row,nodes:Text[]=[],offsets:number[]=[];let text='';
 const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT,{acceptNode:node=>{const parent=node.parentElement;return parent&&!parent.closest('button,script,style,textarea,.katex-mathml,[aria-hidden=true]')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
 for(let node=walker.nextNode();node;node=walker.nextNode()){offsets.push(text.length);nodes.push(node as Text);text+=node.textContent??'';}
 const lowered=text.toLowerCase(),q=query.toLowerCase(),ranges:Range[]=[];let total=0;
 for(let at=lowered.indexOf(q);at>=0;at=lowered.indexOf(q,at+q.length)){
  total++;if(ranges.length>=SEARCH_HIGHLIGHT_LIMIT)continue;const end=at+q.length,startIndex=offsets.findLastIndex(value=>value<=at),endIndex=offsets.findLastIndex(value=>value<end);if(startIndex<0||endIndex<0)continue;
  const range=document.createRange();range.setStart(nodes[startIndex]!,at-offsets[startIndex]!);range.setEnd(nodes[endIndex]!,end-offsets[endIndex]!);ranges.push(range);
 }
 return{ranges,total};
}
/** Paint the active message and other rendered hits without rebuilding their DOM. */
export function highlightSearchRows(row:HTMLElement|undefined,query:string,others:Iterable<HTMLElement>,preserveIfSame=false,color:unknown='theme'){
 if(!query){clearSearchHighlights();return{ranges:[] as Range[],total:0};}
 const active=row?rowSearchRanges(row,query):{ranges:[] as Range[],total:0},extra:Range[]=[];
 for(const other of others){if(extra.length>=SEARCH_OTHER_HIGHLIGHT_LIMIT)break;if(other===row||!other.isConnected||other.hidden)continue;extra.push(...rowSearchRanges(other,query).ranges.slice(0,SEARCH_OTHER_HIGHLIGHT_LIMIT-extra.length));}
 const ranges=[...active.ranges,...extra];
 if(!ranges.length){clearSearchHighlights();return active;}
 if(typeof Highlight!=='undefined'&&typeof CSS!=='undefined'&&'highlights'in CSS){const old=Array.from(CSS.highlights.get('dsh-search-match')??[]);if(!preserveIfSame||old.length!==ranges.length||old.some((r,i)=>r.startContainer!==ranges[i]!.startContainer||r.startOffset!==ranges[i]!.startOffset||r.endContainer!==ranges[i]!.endContainer||r.endOffset!==ranges[i]!.endOffset))CSS.highlights.set('dsh-search-match',new Highlight(...ranges));paintSearchColors(ranges,color);}
 return active;
}
