import * as vscode from 'vscode';import {createHash} from 'node:crypto';
import type {Projection} from './state';import type {ParsedPublicDiff} from './public-diff';
export const PUBLIC_DIFF_SCHEME='codex-public-diff';
export type PublicDiffSnapshot={threadId:string;turnId:string;revision:number;diff:string;parsed:ParsedPublicDiff;mode:'raw'|'hunk';index?:number};
const MAX_DOCUMENTS=32,MAX_DOCUMENT_CHARACTERS=8_000_000;
/** Immutable read-only virtual documents, backed only by a checked public patch snapshot. */
export class NativeDiffViews implements vscode.TextDocumentContentProvider,vscode.Disposable{
 private documents=new Map<string,{text:string;pending:number;confirmed:boolean}>();private characters=0;private subscriptions:vscode.Disposable[];
 constructor(){this.subscriptions=[vscode.workspace.registerTextDocumentContentProvider(PUBLIC_DIFF_SCHEME,this),vscode.workspace.onDidCloseTextDocument(document=>this.release(document.uri))];}
 provideTextDocumentContent(uri:vscode.Uri){const value=this.documents.get(uri.toString());if(!value)throw Error('公开差异快照已关闭或不属于此查看器');return value.text;}
 private release(uri:vscode.Uri){const key=uri.toString(),value=this.documents.get(key);if(value){this.characters-=value.text.length;this.documents.delete(key);}}
 async open(snapshot:PublicDiffSnapshot,current:()=>boolean){
  const identity=JSON.stringify([snapshot.threadId,snapshot.turnId,snapshot.revision,snapshot.mode,snapshot.index]);
  let title='',values:{side:string;text:string}[];
  if(snapshot.mode==='raw')values=[{side:'public.patch.diff',text:snapshot.diff}];
  else{const hunk=snapshot.parsed.hunks[snapshot.index!];if(!hunk)throw Error('公开补丁片段不存在，请重新打开');values=[{side:'before.txt',text:hunk.before},{side:'after.txt',text:hunk.after}];title=`${hunk.beforePath} → ${hunk.afterPath} · 公开补丁片段 −${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} · 回合 ${snapshot.turnId}`;}
  const records=values.map(value=>{const hash=createHash('sha256').update(identity+'\n'+value.side+'\n'+value.text).digest('hex'),uri=vscode.Uri.parse(`${PUBLIC_DIFF_SCHEME}:/snapshot/${hash}/${value.side}?turn=${encodeURIComponent(snapshot.turnId)}`);return{...value,uri,key:uri.toString()};}),added=records.filter(record=>!this.documents.has(record.key));
  if(this.documents.size+added.length>MAX_DOCUMENTS||this.characters+added.reduce((n,v)=>n+v.text.length,0)>MAX_DOCUMENT_CHARACTERS)throw Error('公开差异窗口已到容量上限，请先关闭部分补丁视图');
  if(!current())throw Error('差异所属页面、会话或快照已改变，未打开');
  for(const record of added){this.documents.set(record.key,{text:record.text,pending:0,confirmed:false});this.characters+=record.text.length;}
  const held=records.map(record=>({record,value:this.documents.get(record.key)!}));for(const entry of held)entry.value.pending++;
  let confirmed=false;
  try{if(snapshot.mode==='raw')await vscode.commands.executeCommand('vscode.open',records[0]!.uri,{preview:true});else await vscode.commands.executeCommand('vscode.diff',records[0]!.uri,records[1]!.uri,title,{preview:true});confirmed=true;}
  finally{for(const {record,value} of held){if(confirmed)value.confirmed=true;value.pending--;if(!value.confirmed&&!value.pending&&this.documents.get(record.key)===value&&!vscode.workspace.textDocuments.some(document=>document.uri.toString()===record.key))this.release(record.uri);}}
 }
 dispose(){for(const subscription of this.subscriptions)subscription.dispose();this.subscriptions=[];this.documents.clear();this.characters=0;}
}
type DiffOwner={connectionId:number;projection:Projection};
export class NativeDiffHost{
 constructor(private owner:()=>DiffOwner|undefined,private active:()=>boolean,private open:(snapshot:PublicDiffSnapshot,current:()=>boolean)=>Promise<void>){}
 async handle(m:any,post:(reply:any)=>unknown){
  if(m?.type!=='turn-diff-open')return false;
  if(!Number.isSafeInteger(m.id)||m.id<1||typeof m.turnId!=='string'||!Number.isSafeInteger(m.revision)||m.revision<1||!['raw','hunk'].includes(m.mode)||m.mode==='hunk'&&(!Number.isSafeInteger(m.index)||m.index<0))return true;
  const source=this.owner(),current=()=>{const now=this.owner();return this.active()&&!!source&&now?.projection===source.projection&&now.connectionId===m.connectionId&&now.projection.threadId===m.threadId;};
  const reply=(result:object)=>post({type:'turn-diff-result',id:m.id,threadId:m.threadId,connectionId:m.connectionId,turnId:m.turnId,revision:m.revision,...result});
  try{if(!current())return true;const captured=source!.projection.turnProgress.readDiff(source!.projection.turns,m.turnId,m.revision),valid=()=>{if(!current())return false;try{return source!.projection.turnProgress.readDiff(source!.projection.turns,m.turnId,m.revision).diff===captured.diff;}catch{return false;}};
   await this.open({threadId:m.threadId,turnId:m.turnId,revision:m.revision,...captured,mode:m.mode,...(m.mode==='hunk'?{index:m.index}:{})},valid);if(current())await reply({ok:true});
  }catch(error){if(current())try{await reply({ok:false,error:error instanceof Error?error.message:'公开差异未能打开'});}catch{/* Never reopen an unknown native command automatically. */}}
  return true;
 }
}
