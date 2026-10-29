import type {ThreadItem} from './protocol/v2/ThreadItem';import type {SearchSource} from './search-query';
import {publicToolValue,PUBLIC_TOOL_TRUNCATED_SUFFIX} from './public-tool-value';
export const PUBLIC_TOOL_SEARCH_FIELDS=8;
/** Explicit current public call/result fields. No protocol-event emulation or resource loading. */
export function publicToolSearchSources(item:{type:string;id:string}):SearchSource[]{
 const sources:SearchSource[]=[],values:{text:string;incomplete:boolean}[]=[];let resultIncomplete=false;
 const value=(raw:unknown)=>{const v=publicToolValue(raw);return{text:v.truncated?v.text.slice(0,-PUBLIC_TOOL_TRUNCATED_SUFFIX.length):v.text,incomplete:v.truncated};};
 const result=(raw:unknown)=>{if(raw===null||raw===undefined)return;if(values.length>=PUBLIC_TOOL_SEARCH_FIELDS){resultIncomplete=true;return;}values.push(value(raw));};
 const call=(names:unknown[],args?:unknown)=>{const fields=names.filter((name):name is string=>typeof name==='string'&&!!name.trim()).map(value),name=fields.map(v=>v.text).join(' '),incomplete=fields.some(v=>v.incomplete);if(name)sources.push({kind:'工具',field:'调用',text:name,incomplete});if(args!==null&&args!==undefined){const input=value(args);sources.push({kind:'工具',field:'调用',text:(name?name+' ':'')+input.text,incomplete:incomplete||input.incomplete});}};
 switch(item.type){
  case 'mcpToolCall':{const v=item as Extract<ThreadItem,{type:'mcpToolCall'}>;call([v.server,v.tool],v.arguments);if(Array.isArray(v.result?.content)){resultIncomplete=v.result.content.length>PUBLIC_TOOL_SEARCH_FIELDS;for(const content of v.result.content.slice(0,PUBLIC_TOOL_SEARCH_FIELDS)){if(typeof content==='string'||typeof content==='number'||typeof content==='boolean')result(content);else if(content&&typeof content==='object'&&!Array.isArray(content)){if(content.type==='text'&&typeof content.text==='string')result(content.text);else if(!['image','audio','resource','resource_link'].includes(String(content.type)))resultIncomplete=true;}else resultIncomplete=true;}}result(v.result?.structuredContent);result(v.error);break;}
  case 'dynamicToolCall':{const v=item as Extract<ThreadItem,{type:'dynamicToolCall'}>;call([v.namespace,v.tool],v.arguments);if(Array.isArray(v.contentItems)){resultIncomplete=v.contentItems.length>PUBLIC_TOOL_SEARCH_FIELDS;for(const content of v.contentItems.slice(0,PUBLIC_TOOL_SEARCH_FIELDS))if(content.type==='inputText')result(content.text);}break;}
  case 'collabAgentToolCall':{const v=item as Extract<ThreadItem,{type:'collabAgentToolCall'}>;call([v.tool],{senderThreadId:v.senderThreadId,receiverThreadIds:v.receiverThreadIds,prompt:v.prompt,model:v.model,reasoningEffort:v.reasoningEffort});result(v.agentsStates);break;}
  default:return[];
 }
 if(values.length||resultIncomplete)sources.push({kind:'工具',field:'结果',text:values.map(v=>v.text).join('\n'),incomplete:resultIncomplete||values.some(v=>v.incomplete)});return sources;
}
