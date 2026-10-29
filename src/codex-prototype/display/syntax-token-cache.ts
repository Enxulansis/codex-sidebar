/** Reuse the same vendor's exact tokens across width-only measurement passes. */
type Tokens={content:string;color:string}[][];
type Vendor={tokenize:(lang:string,code:string)=>Promise<Tokens|undefined>};
const MAX_ENTRIES=1024,MAX_ACCOUNTED_BYTES=8*1024*1024,MAX_SOURCE_CHARS=65536;
let owner:Vendor|undefined,bytes=0;
const entries=new Map<string,{value:Promise<Tokens|undefined>;bytes:number}>();
function trim(){while(entries.size>MAX_ENTRIES||bytes>MAX_ACCOUNTED_BYTES){const first=entries.keys().next().value;if(first===undefined)break;bytes-=entries.get(first)!.bytes;entries.delete(first);}}
export function syntaxTokens(vendor:Vendor,lang:string,code:string):Promise<Tokens|undefined>{
 if(owner!==vendor){entries.clear();bytes=0;owner=vendor;}
 if(code.length>MAX_SOURCE_CHARS)return vendor.tokenize(lang,code);
 const key=JSON.stringify([lang,code]),prior=entries.get(key);
 if(prior){entries.delete(key);entries.set(key,prior);return prior.value;}
 const entry={bytes:key.length*2,value:undefined as unknown as Promise<Tokens|undefined>};
 entry.value=vendor.tokenize(lang,code).then(tokens=>{
  if(entries.get(key)!==entry)return tokens;
  if(!tokens){bytes-=entry.bytes;entries.delete(key);return tokens;}
  const weight=entry.bytes+tokens.reduce((sum,line)=>sum+24+line.reduce((n,t)=>n+64+2*(t.content.length+t.color.length),0),0);
  bytes+=weight-entry.bytes;entry.bytes=weight;trim();return tokens;
 },error=>{if(entries.get(key)===entry){bytes-=entry.bytes;entries.delete(key);}throw error;});
 entries.set(key,entry);bytes+=entry.bytes;trim();return entry.value;
}
