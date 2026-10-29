export const PUBLIC_TOOL_FIELD_CHARS=100_000;
export const PUBLIC_TOOL_TRUNCATED_SUFFIX='\n（显示已截断；复制仅包含当前显示片段）';
const PUBLIC_VALUE_NODES=4096,PUBLIC_VALUE_DEPTH=32,QUOTE_CHUNK_CHARS=256;
/** Shared display/search prefix and explicit coverage; never allocate a full large JSON value first. */
export function publicToolValue(value:unknown):{text:string;truncated:boolean}{
 const TRUNCATED=PUBLIC_TOOL_TRUNCATED_SUFFIX;
 if(value===undefined||value===null)return{text:'未提供',truncated:false};
 if(typeof value==='string')return value.length>PUBLIC_TOOL_FIELD_CHARS?{text:value.slice(0,PUBLIC_TOOL_FIELD_CHARS-TRUNCATED.length)+TRUNCATED,truncated:true}:{text:value,truncated:false};
 let text='',truncated=false,nodes=0;const ancestors=new Set<object>();
 const put=(part:string)=>{const remaining=PUBLIC_TOOL_FIELD_CHARS-text.length;if(part.length>remaining){text+=part.slice(0,remaining);truncated=true;}else text+=part;};
 const quote=(part:string)=>{put('"');for(let i=0;i<part.length&&!truncated;i+=QUOTE_CHUNK_CHARS)put(JSON.stringify(part.slice(i,i+QUOTE_CHUNK_CHARS)).slice(1,-1));if(!truncated)put('"');};
 const visit=(part:unknown,depth:number):void=>{
  if(truncated)return;if(++nodes>PUBLIC_VALUE_NODES||depth>PUBLIC_VALUE_DEPTH){truncated=true;return;}
  if(part===null){put('null');return;}if(typeof part==='string'){quote(part);return;}if(typeof part==='boolean'){put(String(part));return;}if(typeof part==='number'){if(Number.isFinite(part))put(String(part));else quote('数值不可用');return;}
  if(typeof part!=='object'){quote('字段不可用');return;}if(ancestors.has(part)){truncated=true;return;}ancestors.add(part);
  if(Array.isArray(part)){put('[');for(let i=0;i<part.length&&!truncated;i++){if(i)put(',');const descriptor=Object.getOwnPropertyDescriptor(part,String(i));if(descriptor&&!('value'in descriptor)){truncated=true;break;}visit(descriptor?.value,depth+1);}if(!truncated)put(']');}
  else{put('{');let first=true;for(const key in part){if(truncated)break;if(!Object.hasOwn(part,key))continue;const descriptor=Object.getOwnPropertyDescriptor(part,key);if(!descriptor||!('value'in descriptor)){truncated=true;break;}if(!first)put(',');first=false;quote(key);put(':');visit(descriptor.value,depth+1);}if(!truncated)put('}');}ancestors.delete(part);
 };visit(value,0);return{text:truncated?text.slice(0,PUBLIC_TOOL_FIELD_CHARS-TRUNCATED.length)+TRUNCATED:text,truncated};
}
