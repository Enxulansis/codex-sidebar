import {toolOutputText,toolPresentation,type ToolDisplayItem} from '../tool-display';
import {isPublicRecordDisplay} from '../public-record-types';
import {COPY_SVG,CHECK_SVG} from './copy-icons';import {showFormulaToast} from './dsh-math-export';
import {appendFileText,fileLinkButton,type FileReferenceOptions} from './file-references';
type Memory={has:(key:string)=>boolean;save:(key:string,expanded:boolean)=>Promise<void>};
const pendingCards=new WeakMap<HTMLDetailsElement,()=>boolean>();
/** Complete the existing shell in place before its process or search target becomes visible. */
export function materializeToolCards(root:HTMLElement){let built=0;const cards=root.matches('details.tool')?[root as HTMLDetailsElement]:Array.from(root.querySelectorAll<HTMLDetailsElement>('details.tool'));for(const card of cards)if(pendingCards.get(card)?.())built++;return built;}
/** Original 165 details/summary and output copy; only explicit public fields, all text inert. */
export class ToolCards{
 private identity='';private local=new Map<string,{phase:string;open:boolean}>();private remember=true;private lazy=true;private materialized=new Set<string>();
 configure(identity:string,remember:boolean,lazy=true,keys?:readonly string[]){if(this.identity!==identity||this.remember!==remember)this.local.clear();if(this.identity!==identity||this.lazy!==lazy)this.materialized.clear();if(keys){const current=new Set(keys);for(const key of this.materialized)if(!current.has(key))this.materialized.delete(key);}this.identity=identity;this.remember=remember;this.lazy=lazy;}
 forget(key:string){this.local.delete(key);}
 render(item:ToolDisplayItem,complete:boolean,owner:readonly[string,string,string],valid:()=>boolean,memory:Memory,copy:()=>Promise<void>,feedbackMs=1000,openFile?:FileReferenceOptions['openFile'],defer=false){
  const info=toolPresentation(item,complete),key=JSON.stringify(owner),phase=String(complete)+':'+item.status,local=this.local.get(key);
  const emptyRecord=isPublicRecordDisplay(item)&&item.fields.every(field=>field.label==='说明');
  const card=document.createElement('details');card.className='tool'+(info.failed?' failed':'')+(emptyRecord?' empty':'');card.dataset.toolKey=key;
  const build=()=>{this.materialized.add(key);card.open=emptyRecord?false:local?.phase===phase?local.open:item.type==='unavailableRecord'||info.live||info.failed||memory.has(key);
  const node=(tag:string,cls:string,text:string)=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
  const summary=document.createElement('summary');summary.append(node('span','tool-icon'+(info.live?' live':''),info.icon),node('span','tool-title',info.title),node('span','tool-detail',info.brief));summary.title=isPublicRecordDisplay(item)&&!info.failed&&!info.declined?info.title:info.detail;card.append(summary);
  let built=false;const initialize=()=>{if(built)return;built=true;if(emptyRecord)return;const body=node('div','tool-body','');
   if(item.type==='commandExecution'){if(item.cwd)body.append(node('div','result-title',item.cwd));const output=node('pre','tool-output',openFile?'':item.aggregatedOutput??'');if(openFile)appendFileText(output,item.aggregatedOutput??'',openFile,valid);body.append(output);if(item.exitCode!==null)body.append(node('div','', '退出码 '+item.exitCode));}
   else if(item.type==='fileChange')for(const change of item.changes){const path=node('div','diff-path','');if(openFile){path.append(fileLinkButton({path:change.path},change.path,openFile,valid));if(change.kind.type==='update'&&change.kind.move_path)path.append(document.createTextNode(' → '),fileLinkButton({path:change.kind.move_path},change.kind.move_path,openFile,valid));}else path.textContent=change.path;body.append(path,node('pre','tool-output',change.diff));}
   else for(const field of item.fields)if(field.label!=='说明')body.append(node('div','result-title',field.label),node('pre','tool-output',field.text));
   const button=document.createElement('button');button.type='button';button.className='msg-action tool-copy';button.title='复制输出（当前显示的内容）';button.setAttribute('aria-label',button.title);button.innerHTML=COPY_SVG;button.disabled=!complete||item.type==='unavailableRecord'||!toolOutputText(item);let copying=false;
   button.addEventListener('click',async()=>{if(!valid()||!card.isConnected||button.disabled||copying)return;copying=true;try{await copy();if(valid()&&card.isConnected){button.innerHTML=CHECK_SVG;button.title='已复制';setTimeout(()=>{if(button.isConnected){button.innerHTML=COPY_SVG;button.title='复制输出（当前显示的内容）';}},feedbackMs);}}catch{if(valid()&&card.isConnected)showFormulaToast('复制失败，请重试',true);}finally{copying=false;}});body.append(button);card.append(body);
  };
  if(card.open)initialize();summary.addEventListener('click',e=>{if(emptyRecord){e.preventDefault();return;}if(!valid()||!card.isConnected){e.preventDefault();return;}if(e.defaultPrevented)return;
   // Capture the native summary intent before a stream repaint can detach this details node.
   const open=!card.open;this.local.delete(key);this.local.set(key,{phase,open});while(this.local.size>2000)this.local.delete(this.local.keys().next().value!);
   if(item.type!=='unavailableRecord')void memory.save(key,open).catch(()=>{if(valid()&&card.isConnected){this.local.delete(key);card.open=info.live||info.failed||memory.has(key);}});
  });
  card.addEventListener('toggle',()=>{if(emptyRecord)return;if(valid()&&card.isConnected&&card.open)initialize();});
  };
  if(this.lazy&&defer&&complete&&!emptyRecord&&item.type!=='unavailableRecord'&&item.status==='completed'&&!info.live&&!info.failed&&!info.declined&&!this.materialized.has(key)){
   card.dataset.toolBuilt='0';pendingCards.set(card,()=>{if(!valid()||!card.isConnected)return false;pendingCards.delete(card);delete card.dataset.toolBuilt;build();return true;});
  }else build();
  return card;
 }
}
export const TOOL_STYLE=`
    article.tool-message { border: 0; padding: 0; border-radius: 0; }
    .tool { margin: 7px 0 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; overflow: hidden; background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); }
    .tool.failed { border-color: var(--vscode-errorForeground); }
    .tool summary { min-height: 35px; padding: 7px 9px; display: flex; align-items: center; gap: 7px; cursor: pointer; list-style: none; }
    .tool summary::-webkit-details-marker { display: none; }
    .tool-icon { width: 18px; color: var(--vscode-descriptionForeground); text-align: center; font-family: var(--editor-font); }
    .tool-title { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; }
    .tool-detail { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .tool-body { padding: 2px 26px 9px 12px; min-width: 0; overflow: hidden; color: var(--vscode-descriptionForeground); }
    .tool-body { position: relative; }
    .tool-copy { position: absolute; top: 2px; right: 4px; opacity: .7; z-index: 3; }
    .tool-copy:hover, .tool-copy:focus-visible { opacity: 1; }
    .tool-copy:focus-visible { outline:1px solid var(--vscode-focusBorder); outline-offset:2px; border-radius:4px; }
    .tool-body pre { color: var(--vscode-foreground); }
    .diff-path, .result-title { margin: 7px 0 4px; font-weight: 600; color: var(--vscode-foreground); }
    .tool-body .tool-output { font-family: var(--editor-font); white-space: pre-wrap; overflow-wrap: anywhere; }
`;
