import {open,lstat} from 'node:fs/promises';
import {constants,type BigIntStats} from 'node:fs';
import {join,dirname,basename,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {ownedPath,assertWorkspaceFiles} from './storage';
import {IMAGE_SOURCE_BYTES,sourceImage,imageSourceMime,imageSignatureMatches,validAnimationIdentity,isAnimationSourcePath,type ImageOriginInfo} from './image-formats';
export type {ImageOriginInfo} from './image-formats';
export type ImageOriginManifest={version:1;output:{name:string;size:number;sha256:string};original:ImageOriginInfo};
export const ORIGIN_BYTES_FILE='source.bin',ORIGIN_META_FILE='source.json',DERIVED_IMAGE_DIR='derived',ANIMATION_IMAGE_DIR='animated';
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const stamp=(s:BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
/** Bounded read plus a reusable path lease; no cache can resurrect an unlinked or replaced source. */
async function originBytes(root:string,path:string,max:number,known?:Uint8Array){
 const safe=await ownedPath(root,path),before=await lstat(safe,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.size<1n||before.size>BigInt(max))throw Error('原图片来源大小或类型已变化');
 const handle=await open(safe,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const opened=await handle.stat({bigint:true});if(!opened.isFile()||stamp(opened)!==stamp(before))throw Error('原图片来源打开期间已变化');let bytes:Buffer;
  if(known)bytes=Buffer.from(known);else{const data=Buffer.alloc(Number(opened.size)+1);let offset=0;while(offset<data.length){const value=await handle.read(data,offset,data.length-offset,offset);if(!value.bytesRead)break;offset+=value.bytesRead;}if(offset!==Number(opened.size))throw Error('原图片来源读取期间大小已变化');bytes=data.subarray(0,offset);}
  if(bytes.length>max||stamp(await handle.stat({bigint:true}))!==stamp(opened))throw Error('原图片来源读取期间已变化');
  const check=async()=>{await ownedPath(root,safe);const now=await lstat(safe,{bigint:true});if(!now.isFile()||now.isSymbolicLink()||stamp(now)!==stamp(opened))throw Error('原图片来源读取期间已变化，请重新打开预览');};await check();return{bytes,check};
 }finally{await handle.close();}
}
export function originPayload(value:any){
 if(!value||typeof value.base64!=='string'||value.base64.length%4||value.base64.length>Math.ceil(IMAGE_SOURCE_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64)||!['rasterized','compressed','frame','animation'].includes(value.transformation))throw Error('原图片来源编码或转换说明无效');
 const bytes=Buffer.from(value.base64,'base64');if(bytes.toString('base64')!==value.base64)throw Error('原图片来源编码无效');const checked=sourceImage(value.name,bytes);if(checked.animated&&!['animation','frame'].includes(value.transformation)||!checked.animated&&['animation','frame'].includes(value.transformation))throw Error('动图来源与选帧说明不一致');
 const info:ImageOriginInfo={name:value.name as string,mime:checked.mime,size:bytes.length,sha256:digest(bytes),animated:checked.animated,transformation:value.transformation,...(value.groupId===undefined?{}:{groupId:value.groupId}),...(value.frameIndex===undefined?{}:{frameIndex:value.frameIndex}),...(value.frameCount===undefined?{}:{frameCount:value.frameCount})};if(!validAnimationIdentity(info))throw Error('动图分组或帧身份无效');return{bytes,info};
}
export function originManifest(name:string,output:Uint8Array,original:ImageOriginInfo):ImageOriginManifest{return{version:1,output:{name,size:output.length,sha256:digest(output)},original};}
/** Manifest hints bind to the verified runtime bytes; they never assert the raw original is present. */
async function originRecord(root:string,path:string,knownOutput?:Uint8Array){
 let runtime=await ownedPath(root,path);
 // Public history now names the exact animation input. Resolve only its fixed
 // sibling poster through the existing manifest; never accept an arbitrary path.
 if(isAnimationSourcePath(runtime)){const metadata=await originBytes(root,join(dirname(runtime),ORIGIN_META_FILE),4096),hint=JSON.parse(metadata.bytes.toString('utf8')),name=hint?.output?.name;if(typeof name!=='string'||name.includes('/')||name.includes('\\')||imageSourceMime(name)!=='image/png'||hint?.original?.transformation!=='animation')throw Error('原动图输入与预览来源无法核对');runtime=await ownedPath(root,join(dirname(runtime),ANIMATION_IMAGE_DIR,name));knownOutput=undefined;await metadata.check();}
 const outputDir=dirname(runtime);if(![DERIVED_IMAGE_DIR,ANIMATION_IMAGE_DIR].includes(basename(outputDir)))return;const dir=dirname(outputDir);if(!/^\.codex-attachments\/[0-9a-f-]{36}$/i.test(relative(root,dir).replace(/\\/g,'/')))return;
 // The derived namespace survives loss of both sidecars. Never silently call
 // the send copy an original merely because its source record disappeared.
 const meta=await ownedPath(root,join(dir,ORIGIN_META_FILE));let metaStat;try{metaStat=await lstat(meta);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw Error('原图片来源记录缺失，无法核对原图');throw error;}
 if(!metaStat.isFile()||metaStat.isSymbolicLink()||metaStat.size>4096||(await lstat(dir)).isSymbolicLink()||(await lstat(outputDir)).isSymbolicLink())throw Error('原图片来源记录无效');await assertWorkspaceFiles(root);
  const metadata=await originBytes(root,meta,4096);const value=JSON.parse(metadata.bytes.toString('utf8')) as ImageOriginManifest,info=value.original;
  if(value.version!==1||!value.output||value.output.name!==basename(runtime)||!Number.isSafeInteger(value.output.size)||!info||!Number.isSafeInteger(info.size)||info.size<1||info.size>IMAGE_SOURCE_BYTES||typeof info.animated!=='boolean'||!imageSourceMime(info.name)||imageSourceMime(info.name)!==info.mime||!/^([a-f0-9]{64})$/.test(value.output.sha256)||!/^([a-f0-9]{64})$/.test(info.sha256)||!['rasterized','compressed','frame','animation'].includes(info.transformation)||!validAnimationIdentity(info))throw Error('原图片来源记录无法核对');
  if(!/\.(png|jpe?g)$/i.test(runtime))throw Error('发送副本格式无效');const runtimeRead=await originBytes(root,runtime,5*1024*1024,knownOutput),output=runtimeRead.bytes;if(!imageSignatureMatches(output,/\.png$/i.test(runtime)?'image/png':'image/jpeg')||output.length!==value.output.size||digest(output)!==value.output.sha256)throw Error('发送副本内容已变化，原图片关联失效');
 if(info.transformation==='rasterized'&&(!/\.png$/i.test(runtime)||['image/png','image/jpeg'].includes(info.mime))||info.transformation==='compressed'&&!/\.jpe?g$/i.test(runtime))throw Error('原图片转换说明与发送副本格式不一致');
 if((basename(outputDir)===ANIMATION_IMAGE_DIR)!==(info.transformation==='animation')||['animation','frame'].includes(info.transformation)&&(!info.animated||!runtime.toLowerCase().endsWith('.png')))throw Error('动图预览或静态帧来源不一致');
  const check=async()=>{await metadata.check();await runtimeRead.check();if((await lstat(dir)).isSymbolicLink()||(await lstat(outputDir)).isSymbolicLink())throw Error('原图片来源目录已变化');};await check();return{runtime,dir,info,check};
}
/** Small display hint only. A later explicit original read/export still rehashes actual raw bytes. */
export async function readImageOriginHint(root:string,path:string,output:Uint8Array){return(await originRecord(root,path,output))?.info;}
/** Runtime paths locate only fixed sidecars in a single imported UUID directory. */
export async function readImageOrigin(root:string,path:string){
  const record=await originRecord(root,path);if(!record)return;const {dir,info}=record;
  const original=await ownedPath(root,join(dir,ORIGIN_BYTES_FILE));let originalStat;try{originalStat=await lstat(original);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw Error('原图片缺失，无法预览或导出原图；发送副本仍保留');throw error;}if(!originalStat.isFile()||originalStat.isSymbolicLink()||originalStat.size!==info.size)throw Error('原图片缺失或大小已变化');const source=await originBytes(root,original,IMAGE_SOURCE_BYTES),bytes=source.bytes;if(bytes.length!==info.size||digest(bytes)!==info.sha256)throw Error('原图片内容已变化');const checked=sourceImage(info.name,bytes);if(checked.mime!==info.mime||checked.animated!==info.animated)throw Error('原图片格式或动画身份已变化');await record.check();await source.check();
 return{info,bytes,path:original,previewPath:record.runtime};
}
