type Owner={threadId:string;connectionId:number};
type Operation={signal:AbortSignal;check:()=>void;dispose:()=>void};
// Reuse DSH165's preparation registry; an accepted delivery is outside this lease.
const {PromptAdmissions}=require('../../runtime/admission-cancellation.cjs') as {PromptAdmissions:new(error:()=>Error)=>{begin:(key:string)=>Operation;cancel:(key:string)=>void}};
export class AttachmentPreparations{
 private admissions=new PromptAdmissions(()=>Error('附件准备已取消'));
 private key(owner:Owner){return JSON.stringify([owner.connectionId,owner.threadId]);}
 cancel(owner:Owner){this.admissions.cancel(this.key(owner));}
 async run<T>(owner:Owner,work:(active:()=>boolean)=>Promise<T>):Promise<T>{
  const operation=this.admissions.begin(this.key(owner));
  try{return await work(()=>!operation.signal.aborted);}finally{operation.dispose();}
 }
}
