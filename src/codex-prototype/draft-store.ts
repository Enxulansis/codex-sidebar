import type {DisplayStateStorage} from './display-settings';
import {randomUUID} from 'node:crypto';
import {imageInput} from './storage';
import {checkedImage} from './online-image';

export const DRAFT_KEY='codexPrototype.drafts.v1';
export const DRAFT_CAP=32;
import {emptyDraft,draftFiles,draftImages,imageFields,validDraft,validDraftRecord,hasDraftContent,type DraftFields,type DraftRecord,type DraftFile,type DraftImage,type DraftRecovery,type DraftRecoveryIdentity} from './draft-store-types';
import {checkDraftFile} from './attachment-files';
import {readImageOrigin} from './image-origin';
import {isAnimationPosterPath} from './image-formats';
import {sameSkill,type SkillReference} from './skill-reference';
import {ATTACHMENT_COUNT} from './attachment-policy';
export {emptyDraft,validDraft,DRAFT_TEXT_CAP,type DraftFields,type DraftRecord} from './draft-store-types';
function validThread(t:unknown):t is string{return typeof t==='string'&&t.length>0&&t.length<=256;}
function copyFields(value:DraftFields):DraftFields{return {text:value.text,image:value.image,pathInput:value.pathInput,imageToken:value.imageToken,...(value.draftEditId?{draftEditId:value.draftEditId}:{}),...(value.extraImages?.length?{extraImages:value.extraImages.map(v=>({...v}))}:{}),...(value.files?.length?{files:value.files.map(f=>({...f}))}:{}),...(value.skill?{skill:{...value.skill}}:{})};}
function checkRecoveryIdentity(value:DraftRecord,expected:DraftRecoveryIdentity|undefined){if(!expected||typeof expected!=='object'||expected.recoveryId!==value.recovery?.id||expected.draftEditId!==value.draftEditId||expected.pendingEditId!==value.pendingEditId)throw Error('草稿或原内容已变化，请重新核对');}
/** Workspace-local metadata only. Images remain under the existing checked workspace path. */
export class DraftStore {
 private records=new Map<string,DraftRecord>();private tail:Promise<unknown>=Promise.resolve();private corrupt=false;
 private forgotten=new Set<string>();
 constructor(private storage:DisplayStateStorage){
  const raw=storage.get<any>(DRAFT_KEY,undefined);if(raw===undefined)return;
  if(!Array.isArray(raw)||raw.length>DRAFT_CAP||new Set(raw.map(v=>v?.[0])).size!==raw.length||raw.some(v=>!Array.isArray(v)||v.length!==2||!validThread(v[0])||!validDraftRecord(v[1]))){this.corrupt=true;return;}
  this.records=new Map(raw);
 }
 read(thread:string){if(this.corrupt)throw Error('草稿存储无法读取；未覆盖原数据');if(!validThread(thread)||this.forgotten.has(thread))throw Error('草稿线程无效或已永久删除');return structuredClone(this.records.get(thread)??emptyDraft());}
 async load(thread:string){await this.tail;return this.read(thread);}
 async attachmentReferences(){await this.tail;if(this.corrupt)throw Error('草稿存储无法读取；未清理附件');return [...this.records].flatMap(([owner,value])=>[value,...(value.recovery?[value.recovery.draft]:[])].flatMap(draft=>[...draftImages(draft).map(image=>({owner,path:image.path})),...draftFiles(draft).map(file=>({owner,path:file.path}))]));}
 private change(thread:string,fn:(old:DraftRecord)=>DraftRecord){
  const task=this.tail.then(async()=>{const value=fn(this.read(thread));if(!validDraftRecord(value))throw Error('草稿恢复记录格式无效，原数据未覆盖');const next=new Map(this.records);if(!hasDraftContent(value)&&!value.uncertain&&!value.recovery)next.delete(thread);else next.set(thread,value);if(next.size>DRAFT_CAP)throw Error('草稿已达32个线程上限；请先清空不需要的草稿');await this.storage.update(DRAFT_KEY,[...next]);this.records=next;return structuredClone(value);});this.tail=task.catch(()=>{});return task;
 }
 save(thread:string,value:unknown,current:()=>boolean=()=>true){if(!validDraft(value))return Promise.reject(Error(`草稿过长、附件超过本地${ATTACHMENT_COUNT}项上限或格式无效，未截断内容`));if('recovery'in value||'pendingEditId'in value)return Promise.reject(Error('恢复记录只能由提交操作创建，未覆盖当前内容'));const fields=copyFields(value);return this.change(thread,old=>{if(!current())throw Error('草稿保存身份已变化，未覆盖当前内容');return {...fields,uncertain:old.uncertain,...(old.pendingEditId!==undefined?{pendingEditId:old.pendingEditId}:{}),...(old.recovery?{recovery:old.recovery}:{})};});}
 begin(thread:string,text:string,image:string,imageToken='',files:DraftFile[]=[],extraImages:DraftImage[]=[],skill?:SkillReference,draftEditId?:string,mode:DraftRecovery['mode']='send'){return this.change(thread,old=>{if(old.uncertain)throw Error('上次发送结果未确认，请先核对历史');if(old.recovery)throw Error('请先核对并处理上次原内容，再开始新的提交');if(!['send','queue','steer'].includes(mode))throw Error('提交类型无效');if(old.draftEditId!==draftEditId||old.text!==text||!sameSkill(old.skill,skill)||JSON.stringify(draftImages(old))!==JSON.stringify(draftImages({image,imageToken,extraImages}))||JSON.stringify(draftFiles(old))!==JSON.stringify(files))throw Error('草稿已变化，请重新发送');return {...old,uncertain:true,pendingEditId:draftEditId??'',recovery:{id:randomUUID(),mode,state:'pending',draft:copyFields(old)}};});}
 finish(thread:string,text:string,image:string,accepted:boolean,imageToken='',files:DraftFile[]=[],extraImages:DraftImage[]=[],skill?:SkillReference,draftEditId?:string){return this.change(thread,old=>{
  // A new edit can have identical text/files. Its durable identity, rather than
  // the still-open webview, must protect it from an older acknowledgement.
  if(old.pendingEditId!==(draftEditId??''))return old;
  const unchanged=!!old.recovery&&JSON.stringify(copyFields(old))===JSON.stringify(old.recovery.draft);
  const clear=accepted&&old.draftEditId===draftEditId&&(draftEditId!==undefined||unchanged),sent=draftImages({image,imageToken,extraImages});
  const remaining=draftImages(old).filter(v=>!clear||!sent.some(s=>s.path===v.path&&s.token===v.token));
  const next={...old,text:clear&&old.text===text&&sameSkill(old.skill,skill)?'':old.text,...imageFields(remaining),uncertain:false};
  delete (next as DraftRecord).pendingEditId;if(accepted||old.recovery&&JSON.stringify(copyFields(old))===JSON.stringify(old.recovery.draft))delete next.recovery;else if(next.recovery)next.recovery={...next.recovery,state:'rejected'};if(clear&&sameSkill(old.skill,skill))delete next.skill;if(!next.extraImages.length)delete (next as DraftRecord).extraImages;if(clear&&old.files)next.files=old.files.filter(f=>!files.some(sent=>sent.path===f.path&&sent.sha256===f.sha256));return next;
 });}
 review(thread:string,expected:DraftRecoveryIdentity,current:()=>boolean=()=>true){return this.change(thread,old=>{if(!current())throw Error('草稿页面或线程已切换');checkRecoveryIdentity(old,expected);const next={...old,uncertain:false};delete next.pendingEditId;delete next.recovery;return next;});}
 restore(thread:string,expected:DraftRecoveryIdentity,current:()=>boolean=()=>true){return this.change(thread,old=>{if(!current())throw Error('草稿页面或线程已切换');checkRecoveryIdentity(old,expected);if(!old.recovery)throw Error('没有可恢复的原内容快照');if(hasDraftContent(old))throw Error('当前草稿非空，已保留当前稿，未覆盖');return {...copyFields(old.recovery.draft),draftEditId:randomUUID(),uncertain:false};});}
 forget(thread:string){
  if(!validThread(thread)||this.corrupt)return Promise.reject(Error('无法安全清理草稿记录'));
  this.forgotten.add(thread);
  const task=this.tail.then(async()=>{const next=new Map(this.records);next.delete(thread);await this.storage.update(DRAFT_KEY,[...next]);this.records=next;});
  this.tail=task.catch(()=>{});return task;
 }
}
type Identity={threadId:string;connectionId:number;threads:string[]};
export async function loadDraftImage(root:string,path:string){const safe=await imageInput(root,path),image=await checkedImage(root,safe,'draft');if(!image.src)throw Error('草稿图片无法解码');return {path:safe,preview:image.src};}
/** Per-panel bridge lease. No runtime IDs, approvals, tools or automatic resends. */
export class DraftHost {
 private view='';
 private lastSave=new Map<string,number>();
 constructor(private store:Pick<DraftStore,'save'|'review'|'restore'|'load'>,private root:string,private identity:()=>Identity|undefined,private active:()=>boolean,private copyText?:(text:string)=>PromiseLike<unknown>){}
 async handle(m:any,post:(reply:any)=>unknown){
  if(!['draft-read','draft-save','draft-review','draft-restore','draft-copy'].includes(m?.type))return false;
  const s=this.identity();if(!this.active()||!s||!Number.isSafeInteger(m.id)||m.id<1)return true;
  if(!this.view&&m.type==='draft-read'&&/^[0-9a-f-]{36}$/i.test(m.viewId??''))this.view=m.viewId;
  const reply:any={type:'draft-result',id:m.id,threadId:m.threadId,viewId:m.viewId};
  try{
   if(!this.view||m.viewId!==this.view||!s.threads.includes(m.threadId))throw Error('草稿身份已失效');
   if(m.connectionId!==s.connectionId||m.type!=='draft-save'&&m.threadId!==s.threadId)throw Error('草稿线程已切换');
   const current=()=>{const owner=this.identity();return this.active()&&!!owner&&owner.threadId===m.threadId&&owner.connectionId===m.connectionId&&owner.threads.includes(m.threadId);};
   if(m.type==='draft-save'){if(m.id<=(this.lastSave.get(m.threadId)??0))throw Error('旧保存请求已失效');this.lastSave.set(m.threadId,m.id);}
   const saveCurrent=()=>{const owner=this.identity();return this.active()&&!!owner&&owner.connectionId===m.connectionId&&owner.threads.includes(m.threadId)&&this.lastSave.get(m.threadId)===m.id;};
   const value=m.type==='draft-save'?await this.store.save(m.threadId,m.value,saveCurrent):m.type==='draft-review'?await this.store.review(m.threadId,m.expected,current):m.type==='draft-restore'?await this.store.restore(m.threadId,m.expected,current):await this.store.load(m.threadId);
   if(m.type==='draft-copy'){checkRecoveryIdentity(value,m.expected);if(!value.recovery||!this.copyText||!current())throw Error('原内容或复制身份已失效');await this.copyText(value.recovery.draft.text);}
   reply.value=value;reply.ok=true;
   if(m.type==='draft-read'||m.type==='draft-restore'){reply.imagePreviews={};reply.imageOrigins={};reply.imageOriginErrors={};reply.invalidImages=[];for(const image of draftImages(value)){try{const src=(await loadDraftImage(this.root,image.path)).preview;reply.imagePreviews[image.token]=src;if(image.token===value.imageToken)reply.preview=src;try{const origin=await readImageOrigin(this.root,image.path);if(origin)reply.imageOrigins[image.token]=origin.info;}catch{reply.imageOriginErrors[image.token]='原图缺失或来源记录无法核对；发送副本仍保留，原图操作不可用。';if(isAnimationPosterPath(image.path)){reply.imageError='动图来源无法核对；请移除后重新附加，文字已保留。';reply.invalidImages.push(image.token);}}}catch{reply.imageError='草稿图片缺失或不再符合工作区限制；请移除对应图片后重新附加，文字已保留。';reply.invalidImages.push(image.token);}}for(const file of draftFiles(value)){try{await checkDraftFile(this.root,file);}catch{reply.fileError='草稿文件缺失或内容已变化；请移除后重新附加，文字已保留。';(reply.invalidFiles??=[]).push(file.path);}}}
  }catch(e){reply.ok=false;reply.error=e instanceof Error?e.message:'草稿保存失败';}
  if(this.active())await post(reply);return true;
 }
}
