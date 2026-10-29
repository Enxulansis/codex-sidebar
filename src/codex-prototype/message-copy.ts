/** Copy current public message text; no client-supplied body or file reads. */
import {isToolDisplayItem,toolOutputText} from './tool-display';
import {isPublicToolKind} from './public-tool-types';import {publicToolDisplay} from './public-tool-display';
import {isPublicRecordKind} from './public-record-types';import {publicRecordDisplay} from './public-record-display';
import {publicQuestionRecord,agentPublicText} from './public-questions';
export const MAX_MESSAGE_COPY_CHARS=1_000_000;
export interface MessageCopyOwner {threadId:string;connectionId:number;items:Array<{turnId:string;complete?:boolean;item:{type:string;id:string;content?:unknown;text?:string;questions?:unknown}}>}
export function userMessageText(content:unknown):string{
 if(!Array.isArray(content))throw Error('用户消息正文不可用');
 const parts:string[]=[];let size=0;
 for(const part of content){if(part?.type!=='text')continue;if(typeof part.text!=='string')throw Error('用户消息正文无效');size+=part.text.length+(parts.length?1:0);if(size>MAX_MESSAGE_COPY_CHARS)throw Error('用户消息超过复制容量');parts.push(part.text);}
 const text=parts.join('\n');if(!text.length)throw Error('该消息没有可复制文本');return text;
}
function currentItem(m:any,owner:MessageCopyOwner|undefined){if(!owner||m.threadId!==owner.threadId||m.connectionId!==owner.connectionId||typeof m.turnId!=='string'||typeof m.itemId!=='string')throw Error('消息复制身份已失效');const row=owner.items.find(v=>v.turnId===m.turnId&&v.item.id===m.itemId);if(!row||!['userMessage','agentMessage','commandExecution','fileChange'].includes(row.item.type)&&!isPublicToolKind(row.item.type)&&!isPublicRecordKind(row.item.type))throw Error('消息复制身份已失效');if(row.item.type!=='userMessage'&&row.complete!==true)throw Error('正文仍在生成，暂不可复制');return row.item;}
function messageText(item:MessageCopyOwner['items'][number]['item']){if(item.type==='userMessage')return userMessageText(item.content);const tool=publicToolDisplay(item)??publicRecordDisplay(item)??(isToolDisplayItem(item)?item:undefined),text=tool?toolOutputText(tool):item.type==='agentMessage'?agentPublicText(item.text??'',publicQuestionRecord(item.questions),true):item.text;if(typeof text!=='string'||!text.length)throw Error('该消息没有可复制文本');if(text.length>MAX_MESSAGE_COPY_CHARS)throw Error('消息超过复制容量');return text;}
export async function handleMessageCopy(m:any,owner:()=>MessageCopyOwner|undefined,active:()=>boolean,write:(text:string)=>PromiseLike<void>,post:(m:any)=>unknown){
 if(m?.type!=='message-copy')return false;if(!active()||!Number.isSafeInteger(m.id)||m.id<1)return true;
 let ok=false,error='消息复制身份已失效';try{const item=currentItem(m,owner()),text=messageText(item);if(!active())throw Error(error);await write(text);if(messageText(currentItem(m,owner()))!==text)throw Error('消息内容已改变');ok=active();}catch(e){error=e instanceof Error?e.message:'复制失败，请重试';}
 if(active())await post({type:'message-copied',id:m.id,threadId:m.threadId,connectionId:m.connectionId,turnId:m.turnId,itemId:m.itemId,ok,...(!ok?{error}:{})});return true;
}
