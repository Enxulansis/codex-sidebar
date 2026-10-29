import type {SearchSource} from './search-query';
export type PublicQuestion={title:string;options:string[]|null};
export type PublicQuestionRecord={questions:PublicQuestion[];incomplete:boolean;notice:string};
export const QUESTION_LIMIT=20,QUESTION_TITLE_LIMIT=4000,QUESTION_OPTION_LIMIT=20,QUESTION_OPTION_TEXT_LIMIT=1000,QUESTION_TEXT_LIMIT=64000;
export const QUESTION_STATUS_UNKNOWN='未记录回答';
/** Only the published title/options fields. Never infer answers, pending state or a human approval. */
export function publicQuestionRecord(raw:unknown):PublicQuestionRecord|undefined{
 if(raw===undefined||raw===null||Array.isArray(raw)&&!raw.length)return;
 const questions:PublicQuestion[]=[];let incomplete=!Array.isArray(raw),remaining=QUESTION_TEXT_LIMIT;
 if(Array.isArray(raw)){
  if(raw.length>QUESTION_LIMIT)incomplete=true;
  const text=(value:string,limit:number)=>{const end=Math.min(value.length,limit,remaining);if(end<value.length)incomplete=true;remaining-=end;return value.slice(0,end);};
  for(const value of raw.slice(0,QUESTION_LIMIT)){
   if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.title!=='string'||value.options!==null&&(!Array.isArray(value.options)||!value.options.every((v:unknown)=>typeof v==='string'))){incomplete=true;continue;}
   if(!remaining){incomplete=true;break;}
   const title=text(value.title,QUESTION_TITLE_LIMIT),options=value.options===null?null:[] as string[];
   if(options){if(value.options.length>QUESTION_OPTION_LIMIT)incomplete=true;for(const option of value.options.slice(0,QUESTION_OPTION_LIMIT)){if(!remaining){incomplete=true;break;}options.push(text(option,QUESTION_OPTION_TEXT_LIMIT));}}
   questions.push({title,options});
  }
 }
 return{questions,incomplete,notice:(incomplete?'部分公开提问信息格式未核对或超出显示范围；':'')+QUESTION_STATUS_UNKNOWN};
}
export function hasPublicQuestions(item:{questions?:unknown;questionRecord?:unknown}){return item.questionRecord!==undefined||item.questions!==undefined&&item.questions!==null&&(!Array.isArray(item.questions)||item.questions.length>0);}
export function agentPublicText(text:string,record?:PublicQuestionRecord,includeNotice=false){const body=record?.questions.map(q=>q.title+(q.options?.length?'\n可选项：'+q.options.join('、'):'')).join('\n\n')??'';return[text,body,includeNotice?record?.notice:''].filter(v=>!!v).join('\n\n');}
export function agentSearchSources(text:string,record?:PublicQuestionRecord):SearchSource[]{return[{kind:'正文',text:agentPublicText(text,record),...(record?.incomplete?{incomplete:true}:{})}];}
