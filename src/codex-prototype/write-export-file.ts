import {open,type FileHandle} from 'node:fs/promises';
/** Register ownership only after exclusive creation, before a write can leave partial bytes. */
export async function writeNewExport(path:string,bytes:Uint8Array,created:(handle:FileHandle)=>void|Promise<void>){
 const handle=await open(path,'wx');
 try{await created(handle);await handle.writeFile(bytes);}finally{await handle.close();}
}
