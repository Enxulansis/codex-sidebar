import {open,lstat} from 'node:fs/promises';
import type {BigIntStats} from 'node:fs';
import {basename} from 'node:path';
import {ownedPath} from './storage';
import {readImageOriginHint,readImageOrigin} from './image-origin';
import {isAnimationSourcePath} from './image-formats';
import type {DisplayImage} from './display/image-preview';
const IMAGE_BYTES=5*1024*1024;
const stamp=(s:BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
/** One bounded handle, plus physical containment and path/handle identity checks. */
async function localImageBytes(root:string,path:string){
 const safe=await ownedPath(root,path);if(!/\.(?:png|jpe?g)$/i.test(safe))throw Error('Unsupported local image');
 const initial=await lstat(safe,{bigint:true});if(initial.isSymbolicLink()||!initial.isFile()||initial.size<=0n||initial.size>BigInt(IMAGE_BYTES))throw Error('Image outside file bounds');
 const handle=await open(safe,'r');try{
  const before=await handle.stat({bigint:true});if(stamp(before)!==stamp(initial))throw Error('Image identity changed');
  const bytes=Buffer.alloc(Number(before.size)+1);let size=0;while(size<bytes.length){const read=await handle.read(bytes,size,bytes.length-size,size);if(!read.bytesRead)break;size+=read.bytesRead;}
  const after=await handle.stat({bigint:true}),pathAfter=await lstat(safe,{bigint:true});
  if(size!==Number(before.size)||stamp(before)!==stamp(after)||pathAfter.isSymbolicLink()||stamp(after)!==stamp(pathAfter)||await ownedPath(root,safe)!==safe)throw Error('Image source changed while reading');
  return{safe,bytes:bytes.subarray(0,size)};
 }finally{await handle.close();}
}
/** Host-only adapter. Never accepts a server-supplied URL/data payload as a checked preview. */
export async function checkedImage(root:string,path:string,id:string):Promise<DisplayImage&{error?:string}> {
  try {
    if(isAnimationSourcePath(path)){const origin=await readImageOrigin(root,path);if(!origin?.info.animated||origin.info.transformation!=='animation')throw Error('原动图输入来源无法核对');const poster=await checkedImage(root,origin.previewPath,id);if(!poster.src)throw Error('原动图预览不可用');return{...poster,name:origin.info.name,originHint:origin.info,originalInput:true};}
    const {safe,bytes}=await localImageBytes(root,path);
    const png=/\.png$/i.test(safe);
    if(bytes.length>5*1024*1024 || !(png?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw Error('图片读取期间格式或大小发生变化');
    let originHint,originUnavailable;try{originHint=await readImageOriginHint(root,safe,bytes);}catch{originUnavailable='原图来源记录缺失或已变化；显示发送副本';}
    return{id,name:basename(safe),src:`data:image/${png?'png':'jpeg'};base64,${bytes.toString('base64')}`,...(originHint?{originHint}:{}),...(originUnavailable?{originUnavailable}:{})};
  }catch{return{id,name:'图片不可用',error:'图片缺失、路径超出范围或格式/大小不匹配'};}
}
