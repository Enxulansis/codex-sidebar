/** 165 block hover copying and context exports with Codex acknowledgement/identity guards. */
import type {CopyText} from './markdown';
import type {MathOptions,prepareMath} from './dsh-math';
import {createBlockText} from './block-copy-text.js';
import {showCopyMenu,showFormulaToast} from './dsh-math-export';
import {COPY_SVG,CHECK_SVG} from './copy-icons';
import {foldButton,blockFoldable,type BlockFoldOptions} from './block-fold';
export interface BlockCopyOptions extends MathOptions,BlockFoldOptions {blockButtons?:boolean;plainMathFormat?:'tex'|'tex-delimited';codeCopyFormat?:'text'|'markdown'}
export function blockText(prepared:ReturnType<typeof prepareMath>,options:BlockCopyOptions){return createBlockText(text=>text.replace(prepared.pattern,(full,key)=>{const v=prepared.values.get(key);if(!v)return full;return options.plainMathFormat==='tex-delimited'?(v.display?'$$':'$')+v.tex+(v.display?'$$':'$'):v.tex;}));}
export function attachBlockCopy(el:HTMLElement,token:any,tokens:any[],index:number,source:string,prepared:ReturnType<typeof prepareMath>,kind:string,tip:string,copyText:CopyText,current:()=>boolean,options:BlockCopyOptions){
 if(!token.map||token.map.length<2)return;const text=blockText(prepared,options),markdown=()=>text.blockSource(source,prepared.srcLine,token.map),plain=kind==='code'?()=>String(token.content||'').trimEnd():()=>text.blockPlainText(tokens,index);
 el.dataset.mkd=kind;Object.defineProperty(el,'__mkd',{value:{kind,token,srcInfo:{source,srcLine:prepared.srcLine},plain},configurable:true});
 const valid=()=>!options.streaming&&current()&&el.isConnected;
 const duration=typeof options.feedbackMs==='number'&&options.feedbackMs>=200&&options.feedbackMs<=6000?options.feedbackMs:1000;
 const flash=()=>{el.classList.remove('copied-flash');void el.offsetWidth;el.style.setProperty('--copy-feedback-duration',duration+'ms');el.classList.add('copied-flash');setTimeout(()=>el.classList.remove('copied-flash'),duration+100);};
 const copy=async(get:()=>string,button?:HTMLButtonElement)=>{if(!valid()||button&&!button.isConnected)return;try{await copyText(get());if(!valid()||button&&!button.isConnected)return;flash();if(button){button.innerHTML=CHECK_SVG;button.title='已复制';setTimeout(()=>{button.innerHTML=COPY_SVG;button.title=tip;},duration);}else showFormulaToast('已复制');}catch{if(valid())showFormulaToast('复制失败，请重试或手动选择',true);}};
 el.addEventListener('contextmenu',e=>{if((e.target as HTMLElement).closest('[data-mkd]')!==el||!current()||!el.isConnected)return;e.preventDefault();e.stopPropagation();const entries=kind==='table'?[{label:'复制为 Markdown',run:()=>copy(markdown)},{label:'复制为 TSV（粘进 Excel/Sheets）',run:()=>copy(plain)},{label:'复制为 CSV',run:()=>copy(()=>text.tsvToCsv(plain()))}]:[{label:'复制为 Markdown',run:()=>copy(markdown)},{label:'复制纯文本',run:()=>copy(plain)}];showCopyMenu(e,valid,entries);});
 if(options.blockButtons===false)return;const capsule=document.createElement('div');capsule.className='block-actions';const button=document.createElement('button');button.type='button';button.className='msg-action copy-block';
 button.hidden=button.disabled=options.streaming===true;
 if(kind==='code')tip=options.codeCopyFormat==='markdown'?'复制代码(Markdown)':'复制代码(纯文本)';button.title=tip;button.setAttribute('aria-label',tip);button.innerHTML=COPY_SVG;
 button.addEventListener('click',()=>{void copy(kind==='code'&&options.codeCopyFormat!=='markdown'?plain:markdown,button);});capsule.append(button);
  if(blockFoldable(kind,token,tokens,index,options.blockMinLines??3)){const foldOptions={...options};if(options.streaming)delete foldOptions.blockOwner;const fold=foldButton(el,valid,foldOptions,token.map[0]);fold.hidden=fold.disabled=options.streaming===true;capsule.append(fold);}
 el.append(capsule);
}
