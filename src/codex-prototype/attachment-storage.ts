import {lstat,readdir,open,unlink,rmdir} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';import {createHash} from 'node:crypto';
import type {DisplayStateStorage} from './display-settings';
import {assertWorkspaceFiles,ownedPath} from './storage';
import {importAttachment} from './attachment-files';
import {attachmentKind,ATTACHMENT_STORE_DEFAULT_MB,validAttachmentLimit,type AttachmentStorageStatus} from './attachment-policy';
import {attachmentSize} from './attachment-size';
import {DraftStore,DRAFT_KEY} from './draft-store';
import {LocalQueueStore,LOCAL_QUEUE_KEY} from './local-queue';
import {AttachmentRetention,ATTACHMENT_RETENTION_KEY,attachmentGroup} from './attachment-retention';
import {MessageFileSources,MESSAGE_FILE_SOURCES_KEY} from './message-file-sources';
import {exportCarriers} from './export-carriers';

export const ATTACHMENT_IMPORTS_KEY='codexPrototype.attachmentImports.v1';
export const IMPORT_RECORD_CAP=4096;
export const ATTACHMENT_GC_BATCH=32;
type FileRecord={name:string;size:number;sha256:string};
type ImportRecord={id:string;seen:boolean;files:FileRecord[];deleting?:boolean};
type Data={version:1;imports:ImportRecord[]};
export type AttachmentCollection={removed:number;bytes:number;missing:number;referenced:number;unobserved:number;remaining:number;changed:{id:string;reason:string}[]};
const protectedKeys=new Set([DRAFT_KEY,LOCAL_QUEUE_KEY,ATTACHMENT_RETENTION_KEY,MESSAGE_FILE_SOURCES_KEY]);
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const samePath=(path:string)=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
const maxFileBytes=(name:string)=>name==='source.bin'?25*1024*1024:5*1024*1024;
function storedName(name:unknown){if(typeof name!=='string')return false;const parts=name.split('/');if(parts.length>2||parts.length===2&&!['derived','animated'].includes(parts[0]!))return false;if(name==='source.bin')return true;try{const kind=attachmentKind(parts.at(-1));return parts.length===1||kind==='image';}catch{return false;}}
/** One coordinator for import evidence and durable references; existing store formats remain unchanged. */
export class AttachmentStorage{
 private tail:Promise<unknown>=Promise.resolve();private records:ImportRecord[]=[];private blocked='';private collectCursor=0;private lastCollection:AttachmentCollection|undefined;
 private size:{bytes:number|null;files:number|null;checkedAt:number|null;sizeError:string}={bytes:null,files:null,checkedAt:null,sizeError:'尚未扫描'};private maintenanceError='';
 readonly state:DisplayStateStorage;
 constructor(private raw:DisplayStateStorage,private root:string,private maxTotalMB:()=>number=()=>ATTACHMENT_STORE_DEFAULT_MB){
  const value=raw.get<unknown>(ATTACHMENT_IMPORTS_KEY,undefined);if(value!==undefined){if(this.valid(value))this.records=structuredClone(value.imports);else this.blocked='附件导入记录无法读取；原数据保留，未清理来源';}
  this.state={get:<T>(key:string,fallback:T)=>raw.get(key,fallback),update:(key,value)=>protectedKeys.has(key)?this.serial(()=>this.updateReferences(key,value)):raw.update(key,value)};
 }
 private valid(value:any):value is Data{
  return value?.version===1&&Array.isArray(value.imports)&&value.imports.length<=IMPORT_RECORD_CAP&&new Set(value.imports.map((record:any)=>record?.id)).size===value.imports.length&&value.imports.every((record:any)=>typeof record?.id==='string'&&attachmentGroup(this.root,join(this.root,'.codex-attachments',record.id,'input.png'))===record.id&&typeof record.seen==='boolean'&&(record.deleting===undefined||typeof record.deleting==='boolean')&&Array.isArray(record.files)&&record.files.length>0&&record.files.length<=3&&new Set(record.files.map((file:any)=>file?.name)).size===record.files.length&&record.files.every((file:any)=>storedName(file?.name)&&Number.isSafeInteger(file.size)&&file.size>0&&file.size<=maxFileBytes(file.name)&&/^[a-f0-9]{64}$/.test(file.sha256??'')));
 }
 private serial<T>(work:()=>Promise<T>){const task=this.tail.then(work);this.tail=task.catch(()=>{});return task;}
 private check(){if(this.blocked)throw Error(this.blocked);}
 private async save(records:ImportRecord[]){const value:Data={version:1,imports:records};if(!this.valid(value))throw Error('附件导入记录无法核对，未覆盖原记录');try{await this.raw.update(ATTACHMENT_IMPORTS_KEY,value);}catch(error){this.blocked='附件导入记录保存未确认；来源保留，停止导入及自动清理，请Reload后核对';throw error;}this.records=records;}
 private async references(storage=this.raw,key?:string){
  const references=new Map<string,string>(),add=(kind:string,owner:string,path:string)=>{if(attachmentGroup(this.root,path)){const normalized=samePath(path);references.set(JSON.stringify([kind,owner,normalized]),normalized);}};
  if(!key||key===DRAFT_KEY)for(const value of await new DraftStore(storage).attachmentReferences())add(DRAFT_KEY,value.owner,value.path);
  if(!key||key===LOCAL_QUEUE_KEY)for(const value of await new LocalQueueStore(storage).attachmentReferences())add(LOCAL_QUEUE_KEY,value.owner,value.path);
  if(!key||key===MESSAGE_FILE_SOURCES_KEY)for(const value of await new MessageFileSources(storage,this.root).attachmentReferences())add(MESSAGE_FILE_SOURCES_KEY,value.owner,value.path);
  if(!key||key===ATTACHMENT_RETENTION_KEY){const retained=await new AttachmentRetention(storage,this.root).snapshot();for(const [owner,paths]of retained.threads)for(const path of paths)add(ATTACHMENT_RETENTION_KEY,'thread:'+owner,path);for(const [owner,paths]of retained.unresolvedForks)for(const path of paths)add(ATTACHMENT_RETENTION_KEY,'fork:'+owner,path);}
  return references;
 }
 private async updateReferences(key:string,value:unknown){
  const next={get:<T>(name:string,fallback:T)=>(name===key?value:this.raw.get(name,fallback))as T,update:async()=>{}},before=await this.references(this.raw,key),after=await this.references(next,key);
  for(const [identity,path]of after)if(!before.has(identity)){try{const safe=await ownedPath(this.root,path),info=await lstat(safe);if(!info.isFile()||info.isSymbolicLink())throw Error('invalid');}catch{throw Error('附件来源已缺失或被替换，请重新附加；原引用未覆盖');}}
  try{await this.raw.update(key,value);}catch(error){this.blocked='附件引用保存未确认；停止自动清理，请Reload后核对';throw error;}
  if(this.blocked)return;const paths=new Set(after.values()),records=this.records.map(record=>!record.seen&&record.files.some(file=>paths.has(samePath(join(this.root,'.codex-attachments',record.id,file.name))))?{...record,seen:true}:record);
  if(records.some((record,index)=>record!==this.records[index]))await this.save(records);
 }
 private async boundedBytes(path:string,max:number){
  const safe=await ownedPath(this.root,path),before=await lstat(safe,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.size<1n||before.size>BigInt(max))throw Error('附件来源大小或类型已变化');const handle=await open(safe,'r');
  try{
   const opened=await handle.stat({bigint:true});if(!opened.isFile()||opened.ino!==before.ino||opened.dev!==before.dev||opened.size!==before.size)throw Error('附件打开期间来源已变化');const bytes=Buffer.alloc(Number(opened.size)+1);let offset=0;
   while(offset<bytes.length){const read=await handle.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)break;offset+=read.bytesRead;}
   const after=await handle.stat({bigint:true}),now=await lstat(safe,{bigint:true});await ownedPath(this.root,safe);
   if(offset!==Number(opened.size)||after.size!==opened.size||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||now.isSymbolicLink()||!now.isFile()||now.ino!==opened.ino||now.dev!==opened.dev||now.size!==after.size||now.mtimeNs!==after.mtimeNs||now.ctimeNs!==after.ctimeNs)throw Error('附件来源读取期间已变化');return bytes.subarray(0,offset);
  }finally{await handle.close();}
 }
 private async capture(id:string,created:string[]):Promise<FileRecord[]>{
  const dir=await ownedPath(this.root,join('.codex-attachments',id)),info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())throw Error('附件导入目录已变化');const entries=await readdir(dir,{withFileTypes:true});if(entries.length<1||entries.length>3)throw Error('附件导入文件集合无法核对');const names:string[]=[];
  for(const entry of entries){if(entry.isFile())names.push(entry.name);else if(entry.isDirectory()&&['derived','animated'].includes(entry.name)){const nested=await readdir(await ownedPath(this.root,join(dir,entry.name)),{withFileTypes:true});if(nested.length!==1||!nested[0]!.isFile())throw Error('附件导入子目录无法核对');names.push(entry.name+'/'+nested[0]!.name);}else throw Error('附件导入目录包含未知文件或链接');}
  const expected=created.map(path=>{if(attachmentGroup(this.root,path)!==id)throw Error('附件创建清单超出本次目录');const name=relative(dir,path).replace(/\\/g,'/');if(!storedName(name))throw Error('附件创建名称无效');return name;});if(new Set(expected).size!==expected.length||expected.length!==names.length||names.some(name=>!expected.includes(name)))throw Error('附件目录包含非本次创建文件，未接管或删除它们');
  const files:FileRecord[]=[];for(const name of expected){const bytes=await this.boundedBytes(join(dir,name),maxFileBytes(name));files.push({name,size:bytes.length,sha256:sha(bytes)});}return files.sort((a,b)=>a.name.localeCompare(b.name));
 }
 private async emptyDirectories(record:ImportRecord){
  const dirs=[...new Set(record.files.filter(file=>file.name.includes('/')).map(file=>file.name.split('/')[0]!))];
  for(const name of dirs)try{await rmdir(await ownedPath(this.root,join('.codex-attachments',record.id,name)));}catch(error){if(!['ENOENT','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
 }
 /** Resumes only a durably marked deletion; absent files before that marker are treated as changed source. */
 private async remaining(record:ImportRecord){
  const paths:string[]=[];for(const file of record.files){const path=await ownedPath(this.root,join('.codex-attachments',record.id,file.name));try{await lstat(path);paths.push(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(!record.deleting)throw Error('附件文件缺失，保留其余来源');}}
  if(record.deleting)await this.emptyDirectories(record);
  if(!paths.length)return[];
  const found=await this.capture(record.id,paths);for(const file of found){const expected=record.files.find(value=>value.name===file.name);if(!expected||file.size!==expected.size||file.sha256!==expected.sha256)throw Error('附件内容已变化，未清理');}return found;
 }
 private async collectKnown():Promise<AttachmentCollection>{
  this.lastCollection=undefined;this.check();await assertWorkspaceFiles(this.root);const references=await this.references(),groups=new Set([...references.values()].map(path=>attachmentGroup(this.root,path))),observed=this.records.map(record=>!record.seen&&groups.has(record.id)?{...record,seen:true}:record);
  if(observed.some((record,index)=>record!==this.records[index]))await this.save(observed);
  const candidates=this.records.filter(record=>record.seen&&!groups.has(record.id)),offset=this.collectCursor%Math.max(1,candidates.length),batch=[...candidates.slice(offset),...candidates.slice(0,offset)].slice(0,ATTACHMENT_GC_BATCH),report:AttachmentCollection={removed:0,bytes:0,missing:0,referenced:this.records.filter(record=>groups.has(record.id)).length,unobserved:this.records.filter(record=>!record.seen&&!groups.has(record.id)).length,remaining:Math.max(0,candidates.length-batch.length),changed:[]};this.collectCursor=offset+batch.length;
  for(const record of batch){
   try{
    const dir=await ownedPath(this.root,join('.codex-attachments',record.id));try{await lstat(dir);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await this.save(this.records.filter(value=>value.id!==record.id));report.missing++;continue;}
    const remaining=await this.remaining(record);if(!record.deleting)await this.save(this.records.map(value=>value.id===record.id?{...value,deleting:true}:value));
    for(const file of remaining){const path=await ownedPath(this.root,join(dir,file.name)),bytes=await this.boundedBytes(path,file.size);if(bytes.length!==file.size||sha(bytes)!==file.sha256)throw Error('删除前附件内容已变化，剩余来源保留');await ownedPath(this.root,path);await unlink(path);report.bytes+=file.size;}
    await this.emptyDirectories(record);await rmdir(await ownedPath(this.root,dir));await this.save(this.records.filter(value=>value.id!==record.id));report.removed++;
   }catch(error){if(this.blocked)throw error;report.changed.push({id:record.id,reason:error instanceof Error?error.message:'来源状态无法核对，未继续清理'});}
  }
  this.lastCollection=report;return report;
 }
 /** All reference writes share this gate. No recursive deletion, no legacy adoption, no automatic replay. */
 collect(){return this.serial(()=>this.collectKnown());}
 private limit(){const value=this.maxTotalMB();return validAttachmentLimit(value)?value:ATTACHMENT_STORE_DEFAULT_MB;}
 private async measure(){try{this.size={...await attachmentSize(this.root),checkedAt:Date.now(),sizeError:''};}catch(error){this.size={bytes:null,files:null,checkedAt:Date.now(),sizeError:error instanceof Error?error.message:'附件大小无法完整统计'};}}
 status():AttachmentStorageStatus{const c=this.lastCollection;return{...this.size,exports:exportCarriers(this.root).status(),limitMB:this.limit(),maintenanceError:this.blocked||this.maintenanceError,...(c?{collection:{removed:c.removed,bytes:c.bytes,missing:c.missing,remaining:c.remaining,changed:c.changed.length,referenced:c.referenced,unobserved:c.unobserved}}:{})};}
 /** One bounded GC batch plus a read-only size snapshot. Failed/incomplete measurements stay unknown. */
 async maintain(){await Promise.all([exportCarriers(this.root).maintain(),this.serial(async()=>{this.maintenanceError='';try{await this.collectKnown();}catch(error){this.maintenanceError=error instanceof Error?error.message:'附件清理未完成';}await this.measure();})]);return this.status();}
 /** Before delivery, record the exact newly-created files. Unknown delivery stays unobserved and protected. */
 import:typeof importAttachment=(root,name,base64,current,original)=>this.serial(async()=>{
  this.check();if(samePath(root)!==samePath(this.root))throw Error('附件存储工作区不一致');await this.collectKnown();if(!current())throw Error('附件清理核对期间所属线程已切换');if(this.records.length>=IMPORT_RECORD_CAP)throw Error('附件导入记录已达4096组上限，未淘汰来源');
  const result=await importAttachment(root,name,base64,current,original).catch(async(error:unknown)=>{await this.measure();throw error;}),path='path'in result?result.path:result.file.path,id=attachmentGroup(root,path)!;
  try{const files=await this.capture(id,result.createdFiles);await this.measure();const limit=this.limit();if(limit!==-1){if(this.size.bytes===null)throw Error('附件大小无法完整统计，未导入；可检查存储状态后重试');if(this.size.bytes>limit*1024*1024)throw Error('加入此附件后将超过本地存储上限（'+limit+' MiB）；已有受保护来源未删除，请调整上限或处理已有引用');}if(!current())throw Error('附件所属线程已切换');await this.save([...this.records,{id,seen:false,files}]);if(!current())throw Error('附件保存期间所属线程已切换');}
  catch(error){try{await result.discard();if(!this.blocked&&this.records.some(record=>record.id===id))await this.save(this.records.filter(record=>record.id!==id));}finally{await this.measure();}throw error;}
  return{...result,discard:()=>this.serial(async()=>{const references=new Set((await this.references()).values());if(this.records.find(record=>record.id===id)?.files.some(file=>references.has(samePath(join(root,'.codex-attachments',id,file.name)))))return;try{await result.discard();await this.save(this.records.filter(record=>record.id!==id));}finally{await this.measure();}})};
 });
 async snapshot(){return this.serial(async()=>{this.check();const references=await this.references();return{imports:structuredClone(this.records),protectedPaths:[...new Set(references.values())],...(this.lastCollection?{lastCollection:structuredClone(this.lastCollection)}:{})};});}
}
