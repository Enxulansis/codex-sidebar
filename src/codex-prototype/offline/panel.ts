import * as vscode from 'vscode';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {offlineHtml} from './html';
import {FormulaExporter,type FormulaRequest} from '../formula-export-host';
import {Replay} from './replay';import {TIMELINES} from './fixtures';
import {DisplaySettingsStore,handleDisplaySettings} from '../display-settings';
import {BlockFoldStore,handleBlockFold} from '../block-fold-store';
import {UserFoldStore,handleUserFold} from '../user-fold-store';
import {handleMessageCopy} from '../message-copy';
import {handleDisplayCopy} from '../display-copy';
import {ImageExporter,type ImageRequest,type ImageSourceRequest,type ImageFrameRequest} from '../image-export-host';import {IMAGE_ASSETS} from './image-assets';
import {RuntimeEnvironmentHost} from '../runtime-environment-host';
import type {RuntimeEnvironment} from '../runtime-environment';
import {FileReferenceHost} from '../file-reference-host';
import {openReferencedText,openReferencedFile,findReferencedFiles} from '../file-reference-vscode';

/** Offline host: explicit display copying/exporting only; no execution authority. */
export function registerOfflinePanel(context:vscode.ExtensionContext,settings:DisplaySettingsStore,blockFolds:BlockFoldStore,userFolds:UserFoldStore,sidebar=false,readEnvironment?:()=>Promise<RuntimeEnvironment>):()=>Promise<void> {
  let panel:vscode.WebviewPanel|vscode.WebviewView|undefined;
  const mount=async(target:vscode.WebviewPanel|vscode.WebviewView)=>{
    panel=target;target.webview.options={enableScripts:true,localResourceRoots:[]};
    const root=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath??'';
    let pageVersion=0;
    let pageId='';
    const settingsChanges=settings.onDidChange(source=>{if(panel===target&&pageId&&source!==pageId)void target.webview.postMessage({type:'settings-changed',pageId}).then(undefined,()=>{});});context.subscriptions.push(settingsChanges);
    target.onDidDispose(()=>{settingsChanges.dispose();if(panel===target)panel=undefined;});
    function bindPage(){
    const version=++pageVersion,documentId=pageId,current=()=>panel===target&&version===pageVersion;
    const post=(message:object)=>current()?target.webview.postMessage({...message,pageId:documentId}):Promise.resolve(false);
    const environment=new RuntimeEnvironmentHost(readEnvironment??(async()=>{throw Error('运行环境读取未接入');}),current);
    let position={threadId:'',connectionId:0,cursor:0};
    const owner=()=>{
      if(!current()||!TIMELINES[position.threadId])return;
      const replay=new Replay();replay.select(position.threadId);for(const event of TIMELINES[position.threadId]!.slice(0,position.cursor))replay.apply(event);
      return {...position,items:[...replay.messages.values()].map(v=>({turnId:v.turnId,complete:v.complete,item:{type:v.role==='assistant'?'agentMessage':'userMessage',id:v.itemId,text:v.text,...(v.role==='user'?{content:[{type:'text',text:v.text}]}:{})}}))};
    };
    const exporter=new FormulaExporter(root,owner,async(kind,name)=>{const uri=await vscode.window.showSaveDialog({saveLabel:'保存 '+kind.toUpperCase(),filters:{[kind.toUpperCase()]:[kind]},defaultUri:vscode.Uri.file(join(root,name))});if(uri&&uri.scheme!=='file')throw Error('只能保存到临时工作区的本地文件');return uri?.fsPath;});
    const imageExporter=new ImageExporter(root,()=>{if(!owner())return;const replay=new Replay();replay.select(position.threadId);for(const event of TIMELINES[position.threadId]!.slice(0,position.cursor))replay.apply(event);return{...position,images:[...replay.messages.values()].flatMap(v=>v.images.flatMap(id=>IMAGE_ASSETS[id]?[{turnId:v.turnId,itemId:v.itemId,image:IMAGE_ASSETS[id]!}]:[]))};},async(kind,name)=>{const uri=await vscode.window.showSaveDialog({saveLabel:'保存图片',filters:{图片:kind==='jpg'?['jpg','jpeg']:[kind]},defaultUri:vscode.Uri.file(join(root,name))});if(uri&&uri.scheme!=='file')throw Error('只能保存到临时工作区的本地文件');return uri?.fsPath;},text=>vscode.env.clipboard.writeText(text));
    const fileReferences=new FileReferenceHost(root,owner,current,openReferencedText,pattern=>findReferencedFiles(root,pattern),openReferencedFile);
    return async(m:any)=>{
      if(!current())return;
      if(await environment.handle(m,post))return;
      if(await fileReferences.handle(m,post))return;
      if(await handleDisplaySettings(settings,m,post,current))return;
      if(await handleBlockFold(blockFolds,m,post,owner,current,()=>settings.read().foldMemory))return;
      if(await handleUserFold(userFolds,m,post,owner,current,()=>settings.read().foldMemory))return;
      if(await handleMessageCopy(m,owner,current,text=>vscode.env.clipboard.writeText(text),post))return;
      if(m?.type==='image-frame-copy'){try{const result=await imageExporter.copyFrame(m as ImageFrameRequest);await post({type:'image-frame-copied',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:true,result});}catch(error){await post({type:'image-frame-copied',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:false,error:error instanceof Error?error.message:'帧PNG复制失败'});}return;}
      if(m?.type==='image-origin-read'){try{const result=await imageExporter.readOrigin(m as ImageSourceRequest);await post({type:'image-origin-result',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:true,result});}catch(error){await post({type:'image-origin-result',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:false,error:error instanceof Error?error.message:'原动图读取失败'});}return;}
      if(m?.type==='image-export'){try{const result=await imageExporter.handle(m as ImageRequest);await post({type:'image-exported',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:true,result});}catch(error){await post({type:'image-exported',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:false,error:error instanceof Error?error.message:'图片操作失败'});}return;}
      if(m?.type==='offline-position'){
        if(typeof m.threadId==='string'&&TIMELINES[m.threadId]&&Number.isSafeInteger(m.connectionId)&&(m.connectionId>position.connectionId||(m.connectionId===position.connectionId&&m.threadId===position.threadId&&m.cursor>=position.cursor))&&Number.isSafeInteger(m.cursor)&&m.cursor>=0&&m.cursor<=TIMELINES[m.threadId]!.length)position={threadId:m.threadId,connectionId:m.connectionId,cursor:m.cursor};return;
      }
      if(m?.type==='formula-component'){
        const valid=current()&&Number.isSafeInteger(m.id)&&m.id>0&&m.threadId===position.threadId&&m.connectionId===position.connectionId;
        try{if(!valid)throw Error('显示身份失效');const code=await readFile(join(context.extensionPath,'dist/mathjax-tex-svg.js'),'utf8');await post({type:'formula-component',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:true,code});}
        catch{await post({type:'formula-component',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:false});}return;
      }
      if(m?.type==='formula-export'){
        try{const result=await exporter.handle(m as FormulaRequest);await post({type:'formula-exported',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:true,result});}
        catch(error){await post({type:'formula-exported',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:false,error:error instanceof Error?error.message:'公式导出失败'});}return;
      }
      await handleDisplayCopy(m,()=>position,current,text=>vscode.env.clipboard.writeText(text),post);
    };
    }
    let receive=bindPage();
    target.webview.onDidReceiveMessage(m=>{if(panel!==target)return;if(m?.type==='ready'){if(typeof m.pageId!=='string'||!/^[0-9a-f-]{36}$/i.test(m.pageId)||m.pageId===pageId)return;pageId=m.pageId;receive=bindPage();return;}if(!pageId||m?.pageId!==pageId)return;return receive(m);});
    const [vendor,browser]=await Promise.all(['offline-vendor.js','offline-browser.js'].map(n=>readFile(join(context.extensionPath,'dist',n),'utf8')));
    if(panel===target)target.webview.html=offlineHtml(vendor!,browser!,randomBytes(16).toString('hex'));
  };
  if(sidebar)context.subscriptions.push(vscode.window.registerWebviewViewProvider('codexPrototype.chat',{resolveWebviewView:mount},{webviewOptions:{retainContextWhenHidden:true}}));
  const open=async()=>{
    if(sidebar){await vscode.commands.executeCommand('codexPrototype.chat.focus');return;}
    if(panel&&'reveal' in panel){panel.reveal();return;}
    await mount(vscode.window.createWebviewPanel('codexPrototype.offline','Codex 离线显示演示',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]}));
  };
  context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.openOffline',open));
  let comparison:vscode.WebviewPanel|undefined;
  if(existsSync(join(context.extensionPath,'dist/preview-comparison.html')))context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.previewComparison',async()=>{
    if(comparison){comparison.reveal();return;}
    const html=await readFile(join(context.extensionPath,'dist/preview-comparison.html'),'utf8');
    comparison=vscode.window.createWebviewPanel('codexPrototype.previewComparison','165／Codex 图片预览对照',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
    comparison.webview.html=html;
    comparison.onDidDispose(()=>{comparison=undefined;});
    // Pure synthetic display: no messages accepted by the host, no resource roots.
  }));
  return open;
}
