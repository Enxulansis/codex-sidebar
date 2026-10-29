import type {RequestId} from './protocol/RequestId';
import type {ToolRequestUserInputParams} from './protocol/v2/ToolRequestUserInputParams';
import type {ToolRequestUserInputResponse} from './protocol/v2/ToolRequestUserInputResponse';

export type NativeUserInput={id:RequestId;callbackToken:string;params:ToolRequestUserInputParams;status:'pending'|'submitted'};
export const USER_INPUT_TEXT_LIMIT=20_000;
const text=(v:unknown,max=USER_INPUT_TEXT_LIMIT):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!v.includes('\0');
export function validateUserInput(params:unknown):asserts params is ToolRequestUserInputParams {
  const p=params as ToolRequestUserInputParams;
  if(!p||![p.threadId,p.turnId,p.itemId].every(v=>text(v,256))||typeof p.isBlocking!=='boolean'||!(p.autoResolutionMs===null||typeof p.autoResolutionMs==='number'&&Number.isSafeInteger(p.autoResolutionMs)&&p.autoResolutionMs>=0)||!Array.isArray(p.questions)||!p.questions.length||p.questions.length>3)throw Error('原生提问字段未完整核对；未截断问题');
  const ids=new Set<string>();
  for(const q of p.questions){
    if(!q||!text(q.id,256)||ids.has(q.id)||!text(q.header,1024)||!text(q.question)||typeof q.isOther!=='boolean'||typeof q.isSecret!=='boolean'||!(q.options===null||Array.isArray(q.options)&&q.options.length>0&&q.options.length<=32))throw Error('原生问题格式无效；未删减选项');
    ids.add(q.id);const labels=new Set<string>();
    for(const option of q.options??[]){if(!option||!text(option.label,4096)||option.label!==option.label.trim()||labels.has(option.label)||typeof option.description!=='string'||option.description.length>USER_INPUT_TEXT_LIMIT)throw Error('原生问题选项无法核对');labels.add(option.label);}
  }
}
/** Native single-choice labels/freeform. Blank questions are explicitly skipped. */
export function userInputResponse(params:ToolRequestUserInputParams,answers:unknown):ToolRequestUserInputResponse {
  if(!answers||typeof answers!=='object'||Array.isArray(answers))throw Error('回答格式无效');
  const source=answers as Record<string,unknown>,allowed=new Set(params.questions.map(q=>q.id)),result:ToolRequestUserInputResponse={answers:{}};
  if(Object.keys(source).some(id=>!allowed.has(id)))throw Error('回答包含已失效的问题');
  for(const q of params.questions){
    if(!Object.hasOwn(source,q.id))continue;const value=source[q.id];if(value===undefined)continue;
    if(typeof value!=='string'||value.length>USER_INPUT_TEXT_LIMIT||value.includes('\0'))throw Error('回答内容无效或超过20000字符，未发送');
    const answer=value.trim();if(!answer)continue;
    if(q.options&&!q.isOther&&!q.options.some(option=>option.label===answer))throw Error('回答不是当前问题的选项');
    Object.defineProperty(result.answers,q.id,{value:{answers:[answer]},enumerable:true});
  }
  return result;
}
