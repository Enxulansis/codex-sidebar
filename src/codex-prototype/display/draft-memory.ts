import {safeImageSource} from './image-preview';
import {emptyDraft,draftFiles,draftImages,imageFields,validDraftRecord,validFiles,draftRecoveryIdentity,hasDraftContent,type DraftFields,type DraftRecord,type DraftFile,type DraftImage} from '../draft-store-types';
import {ATTACHMENT_COUNT,type ImageProof} from '../attachment-policy';
import type {ImageOriginInfo} from '../image-formats';
import {sameSkill,matchesSkillPrompt,type SkillReference} from '../skill-reference';

/** Narrow DSH draft-slot adaptation. Does not send turns or resolve approval state. */
export class DraftMemory {
 private slots=new Map<string,{value:DraftRecord;loaded:boolean;error:string;errorOrder:number;readError:string;restoreRevision:number|undefined;confirmedRevision:number;preview:string;imageError:string;previews:Record<string,string>;invalidImages:string[];fileError:string;invalidFiles:string[];revision:number}>();
 private thread='';private connection=0;private sequence=0;private ownerEpoch=0;
 private pendingView:{cleared:boolean;edited:boolean}|undefined;
 private recoveryLocks=new Set<string>();
 private recoveryActions=new Map<string,number>();
 private metadataOrder=new Map<string,number>();
 private origins=new Map<string,Record<string,ImageOriginInfo>>();private originErrors=new Map<string,Record<string,string>>();
 private requests=new Map<number,{thread:string;connection:number;epoch:number;revision:number;kind:string;resolve:(v:boolean)=>void;timer:ReturnType<typeof setTimeout>}>();
 readonly viewId=crypto.randomUUID();
 constructor(private post:(m:any)=>unknown,private changed:()=>void,private paint:(v:DraftRecord,preview:string)=>void){}
 private slot(t=this.thread){let s=this.slots.get(t);if(!s){s={value:emptyDraft(),loaded:false,error:'',errorOrder:0,readError:'',restoreRevision:undefined,confirmedRevision:0,preview:'',imageError:'',previews:{},invalidImages:[],fileError:'',invalidFiles:[],revision:0};this.slots.set(t,s);}return s;}
 get ready(){return !!this.thread&&this.slot().loaded&&!this.recoveryLocks.has(this.thread);}
 get restoring(){return !!this.thread&&this.slot().restoreRevision!==undefined;}
 get blocked(){return !this.ready||this.slot().restoreRevision!==undefined||!!this.slot().readError||!!this.slot().error||!!this.slot().imageError||!!this.slot().fileError||this.slot().value.uncertain||!!this.slot().value.recovery;}
 get notice(){if(!this.thread)return '';const s=this.slot();return s.readError||(s.restoreRevision!==undefined?'正在恢复草稿…':'')||s.error||s.imageError||s.fileError||(!s.loaded?'正在恢复草稿…':s.value.uncertain?'上次发送未确认，请核对历史。':s.value.recovery?'上次未提交内容已保留，请先核对。':'');}
 get needsReview(){return !!this.thread&&this.slot().loaded&&(this.slot().value.uncertain||!!this.slot().value.recovery);}
 get recovery(){return this.thread?this.slot().value.recovery:undefined;}
 get recoveryBusy(){return this.recoveryActions.get(this.thread)===this.ownerEpoch;}
 get canRestoreOriginal(){return this.ready&&!!this.recovery&&!hasDraftContent(this.slot().value)&&!this.restoring&&!this.recoveryBusy;}
 refreshRecovery(){if(!this.thread)return;const s=this.slot();s.restoreRevision=s.revision;void this.request('draft-read');this.changed();}
 get canRetry(){return !!this.thread&&!!(this.slot().readError||this.slot().error);}
 get editId(){return this.thread?this.slot().value.draftEditId:undefined;}
 private visibleValue(){return this.pendingView?.cleared?emptyDraft():this.slot().value;}
 // Only the composer is cleared. Until the next edit, saves retain the original
 // durable draft, including images, so a lost receipt/reload never saves blanks.
 private startEditing(){if(!this.pendingView)return;this.pendingView.edited=true;if(!this.pendingView.cleared)return;this.pendingView.cleared=false;const s=this.slot();s.value={...emptyDraft(),uncertain:s.value.uncertain,...(s.value.pendingEditId!==undefined?{pendingEditId:s.value.pendingEditId}:{}),...(s.value.recovery?{recovery:s.value.recovery}:{})};s.preview='';s.previews={};s.invalidImages=[];s.imageError='';s.invalidFiles=[];s.fileError='';this.pruneOrigins([]);}
 get image(){return this.thread?this.visibleValue().image:'';}
 get imageToken(){return this.thread?this.visibleValue().imageToken:'';}
 get previewSource(){return this.thread&&!this.pendingView?.cleared?this.slot().preview:'';}
 get imageError(){return this.thread?this.slot().imageError:'';}
 get files(){return this.thread?draftFiles(this.visibleValue()):[];}
 get skill(){return this.thread?this.visibleValue().skill:undefined;}
 useSkill(skill:SkillReference|undefined,text:string){if(!this.ready)return;this.startEditing();const s=this.slot();s.value={...s.value,text,draftEditId:crypto.randomUUID()};if(skill)s.value.skill={...skill};else delete s.value.skill;s.revision++;s.error='';this.paint(s.value,s.preview);void this.flush();this.changed();}
 fileErrorFor(path:string){return this.thread&&this.slot().invalidFiles.includes(path)?'文件缺失或内容已变化，请移除后重新附加':'';}
 fileFailed(path:string){if(!this.files.some(v=>v.path===path))return;const s=this.slot();if(!s.invalidFiles.includes(path))s.invalidFiles.push(path);s.fileError='草稿文件缺失或内容已变化；请移除后重新附加，文字已保留。';this.changed();}
 get images(){return this.thread?draftImages(this.visibleValue()):[];}
 get extraImages(){return this.images.slice(1);}
 previewFor(token:string){return this.thread?this.slot().previews[token]??'':'';}
 async captureImageProofs():Promise<ImageProof[]>{
  if(this.blocked)throw Error(this.notice||'草稿尚未就绪');const slot=this.slot(),epoch=this.ownerEpoch,revision=slot.revision,images=this.images.map(image=>({...image,src:this.previewFor(image.token)}));
  const current=()=>epoch===this.ownerEpoch&&revision===slot.revision&&images.every(image=>this.previewFor(image.token)===image.src);
  const proofs:ImageProof[]=[];for(const image of images){if(!safeImageSource(image.src))throw Error('图片预览尚未就绪，请重新附加');const bytes=Uint8Array.from(atob(image.src.slice(image.src.indexOf(',')+1)),v=>v.charCodeAt(0)),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');if(!current())throw Error('图片或草稿身份已变化，未提交');proofs.push({path:image.path,sha256});}if(!current())throw Error('图片或草稿身份已变化，未提交');return proofs;
 }
 errorFor(token:string){return this.thread&&this.slot().invalidImages.includes(token)?'图片缺失或无法解码，请移除后重新附加':'';}
 originFor(token:string){return this.origins.get(this.thread)?.[token];}
 originErrorFor(token:string){return this.originErrors.get(this.thread)?.[token]??'';}
 private pruneOrigins(images:DraftImage[]){const keep=(record:Record<string,any>)=>Object.fromEntries(images.filter(v=>record[v.token]).map(v=>[v.token,record[v.token]]));this.origins.set(this.thread,keep(this.origins.get(this.thread)??{}));this.originErrors.set(this.thread,keep(this.originErrors.get(this.thread)??{}));}
 addImage(path:string,preview:string,origin?:ImageOriginInfo){if(!this.ready||!safeImageSource(preview))return;if(this.images.length+this.files.length>=ATTACHMENT_COUNT)throw Error(`侧栏本地图片和文件合计最多${ATTACHMENT_COUNT}项`);this.startEditing();const s=this.slot(),image={path,token:crypto.randomUUID()};s.previews[image.token]=preview;if(origin)this.origins.set(this.thread,{...this.origins.get(this.thread),[image.token]:origin});this.setImages([...this.images,image]);}
  addAttachments(images:{path:string;preview:string;origin?:ImageOriginInfo}[],files:DraftFile[],owner:{threadId:string;connectionId:number}){
   if(owner.threadId!==this.thread||owner.connectionId!==this.connection||!this.ready||images.some(image=>!image.path||!safeImageSource(image.preview)))throw Error('附件预览或草稿身份尚未就绪');
   if(this.images.length+this.files.length+images.length+files.length>ATTACHMENT_COUNT||!validFiles([...this.files,...files]))throw Error('附件超过上限或文件来源重复，原草稿保留');
   if(!images.length&&!files.length)return;this.startEditing();const s=this.slot(),added=images.map(value=>{const image={path:value.path,token:crypto.randomUUID()};s.previews[image.token]=value.preview;if(value.origin)this.origins.set(this.thread,{...this.origins.get(this.thread),[image.token]:value.origin});return image;});
   s.value={...s.value,...imageFields([...this.images,...added]),files:[...this.files,...files],draftEditId:crypto.randomUUID()};s.preview=s.previews[s.value.imageToken]??'';s.revision++;s.error='';this.paint(s.value,s.preview);void this.flush();this.changed();
  }
 replaceImages(tokens:string[],values:{path:string;preview:string;origin?:ImageOriginInfo}[]){
  if(!this.ready||!tokens.length||new Set(tokens).size!==tokens.length||tokens.some(token=>!this.images.some(v=>v.token===token)))throw Error('动图草稿已改变');if(values.some(v=>!v.path||v.path.length>4096||!safeImageSource(v.preview)))throw Error('选择帧预览无效');if(this.images.length-tokens.length+values.length+this.files.length>ATTACHMENT_COUNT)throw Error(`侧栏本地图片和文件合计最多${ATTACHMENT_COUNT}项，请减少选择帧`);
  if(!this.ready)throw Error('草稿尚未就绪');const old=this.images,at=old.findIndex(v=>tokens.includes(v.token)),images=values.map(value=>{const image={path:value.path,token:crypto.randomUUID()};this.slot().previews[image.token]=value.preview;if(value.origin)this.origins.set(this.thread,{...this.origins.get(this.thread),[image.token]:value.origin});return image;});this.setImages([...old.slice(0,at).filter(v=>!tokens.includes(v.token)),...images,...old.slice(at).filter(v=>!tokens.includes(v.token))]);
 }
 removeImage(token:string){if(this.ready)this.setImages(this.images.filter(v=>v.token!==token));}
 clearImages(){if(this.ready)this.setImages([]);}
 private setImages(images:DraftImage[]){this.startEditing();this.pruneOrigins(images);const s=this.slot();s.value={...s.value,...imageFields(images),draftEditId:crypto.randomUUID()};s.invalidImages=s.invalidImages.filter(token=>images.some(v=>v.token===token));s.previews=Object.fromEntries(images.filter(v=>s.previews[v.token]).map(v=>[v.token,s.previews[v.token]!]));s.preview=s.previews[s.value.imageToken]??'';if(!s.invalidImages.length)s.imageError='';s.revision++;s.error='';this.paint(s.value,s.preview);void this.flush();this.changed();}
 setFiles(files:DraftFile[]){if(!this.ready)return;this.startEditing();const s=this.slot();s.value={...s.value,files,draftEditId:crypto.randomUUID()};s.invalidFiles=s.invalidFiles.filter(path=>files.some(f=>f.path===path));if(!s.invalidFiles.length)s.fileError='';s.revision++;s.error='';void this.flush();this.changed();}
 imageFailed(token=this.imageToken){if(!this.images.some(v=>v.token===token))return;const s=this.slot();delete s.previews[token];if(token===this.imageToken)s.preview='';if(!s.invalidImages.includes(token))s.invalidImages.push(token);s.imageError='草稿图片无法解码；请移除对应图片后重新附加，文字已保留。';this.changed();}
 select(thread:string,connection:number){
  if(thread===this.thread&&connection===this.connection)return;
  void this.flush();
  if(this.pendingView&&!this.pendingView.edited)this.slot().confirmedRevision=this.slot().revision;
  this.pendingView=undefined;
  for(const [id,p] of this.requests){if(p.kind==='draft-read'){clearTimeout(p.timer);p.resolve(false);this.requests.delete(id);}}
  this.thread=thread;this.connection=connection;this.ownerEpoch++;
  if(!thread){this.paint(emptyDraft(),'');this.changed();return;}
  const s=this.slot();s.restoreRevision??=s.confirmedRevision;s.readError='';this.paint(s.value,s.preview);void this.request('draft-read');this.changed();
 }
 edit(fields:Omit<DraftFields,'imageToken'>,preview?:string){if(!this.ready)return;this.startEditing();const s=this.slot();s.value={...s.value,...fields,draftEditId:crypto.randomUUID(),imageToken:preview!==undefined?(fields.image?crypto.randomUUID():''):s.value.imageToken,uncertain:s.value.uncertain};if(s.value.skill&&!matchesSkillPrompt(s.value.text,s.value.skill))delete s.value.skill;s.revision++;s.error='';if(preview!==undefined){s.preview=preview;s.previews={[s.value.imageToken]:preview};s.invalidImages=[];s.imageError='';}void this.flush();this.changed();}
 private request(kind:string,thread=this.thread):Promise<boolean>{
  if(!thread)return Promise.resolve(false);const s=this.slot(thread),id=++this.sequence,epoch=this.ownerEpoch;
  if(kind==='draft-read')for(const [oldId,p]of this.requests)if(p.kind==='draft-read'&&p.thread===thread){clearTimeout(p.timer);this.requests.delete(oldId);p.resolve(false);}
  return new Promise(resolve=>{const timer=setTimeout(()=>{this.requests.delete(id);if(epoch===this.ownerEpoch){if(kind==='draft-read')s.readError='草稿恢复未确认；当前内容保留，请重试。';else if(id>=s.errorOrder){s.errorOrder=id;s.error='草稿保存未确认；当前内容保留，请重试。';}this.changed();}resolve(false)},5000);this.requests.set(id,{thread,connection:this.connection,epoch,revision:s.revision,kind,resolve,timer});this.post({type:kind,id,viewId:this.viewId,threadId:thread,connectionId:this.connection,...(['draft-review','draft-restore','draft-copy'].includes(kind)?{expected:draftRecoveryIdentity(s.value)}:{}),...(kind==='draft-save'?{value:{text:s.value.text,image:s.value.image,pathInput:s.value.pathInput,imageToken:s.value.imageToken,...(s.value.draftEditId?{draftEditId:s.value.draftEditId}:{}),...(s.value.extraImages?.length?{extraImages:s.value.extraImages}:{}),...(s.value.files?.length?{files:s.value.files}:{}),...(s.value.skill?{skill:{...s.value.skill}}:{})}}:{})});});
 }
 flush(){if(this.pendingView&&!this.pendingView.edited)return Promise.resolve(true);return this.ready&&this.slot().restoreRevision===undefined?this.request('draft-save'):Promise.resolve(false);}
 async retry(){const s=this.slot();s.error='';if(s.restoreRevision!==undefined){s.readError='';await this.request('draft-read');}else await this.flush();this.changed();}
 async copyOriginal(){if(!this.ready||!this.recovery||this.restoring||this.recoveryBusy)return false;const epoch=this.ownerEpoch,id=this.recovery.id;if(!await this.flush()||epoch!==this.ownerEpoch||this.recovery?.id!==id)return false;return this.request('draft-copy');}
 async review(){await this.recoveryAction('draft-review');}
 async restoreOriginal(){if(this.canRestoreOriginal)await this.recoveryAction('draft-restore');}
 private async recoveryAction(kind:'draft-review'|'draft-restore'){
  if(!this.ready||!this.needsReview||this.restoring||this.recoveryBusy)return;const thread=this.thread,epoch=this.ownerEpoch,s=this.slot(),revision=s.revision,expected=JSON.stringify(draftRecoveryIdentity(s.value));
  // Reserve the gesture before saving; editing remains allowed until that save is acknowledged.
  this.recoveryActions.set(thread,epoch);this.changed();
  try{
   if(!await this.flush()||this.ownerEpoch!==epoch||s.error||s.revision!==revision||JSON.stringify(draftRecoveryIdentity(s.value))!==expected)return;
   this.recoveryLocks.add(thread);s.restoreRevision=s.revision;this.changed();await this.request(kind);
  }finally{if(this.recoveryActions.get(thread)===epoch)this.recoveryActions.delete(thread);this.changed();}
 }
 get pendingEdited(){return this.pendingView?.edited===true;}
 prepareSubmission(){const s=this.slot();s.value.draftEditId=crypto.randomUUID();s.revision++;}
 markPending(){const s=this.slot();s.value.uncertain=true;s.revision++;this.pendingView={cleared:true,edited:false};this.paint(emptyDraft(),'');this.changed();}
 revealPending(){if(!this.pendingView?.cleared)return;this.pendingView.cleared=false;const s=this.slot();this.paint(s.value,s.preview);this.changed();}
 settle(text:string,image:string,accepted:boolean,unknown=false,imageToken='',files:DraftFile[]=[],extraImages:DraftImage[]=[],skill?:SkillReference){accepted=accepted&&!unknown;const edited=this.pendingEdited;this.pendingView=undefined;const s=this.slot();if(accepted&&!edited){if(s.value.text===text&&sameSkill(s.value.skill,skill))s.value.text='';if(sameSkill(s.value.skill,skill))delete s.value.skill;const sent=draftImages({image,imageToken,extraImages}),remaining=this.images.filter(v=>!sent.some(s=>s.path===v.path&&s.token===v.token));this.pruneOrigins(remaining);s.value={...s.value,...imageFields(remaining)};s.previews=Object.fromEntries(remaining.filter(v=>s.previews[v.token]).map(v=>[v.token,s.previews[v.token]!]));s.invalidImages=s.invalidImages.filter(t=>remaining.some(v=>v.token===t));s.preview=s.previews[s.value.imageToken]??'';if(!s.invalidImages.length)s.imageError='';if(s.value.files)s.value.files=s.value.files.filter(f=>!files.some(sent=>sent.path===f.path&&sent.sha256===f.sha256));}s.value.uncertain=unknown;s.revision++;this.paint(s.value,s.preview);this.changed();if(accepted||edited)void this.flush();}
 receive(m:any){if(m?.type!=='draft-result'||m.viewId!==this.viewId)return;const p=this.requests.get(m.id);if(!p||p.thread!==m.threadId)return;clearTimeout(p.timer);this.requests.delete(m.id);const s=this.slot(p.thread);
  if(p.epoch!==this.ownerEpoch||this.thread!==p.thread||this.connection!==p.connection){p.resolve(false);return;}
  const invalidRead=m.ok===true&&['draft-read','draft-restore'].includes(p.kind)&&!validDraftRecord(m.value);
  if(m.ok!==true||invalidRead){const error=invalidRead?'草稿恢复格式无效；当前内容保留，请重试。':typeof m.error==='string'&&m.error||'草稿保存或恢复失败，当前内容已保留；请重试。';if(['draft-read','draft-restore','draft-review'].includes(p.kind))s.readError=error;else if(m.id>=s.errorOrder){s.errorOrder=m.id;s.error=error;}p.resolve(false);this.changed();return;}
  // Late restore/save replies never overwrite text typed in the meantime.
  if(p.kind==='draft-read'||p.kind==='draft-restore'){
   const edited=s.restoreRevision!==s.revision;
   if(!edited){s.value=m.value;s.preview=safeImageSource(m.preview)?m.preview:'';s.previews=Object.fromEntries(draftImages(s.value).map(v=>[v.token,m.imagePreviews?.[v.token]??(v.token===s.value.imageToken?s.preview:'')]).filter(([,src])=>safeImageSource(src)));this.origins.set(p.thread,m.imageOrigins??{});this.originErrors.set(p.thread,m.imageOriginErrors??{});s.invalidImages=Array.isArray(m.invalidImages)?m.invalidImages:m.imageError?[s.value.imageToken]:[];s.imageError=m.imageError||'';s.fileError=m.fileError||'';s.invalidFiles=Array.isArray(m.invalidFiles)?m.invalidFiles:[];this.paint(s.value,s.preview);}
   else {s.value.uncertain=m.value.uncertain||!!this.pendingView&&s.value.uncertain;s.value.recovery=m.value.recovery;s.value.pendingEditId=m.value.pendingEditId;const stored=draftImages(m.value);for(const image of this.images.filter(image=>stored.some(v=>v.path===image.path&&v.token===image.token))){const src=m.imagePreviews?.[image.token]??(image.token===m.value.imageToken?m.preview:'');if(safeImageSource(src))s.previews[image.token]=src;if(m.invalidImages?.includes(image.token)||m.imageError&&!m.invalidImages?.length){if(!s.invalidImages.includes(image.token))s.invalidImages.push(image.token);s.imageError=m.imageError;}if(m.imageOrigins?.[image.token])this.origins.set(p.thread,{...this.origins.get(p.thread),[image.token]:m.imageOrigins[image.token]});if(m.imageOriginErrors?.[image.token])this.originErrors.set(p.thread,{...this.originErrors.get(p.thread),[image.token]:m.imageOriginErrors[image.token]});}for(const file of this.files.filter(file=>draftFiles(m.value).some(v=>v.path===file.path&&v.sha256===file.sha256)&&m.invalidFiles?.includes(file.path))){if(!s.invalidFiles.includes(file.path))s.invalidFiles.push(file.path);s.fileError=m.fileError;}s.preview=s.previews[s.value.imageToken]??'';}
   s.loaded=true;s.restoreRevision=undefined;s.readError='';this.recoveryLocks.delete(p.thread);this.metadataOrder.set(p.thread,m.id);if(edited)void this.flush();else s.confirmedRevision=s.revision;
  }
  if(p.kind==='draft-review'&&p.revision===s.revision){s.value.uncertain=false;delete s.value.recovery;delete s.value.pendingEditId;s.restoreRevision=undefined;s.readError='';this.recoveryLocks.delete(p.thread);}
  if(p.kind==='draft-save'&&p.revision===s.revision){s.confirmedRevision=s.revision;if(m.id>(this.metadataOrder.get(p.thread)??0)&&validDraftRecord(m.value)&&m.value.recovery){s.value.uncertain=m.value.uncertain;s.value.pendingEditId=m.value.pendingEditId;s.value.recovery=m.value.recovery;this.metadataOrder.set(p.thread,m.id);}}
  if(p.revision===s.revision&&m.id>=s.errorOrder){s.errorOrder=m.id;s.error='';}p.resolve(true);this.changed();
 }
 dispose(){this.ownerEpoch++;for(const p of this.requests.values()){clearTimeout(p.timer);p.resolve(false)}this.requests.clear();}
}
