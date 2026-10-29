import type {ThreadItem} from './protocol/v2/ThreadItem';
import type {PublicRecordDisplayItem} from './public-record-types';
import {publicToolValue,PUBLIC_TOOL_TRUNCATED_SUFFIX} from './public-tool-value';
const MAX_FIELDS=8,TITLE_CHARS=256;
const literal=(value:unknown)=>typeof value==='string'&&value?value.slice(0,TITLE_CHARS):'未知';
/** Explicit public fields only. Opaque results never cross the page/copy/search boundary. */
export function publicRecordDisplay(item:{type:string;id:string}):PublicRecordDisplayItem|undefined{
 const fields:PublicRecordDisplayItem['fields']=[],searchSources:PublicRecordDisplayItem['searchSources']=[];
 const add=(label:string,value:unknown,search?:'调用'|'结果')=>{if(fields.length>=MAX_FIELDS)return;const v=publicToolValue(value);fields.push({label,text:v.text});if(search&&value!==null&&value!==undefined&&v.text)searchSources.push({kind:'工具',field:search,text:v.truncated?v.text.slice(0,-PUBLIC_TOOL_TRUNCATED_SUFFIX.length):v.text,incomplete:v.truncated});};
 const record=(title:string,detail='公开记录'):PublicRecordDisplayItem=>({type:item.type as PublicRecordDisplayItem['type'],id:item.id,title,status:'record',detail,fields,searchSources});
 switch(item.type){
  case 'webSearch':{const v=item as Extract<ThreadItem,{type:'webSearch'}>;add('查询',v.query,'调用');const a=v.action;add('动作',a?.type,'调用');if(a?.type==='search'){add('动作查询',a.query,'调用');add('多项查询',a.queries,'调用');}else if(a?.type==='openPage'||a?.type==='findInPage'){add('目标地址',a.url,'调用');if(a.type==='findInPage')add('查找文字',a.pattern,'调用');}add('结果范围',Array.isArray(v.results)?`${v.results.length} 项结果（未加载）`:'未提供结果');return record('网页检索');}
  case 'imageView':{const v=item as Extract<ThreadItem,{type:'imageView'}>;add('来源路径',v.path,'调用');add('图片内容','图片未加载');return record('图片查看');}
  case 'imageGeneration':{const v=item as Extract<ThreadItem,{type:'imageGeneration'}>;add('图片结果','图片未加载');add('状态',v.status,'结果');add('修订提示',v.revisedPrompt,'调用');if(v.transparentBackground!==undefined)add('透明背景',v.transparentBackground,'调用');if(v.savedPath!==undefined)add('保存路径',v.savedPath,'结果');if(v.failure){add('失败类型',v.failure.type,'结果');add('限制标识',v.failure.limitId);add('重置时间（Unix 秒）',v.failure.resetsAt);}return record('图片生成','状态：'+literal(v.status));}
  case 'sleep':{const v=item as Extract<ThreadItem,{type:'sleep'}>;add('请求等待时长',typeof v.durationMs==='number'&&Number.isFinite(v.durationMs)&&v.durationMs>=0?v.durationMs+'毫秒':undefined,'调用');add('说明','请求时长不代表实际经过时间，也不表示等待已成功执行');return record('等待记录');}
  case 'subAgentActivity':{const v=item as Extract<ThreadItem,{type:'subAgentActivity'}>;add('活动类型',v.kind,'结果');add('目标线程（仅标识）',v.agentThreadId,'调用');add('代理路径（仅文本）',v.agentPath,'调用');add('说明','活动记录的completed不等于目标代理任务成功；未读取或接管该线程');return record('子代理活动','活动：'+literal(v.kind));}
  case 'enteredReviewMode':case 'exitedReviewMode':{const v=item as Extract<ThreadItem,{type:'enteredReviewMode'|'exitedReviewMode'}>;add('公开审阅说明',v.review,'结果');add('说明','模式记录不代表审批允许、拒绝或审阅结论');return record(item.type==='enteredReviewMode'?'进入审阅模式':'退出审阅模式');}
  case 'contextCompaction':add('说明','公开历史记录了上下文压缩；未提供压缩量，不据此推断用量或费用');return record('上下文压缩记录');
  case 'functionCallOutput':{const v=item as Extract<ThreadItem,{type:'functionCallOutput'}>;add('函数',v.name);add('命名空间',v.namespace);if(typeof v.output==='string')add('文本输出',v.output);else if(Array.isArray(v.output)){for(const part of v.output.slice(0,MAX_FIELDS-3)){if(part?.type==='input_text')add('文本输出',part.text);else add('非文本结果','图片、音频、加密或未知载荷未投递到本页');}if(v.output.length>MAX_FIELDS-3)add('显示范围','其余内容未显示；复制仅包含当前显示片段');}else add('输出','未提供可显示的文本');return record('函数输出记录');}
  case 'hookPrompt':add('说明','钩子注入内容未接入公开显示；不投递提示片段或内部运行标识');return record('钩子提示记录');
  default:return;
 }
}
/** Future/unknown items stay visible without copying their unverified payload. */
export function unavailableRecord(item:{type:string;id:string}):PublicRecordDisplayItem{return{type:'unavailableRecord',id:item.id,title:'未适配记录 · '+literal(item.type),status:'record',detail:'内容不可用',fields:[{label:'说明',text:'当前候选尚未适配该记录类型，未显示、复制或检索其原始载荷'}],searchSources:[]};}
