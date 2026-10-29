/** DSH 165 parseSearchQuery/localSessionHits literal matching and snippet rules. */
export type SearchQuery={include:string;excludes:string[]};
export type SearchAttachment={name:string;sha256:string};
export const validSearchAttachment=(value:unknown):value is SearchAttachment=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>key==='name'||key==='sha256')&&typeof (value as SearchAttachment).name==='string'&&(value as SearchAttachment).name.length>0&&(value as SearchAttachment).name.length<=180&&/^[a-f0-9]{64}$/.test((value as SearchAttachment).sha256);
export type SearchSource={kind:'正文'|'图片'|'文件'|'工具';text:string;field?:'调用'|'结果';incomplete?:boolean;file?:SearchAttachment};
export type SearchHit={threadId:string;title:string;turnId:string;itemId:string;kind:string;field?:'调用'|'结果';total:number;snippet:string;snippetLong:string;incomplete:boolean;cached?:true;archived?:true;cachedAtMs?:number;timeMs?:number;file?:SearchAttachment};
export const validSearchTimeMs=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=8.64e15;
export function parseSearchQuery(raw:string):SearchQuery{
 const parts=raw.trim().split(/\s+/).filter(Boolean),excludes:string[]=[],keep:string[]=[];
 for(const part of parts)if(part.length>1&&part.charAt(0)==='-')excludes.push(part.slice(1).toLowerCase());else keep.push(part);
 return{include:keep.join(' '),excludes};
}
export function matchSearchText(sources:readonly SearchSource[],query:SearchQuery){
 const q=query.include.toLowerCase();if(!q)return;
 for(const source of sources){
  const lowered=source.text.toLowerCase(),index=lowered.indexOf(q);if(index<0||source.incomplete&&query.excludes.length>0||query.excludes.some(term=>lowered.includes(term)))continue;
  let total=0;for(let at=index;at>=0;at=lowered.indexOf(q,at+q.length))total++;
  const from=Math.max(0,index-16),longFrom=Math.max(0,index-120),snippet=source.text.slice(from,index+q.length+30).replace(/\s+/g,' ').trim(),long=source.text.slice(longFrom,index+q.length+240).replace(/\s+/g,' ').trim();
  return{kind:source.kind,...(source.field?{field:source.field}:{}),...(source.incomplete?{incomplete:true}:{}),...(source.file?{file:{...source.file}}:{}),total,snippet:(from?'…':'')+snippet,snippetLong:(longFrom?'…':'')+long};
 }
 return;
}
