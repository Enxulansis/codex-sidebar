import * as vscode from 'vscode';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {html} from '../webview';
import {OfflineExperience,OFFLINE_EXPERIENCE_PREFIX,OFFLINE_EXPERIENCE_REASON} from './interactive-state';
import {DraftStore,DraftHost,type DraftRecord} from '../draft-store';
import {ScrollViewStore,ScrollViewHost} from '../scroll-view-store';
import {SearchHistoryStore,handleSearchHistory} from '../search-history-store';
import {RailViewStore,handleRailView} from '../rail-view-store';
import {BlockFoldStore,handleBlockFold} from '../block-fold-store';
import {UserFoldStore,handleUserFold} from '../user-fold-store';
import {handleDisplaySettings,type DisplaySettingsStore,type DisplayStateStorage} from '../display-settings';
import {handleDisplayCopy} from '../display-copy';
import {handleMessageCopy} from '../message-copy';
import {WorkFoldStore,handleWorkFold} from '../work-fold-store';
import {ToolExpansionStore,handleToolExpansion} from '../tool-expansion-store';
import {ChangedFilesStore,handleChangedFilesFold} from '../changed-files-store';
import {ChangedReviewStore,handleChangedReview} from '../changed-review-store';
import {RuntimeEnvironmentHost,readRuntimeEnvironment} from '../runtime-environment-host';
import {ImageExporter,type ImageRequest} from '../image-export-host';
import {FormulaExporter,type FormulaRequest} from '../formula-export-host';
import {IMAGE_ASSETS} from './image-assets';

/** Explicit, same-window shared-page experience. Synthetic persistence never enters live stores. */
export function registerInteractiveOfflinePanel(context:vscode.ExtensionContext,settings:DisplaySettingsStore,scripts:{vendor:string;display:string}){
 let panel:vscode.WebviewPanel|undefined;
 const mount=async(target:vscode.WebviewPanel)=>{
  panel=target;target.webview.options={enableScripts:true,localResourceRoots:[]};
  const storage:DisplayStateStorage={get:<T>(key:string,fallback:T)=>context.workspaceState.get(OFFLINE_EXPERIENCE_PREFIX+key,fallback),update:(key,value)=>context.workspaceState.update(OFFLINE_EXPERIENCE_PREFIX+key,value)};
  const model=new OfflineExperience(storage,()=>{const s=settings.read();return{loadAll:s.historyLoadAll,maxMessages:s.historyMaxMessages};}),drafts=new DraftStore(storage),scrolls=new ScrollViewStore(storage),rails=new RailViewStore(storage),searches=new SearchHistoryStore(storage),blocks=new BlockFoldStore(storage),users=new UserFoldStore(storage),works=new WorkFoldStore(storage),tools=new ToolExpansionStore(storage),changedFiles=new ChangedFilesStore(storage),changedReviews=new ChangedReviewStore(storage);
  function textOnly(value:unknown):DraftRecord{const v=value as DraftRecord;if(v&&(v.image||v.pathInput||v.extraImages?.length||v.files?.length||v.skill))throw Error('离线体验草稿仅保存文字；附件请使用日常草稿或独立显示回放，不读取真实文件');return v;}
  let pageId='',version=0,error='',selections:Promise<unknown>=Promise.resolve();
  const settingsChanges=settings.onDidChange(source=>{if(panel===target&&pageId&&source!==pageId)void target.webview.postMessage({type:'settings-changed',pageId}).then(undefined,()=>{});});context.subscriptions.push(settingsChanges);
  target.onDidDispose(()=>{settingsChanges.dispose();if(panel===target){version++;panel=undefined;}});
  function bind(){
   const lease=++version,id=pageId,current=()=>panel===target&&version===lease;
   const post=(message:object)=>current()?target.webview.postMessage({...message,pageId:id}):Promise.resolve(false);
   const publish=()=>post({type:'state',state:{...model.snapshot(),error,copySettings:settings.read()}});
   const owner=()=>current()?{threadId:model.threadId,connectionId:model.connectionId,items:model.snapshot().items,turns:model.snapshot().turns??[]}:undefined;
   const draftHost=new DraftHost({load:async thread=>textOnly(await drafts.load(thread)),save:(thread,value,current)=>drafts.save(thread,textOnly(value),current),review:(thread,expected,current)=>drafts.review(thread,expected,current),restore:async(thread,expected,current)=>{const value=await drafts.load(thread);if(value.recovery)textOnly({...value.recovery.draft,uncertain:false});return drafts.restore(thread,expected,current);}},'',()=>({threadId:model.threadId,connectionId:model.connectionId,threads:model.threads}),current,text=>vscode.env.clipboard.writeText(text)),scrollHost=new ScrollViewHost(scrolls,()=>({threadId:model.threadId,connectionId:model.connectionId,threads:model.threads}),current);
   const environment=new RuntimeEnvironmentHost(()=>readRuntimeEnvironment({extensionVersion:context.extension?.packageJSON?.version,extensionPath:context.extensionPath,vscodeVersion:vscode.version},()=> 'offline'),current);
   const imageRoot=vscode.workspace.workspaceFolders?.[0]?.uri.scheme==='file'?vscode.workspace.workspaceFolders[0].uri.fsPath:'';
   const exporter=new ImageExporter(imageRoot,()=>{const state=owner();return state?{...state,images:state.items.flatMap(row=>row.item.type==='userMessage'?(row.item.content as {displayImage?:typeof IMAGE_ASSETS[string]}[]).flatMap(input=>input.displayImage?[{turnId:row.turnId,itemId:row.item.id,image:input.displayImage}]:[]):[])}:undefined;},async(kind,name)=>{const uri=await vscode.window.showSaveDialog({saveLabel:'保存合成图片',filters:{图片:kind==='jpg'?['jpg','jpeg']:[kind]},defaultUri:vscode.Uri.file(join(imageRoot,name))});return uri?.scheme==='file'?uri.fsPath:undefined;},text=>vscode.env.clipboard.writeText(text));
   const formulas=new FormulaExporter(imageRoot,owner,async(kind,name)=>{const uri=await vscode.window.showSaveDialog({saveLabel:'保存 '+kind.toUpperCase(),filters:{[kind.toUpperCase()]:[kind]},defaultUri:vscode.Uri.file(join(imageRoot,name))});return uri?.scheme==='file'?uri.fsPath:undefined;});
   return async(m:any)=>{
    if(!current())return;
    if(await environment.handle(m,post))return;
    if(await draftHost.handle(m,post)||await scrollHost.handle(m,post))return;
    if(await handleDisplaySettings(settings,m,post,current)||await handleSearchHistory(searches,m,post,current))return;
    if(await handleRailView(rails,m,post,()=>current()?{threadId:model.threadId,connectionId:model.connectionId,turnIds:model.turnIds()}:undefined,current))return;
    if(await handleBlockFold(blocks,m,post,owner,current,()=>settings.read().foldMemory)||await handleUserFold(users,m,post,owner,current,()=>settings.read().foldMemory))return;
    if(await handleWorkFold(works,m,post,()=>({...owner()!,turns:model.snapshot().turns??[]}),current,()=>settings.read().foldMemory&&settings.read().workSegments)||await handleToolExpansion(tools,m,post,owner,current,()=>settings.read().expandMemory))return;
    if(await handleChangedFilesFold(changedFiles,m,post,()=>({...owner()!,turns:model.snapshot().turns??[]}),current,()=>settings.read().foldMemory)||await handleChangedReview(changedReviews,m,post,owner,current))return;
    if(await handleMessageCopy(m,owner,current,text=>vscode.env.clipboard.writeText(text),post)||await handleDisplayCopy(m,owner,current,text=>vscode.env.clipboard.writeText(text),post))return;
    try{
     // Reload retains this model and its in-flight storage write. The new page
     // must observe its settled selection before publishing or choosing another.
     if(m.type==='ready'){await selections;await publish();return;}
     if(m.type==='offline-experience-return'){await vscode.commands.executeCommand('codexPrototype.open');return;}
     if(m.type==='formula-component'){if(!model.owns(m))throw Error('合成资料身份已变化');const code=await readFile(join(context.extensionPath,'dist/mathjax-tex-svg.js'),'utf8');await post({type:'formula-component',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:true,code});return;}
     if(m.type==='image-export'){let result;try{result={ok:true,result:await exporter.handle(m as ImageRequest)};}catch(e){result={ok:false,error:e instanceof Error?e.message:'合成图片操作失败'};}await post({type:'image-exported',id:m.id,threadId:m.threadId,connectionId:m.connectionId,...result});return;}
     if(m.type==='formula-export'){let result;try{result={ok:true,result:await formulas.handle(m as FormulaRequest)};}catch(e){result={ok:false,error:e instanceof Error?e.message:'公式导出失败'};}await post({type:'formula-exported',id:m.id,threadId:m.threadId,connectionId:m.connectionId,...result});return;}
     if(m.type==='attachment-storage-check'){await post({type:'attachment-storage-result',id:m.id,status:undefined});return;}
     if(m.type==='send'){await post({type:'sent',threadId:m.threadId,connectionId:m.connectionId,viewId:m.viewId,requestId:m.requestId,ok:false,unknown:false,error:OFFLINE_EXPERIENCE_REASON});return;}
     // Shared-page session selection carries the destination, not a current-thread lease.
     // The document lease above and the fixed fixture allowlist still apply.
     if(m.type==='restore'){
      const connection=model.connectionId,selected=(ok:boolean)=>m.selectionId===undefined?Promise.resolve(false):post({type:'session-selected',id:m.selectionId,threadId:m.threadId,connectionId:connection,ok});
      if(m.selectionId!==undefined&&(!Number.isSafeInteger(m.selectionId)||m.selectionId<1||m.connectionId!==connection))return;
      const task=selections.then(async()=>{if(!current()||model.connectionId!==connection)return;try{await model.select(m.threadId);if(!current()||model.connectionId!==connection)return;error='';await publish();await selected(true);}catch(e){await selected(false);throw e;}});selections=task.catch(()=>{});await task;return;
     }
     if(m.connectionId!==model.connectionId)throw Error('离线页面身份已变化，未执行');
     if(m.type==='thread-sort')await model.catalog.setSort(m.sort);
     else if(m.type==='thread-reorder')await model.catalog.reorder(model.threads,m.threadId,m.before);
     else if(m.type==='search-query'){if(!['thread','workspace'].includes(m.scope)||typeof m.query!=='string'||typeof m.includeTools!=='boolean'||!model.owns(m))throw Error('离线搜索条件或身份无效');model.query(m.id,m.query,m.scope,m.includeTools);}
     else if(['search-cancel','navigate-cancel'].includes(m.type))return;
     else if(['outline-scan','history-older','history-items','navigate'].includes(m.type)){
      if(!model.owns(m))throw Error('离线会话已切换，未读取其他会话');
      if(m.type==='outline-scan')await model.scanOutline();
      else if(m.type==='history-older')model.loadOlder();
      else{const result=model.materialize(m.turnId,m.itemId);if(m.type==='navigate'){await publish();await post({type:'navigation-result',id:m.id,threadId:m.threadId,connectionId:m.connectionId,turnId:m.turnId,...result});return;}}
     }
     else throw Error('本离线体验不支持此操作（'+String(m.type)+'）；不会连接或执行');
     error='';await publish();
    }catch(e){if(current()){error=e instanceof Error?e.message:'离线操作失败';await publish();}}
   };
  }
  let receive=bind();
  target.webview.onDidReceiveMessage(m=>{
   if(panel!==target)return;
   if(m?.type==='ready'){if(typeof m.pageId!=='string'||!/^[0-9a-f-]{36}$/i.test(m.pageId)||m.pageId===pageId)return;pageId=m.pageId;model.connectionId++;receive=bind();return receive(m);}
   if(!pageId||m?.pageId!==pageId)return;return receive(m);
  });
  target.webview.html=html(randomBytes(16).toString('hex'),scripts);
 };
 const open=async()=>{
  // A maximized auxiliary sidebar can cover editor panels. Reveal this explicitly
  // requested experience in the same window, preserving both panels' contents.
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  if(panel){panel.reveal();return;}
  await mount(vscode.window.createWebviewPanel('codexPrototype.offlineExperience','Codex 离线交互体验 · 合成资料',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]}));
 };
 context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('codexPrototype.offlineExperience',{deserializeWebviewPanel:mount}),vscode.commands.registerCommand('codexPrototype.openOfflineExperience',open));
 return open;
}
