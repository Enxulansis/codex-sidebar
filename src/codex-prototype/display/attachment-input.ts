import type {PageHost} from '../page-host';
import {draftFileId,validFiles,type DraftFile} from '../draft-store-types';
import {attachmentKind,ATTACHMENT_BYTES,FILE_COUNT,ATTACHMENT_COUNT,ATTACHMENT_BATCH_DEFAULTS,attachmentBatchPolicy,attachmentBatchReason} from '../attachment-policy';
import {FILE_TYPE_ICON_EXT,FILE_TYPE_ICON_DATA,FILE_TYPE_ICON_DEFAULT} from '../../file-type-icons';
import {showCopyMenu,showFormulaToast,clearDisplayToast,closeStaleMathMenu} from './dsh-math-export';
import type {FileActionKind} from '../file-action-host';
import {displayHintMs} from './hint-duration';
import {QUIET_PROGRESS_DELAY_MS} from './progress-delay';
import {prepareImage,type PreparedImage} from './image-conversion';
import {imageSourceMime,IMAGE_SOURCE_BYTES,type ImageOriginInfo} from '../image-formats';
type FileActions={run:(file:DraftFile,kind:FileActionKind)=>Promise<string>;error:(path:string)=>string;invalid:(path:string)=>void;removed?:(file:DraftFile)=>void};
type ImportedImage={path:string;preview:string;origin?:ImageOriginInfo};
const IMPORT_UNAVAILABLE='当前页面未启用附件导入；文字草稿仍可编辑，可在日常侧栏使用工作区图片路径。';
/** Original plus/paste/drop gestures, bounded byte upload instead of arbitrary path IPC. */
export class AttachmentInput {
 private sequence=0;private queue:Promise<void>=Promise.resolve();private pending=new Map<number,{resolve:(m:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();private epoch=0;private signature='';private busyCount=0;private cancels=new Set<()=>void>();private noticeTimer?:ReturnType<typeof setTimeout>;
 private batchSequence=0;private pendingBatches=new Map<number,string[]>();
 private commitPartial:(()=>void)|undefined;
 constructor(private host:PageHost,private identity:()=>{threadId:string;connectionId:number},private ready:()=>boolean,private available:()=>boolean,private files:()=>DraftFile[],private setFiles:(files:DraftFile[])=>void,private append:(images:ImportedImage[],files:DraftFile[],owner:{threadId:string;connectionId:number})=>void,private changed:()=>void,private imageCount:()=>number=()=>0,private actions?:FileActions,private batchSettings:()=>{maxFiles?:unknown;maxTotalMB?:unknown}=()=>ATTACHMENT_BATCH_DEFAULTS,private documentText:()=>boolean=()=>false){
  const composer=document.getElementById('composer')!,input=document.getElementById('attachment-input') as HTMLInputElement;
  document.getElementById('attach')!.addEventListener('click',()=>{if(this.ready()&&this.available())input.click();});input.addEventListener('change',()=>{this.enqueue(Array.from(input.files??[]));input.value='';});
  composer.addEventListener('paste',(e:ClipboardEvent)=>{const files=Array.from(e.clipboardData?.files??[]);if(files.length){if(!this.available()){this.notice(IMPORT_UNAVAILABLE);if(!e.clipboardData?.getData('text/plain'))e.preventDefault();return;}e.preventDefault();this.enqueue(files);}});
  const isFile=(e:DragEvent)=>Array.from(e.dataTransfer?.types??[]).some(t=>['Files','text/uri-list','application/vnd.code.uri-list'].includes(t));
  composer.addEventListener('dragover',(e:DragEvent)=>{if(!isFile(e))return;e.preventDefault();const allowed=this.ready()&&this.available();composer.classList.toggle('file-drag',allowed);if(e.dataTransfer)e.dataTransfer.dropEffect=allowed?'copy':'none';});
  for(const event of ['dragleave','dragend'])composer.addEventListener(event,()=>composer.classList.remove('file-drag'));
  composer.addEventListener('drop',(e:DragEvent)=>{if(!isFile(e))return;e.preventDefault();composer.classList.remove('file-drag');if(!this.available()){this.notice(IMPORT_UNAVAILABLE);return;}const files=Array.from(e.dataTransfer?.files??[]);if(files.length)this.enqueue(files);else this.notice('未收到文件内容，请用加号选择或粘贴文件；不会读取拖入的任意路径。');});
  this.host.messages.addEventListener('message',this.receive);window.addEventListener('pagehide',()=>{this.reset();this.host.messages.removeEventListener('message',this.receive);},{once:true});
 }
 get busy(){return this.busyCount>0;}
 private notice(text:string,transient=true){clearTimeout(this.noticeTimer);const status=document.getElementById('attachment-status')!;status.dataset.kind=transient?'notice':'progress';status.textContent=text;if(text&&transient)this.noticeTimer=setTimeout(()=>{status.textContent='';},displayHintMs());}
 showNotice(text:string){this.notice(text);}
 cancel(){if(!this.busy)return false;const owner=this.identity(),submitted=this.pending.size>0,issue=this.reset();try{this.host.postMessage({type:'attachment-cancel',...owner});}catch{/* Delivery may be unknown; the host keeps unconfirmed source bytes. */}this.notice(issue||(submitted?'已取消附件准备；在途导入结果未确认，已有草稿和来源保留。':'已取消附件准备，已有草稿保留。'));return true;}
 reset(){let issue='';try{this.commitPartial?.();}catch{issue='已确认的附件未能加入原草稿，来源仍保留；请核对后重新选择。';}this.commitPartial=undefined;this.epoch++;this.queue=Promise.resolve();this.signature='';for(const cancel of this.cancels)cancel();this.cancels.clear();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('附件所属线程已改变'));}this.pending.clear();this.pendingBatches.clear();this.busyCount=0;this.notice(issue);this.refresh();this.changed();return issue;}
 private read(file:File){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();const finish=(error?:string)=>{reader.onload=reader.onerror=reader.onabort=null;clearTimeout(timer);this.cancels.delete(cancel);if(error){reader.abort();reject(Error(error));}else resolve(String(reader.result));};const cancel=()=>finish('附件所属线程已改变'),timer=setTimeout(()=>finish('文件读取超时'),10000);this.cancels.add(cancel);reader.onload=()=>finish();reader.onerror=()=>finish('文件读取失败');reader.onabort=()=>finish('文件读取已取消');reader.readAsDataURL(file);});}
 private async prepare(name:string,data:string){const controller=new AbortController(),cancel=()=>controller.abort();this.cancels.add(cancel);try{return await prepareImage(name,data,controller.signal);}finally{this.cancels.delete(cancel);}}
 private pendingChip(name:string){const chip=document.createElement('div'),dot=document.createElement('span'),label=document.createElement('span');chip.className='draft-file-chip importing';chip.setAttribute('role','status');chip.setAttribute('aria-label','正在附加 '+name);chip.title='正在附加 '+name;dot.className='connection-spinner';dot.setAttribute('aria-hidden','true');label.className='attachment-name';label.textContent=name;chip.append(dot,label);return chip;}
 refresh(){const target=document.getElementById('draft-files')!,owner=this.identity(),pending=[...this.pendingBatches.values()].flat(),signature=JSON.stringify([owner,this.files(),this.files().map(f=>this.actions?.error(f.path)),this.documentText(),pending]);if(signature===this.signature)return;this.signature=signature;target.replaceChildren(...this.files().map(file=>{
  const chip=document.createElement('div'),error=this.actions?.error(file.path)||'',content=this.documentText()?'发送时读取文档文字；内含图片请单独附加':'文件引用，未解析';chip.className='draft-file-chip chip-file'+(error?' unavailable':'');chip.dataset.fileId=draftFileId(file);chip.title=error||file.name+' · '+file.size+' 字节 · '+content;chip.tabIndex=0;chip.setAttribute('role','button');chip.setAttribute('aria-label','预览 '+file.name);chip.setAttribute('aria-disabled',String(!!error));
  const badge=document.createElement('span');badge.className='context-icon';const icon=document.createElement('img'),key=FILE_TYPE_ICON_EXT[file.name.split('.').at(-1)?.toLowerCase()??''];icon.src=(key&&FILE_TYPE_ICON_DATA[key])||FILE_TYPE_ICON_DEFAULT;icon.alt='';icon.draggable=false;badge.append(icon);
  const name=document.createElement('span');name.className='attachment-name';name.textContent=file.name;const remove=document.createElement('button');remove.type='button';remove.className='attachment-remove';remove.textContent='✕';remove.title='移除 '+file.name;remove.setAttribute('aria-label',remove.title);remove.onclick=e=>{e.stopPropagation();if(this.ready()){this.actions?.removed?.(file);this.setFiles(this.files().filter(f=>f.path!==file.path));}};
  const valid=()=>{const now=this.identity();return chip.isConnected&&this.ready()&&owner.threadId===now.threadId&&owner.connectionId===now.connectionId&&this.files().some(v=>draftFileId(v)===draftFileId(file)&&v.name===file.name&&v.size===file.size);};
  const run=async(kind:FileActionKind)=>{if(!valid()||!this.actions)return;const error=this.actions.error(file.path);if(error){showFormulaToast(error,true);return;}try{const result=await this.actions.run(file,kind);if(!valid())return;const text=kind==='name'?'已复制文件名：'+file.name:kind==='path'?'已复制路径':kind==='copy'?'已复制文件：'+file.name:kind==='save'&&result==='saved'?'已保存 '+file.name:'';if(text)showFormulaToast(text);}catch(e){if(valid()){if((e as any).invalidFile)this.actions.invalid(file.path);showFormulaToast(e instanceof Error?e.message:'文件操作失败，请重试',true);}}};
  chip.onclick=()=>void run('open');chip.onkeydown=e=>{if(e.target===chip&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();void run('open');}};
  chip.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();if(!valid())return;clearDisplayToast();const error=this.actions?.error(file.path);if(error){showFormulaToast(error,true);return;}showCopyMenu(e,valid,[{label:'复制文件名',run:()=>run('name')},{label:'复制路径',run:()=>run('path')},{label:'复制文件',run:()=>run('copy')},{label:'另存为…',run:()=>run('save')}]);};
  if(file.editorSource){chip.dataset.editorSource=file.editorSource;chip.classList.add('attached');chip.title='自动附带 · 已保存的磁盘快照：'+file.editorSource+' · '+file.size+' 字节 · '+content;}chip.append(badge,name,remove);return chip;
 }),...pending.map(name=>this.pendingChip(name)));target.hidden=!this.files().length&&!pending.length;closeStaleMathMenu();}
 private receive=(e:MessageEvent)=>{const m=e.data;if(m?.type!=='attachment-imported')return;const p=this.pending.get(m.id),s=this.identity();if(!p||s.threadId!==m.threadId||s.connectionId!==m.connectionId)return;clearTimeout(p.timer);this.pending.delete(m.id);if(m.ok)p.resolve(m);else p.reject(Error(m.error||'附件导入失败'));};
 private request(name:string,base64:string,prepared?:PreparedImage){if(!this.available())return Promise.reject(Error(IMPORT_UNAVAILABLE));const id=++this.sequence,s=this.identity();return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('附件导入未确认，请检查后重新选择'));},10000);this.pending.set(id,{resolve,reject,timer});this.host.postMessage({type:'attachment-import',id,...s,name,base64,...(prepared&&prepared.transformation!=='none'?{original:{...prepared.original,transformation:prepared.transformation}}:{})});});}
  importPrepared(prepare:(signal:AbortSignal)=>Promise<PreparedImage>,current:()=>boolean){const epoch=this.epoch,controller=new AbortController(),cancel=()=>controller.abort();this.cancels.add(cancel);this.busyCount++;this.changed();const check=()=>{if(epoch!==this.epoch||!this.ready()||!current()||controller.signal.aborted)throw Error('动图草稿已改变');};const run=this.queue.then(async()=>{check();const prepared=await prepare(controller.signal);check();const result=await this.request(prepared.name,prepared.base64,prepared);check();if(result.kind!=='image'||!result.origin)throw Error('选帧导入未确认来源');return result as {path:string;preview:string;origin:ImageOriginInfo};});this.queue=run.then(()=>{},()=>{});return run.finally(()=>{this.cancels.delete(cancel);controller.abort();if(epoch===this.epoch){this.busyCount--;this.changed();}});}
 /** Same import queue/capacity/owner gate as manual files, replacing only the auto-attached slot. */
 importEditor(request:()=>Promise<DraftFile>,current:()=>boolean){
  const epoch=this.epoch,previous=this.files().filter(f=>f.editorSource).map(draftFileId).join();
  const check=()=>{if(epoch!==this.epoch||!this.ready()||!current()||this.files().filter(f=>f.editorSource).map(draftFileId).join()!==previous)throw Error('活动文件草稿或所属身份已改变');};
  const capacity=()=>{const manual=this.files().filter(f=>!f.editorSource);if(manual.length>=FILE_COUNT||manual.length+this.imageCount()>=ATTACHMENT_COUNT)throw Error('自动附带未加入：附件已达上限，请移除一项后重开附带开关');return manual;};
  this.busyCount++;this.changed();
  const run=this.queue.then(async()=>{check();capacity();const file=await request();check();if(!validFiles([file])||!file.editorSource)throw Error('活动文件来源回执无效');this.setFiles([file,...capacity()]);});
  this.queue=run.catch(()=>{});return run.finally(()=>{if(epoch===this.epoch){this.busyCount--;this.changed();}});
 }
 private enqueue(files:File[]){
  if(!this.available()){this.notice(IMPORT_UNAVAILABLE);return;}
  if(!this.ready()){this.notice('请等待草稿恢复后再附加文件');return;}
  const epoch=this.epoch,owner={...this.identity()},batchId=++this.batchSequence,reserved=[...this.pendingBatches.values()].reduce((sum,names)=>sum+names.length,0),slots=Math.max(0,ATTACHMENT_COUNT-this.imageCount()-this.files().length-reserved);this.pendingBatches.set(batchId,files.slice(0,Math.min(slots,attachmentBatchPolicy(this.batchSettings()).maxFiles)).map(file=>file.name));this.busyCount++;this.notice('');this.refresh();const progress=setTimeout(()=>{if(epoch===this.epoch&&this.busy)this.notice('正在附加…',false);},QUIET_PROGRESS_DELAY_MS);this.changed();
  this.queue=this.queue.then(async()=>{
   if(epoch!==this.epoch)return;const batch=attachmentBatchPolicy(this.batchSettings());let count=0,totalBytes=0;const errors:string[]=[],notes:string[]=[],images:ImportedImage[]=[],documents:DraftFile[]=[];
   const commit=()=>{if(!images.length&&!documents.length)return;this.append(images,documents,owner);images.length=documents.length=0;};this.commitPartial=commit;
   // Read/decode at most one file ahead; imports and quota decisions retain selection order.
   const preparations=new Map<number,Promise<{value:{kind:string;prepared:PreparedImage|undefined;base64:string;bytes:number}}|{error:unknown}>>();
   const prepareAt=(index:number)=>{let task=preparations.get(index);if(!task){task=(async()=>{if(epoch!==this.epoch)throw Error('附件所属线程已改变');const file=files[index]!,kind=imageSourceMime(file.name)?'image':attachmentKind(file.name),limit=kind==='image'?IMAGE_SOURCE_BYTES:ATTACHMENT_BYTES;if(!file.size||file.size>limit)throw Error(kind==='image'?'原图片上限25 MiB，不能为空':'单文件上限 5 MiB，不能为空');const data=await this.read(file);if(epoch!==this.epoch)throw Error('附件所属线程已改变');const prepared=kind==='image'?await this.prepare(file.name,data):undefined,base64=prepared?.base64??data.slice(data.indexOf(',')+1),bytes=prepared?(prepared.transformation==='compressed'?prepared.bytes:prepared.original.size):Math.floor(base64.length*3/4)-(base64.endsWith('==')?2:base64.endsWith('=')?1:0);return{kind,prepared,base64,bytes};})().then(value=>({value}),error=>({error}));preparations.set(index,task);}return task;};
   for(const[index,file]of files.entries()){
    if(epoch!==this.epoch)return;
    if(count>=batch.maxFiles){errors.push(`超出单次${batch.maxFiles}项上限，余下${files.length-index}项已跳过`);break;}
    if(this.imageCount()+this.files().length+count>=ATTACHMENT_COUNT){errors.push(`已到侧栏本地${ATTACHMENT_COUNT}项上限，余下${files.length-index}项已跳过`);break;}
    try{
     const preparation=prepareAt(index);if(index+1<files.length&&count+1<batch.maxFiles&&this.imageCount()+this.files().length+count+1<ATTACHMENT_COUNT)void prepareAt(index+1);
     const result=await preparation;preparations.delete(index);if(epoch!==this.epoch)return;if('error'in result)throw result.error;const {kind,prepared,base64,bytes}=result.value;
     if(kind==='file'&&this.files().length+documents.length>=FILE_COUNT)throw Error(`侧栏本地最多附加 ${FILE_COUNT} 个文件`);
     const reason=attachmentBatchReason(batch,count,totalBytes,bytes);
     if(reason)throw Error(reason);
     const imported=await this.request(prepared?.name??file.name,base64,prepared);if(epoch!==this.epoch)return;
     if(imported.kind==='image')images.push({path:imported.path,preview:imported.preview,...(imported.origin?{origin:imported.origin}:{})});else{if(!validFiles([imported.file]))throw Error('附件来源回执无效');documents.push(imported.file);}
     if(prepared?.note&&(prepared.transformation==='compressed'||prepared.original.mime==='image/tiff'))notes.push(file.name+'：'+prepared.note);count++;totalBytes+=bytes;
    }catch(e){errors.push(file.name+'：'+(e instanceof Error?e.message:String(e)));}
   }
   await Promise.all(preparations.values());if(epoch===this.epoch){this.pendingBatches.delete(batchId);commit();this.commitPartial=undefined;this.notice([...notes,...errors].join('；'));}
  }).catch(()=>{if(epoch===this.epoch)this.notice('附件导入未完成，请重新选择；原草稿保留。');}).finally(()=>{clearTimeout(progress);if(epoch===this.epoch){this.pendingBatches.delete(batchId);this.busyCount--;this.refresh();this.changed();}});
 }
}
