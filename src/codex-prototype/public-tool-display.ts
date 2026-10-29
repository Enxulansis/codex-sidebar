import type {ThreadItem} from './protocol/v2/ThreadItem';
import type {PublicToolDisplayItem} from './public-tool-types';
import {publicToolValue} from './public-tool-value';import {publicToolSearchSources} from './public-tool-search';
export {PUBLIC_TOOL_FIELD_CHARS} from './public-tool-value';
export const TOOL_PROGRESS_CHARS=4096;
export const TOOL_PROGRESS_SUFFIX='（进度已截断）';
const PUBLIC_TOOL_MAX_FIELDS=8,TITLE_CHARS=256,field=(value:unknown)=>publicToolValue(value).text;
const name=(value:unknown)=>typeof value==='string'&&value?(value.length>TITLE_CHARS?value.slice(0,TITLE_CHARS-1)+'…':value):'名称未提供';
const duration=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
/** One adapter used for both page data and host copying, so copies match the visible fields. */
export function publicToolDisplay(item:{type:string;id:string},progress?:string):PublicToolDisplayItem|undefined{
 const rows:{label:string;text:string}[]=[],add=(label:string,value:unknown)=>{if(rows.length<PUBLIC_TOOL_MAX_FIELDS)rows.push({label,text:field(value)});else if(rows.at(-1)?.label!=='显示范围')rows.push({label:'显示范围',text:'其余字段未显示；复制仅包含当前显示片段'});};
 switch(item.type){
  case 'mcpToolCall':{const call=item as Extract<ThreadItem,{type:'mcpToolCall'}>;add('参数',call.arguments);if(progress)add('当前进度',progress);add('结果',call.result?.content);if(call.result?.structuredContent!==null&&call.result?.structuredContent!==undefined)add('结构化结果',call.result.structuredContent);if(call.error)add('错误',call.error);if(call.mcpAppUi||call.mcpAppResourceUri)add('应用界面','未加载');return{type:'mcpToolCall',id:item.id,title:name(call.server)+' · '+name(call.tool),status:call.status,durationMs:duration(call.durationMs),failedResult:call.error!==null&&call.error!==undefined,unknownResult:call.result==null&&call.error==null,fields:rows,searchSources:publicToolSearchSources(item)};}
  case 'dynamicToolCall':{const call=item as Extract<ThreadItem,{type:'dynamicToolCall'}>;add('参数',call.arguments);if(Array.isArray(call.contentItems))for(const content of call.contentItems){if(rows.length>=PUBLIC_TOOL_MAX_FIELDS){add('显示范围',null);break;}if(content.type==='inputText')add('输出',content.text);else add('媒体结果',content.type==='inputImage'?'图片结果未加载（资源限制）':content.type==='inputAudio'?'音频结果尚未接入播放':'未知媒体类型，未加载');}else add('公开结果',null);add('工具结果标记',call.success===true?'成功':call.success===false?'失败':'未提供');return{type:'dynamicToolCall',id:item.id,title:(call.namespace?name(call.namespace)+' · ':'')+name(call.tool),status:call.status,durationMs:duration(call.durationMs),failedResult:call.success===false,unknownResult:call.success!==true&&call.success!==false,fields:rows,searchSources:publicToolSearchSources(item)};}
  case 'collabAgentToolCall':{const call=item as Extract<ThreadItem,{type:'collabAgentToolCall'}>;add('发起线程',call.senderThreadId);add('目标线程',call.receiverThreadIds);add('提示',call.prompt);if(call.model!==null&&call.model!==undefined)add('请求模型',call.model);if(call.reasoningEffort!==null&&call.reasoningEffort!==undefined)add('请求思考强度',call.reasoningEffort);add('目标代理最近状态',call.agentsStates);return{type:'collabAgentToolCall',id:item.id,title:'子代理协作 · '+name(call.tool),status:call.status,durationMs:null,failedResult:false,unknownResult:false,fields:rows,searchSources:publicToolSearchSources(item)};}
  default:return;
 }
}
