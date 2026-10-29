import {syntheticTailMeta} from './tail-fixtures';import {clearDisplayToast} from '../display/dsh-math-export';
import {renderMarkdown} from '../display/markdown';
import {ImagePreview,imageCard,previewLimits} from '../display/image-preview';
import {Replay} from './replay';
import {TIMELINES,syntheticImages} from './fixtures';
import {closeMathMenu,closeStaleMathMenu,type FormulaExport,type FormulaExportResult} from '../display/dsh-math-export';
import {FORMULA_EXPORT_TIMEOUT_MS} from '../formula-export-limits';
import {DisplaySettingsPanel} from '../display/settings-panel';
import {normalizeDisplaySettings} from '../display-settings';
import {BlockFoldMemory} from '../display/block-fold-memory';
import {UserFoldMemory} from '../display/user-fold-memory';import {UserMessageFolds} from '../display/user-message-fold';
import type {UserFoldState} from '../user-fold-store';
import {MessageCopyBridge} from '../display/message-copy-bridge';import {MessageActions} from '../display/message-actions';
import {ImageExportBridge} from '../display/image-export-bridge';
import {UsageDetailsControl,latestUsageMeta} from '../display/usage-details';
import {ContentColumn} from '../display/content-column';
import {messageHead} from '../display/message-layout';import {configureDisplayHints} from '../display/hint-duration';
import {ActivityIndicator,applyMotion} from '../display/activity';
import {createVsCodePageHost} from '../vscode-page-host';
import {FileReferenceBridge} from '../display/file-reference-bridge';
const by=(id:string)=>document.getElementById(id)!;
let copySettings=normalizeDisplaySettings(undefined);
const replay=new Replay(), images=syntheticImages(), preview=new ImagePreview(()=>previewLimits(copySettings));
const usageDetails=new UsageDetailsControl(by('offline-usage'));by('offline-usage').append(usageDetails.element);
const column=new ContentColumn(by('history'));column.apply();
const activity=new ActivityIndicator();
let timer:ReturnType<typeof setTimeout>|undefined, generation=0, cursor=0, plain=false;
const api=typeof (globalThis as any).acquireVsCodeApi==='function'?createVsCodePageHost():undefined;
api?.postMessage({type:'ready'});
const blockFolds=api?new BlockFoldMemory({postMessage:m=>api.postMessage(m),messages:api.messages},()=>({threadId:replay.threadId,connectionId:generation}),()=>render()):undefined;
const localUserFolds=new Map<string,UserFoldState>();
const userFoldMemory=api?new UserFoldMemory({postMessage:m=>api.postMessage(m),messages:api.messages},()=>({threadId:replay.threadId,connectionId:generation}),()=>render()):{get:(key:string)=>localUserFolds.get(key),save:async(key:string,state:UserFoldState)=>{localUserFolds.set(key,state);}};
const userFolds=new UserMessageFolds(()=>document.documentElement,userFoldMemory);
const userCopy=api?new MessageCopyBridge({postMessage:m=>api.postMessage(m),messages:api.messages},()=>({threadId:replay.threadId,connectionId:generation})):undefined,userActions=new MessageActions(by('history'));
if(api)new DisplaySettingsPanel({postMessage:m=>api.postMessage(m),messages:api.messages},s=>{copySettings=s;render();});
const imageExports=api?new ImageExportBridge({postMessage:m=>api.postMessage(m),messages:api.messages},()=>({threadId:replay.threadId,connectionId:generation})):undefined;
const fileReferences=api?new FileReferenceBridge(api,()=>({threadId:replay.threadId,connectionId:generation}),(source,current)=>preview.openReference(source,current)):undefined;
let copyId=0;
const copies=new Map<number,{generation:number;resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const formulaExports=new Map<number,{generation:number;resolve:(value:FormulaExportResult)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>|undefined}>();
const components=new Map<number,{generation:number;resolve:(value:string)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function clearFormulaExports(){for(const map of [formulaExports,components]){for(const p of map.values()){clearTimeout(p.timer);p.reject(Error('线程已切换'));}map.clear();}closeMathMenu();}
function loadMathJax():Promise<string>{
 if(!api)return Promise.resolve(JSON.parse(document.getElementById('codex-mathjax-source')?.textContent??'""'));
 return new Promise((resolve,reject)=>{const id=++copyId,timer=setTimeout(()=>{components.delete(id);reject(Error('SVG组件读取超时'));},10000);components.set(id,{generation,resolve,reject,timer});api.postMessage({type:'formula-component',id,threadId:replay.threadId,connectionId:generation});});
}
function exportFormula(value:FormulaExport,turnId:string,itemId:string):Promise<FormulaExportResult>{
 if(!api)return Promise.reject(Error('富格式复制及另存文件请在 VS Code 实验面板体验'));
 return new Promise((resolve,reject)=>{const id=++copyId,timer=value.kind.startsWith('save-')?undefined:setTimeout(()=>{formulaExports.delete(id);reject(Error('公式导出超时'));},FORMULA_EXPORT_TIMEOUT_MS);formulaExports.set(id,{generation,resolve,reject,timer});api.postMessage({type:'formula-export',...value,id,threadId:replay.threadId,connectionId:generation,turnId,itemId});});
}
async function copyText(text:string):Promise<void>{
 if(api)return new Promise((resolve,reject)=>{const id=++copyId;const t=setTimeout(()=>{copies.delete(id);reject(Error('复制超时'))},3000);copies.set(id,{generation,resolve,reject,timer:t});api.postMessage({type:'offline-copy',id,text,threadId:replay.threadId,connectionId:generation});});
 const owner=generation;
 await navigator.clipboard.writeText(text);
 if(owner!==generation)throw Error('线程已切换');
 by('copy-result').textContent='已复制到剪贴板';
}
api?.messages.addEventListener('message',e=>{const m=e.data;if(m?.type!=='offline-copied')return;const p=copies.get(m.id);if(!p)return;clearTimeout(p.timer);copies.delete(m.id);if(p.generation!==generation){p.reject(Error('线程已切换'));return;}if(m.ok){by('copy-result').textContent='已复制到剪贴板';p.resolve();}else p.reject(Error('复制失败'));});
api?.messages.addEventListener('message',e=>{const m=e.data;if(m?.type!=='formula-exported')return;const p=formulaExports.get(m.id);if(!p)return;clearTimeout(p.timer);formulaExports.delete(m.id);if(p.generation!==generation||m.threadId!==replay.threadId||m.connectionId!==generation||!m.ok)p.reject(Error(m.error||'公式导出失败或身份失效'));else p.resolve(m.result);});
api?.messages.addEventListener('message',e=>{const m=e.data;if(m?.type!=='formula-component')return;const p=components.get(m.id);if(!p)return;clearTimeout(p.timer);components.delete(m.id);if(p.generation!==generation||m.threadId!==replay.threadId||m.connectionId!==generation||!m.ok||typeof m.code!=='string'||m.code.length>4*1024*1024)p.reject(Error('SVG组件读取失败或身份失效'));else p.resolve(m.code);});
function render(){
 configureDisplayHints(copySettings);
 applyMotion(copySettings.animationStyle);
 const owner=generation; const current=()=>owner===generation;
  column.apply(copySettings.contentMaxWidth);
 blockFolds?.configure(copySettings.foldMemory);if(userFoldMemory instanceof UserFoldMemory)userFoldMemory.configure(copySettings.foldMemory);
 userFolds.clear();userFolds.configure(copySettings);userActions.clear();userActions.configure(copySettings);
 by('history').replaceChildren(...[...replay.messages.values()].map((m,index)=>{
  const article=document.createElement('article');article.dataset.threadId=m.threadId;article.dataset.turnId=m.turnId;article.dataset.itemId=m.itemId;
  const title=document.createElement('div');title.className='message-label';title.textContent=(m.role==='assistant'?'Codex':'你')+' · '+(m.complete?'最终正文':'流式显示');article.append(title);
  const media:HTMLElement[]=[],key=JSON.stringify([m.threadId,m.turnId,m.itemId]);for(const id of m.images){const image=images[id]??{id,name:'缺失图片'};media.push(imageCard(image,preview,()=>current()&&replay.messages.get(key)?.images.includes(id)===true&&images[id]?.src===image.src,{format:copySettings.imageCopyFormat,run:kind=>imageExports?imageExports.run(m.turnId,m.itemId,id,kind):Promise.reject(Error('图片复制和另存为请在 VS Code 实验面板体验'))}));}
  if(m.role==='user'&&!plain){title.remove();article.append(messageHead('user'));userFolds.bind(article,m.text,media,[m.threadId,m.turnId,m.itemId],()=>current()&&article.isConnected);userActions.bind(article,m.text.length>0,()=>userCopy?userCopy.copy(m.turnId,m.itemId):copyText(m.text),()=>current()&&article.isConnected,false,syntheticTailMeta(index,false));}
  else{if(plain){const pre=document.createElement('pre');pre.className='plain-body';pre.textContent=m.text;article.append(pre);}else article.append(renderMarkdown(m.text,copyText,current,{...copySettings,openFile:fileReferences&&m.role==='assistant'?reference=>fileReferences.run(reference,m.turnId,m.itemId):undefined,blockOwner:[m.threadId,m.turnId,m.itemId],...(blockFolds?{foldedBlock:blockFolds.has,saveBlockFold:blockFolds.save}:{}),streaming:!m.complete,loadMathJax,exportFormula:value=>exportFormula(value,m.turnId,m.itemId)}));if(media.length){const row=document.createElement('div');row.className='image-row';row.append(...media);article.append(row);}}
  if(m.role==='assistant'&&!plain){article.className='message assistant';title.replaceWith(messageHead('assistant',m.complete?'回复正文':'流式显示'));const body=article.querySelector('.markdown')!;body.classList.add('message-body');const mediaRow=article.querySelector(':scope > .image-row');if(mediaRow)body.append(mediaRow);if(m.complete)userActions.bind(article,m.text.length>0,()=>userCopy?userCopy.copy(m.turnId,m.itemId):copyText(m.text),()=>current()&&article.isConnected,true,syntheticTailMeta(index));}
  return article;
 }));
  activity.update(by('history'),{threadId:replay.threadId,connectionId:generation,busy:[...replay.messages.values()].some(m=>m.role==='assistant'&&!m.complete),items:[...replay.messages.values()].map(m=>({complete:m.complete,item:{type:m.role==='assistant'?'agentMessage':'userMessage',text:m.text}}))});
  usageDetails.update(latestUsageMeta([...replay.messages.values()].map((m,index)=>({item:{type:m.role==='assistant'?'agentMessage':'userMessage'},displayMeta:syntheticTailMeta(index,m.role==='assistant')}))),JSON.stringify([replay.threadId,generation]));
 preview.closeIfStale();preview.applyLimits();
 closeStaleMathMenu();api?.postMessage({type:'offline-position',threadId:replay.threadId,connectionId:generation,cursor});
 by('progress').textContent=`${({ 'offline-alpha':'线程 A','offline-beta':'线程 B','offline-cases':'线程 C','offline-copy':'线程 D','offline-fold':'线程 E','offline-markdown':'线程 F','offline-user-fold':'线程 G','offline-user-copy':'线程 H','offline-assistant-copy':'线程 I' } as Record<string,string>)[replay.threadId]} · ${cursor}/${TIMELINES[replay.threadId]!.length} 个显示事件${plain?' · 原纯文本路径':' · DSH 显示组件'}`;
 (window as any).__offlineState={offline:true,threadId:replay.threadId,cursor,total:TIMELINES[replay.threadId]!.length,plain,generation,messages:[...replay.messages.values()].map(m=>({...m})),copySettings:{...copySettings},realTurnsAdded:0};
}
function stop(){if(timer)clearTimeout(timer);timer=undefined;}
function select(thread:string){
 stop();generation++;column.reset();clearDisplayToast();userCopy?.clear();imageExports?.clear();fileReferences?.clear();preview.close();clearFormulaExports();for(const p of copies.values()){clearTimeout(p.timer);p.reject(Error('线程已切换'));}copies.clear();
 replay.select(thread);cursor=0;by('copy-result').textContent='';render();
}
function next(){const e=TIMELINES[replay.threadId]![cursor];if(e){cursor++;replay.apply(e);render();}}
by('next').onclick=()=>{stop();next();};
by('finish').onclick=()=>{stop();while(cursor<TIMELINES[replay.threadId]!.length)next();};
by('replay').onclick=()=>{select(replay.threadId);const owner=generation;const tick=()=>{if(owner!==generation)return;next();if(cursor<TIMELINES[replay.threadId]!.length)timer=setTimeout(tick,450);};tick();};
by('reset').onclick=()=>select(replay.threadId);
(by('threads') as HTMLSelectElement).onchange=()=>{select((by('threads') as HTMLSelectElement).value);next();};
by('plain').onclick=()=>{plain=!plain;preview.close();by('plain').textContent=plain?'显示复用后效果':'对比原纯文本';render();};
window.addEventListener('pagehide',()=>{stop();generation++;preview.close();clearFormulaExports();});
select('offline-alpha');next();
