import type {PageState} from './page-model';
export type ComposerDraftState={text:string;images:number;files:number;preparing:boolean;pending:boolean;attachmentBusy:boolean;blocked:boolean;notice:string;modelBlocked:string};
/** Daily dispatch has no experiment counter; all connection/owner/recovery gates still apply. */
export function hasDispatchCapacity(s:Pick<PageState,'dispatchMode'|'used'|'limit'>|undefined):boolean{return !!s&&(s.dispatchMode==='daily'||s.used!==null&&s.limit!==null&&Number.isInteger(s.used)&&Number.isInteger(s.limit)&&s.used<s.limit);}
/** Explanations mirror existing gates; the Session remains the authority for submission. */
export function composerSendReason(s:PageState|undefined,d:ComposerDraftState,mode:'send'|'queue'|'steer'='send'):string{
 if(d.pending)return '等待发送或排队确认，草稿保留；请勿重复提交';
 if(s?.dispatchBlockReason)return s.dispatchBlockReason;
 if(s?.needsRecovery)return '当前状态尚未确认，发送已禁用；请先恢复并核对历史，不会自动重发。';
 if(!s?.ready)return s?.connecting?'正在连接，请等待状态核对':'尚未连接；请连接后核对线程和工具状态';
 if(s.dispatchMode==='daily'&&s.threadId==='codex-local-draft')return '点击顶部“新建会话”开始聊天；已有本地草稿保留';
 if(mode==='send'&&(d.modelBlocked||s.modelSelection?.saving||s.modeSelection?.saving))return d.modelBlocked||'正在保存下一轮模型或模式选择，请等待确认';
 if(d.preparing)return '正在核对草稿与图片摘要，请稍候';
 if(d.attachmentBusy)return '正在附加文件，请稍候';
 if(d.blocked)return d.notice||'草稿保存或恢复尚未确认，请先核对';
 if(s.operating)return '会话操作尚未完成，请稍候';
 if(mode!=='queue'&&s.userInputs?.length)return '等待问题回答；可先保存聊天草稿';
 if(mode==='send'&&s.busy)return s.approvals.length?'等待审批；可先保存草稿':'当前回合运行中，可选择排队发送或立即插话';
 if(mode!=='send'&&!s.localQueue)return '当前宿主未接入本地队列或立即插话';
 if(mode==='queue'&&(s.localQueue!.blocked||s.localQueue!.items.length>=20))return s.localQueue!.blocked?(s.localQueue!.reason||'本地队列状态未确认，请先重新核对'):'本地队列已达20条上限';
 if(mode==='steer'&&!s.localQueue!.steerTurnId)return '没有已确认的活动回合，不能立即插话';
 // Enqueueing is local storage. Tool/budget checks occur again when it is dispatched.
 if(mode!=='queue'){
  if(!s.toolCheck?.verified||s.toolCheck.threadId!==s.threadId)return s.toolCheck?.reason||'工具尚未核对，发送已禁用';
  if(s.dispatchMode!=='daily'){
   if(s.limit===null||s.used===null||!Number.isInteger(s.limit)||!Number.isInteger(s.used))return '本批调用预算未知，发送已禁用';
   if(s.used>=s.limit)return '本批预算已用尽，发送禁用';
  }
 }
 if(!d.text.trim()&&!d.images&&!d.files)return '请输入消息或主动附加文件';
 if(d.text.length>20000)return '当前原型最多发送 20000 字符';
 return '';
}
/** Presentation only: Send keeps the complete gating reason and accessible title. */
export function composerNoticeReason(s:PageState|undefined,reason:string):string{
 if(s?.dispatchMode!=='daily')return reason;
 if((s.connecting||s.operating)&&!s.error&&!s.needsRecovery&&reason===s.toolCheck?.reason)return '';
 if(reason==='正在恢复草稿…')return '';
 if(reason==='尚未连接；请连接后核对线程和工具状态')return '';
 return ['请输入消息或主动附加文件','当前回合运行中，可选择排队发送或立即插话','等待审批；可先保存草稿','等待问题回答；可先保存聊天草稿','正在连接，请等待状态核对','正在附加文件，请稍候','正在核对草稿与图片摘要，请稍候','正在保存下一轮模型选择，请等待确认','正在保存下一轮模型或模式选择，请等待确认','正在核对模型或模式选择，请等待确认','正在确认权限选择，请等待','会话操作尚未完成，请稍候','等待发送或排队确认，草稿保留；请勿重复提交'].includes(reason)?'':reason;
}
