import {MAX_MESSAGE_COPY_CHARS} from './message-copy';
type Owner={threadId:string;connectionId:number};
/** Bounded rendered text only. No path reads, model execution or rich clipboard formats. */
export async function handleDisplayCopy(message:any,owner:()=>Owner|undefined,current:()=>boolean,write:(text:string)=>PromiseLike<void>,post:(message:object)=>unknown){
 if(!['copy-display','offline-copy'].includes(message?.type))return false;
 if(!current()||!Number.isSafeInteger(message.id)||message.id<1)return true;
 const response={type:message.type==='copy-display'?'display-copied':'offline-copied',id:message.id,threadId:message.threadId,connectionId:message.connectionId};
 const matches=()=>{const value=owner();return current()&&!!value?.threadId&&message.threadId===value.threadId&&message.connectionId===value.connectionId;};
 try{
  if(!matches())throw Error('显示复制身份已失效');
  if(typeof message.text!=='string'||message.text.length>MAX_MESSAGE_COPY_CHARS)throw Error('复制内容无效或超过100万字符容量');
  await write(message.text);
  if(!matches())throw Error('复制期间显示身份已变化');
  if(current())await post({...response,ok:true});
 }catch(error){if(current())await post({...response,ok:false,error:error instanceof Error?error.message:'复制失败'});}
 return true;
}
