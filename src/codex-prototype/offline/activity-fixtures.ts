/** Public-looking synthetic display records, never sent to a Session or transport. */
export function activityFixture(threadId='offline-motion-a'){
 const turnId='motion-turn';
 return{status:'合成动效体验：点击上方播放；不会执行模型或工具',error:'',ready:true,busy:false,threadId,connectionId:1,model:'合成案例',auth:'未连接',threads:[threadId],toolCheck:{verified:false,threadId,reason:'合成显示回放；发送始终禁用'},used:2,limit:2,oldUsed:12,approvals:[],turns:[{id:turnId,status:'completed',itemsView:'full',durationMs:3000}],items:[
  {turnId,complete:true,item:{type:'userMessage',id:'motion-user',content:[{type:'text',text:'观察工具处理与公开正文生成间的过渡；切换动效档位、展开过程或复制最终正文。'}]}},
  {turnId,complete:true,item:{type:'commandExecution',id:'motion-tool',command:"Write-Output 'synthetic-display-only'",cwd:'synthetic',status:'completed',aggregatedOutput:'合成输出：不执行命令。',exitCode:0,durationMs:1000}},
  {turnId,complete:true,item:{type:'agentMessage',id:'motion-answer',phase:'final_answer',text:'# 工作态与动效（合成）\n\nStandard：原头像呼吸和文字渐变。Dots：原三点占位。Off：静态反馈。\n\n公式 $x^2+y^2=1$、代码 `literal` 与原复制设置保留。等待审批或停止中仍显示明确文字，不冒充正在生成。'}}]};
}
