/** DSH 0.1.165 mathSegments/mathEl semantics, with Codex copy acknowledgement and identity guards.
 * This module owns display only. It never opens links, fetches resources or handles RPC approvals. */
import type {CopyText} from './markdown';
import {bindFormulaMenu,mathmlOf,flashMath,type FormulaOptions} from './dsh-math-export';
type Segment = {type:'text';text:string}|{type:'math';tex:string;raw:string;display:boolean};
export type MathFormat = 'markdown'|'tex'|'tex-delimited'|'mathml';
export interface MathOptions extends FormulaOptions {streaming?:boolean;mathButtons?:boolean;mathFormat?:MathFormat}
const MATH_SENTINEL='\uE000';
export function mathSegments(text:string):Segment[]{
 const out:Segment[]=[],src=String(text).split('\\$').join(MATH_SENTINEL);let last=0,i=0;
 const flush=(until:number)=>{if(until>last)out.push({type:'text',text:src.slice(last,until)});last=until;};
 while(i<src.length){
  const ch=src[i];
  if(ch==='$'){
   const display=src[i+1]==='$',openLen=display?2:1,endMark=display?'$$':'$';let j=i+openLen,content='',closed=false;
   while(j<src.length){if(src.startsWith(endMark,j)){closed=true;break;}content+=src[j];j++;}
   if(closed&&!display&&(content!==content.trim()||content.includes('\n')))closed=false;
   const trimmed=content.trim();if(closed&&(!trimmed||trimmed.length>2000||trimmed.endsWith(',')||/^[0-9]+$/.test(trimmed)))closed=false;
   if(closed){flush(i);out.push({type:'math',display,tex:trimmed,raw:content});last=j+openLen;i=last;continue;}
  }
  if(ch==='\\'&&(src[i+1]==='('||src[i+1]==='[')){
   const display=src[i+1]==='[',end=display?'\\]':'\\)';const j=src.indexOf(end,i+2),content=j<0?'':src.slice(i+2,j);
   if(j>=0&&content.trim().length>0&&content.trim().length<=2000){flush(i);out.push({type:'math',display,tex:content,raw:content});last=j+2;i=last;continue;}
  }
  i++;
 }
 flush(src.length);for(const seg of out)if(seg.type==='text')seg.text=seg.text.split(MATH_SENTINEL).join('$');return out;
}
export function mathFormatText(format:MathFormat,tex:string,display:boolean,mathml=''):string{
 if(format==='tex')return tex;if(format==='mathml')return mathml||tex;return (display?'$$':'$')+tex+(display?'$$':'$');
}
// Protect code before the original scanner: the legacy whole-source preprocessing also
// transformed dollars inside code. Block maps come from the same Markdown parser; exact
// backtick runs protect inline code, including multiline spans and unmatched openers.
export function prepareMath(source:string,md:any){
 let prefix='\uE002';while(source.includes(prefix))prefix+='\uE002';const close='\uE003';
 const values=new Map<string,Extract<Segment,{type:'math'}>>();
 const srcLine:(number|{from:number;to:number})[]=[0];let srcRow=0,preparedRow=0;
 const literal=(text:string)=>{for(const ch of text)if(ch==='\n'){srcRow++;preparedRow++;srcLine[preparedRow]=srcRow;}return text;};
 const encode=(text:string)=>mathSegments(text).map(seg=>{
  if(seg.type==='text')return literal(seg.text);const key=String(values.size);values.set(key,seg);
  const extra=(seg.raw.match(/\n/g)||[]).length;if(extra){const v=srcLine[preparedRow]??srcRow;srcRow+=extra;srcLine[preparedRow]={from:typeof v==='number'?v:v.from,to:srcRow};}
  return prefix+key+close;
 }).join('');
 function inline(text:string){
  let built='',last=0,i=0;while(i<text.length){
   if(text[i]!=='`'){i++;continue;}const from=i;while(text[i]==='`')i++;const width=i-from;let j=i,found=-1;
   while(j<text.length){if(text[j]!=='`'){j++;continue;}const start=j;while(text[j]==='`')j++;if(j-start===width){found=j;break;}}
   if(found<0)continue;built+=encode(text.slice(last,from))+literal(text.slice(from,found));last=found;i=found;
  }return built+encode(text.slice(last));
 }
 const lines=source.split('\n'),offsets=[0];for(const line of lines)offsets.push(offsets[offsets.length-1]!+line.length+1);
 const code=md.parse(source,{}).filter((t:any)=>(t.type==='fence'||t.type==='code_block')&&t.map);
 let built='',last=0;for(const t of code){const from=offsets[t.map[0]]!,to=Math.min(source.length,offsets[t.map[1]]??source.length);built+=inline(source.slice(last,from))+literal(source.slice(from,to));last=to;}
 built+=inline(source.slice(last));
 return {source:built,pattern:new RegExp(prefix+'([0-9]+)'+close,'g'),values,srcLine};
}
let selectionTextAtDown='';let selectionDocument:Document|undefined;
const selectionNow=()=>String(window.getSelection()?.toString()||'');
function ensureSelectionGuard(){if(selectionDocument===document)return;selectionDocument=document;document.addEventListener('mousedown',()=>{selectionTextAtDown=selectionNow();},true);}
export function appendMath(parent:HTMLElement,text:string,prepared:ReturnType<typeof prepareMath>,copyText:CopyText,current:()=>boolean,options:MathOptions){
 ensureSelectionGuard();let last=0;
 for(const m of text.matchAll(prepared.pattern)){
  const value=prepared.values.get(m[1]!);if(!value)continue;const index=m.index!;parent.append(document.createTextNode(text.slice(last,index)));last=index+m[0].length;
  const span=document.createElement('span');span.className='math'+(value.display?' math-display':'');span.setAttribute('role','math');span.setAttribute('aria-label',value.tex);
  const katex=(window as any).__g15md?.katex,k=document.createElement('span');
  try{katex.render(value.tex,k,{displayMode:value.display,throwOnError:false,output:'html',trust:false});}catch{k.textContent=value.tex;}
  span.append(k);
  const block={raw:value.tex,md:mathFormatText('markdown',value.tex,value.display),display:value.display,el:span};
  bindFormulaMenu(block,copyText,current,options);
  if(options.mathButtons!==false){span.classList.add('math-copy');span.title='点击复制公式';span.addEventListener('click',async()=>{
   if(options.streaming||!current()||!span.isConnected)return;const selected=selectionNow();if(selected&&selected!==selectionTextAtDown)return;
   const format=options.mathFormat??'markdown';let mathml='';
   if(format==='mathml')mathml=mathmlOf(block);
   try{await copyText(mathFormatText(format,value.tex,value.display,mathml));if(!current()||!span.isConnected)return;flashMath(span,options);}catch{if(current()&&span.isConnected)span.title='复制失败，请手动选择';}
  });}
  parent.append(span);
 }
 parent.append(document.createTextNode(text.slice(last)));
}
