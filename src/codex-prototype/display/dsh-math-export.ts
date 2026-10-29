/** Formula menu, lazy MathJax and raster policy reused from DSH 0.1.165.
 * Only the export callback crosses to a host; no paths, RPC or approvals here. */
import type {CopyText} from './markdown';
import {displayHintMs} from './hint-duration';
export type FormulaExport = {raw:string;display:boolean} & (
 | {kind:'svg';svg:string;png:string}
 | {kind:'png';png:string}
 | {kind:'mathml';mathml:string}
 | {kind:'save-svg';svg:string;name:string}
 | {kind:'save-png';png:string;name:string});
export type FormulaExportResult='copied'|'saved'|'canceled';
export interface FormulaOptions {
 exportFormula?:(value:FormulaExport)=>Promise<FormulaExportResult>;
 exportUnavailableReason?:string|undefined;
 loadMathJax?:()=>Promise<string>;
 mathSvgColor?:string;svgPngEdge?:string;feedbackMs?:number;
}
export interface MathBlock {raw:string;md:string;display:boolean;el:HTMLElement;mathml?:string}
export const FORMULA_MENU_LABELS=['复制 LaTeX','复制为 Markdown','复制为 SVG','复制为 MathML','复制为 PNG','另存为 SVG 文件…','另存为 PNG 文件…'] as const;
export function mathjaxSourceTag(source:string,nonce:string){return source?`<script type="application/json" id="codex-mathjax-source" nonce="${nonce}">${JSON.stringify(source).replace(/</g,'\\u003c')}</script>`:'';}
let menu:HTMLElement|undefined,menuCurrent:(()=>boolean)|undefined,boundDocument:Document|undefined,toast:HTMLElement|undefined,toastTimer:ReturnType<typeof setTimeout>|undefined;
let releaseToastPosition:(()=>void)|undefined;
let menuReturnFocus:(()=>void)|undefined;
function dismissMenu(restore:boolean){const owned=menu?.contains(document.activeElement),focus=menuReturnFocus;menu?.remove();menu=undefined;menuCurrent=undefined;menuReturnFocus=undefined;if(restore&&owned)focus?.();}
/** Programmatic, outside-input and source-invalidated closes never reclaim focus. */
export function closeMathMenu(){dismissMenu(false);}
export function closeStaleMathMenu(){if(menuCurrent&&!menuCurrent())closeMathMenu();}
export function clearDisplayToast(){clearTimeout(toastTimer);releaseToastPosition?.();releaseToastPosition=undefined;toast?.remove();toast=undefined;toastTimer=undefined;}
/** The existing 165 menu renderer shared by display copy actions only. */
export function showCopyMenu(e:MouseEvent,valid:()=>boolean,entries:{label:string;disabledReason?:string;run:()=>Promise<void>}[],canRun:()=>boolean=()=>true,restoreFocus?:()=>void,anchor?:HTMLElement){
 if(boundDocument!==document){boundDocument=document;document.addEventListener('mousedown',ev=>{if(menu&&!menu.contains(ev.target as Node))closeMathMenu();},true);document.addEventListener('keydown',ev=>{if(menu&&ev.key==='Escape'&&!ev.isComposing){ev.preventDefault();ev.stopPropagation();dismissMenu(true);}},true);document.addEventListener('focusin',ev=>{if(menu&&!menu.contains(ev.target as Node))closeMathMenu();});document.addEventListener('scroll',closeMathMenu,true);window.addEventListener('pagehide',closeMathMenu);}
 closeMathMenu();if(!valid())return;const invoker=new WeakRef(document.activeElement??document.body),target=document.createElement('div');target.className='ds-menu ctx-menu';target.tabIndex=-1;target.setAttribute('role','menu');target.setAttribute('aria-label','上下文操作');menu=target;menuCurrent=valid;menuReturnFocus=()=>{if(!valid())return;if(restoreFocus){restoreFocus();return;}const active=invoker.deref();if(active instanceof HTMLElement&&active.isConnected)active.focus({preventScroll:true});};let running=false;
 for(const entry of entries){const option=document.createElement('button');option.type='button';option.className='ctx-option';option.setAttribute('role','menuitem');if(entry.disabledReason){option.disabled=true;option.title=entry.disabledReason;option.setAttribute('aria-disabled','true');}const title=document.createElement('span');title.className='ctx-option-title';title.textContent=entry.label;option.append(title);option.onclick=async ev=>{ev.stopPropagation();if(option.disabled||!valid()||running||!canRun()||!option.isConnected||menu!==target)return;running=true;dismissMenu(true);try{await entry.run();}finally{running=false;}};target.append(option);}
 const buttons=()=>Array.from(target.querySelectorAll<HTMLButtonElement>('.ctx-option:not(:disabled)'));
 // Reuse the existing rail-menu keys, with disabled entries excluded. A new
 // focus/pointer owner or a real scroll closes the menu without a focus return.
 target.addEventListener('keydown',event=>{if(event.defaultPrevented||event.isComposing||event.keyCode===229||menu!==target)return;const options=buttons();if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const index=options.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowUp'?-1:1)+options.length)%options.length;options[next]?.focus({preventScroll:true});}else if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();const active=document.activeElement;if(options.includes(active as HTMLButtonElement))(active as HTMLButtonElement).click();}else if(event.key==='Tab')dismissMenu(true);});
 document.body.append(target);const rect=target.getBoundingClientRect(),button=anchor?.getBoundingClientRect(),x=button?button.left:e.clientX,y=button?(button.top-rect.height-6>=6?button.top-rect.height-6:button.bottom+6):e.clientY;target.style.left=Math.max(6,Math.min(x,innerWidth-rect.width-6))+'px';target.style.top=Math.max(6,Math.min(y,innerHeight-rect.height-6))+'px';if(button)target.dataset.anchored='true';(buttons()[0]??target).focus({preventScroll:true});
}
export function showFormulaToast(text:string,warn=false){
 if(!toast?.isConnected){toast=document.createElement('div');toast.className='toast';toast.setAttribute('role','status');document.body.append(toast);}
 toast.textContent=text;toast.classList.toggle('warn',warn);const composer=document.querySelector('#composer');
 releaseToastPosition?.();releaseToastPosition=undefined;
 if(composer){const position=()=>{if(toast?.isConnected)toast.style.bottom=Math.max(12,Math.round(innerHeight-composer.getBoundingClientRect().top+10))+'px';};position();const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(position);observer?.observe(composer);window.addEventListener('resize',position);releaseToastPosition=()=>{observer?.disconnect();window.removeEventListener('resize',position);};}
 void toast.offsetWidth;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast?.classList.remove('show');releaseToastPosition?.();releaseToastPosition=undefined;},displayHintMs());
}
export function flashMath(el:HTMLElement,options:FormulaOptions){
 el.classList.remove('copied');void el.offsetWidth;el.classList.add('copied');
 const ms=typeof options.feedbackMs==='number'&&options.feedbackMs>=200&&options.feedbackMs<=6000?options.feedbackMs:1000;
 el.style.setProperty('--math-copy-duration',ms+'ms');setTimeout(()=>el.classList.remove('copied'),ms+100);
}
export function mathmlOf(b:MathBlock):string{
 if(typeof b.mathml==='string')return b.mathml;
 try{b.mathml=/<math[\s\S]*<\/math>/.exec((window as any).__g15md.katex.renderToString(b.raw,{displayMode:b.display,throwOnError:false,output:'mathml',trust:false}))?.[0]??'';}catch{b.mathml='';}
 return b.mathml;
}
let mathjaxLoading:Promise<void>|undefined;
export function ensureMathJax(load?:()=>Promise<string>):Promise<void>{
 if(typeof (window as any).MathJax?.tex2svg==='function')return Promise.resolve();
 if(mathjaxLoading)return mathjaxLoading;
 // The original lazy script loader, adapted to host-delivered bytes. No resource URI
 // or autoload/require package is exposed to model-supplied TeX.
 mathjaxLoading=(async()=>{
  const embedded=document.getElementById('codex-mathjax-source')?.textContent;
  const source=load?await load():embedded?JSON.parse(embedded):'';if(!source)throw Error('SVG组件未打包');
  const script=document.createElement('script');script.nonce=(document.querySelector('script[nonce]') as HTMLScriptElement)?.nonce??'';
  (window as any).MathJax={startup:{typeset:false},tex:{packages:['base','ams','newcommand','noundefined']},svg:{fontCache:'local'},options:{enableMenu:false}};
  script.textContent=source;document.head.append(script);
  try{const mj=(window as any).MathJax;await mj.startup?.promise;if(typeof mj.tex2svg!=='function')throw Error('SVG组件未就绪');}
  finally{script.textContent='';script.remove();}
 })().catch(e=>{mathjaxLoading=undefined;throw e;});
 return mathjaxLoading;
}
export function pngScale(width:number,height:number,edge='1024'){
 const longEdge=Math.max(1,Math.max(width||200,height||60)),target=edge==='screen'?0:Number(edge);
 let scale=target>0&&Number.isFinite(target)?target/longEdge:4;
 scale=Math.min(8,Math.max(2,scale));scale=Math.min(scale,4096/longEdge);
 // Original final .25 floor could exceed 4096 on an extremely wide formula.
 // Keep its normal-size curve, while retaining the matrix's hard canvas bound.
 scale=Math.max(Math.min(.25,4096/longEdge),scale);
 return {width:Math.max(1,Math.min(4096,Math.round((width||200)*scale))),height:Math.max(1,Math.min(4096,Math.round((height||60)*scale)))};
}
export function assertResourceFreeSvg(svg:SVGElement){
 const allowed=new Set(['svg','g','defs','path','use','rect','line','polyline','polygon','circle','ellipse','text','tspan','title','desc']);
 const ids=new Set(Array.from(svg.querySelectorAll('[id]')).map(el=>el.id));
 for(const el of [svg,...Array.from(svg.querySelectorAll('*'))]){
  if(!allowed.has(el.localName))throw Error('SVG含受限元素');
  for(const a of Array.from(el.attributes)){
   if(/^on/i.test(a.localName)||a.localName==='base'||a.localName==='src'||(a.localName==='href'&&(!/^#[A-Za-z0-9_.:-]+$/.test(a.value)||!ids.has(a.value.slice(1))))||/url\s*\(|@import|expression\s*\(/i.test(a.value))throw Error('SVG含受限资源');
  }
 }
}
export async function renderMathSvg(b:MathBlock,options:FormulaOptions,current:()=>boolean):Promise<string>{
 if(typeof (window as any).MathJax?.tex2svg!=='function')showFormulaToast('正在准备 SVG 组件…');
 await ensureMathJax(options.loadMathJax);if(!current())throw Error('公式已失效');
 const rooted=(window as any).MathJax.tex2svg(b.raw,{display:b.display}),svg=rooted?.querySelector('svg') as SVGElement|null;
 if(!svg)throw Error('未生成SVG');assertResourceFreeSvg(svg);
 const box=b.el.getBoundingClientRect();if(box.width>0)svg.setAttribute('width',Math.round(box.width)+'px');if(box.height>0)svg.setAttribute('height',Math.round(box.height)+'px');
 const configured=String(options.mathSvgColor||''),color=/^#[0-9a-f]{6}$/i.test(configured)?configured.toLowerCase():getComputedStyle(document.body).color||'#000000';
 return svg.outerHTML.split('currentColor').join(color);
}
export function svgToPngDataUrl(svgText:string,options:FormulaOptions,current:()=>boolean):Promise<string>{
 return new Promise((resolve,reject)=>{
  const image=new Image();const finish=()=>{image.onload=image.onerror=null;image.src='';};
  image.onload=()=>{try{
   if(!current())throw Error('公式已失效');const size=pngScale(image.width,image.height,options.svgPngEdge),canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法生成PNG');ctx.drawImage(image,0,0,size.width,size.height);const png=canvas.toDataURL('image/png');finish();resolve(png);
  }catch(e){finish();reject(e);}};image.onerror=()=>{finish();reject(Error('无法解码SVG'));};
  image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svgText);
 });
}
export function formulaFileName(ext:'svg'|'png'){
 const now=new Date(),pad=(value:number)=>String(value).padStart(2,'0');
 return 'formula-'+now.getFullYear()+pad(now.getMonth()+1)+pad(now.getDate())+'-'+pad(now.getHours())+pad(now.getMinutes())+pad(now.getSeconds())+'.'+ext;
}
export function bindFormulaMenu(b:MathBlock,copyText:CopyText,current:()=>boolean,options:FormulaOptions&{streaming?:boolean}){
 b.el.dataset.mkd='math';Object.defineProperty(b.el,'__mkd',{value:b,writable:true,configurable:true});
 let running=false;
 const valid=()=>!options.streaming&&current()&&b.el.isConnected;
 b.el.addEventListener('contextmenu',e=>{
  if(!current()||!b.el.isConnected)return;e.preventDefault();e.stopPropagation();closeMathMenu();if(!valid())return;
  showCopyMenu(e,valid,FORMULA_MENU_LABELS.map((label,index)=>({label,...(index>=2&&options.exportUnavailableReason?{disabledReason:options.exportUnavailableReason}:{}),run:async()=>{
    if(running||!valid())return;running=true;
    try{
     if(index<2){await copyText(index===0?b.raw:b.md);if(valid()){flashMath(b.el,options);showFormulaToast('已复制');}return;}
     if(!options.exportFormula)throw Error('请在 VS Code 实验面板使用富格式导出');
     const common={raw:b.raw,display:b.display};let value:FormulaExport;
     if(index===3){const mathml=mathmlOf(b);if(!mathml)throw Error('未找到该公式的 MathML');value={...common,kind:'mathml',mathml};}
     else{const svg=await renderMathSvg(b,options,valid);if(index===5)value={...common,kind:'save-svg',svg,name:formulaFileName('svg')};
      else{const png=await svgToPngDataUrl(svg,options,valid);value=index===2?{...common,kind:'svg',svg,png}:index===4?{...common,kind:'png',png}:{...common,kind:'save-png',png,name:formulaFileName('png')};}}
     if(!valid())return;const result=await options.exportFormula(value);if(!valid()||result==='canceled')return;
     flashMath(b.el,options);showFormulaToast((result==='saved'?'已保存 ':'已复制 ')+(index===3?'MathML':index===2||index===5?'SVG':'PNG'));
    }catch(error){if(valid())showFormulaToast(error instanceof Error?error.message:'公式导出失败',true);}finally{running=false;}
   }})),()=>!running);
 });
}
