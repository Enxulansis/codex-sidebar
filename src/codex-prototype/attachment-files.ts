import {mkdir,open,lstat,unlink,rmdir} from 'node:fs/promises';
import type {BigIntStats} from 'node:fs';
import {join,relative,dirname,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {assertWorkspaceFiles,ownedPath,imageInput} from './storage';
import {checkedImage} from './online-image';
import type {DraftFile} from './draft-store-types';
import type {UserInput} from './protocol/v2/UserInput';
import {originPayload,originManifest,ORIGIN_BYTES_FILE,ORIGIN_META_FILE,DERIVED_IMAGE_DIR,ANIMATION_IMAGE_DIR} from './image-origin';
import {documentInputText} from './document-input';
import {createDocumentReader,type DocumentReader} from './document-reader';

import {attachmentKind,ATTACHMENT_BYTES,FILE_COUNT,ATTACHMENT_COUNT,validImageProofs,type ImageProof} from './attachment-policy';
import {isAnimationPosterPath} from './image-formats';
import {readImageOrigin} from './image-origin';
export {attachmentKind,ATTACHMENT_BYTES,FILE_COUNT} from './attachment-policy';
/** Remove only a newly imported, unacknowledged file; never traverse/delete a directory tree. */
async function discardImport(root:string,dir:string,created:string[],directories:string[]){
 const rel=relative(root,await ownedPath(root,dir)).replace(/\\/g,'/');if(!/^\.codex-attachments\/[0-9a-f-]{36}$/i.test(rel))throw Error('附件清理路径无效');
 for(const path of created.slice().reverse()){const safe=await ownedPath(root,path);if(!directories.includes(dirname(safe))||!basename(safe))throw Error('附件清理路径无效');try{await unlink(safe);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 for(const directory of directories.slice().reverse())try{await rmdir(await ownedPath(root,directory));}catch(e){if(!['ENOTEMPTY','ENOENT'].includes((e as NodeJS.ErrnoException).code??''))throw e;}
}
/** Receives only user-selected browser File bytes. Never opens a caller-supplied source path. */
export async function importAttachment(root:string,name:unknown,base64:unknown,current:()=>boolean,original?:unknown){
 const kind=attachmentKind(name);if(typeof base64!=='string'||!base64.length||base64.length%4!==0||base64.length>Math.ceil(ATTACHMENT_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw Error('附件为空、过大或数据无效（单文件上限 5 MiB）');
 const bytes=Buffer.from(base64,'base64');if(bytes.toString('base64')!==base64)throw Error('附件编码无效');if(bytes.length>ATTACHMENT_BYTES)throw Error('附件超过 5 MiB');const origin=original===undefined?undefined:originPayload(original);if(origin&&kind!=='image')throw Error('仅图片可以附带原图片来源');await assertWorkspaceFiles(root);if(!current())throw Error('附件所属线程已切换');
 const parent=await ownedPath(root,'.codex-attachments');await mkdir(parent,{recursive:true});
 const dir=await ownedPath(root,join(parent,randomUUID()));await mkdir(dir);const outputDir=origin?await ownedPath(root,join(dir,origin.info.transformation==='animation'?ANIMATION_IMAGE_DIR:DERIVED_IMAGE_DIR)):dir,path=await ownedPath(root,join(outputDir,name as string)),created:string[]=[],directories=[dir],discard=()=>discardImport(root,dir,created,directories);
 const write=async(target:string,content:Uint8Array|string)=>{if(!current())throw Error('附件所属线程已切换');const safe=await ownedPath(root,target),handle=await open(safe,'wx');created.push(safe);try{await handle.writeFile(content);}finally{await handle.close();}if(!current())throw Error('附件所属线程已切换');};
 try{
  if(!current())throw Error('附件所属线程已切换');
  if(origin){await mkdir(outputDir);directories.push(outputDir);}
  await write(path,bytes);
  if(kind==='image'){await imageInput(root,path);const image=await checkedImage(root,path,'draft');if(!image.src)throw Error(image.error);if(!Buffer.from(image.src.slice(image.src.indexOf(',')+1),'base64').equals(bytes))throw Error('导入期间图片内容已变化');if(origin){await write(join(dir,ORIGIN_BYTES_FILE),origin.bytes);await write(join(dir,ORIGIN_META_FILE),JSON.stringify(originManifest(name as string,bytes,origin.info)));}if(!current())throw Error('附件所属线程已切换');return {kind,path,preview:image.src,...(origin?{origin:origin.info}:{}),discard,createdFiles:[...created]};}
  const file:DraftFile={path,name:name as string,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};if(!current())throw Error('附件所属线程已切换');return {kind,file,discard,createdFiles:[...created]};
 }catch(error){await discard();throw error;}
}
const fileStamp=(info:BigIntStats)=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
/** One bounded handle for both the source proof and the actual model input. */
export async function readDraftFile(root:string,file:DraftFile){
 if(attachmentKind(file.name)!=='file')throw Error('文件引用格式无效');const path=await ownedPath(root,file.path);const rel=relative(root,path);if(!rel.startsWith('.codex-attachments\\')&&!rel.startsWith('.codex-attachments/'))throw Error('文件必须由附件入口导入');
 if(process.platform==='win32'?basename(file.path).toLowerCase()!==file.name.toLowerCase():basename(file.path)!==file.name)throw Error('文件名称与实际来源不一致');
 const info=await lstat(path,{bigint:true});if(info.isSymbolicLink()||!info.isFile()||info.size!==BigInt(file.size)||info.size>BigInt(ATTACHMENT_BYTES))throw Error('附件缺失、大小已变化或超限');
 const handle=await open(path,'r');try{
  const opened=await handle.stat({bigint:true});if(fileStamp(opened)!==fileStamp(info))throw Error('附件打开期间内容已变化');
  const bytes=Buffer.alloc(Number(opened.size)+1);let size=0;
  while(size<bytes.length){const part=await handle.read(bytes,size,bytes.length-size,size);if(!part.bytesRead)break;size+=part.bytesRead;}
  const after=await handle.stat({bigint:true}),now=await lstat(await ownedPath(root,path),{bigint:true});
  if(size!==file.size||now.isSymbolicLink()||!now.isFile()||fileStamp(after)!==fileStamp(opened)||fileStamp(now)!==fileStamp(opened)||createHash('sha256').update(bytes.subarray(0,size)).digest('hex')!==file.sha256)throw Error('附件内容已变化，请重新附加');
  return{path,bytes:bytes.subarray(0,size)};
 }finally{await handle.close();}
}
export async function checkDraftFile(root:string,file:DraftFile){return(await readDraftFile(root,file)).path;}
export const fileReferenceText=(files:{name:string;path:string}[])=>'用户主动附加的临时工作区文件引用（文件内容未预先解析；仅在既有工具及审批限制内读取）：\n'+JSON.stringify(files);
/** Standard text references, not an undocumented binary/document input or connector mention. */
export async function attachmentInputs(root:string,text:string,image:string|undefined,files:DraftFile[]=[],extraImages: {path:string}[]=[],imageProofs?:ImageProof[],documentText:boolean|DocumentReader=false):Promise<UserInput[]>{
 if(files.length>FILE_COUNT)throw Error(`侧栏本地最多附加 ${FILE_COUNT} 个文件`);const images=[...(image?[{path:image}]:[]),...extraImages];if(images.length+files.length>ATTACHMENT_COUNT)throw Error(`侧栏本地图片和文件合计最多${ATTACHMENT_COUNT}项`);const input:UserInput[]=text.trim()?[{type:'text',text,text_elements:[]}]:[];
 if(!validImageProofs(images,imageProofs))throw Error('图片缺少已显示预览的发送摘要，请核对图片并重新附加');
 for(const [index,image] of images.entries()){const path=await imageInput(root,image.path),handle=await open(path,'r');try{const bytes=Buffer.alloc(ATTACHMENT_BYTES+1);let size=0;while(size<bytes.length){const read=await handle.read(bytes,size,bytes.length-size,size);if(!read.bytesRead)break;size+=read.bytesRead;}if(size>ATTACHMENT_BYTES||createHash('sha256').update(bytes.subarray(0,size)).digest('hex')!==imageProofs![index]!.sha256)throw Error('图片内容已变化，请重新附加后发送');await ownedPath(root,path);let inputPath=path;if(isAnimationPosterPath(path)){const origin=await readImageOrigin(root,path);if(!origin||origin.info.transformation!=='animation'||origin.info.frameIndex!==0)throw Error('原动图来源无法核对，请重新附加动图');inputPath=origin.path;}input.push({type:'localImage',path:inputPath,detail:'auto'});}finally{await handle.close();}}
 if(files.length){const paths=[],documents=[],readDocument=typeof documentText==='function'?documentText:documentText?createDocumentReader():undefined;for(const file of files){const source=await readDraftFile(root,file);paths.push({name:file.name,path:source.path});if(readDocument)documents.push(await readDocument(file,source.bytes));}input.push({type:'text',text:readDocument?documentInputText(documents):fileReferenceText(paths),text_elements:[]});}return input;
}
/** Identity is checked both before import and after every asynchronous boundary. */
export async function handleAttachmentImport(root:string,m:any,identity:()=>{threadId:string;connectionId:number}|undefined,active:()=>boolean,post:(m:any)=>unknown,importFile:typeof importAttachment=importAttachment){
 if(m?.type!=='attachment-import')return false;
 if(!Number.isSafeInteger(m.id)||m.id<1)return true;
 const current=()=>{const s=identity();return active()&&!!s&&s.threadId===m.threadId&&s.connectionId===m.connectionId;};
 let deliveryAttempted=false;
 try{if(!current())throw Error('附件所属线程已失效');const {discard,createdFiles:_createdFiles,...result}=await importFile(root,m.name,m.base64,current,m.original);if(!current()){await discard();return true;}deliveryAttempted=true;const delivered=await post({type:'attachment-imported',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:true,...result});if(delivered===false)await discard();}
 // A rejected post is unknown delivery, unlike an explicit false. Keep source
 // bytes until reference reconciliation; a page may already have saved them.
 catch(e){if(!deliveryAttempted&&current())try{await post({type:'attachment-imported',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:false,error:e instanceof Error?e.message:'附件导入失败'});}catch{/* Closed/failed transport: no false success or unhandled rejection. */}}return true;
}
