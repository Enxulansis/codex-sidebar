import {existsSync,readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store,assertOwnedWorkspace,type LedgerData,type StorePolicy} from './storage';
import {PIN} from './pin';

export const ACCEPTANCE_MANIFEST='acceptance-batch.json',ACCEPTANCE_LEDGER='acceptance-ledger.json',ACCEPTANCE_LIMIT=2;
type Identity={schemaVersion:1;id:string;limit:2;workspace:string;backend:{version:string;sha256:string}};
type Manifest=Identity&{dispatchEnabled:boolean;runtimeBackend?:Identity['backend']};
type AcceptanceData=LedgerData&{batch:Identity};
const ORIGINAL_BACKEND={version:'codex-cli 0.162.0-alpha.17.2',sha256:'d13914ced6c7af174d8d638db938284231227312104b06a25e9608c632a7daec'};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function regular(path:string){const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink())throw Error('验收记录必须是本批普通文件，不能使用链接');}
function canonicalRun(run:string){const path=resolve(run);if(realpathSync(path).toLowerCase()!==path.toLowerCase())throw Error('验收目录不能通过链接指向其他记录');return path;}
function readManifest(run:string):Manifest{
 const path=join(run,ACCEPTANCE_MANIFEST);regular(path);const value=JSON.parse(readFileSync(path,'utf8')) as Manifest;
 const backend=value?.runtimeBackend??value?.backend;
 // An explicit approved runtime binding preserves the original budget identity and ledger bytes.
 if(value?.schemaVersion!==1||typeof value.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value.id)||value.limit!==ACCEPTANCE_LIMIT||typeof value.workspace!=='string'||!value.workspace||typeof value.dispatchEnabled!=='boolean'||backend?.version!==PIN.version||backend.sha256!==PIN.sha256||value.runtimeBackend!==undefined&&!same(value.backend,ORIGINAL_BACKEND))throw Error('验收批次身份、上限、后端或禁发配置无效；未重建额度');
 return value;
}
function identity(value:Manifest):Identity{return{schemaVersion:1,id:value.id,limit:ACCEPTANCE_LIMIT,workspace:value.workspace,backend:{version:value.backend.version,sha256:value.backend.sha256}};}
export function hasAcceptanceBatch(run:string){return existsSync(join(run,ACCEPTANCE_MANIFEST))||existsSync(join(run,ACCEPTANCE_LEDGER));}
/** Explicit preparation only. Extension activation and Reload never create a new ledger. */
export async function prepareAcceptanceBatch(run:string,workspace:string,id:string){
 await assertOwnedWorkspace(workspace);const root=realpathSync(workspace);mkdirSync(resolve(run),{recursive:true});const folder=canonicalRun(run),lock=join(folder,'acceptance-init.lock'),fd=openSync(lock,'wx');
 try{
  if(existsSync(join(folder,'ledger.json')))throw Error('不能将旧账本目录改造成新验收批次');
  if(hasAcceptanceBatch(folder)){
   const existing=openAcceptanceBatch(folder,root);if(existing.batchId!==id)throw Error('目录已绑定其他验收批次，不能重置');return existing;
  }
  const manifest:Manifest={schemaVersion:1,id,limit:ACCEPTANCE_LIMIT,workspace:root,backend:{version:PIN.version,sha256:PIN.sha256},dispatchEnabled:false};
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id))throw Error('验收批次标识无效');
  // A partial preparation fails closed on the next open.
  writeFileSync(join(folder,ACCEPTANCE_MANIFEST),JSON.stringify(manifest,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  const data:AcceptanceData={attempts:[],threads:[],pendingApprovals:[],invalidatedApprovals:[],batch:identity(manifest)};
  writeFileSync(join(folder,ACCEPTANCE_LEDGER),JSON.stringify(data,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  return openAcceptanceBatch(folder,root);
 }finally{closeSync(fd);unlinkSync(lock);}
}
export function openAcceptanceBatch(run:string,workspace?:string){
 const folder=canonicalRun(run),initial=readManifest(folder),owner=identity(initial),ledger=join(folder,ACCEPTANCE_LEDGER);
 if(workspace&&realpathSync(workspace).toLowerCase()!==initial.workspace.toLowerCase())throw Error('验收批次的工作区不匹配，未恢复旧线程');
 const current=()=>{const value=readManifest(folder);if(!same(identity(value),owner))throw Error('验收批次身份已改变；发送禁用');return value;};
 const policy:StorePolicy={
  validate(data){
   regular(ledger);current();const value=data as AcceptanceData;
   if(!same(value.batch,owner)||data.attempts.length>ACCEPTANCE_LIMIT||new Set(data.threads).size!==data.threads.length||data.threads.some(id=>typeof id!=='string'||!id||id.length>256)||data.selected!==undefined&&!data.threads.includes(data.selected)||new Set(data.attempts.map(a=>a?.id)).size!==data.attempts.length||data.attempts.some(a=>!a||typeof a.id!=='string'||!a.id||!data.threads.includes(a.threadId)||!['text/tool','image'].includes(a.purpose)||typeof a.reservedAt!=='string'||!Number.isFinite(Date.parse(a.reservedAt))))throw Error('验收账本身份、额度或记录损坏；禁止覆盖或重新派发');
  },
  blockedReason(data,purpose){
   if(!current().dispatchEnabled)return '本批仅预检，真实发送已禁用；等待用户另行确认';
   if(!['text/tool','image'].includes(purpose))return '本批只批准最多两次新回合，不允许插话派发';
   if(data.attempts.some(a=>a.status!=='completed'||!a.turnId))return '前次派发尚未明确完成或结果未知；本批暂停，不自动重试';
   if(data.attempts.length>=ACCEPTANCE_LIMIT)return '本批2次派发额度已用尽，发送禁用';
   return '';
  }
 };
 const store=new Store(ledger,ACCEPTANCE_LIMIT,[],policy);store.read();
 return{store,oldUsed:null,baselineSha256:null,batchId:initial.id,independentBatch:true as const};
}
