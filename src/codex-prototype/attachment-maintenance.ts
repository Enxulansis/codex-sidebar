import type {AttachmentStorage} from './attachment-storage';
export const ATTACHMENT_MAINTENANCE_MS=30*60*1000;
/** Workspace lifecycle, independent of sidebar visibility. Never queues overlapping timer runs. */
export function startAttachmentMaintenance(storage:Pick<AttachmentStorage,'maintain'>,changed:()=>unknown){
 let running=false,stopped=false;
 const run=async()=>{if(stopped||running)return;running=true;try{await storage.maintain();if(!stopped)await changed();}catch{/* Preserve the manager's failure status; no automatic retry of an unknown write. */}finally{running=false;}};
 const ready=run(),timer=setInterval(()=>void run(),ATTACHMENT_MAINTENANCE_MS);timer.unref();
 return{ready,dispose(){stopped=true;clearInterval(timer);}};
}
