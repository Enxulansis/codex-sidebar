/** Sanitized public display data only; no session, RPC or execution. */
export function runtimeNoticeFixture(threadId='offline-status-a'){
 const turnId='status-failed',error='合成失败：连接返回前已中断。没有执行任何真实请求。\n请核对历史后继续；草稿会保留。';
 return {status:'历史已恢复（合成状态案例）',error:'',ready:true,busy:false,needsRecovery:false,threadId,connectionId:1,model:'合成案例',auth:'未连接',threads:[threadId],toolCheck:{verified:false,threadId,reason:'仅显示合成消息，不运行模型或工具；发送禁用'},used:2,limit:2,oldUsed:12,
  turns:[{id:turnId,status:'failed',itemsView:'full',durationMs:2000,errorMessage:error},{id:'status-completed',status:'completed',itemsView:'full',durationMs:3000,errorMessage:''}],
  items:[{turnId,complete:true,item:{type:'userMessage',id:'status-user',content:[{type:'text',text:'这是历史失败提示的合成案例。'}]}},{turnId,complete:true,item:{type:'plan',id:'status-plan',text:'合成公开计划：保留正文，然后显示本轮错误。'}},{turnId,complete:true,item:{type:'agentMessage',id:'status-partial',phase:'final_answer',text:'已保留的公开正文不会被错误卡替换。\n\n公式 $E=mc^2$ 与代码 `literal` 仍可复制。'}},{turnId:'status-completed',complete:true,item:{type:'agentMessage',id:'status-next',phase:'final_answer',text:'后续完成的回答仍可阅读。错误详情属于前一回合，不会折进过程条。'}}],approvals:[]};
}
