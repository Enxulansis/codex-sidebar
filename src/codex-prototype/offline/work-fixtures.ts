import {toolFixtureRows} from './tool-fixtures';import type {WorkTurn} from '../work-segments';
/** Synthetic public phases and turn metadata; no execution or private reasoning. */
export function workFixture(){const tools=toolFixtureRows(),rows=[
 {turnId:'work-turn',complete:true,item:{type:'userMessage',id:'work-user',content:[{type:'text',text:'合成任务：检查并说明结果，不执行命令。'}]}},
 {turnId:'work-turn',complete:true,item:{type:'agentMessage',id:'work-comment',phase:'commentary',text:'先核对公开材料，再整理结果。\n\n这属于明确标记的过程说明。'}},
 {turnId:'work-turn',complete:true,item:{type:'plan',id:'work-plan',text:'# 公开计划\n\n- [ ] 核对合成输入\n- [x] 保留原界面\n\n计划里的公式也沿用原显示：$x^2$。\n\n```text\n步骤一\n步骤二\n```'}},
 {...tools[0]!,turnId:'work-turn'}, {...tools[4]!,turnId:'work-turn'},
 {turnId:'work-turn',complete:true,item:{type:'agentMessage',id:'work-partial',phase:'partial_answer',text:'阶段答复：已完成局部核对。这条答复保持可见。'}},
 {turnId:'work-turn',complete:true,item:{type:'agentMessage',id:'work-comment-last',phase:'commentary',text:'准备汇总公开结果。'}},
 {turnId:'work-turn',complete:true,item:{type:'agentMessage',id:'work-final',phase:'final_answer',text:'# 最终合成答复\n\n'+Array.from({length:24},(_,i)=>'段落 '+i+'：最终正文保持可见，不因为过程折叠而隐藏。').join('\n\n')}},
 {turnId:'unknown-turn',complete:true,item:{type:'agentMessage',id:'work-unknown',phase:null,text:'阶段未知的历史正文，保持原样显示，不猜测它是过程说明。'}},
 ];const turns:WorkTurn[]=[{id:'work-turn',status:'completed',itemsView:'full',durationMs:42000},{id:'unknown-turn',status:'completed',itemsView:'full',durationMs:null}];return{rows,turns};}
