import type {ThreadItem} from './protocol/v2/ThreadItem';
import type {SearchSource} from './search-query';
import {publicToolSearchSources} from './public-tool-search';
import {publicRecordDisplay} from './public-record-display';
import {publicQuestionRecord,agentSearchSources} from './public-questions';
import {documentInputDocuments} from './document-input';
/** Search only public content with an explicit semantic mapping; never raw reasoning/unknown JSON. */
export function publicItemSearchSources(item:ThreadItem,includeTools=false):SearchSource[]{
 switch(item.type){
  case 'agentMessage':return agentSearchSources(item.text,publicQuestionRecord(item.questions));
  case 'plan':return[{kind:'正文',text:item.text}];
  case 'userMessage':return item.content.flatMap((input,index):SearchSource[]=>{if(input.type==='text'){const documents=index===item.content.length-1&&typeof item.clientId==='string'&&/^[a-f0-9-]{36}$/.test(item.clientId)?documentInputDocuments(input.text):undefined;return documents?documents.map(document=>({kind:'文件',text:document.name+'\n'+document.text,file:{name:document.name,sha256:document.sha256}})):[{kind:'正文',text:input.text}];}return input.type==='localImage'?[{kind:'图片',text:input.path.split(/[\\/]/).at(-1)??''}]:[];});
  case 'commandExecution':return includeTools?[{kind:'工具',field:'调用',text:item.command},{kind:'工具',field:'结果',text:item.aggregatedOutput??''}]:[];
  case 'fileChange':return includeTools?[{kind:'工具',field:'调用',text:item.changes.map(change=>change.path+(change.kind.type==='update'&&change.kind.move_path?' '+change.kind.move_path:'')).join(' ')},{kind:'工具',field:'结果',text:item.changes.map(change=>change.diff).join('\n')}]:[];
  default:{if(!includeTools)return[];const sources=publicToolSearchSources(item);return sources.length?sources:publicRecordDisplay(item)?.searchSources??[];}
 }
}
