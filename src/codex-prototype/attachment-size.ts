import {lstat,opendir} from 'node:fs/promises';import {join} from 'node:path';
import {assertWorkspaceFiles,ownedPath} from './storage';
export const ATTACHMENT_SCAN_ENTRY_CAP=32768;
/** Logical file byte sizes under the owned attachment root, including legacy/foreign files.
 * Measurement never adopts a file as deletable evidence and never follows a link. */
export async function attachmentSize(root:string,entryCap=ATTACHMENT_SCAN_ENTRY_CAP){
 await assertWorkspaceFiles(root);const base=await ownedPath(root,'.codex-attachments');let bytes=0,files=0,entries=0;
 const walk=async(path:string,depth:number):Promise<void>=>{
  const safe=await ownedPath(root,path),before=await lstat(safe,{bigint:true});if(before.isSymbolicLink()||!before.isDirectory())throw Error('附件目录含链接或类型已变化');
  for await(const entry of await opendir(safe)){
   // Names come from this checked directory. lstat does not follow a child link;
   // each descended directory is independently checked before/after enumeration.
   if(++entries>entryCap)throw Error('附件文件数量超出本次统计范围');const target=join(safe,entry.name),info=await lstat(target,{bigint:true});
   if(info.isSymbolicLink())throw Error('附件目录含链接，无法完整统计');
   if(info.isDirectory()){if(depth>=2)throw Error('附件目录层级超出本次统计范围');await walk(target,depth+1);}
   else if(info.isFile()){const size=Number(info.size);if(size<0||!Number.isSafeInteger(size)||!Number.isSafeInteger(bytes+size))throw Error('附件大小无法完整统计');bytes+=size;files++;}
   else throw Error('附件目录含无法统计的条目');
  }
  const after=await lstat(safe,{bigint:true});await ownedPath(root,safe);if(after.isSymbolicLink()||!after.isDirectory()||before.ino!==after.ino||before.dev!==after.dev||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw Error('附件目录在统计期间已变化，请重试');
 };
 try{await lstat(base);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return{bytes:0,files:0};throw error;}
 await walk(base,0);return{bytes,files};
}
