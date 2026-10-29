import type {Session} from './session';import {validModelChoice} from './model-selection';
type Owner={session:Session;connectionId:number};
/** One page lease and monotonic request numbers; this bridge never starts or steers a turn. */
export class ModelSelectionHost{
 private last=0;private busy=false;
 constructor(private owner:()=>Owner|undefined,private current:()=>boolean){}
 async handle(message:any,post:(value:object)=>unknown):Promise<boolean>{
  if(message?.type!=='model-selection')return false;if(!this.current()||!Number.isSafeInteger(message.id)||message.id<1||message.id<=this.last)return true;this.last=message.id;
  const owner=this.owner(),thread=owner?.session.projection.threadId,live=()=>{const now=this.owner();return this.current()&&now?.session===owner?.session&&now?.connectionId===owner?.connectionId&&now?.session.projection.threadId===thread;};
  try{if(!owner||message.threadId!==thread||message.connectionId!==owner.connectionId||!live())throw Error('模型选择线程、连接或页面已失效');if(this.busy)throw Error('上一项模型选择尚未确认');this.busy=true;
   try{if(message.action==='refresh')await owner.session.refreshModels(live);else if(['select','default'].includes(message.action)){if(!validModelChoice(message.choice))throw Error('模型、思考强度或速度请求无效');await owner.session.selectNextModel(message.choice,live,message.action==='default'?'default':'thread');}else if(['inherit','default-clear'].includes(message.action))await owner.session.selectNextModel(undefined,live,message.action==='default-clear'?'default':'thread');else throw Error('模型选择操作无效');if(live())await post({type:'model-selection-result',id:message.id,threadId:thread,connectionId:owner.connectionId,ok:true,modelSelection:owner.session.modelView()});}
   finally{this.busy=false;}
  }catch(error){if(live())await post({type:'model-selection-result',id:message.id,threadId:thread,connectionId:owner?.connectionId,ok:false,error:error instanceof Error?error.message:'模型选择未确认',modelSelection:owner?.session.modelView()});}return true;
 }
}
