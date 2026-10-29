import type {Session} from './session';
import {validChatMode} from './collaboration-mode';
type Owner={session:Session;connectionId:number};
/** A page/connection lease; selecting a mode never sends a message or changes permissions. */
export class CollaborationModeHost {
  private last=0;private busy=false;
  constructor(private owner:()=>Owner|undefined,private current:()=>boolean){}
  async handle(message:any,post:(value:object)=>unknown):Promise<boolean>{
    if(message?.type!=='chat-mode')return false;
    if(!this.current()||!Number.isSafeInteger(message.id)||message.id<1||message.id<=this.last)return true;this.last=message.id;
    const owner=this.owner(),thread=owner?.session.projection.threadId,live=()=>{const now=this.owner();return this.current()&&now?.session===owner?.session&&now?.connectionId===owner?.connectionId&&now?.session.projection.threadId===thread;};
    try{if(!owner||message.threadId!==thread||message.connectionId!==owner.connectionId||!live())throw Error('模式选择页面、连接或会话已失效');if(this.busy)throw Error('上一项模式选择尚未确认');this.busy=true;
      try{if(message.action==='refresh')await owner.session.refreshModes(live);else if(message.action==='select'&&validChatMode(message.mode))await owner.session.selectNextMode(message.mode,live);else throw Error('模式选择操作无效');if(live())await post({type:'chat-mode-result',id:message.id,threadId:thread,connectionId:owner.connectionId,ok:true,modeSelection:owner.session.modeView()});}finally{this.busy=false;}
    }catch(error){if(live())await post({type:'chat-mode-result',id:message.id,threadId:thread,connectionId:owner?.connectionId,ok:false,error:error instanceof Error?error.message:'模式选择未确认',modeSelection:owner?.session.modeView()});}return true;
  }
}
