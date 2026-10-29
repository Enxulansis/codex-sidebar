import type {Session} from './session';
/** Read-only bridge; one page owns monotonic IDs and late results cannot cross owners. */
export class SkillsHost{
 private last=0;private busy=false;
 constructor(private owner:()=>{session:Session;connectionId:number}|undefined,private current:()=>boolean){}
 async handle(m:any,post:(value:object)=>unknown){if(m?.type!=='skills-refresh')return false;if(!this.current()||!Number.isSafeInteger(m.id)||m.id<1||m.id<=this.last)return true;this.last=m.id;const owner=this.owner(),thread=owner?.session.projection.threadId,live=()=>{const now=this.owner();return this.current()&&now?.session===owner?.session&&now?.connectionId===owner?.connectionId&&now?.session.projection.threadId===thread;};
  try{if(!owner||!thread||m.threadId!==thread||m.connectionId!==owner.connectionId||!live())throw Error('技能目录页面、线程或连接已失效');if(this.busy)throw Error('技能目录仍在读取');this.busy=true;try{await owner.session.refreshSkills(live);if(live())await post({type:'skills-result',id:m.id,threadId:thread,connectionId:owner.connectionId,ok:true,skills:owner.session.skills.snapshot()});}finally{this.busy=false;}}
  catch(error){if(live())await post({type:'skills-result',id:m.id,threadId:thread,connectionId:owner?.connectionId,ok:false,error:error instanceof Error?error.message:'技能目录读取失败',skills:owner?.session.skills.snapshot()});}return true;
 }
}
