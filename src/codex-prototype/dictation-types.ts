export const DICTATION_CHARACTERS=20_000,DICTATION_SEGMENT_CHARACTERS=4_000,DICTATION_DURATION_MS=120_000;
export type DictationRecognizer={id:string;name:string;culture:string};
export type DictationCatalog={recognizers:DictationRecognizer[];available:boolean};
export type DictationEvent={phase:'listening'|'stopping'|'text'|'ended'|'cancelled'|'error';sequence?:number;text?:string;error?:string;cleanupUnknown?:boolean};
export const validDictationText=(value:unknown,max=DICTATION_SEGMENT_CHARACTERS):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
export function dictationCatalog(raw:any):DictationCatalog{
 if(raw?.protocol!==1||raw.microphoneOpened!==false||!Array.isArray(raw.recognizers)||raw.recognizers.length>64)throw Error('本地听写目录无法核对');
 const seen=new Set<string>(),recognizers=raw.recognizers.map((v:any)=>{if(!validDictationText(v?.id,512)||!validDictationText(v.name,512)||!validDictationText(v.culture,64)||seen.has(v.id))throw Error('本地听写语言无法核对');seen.add(v.id);return{id:v.id,name:v.name,culture:v.culture};});
 return{recognizers,available:recognizers.length>0};
}
const punctuation:Record<string,string>={'逗号':'，','句号':'。','问号':'？','感叹号':'！','叹号':'！','分号':'；','冒号':'：','换行':'\n','新段落':'\n\n','comma':',','period':'.','full stop':'.','question mark':'?','exclamation mark':'!','new line':'\n','new paragraph':'\n\n'};
/** Only a whole finalized utterance is a punctuation command; never rewrite those words inside a sentence. */
export function appendDictation(previous:string,recognized:string,commands:boolean){const raw=recognized.trim(),text=commands&&Object.hasOwn(punctuation,raw.toLowerCase())?punctuation[raw.toLowerCase()]!:raw;if(!text)return previous;const space=/[a-z0-9]$/i.test(previous)&&/^[a-z0-9]/i.test(text)?' ':'';const value=previous+space+text;if(value.length>DICTATION_CHARACTERS)throw Error('本次听写超过20000字符，已确认文字保留');return value;}
/** Insert before an existing selection, preserving its text and selection; never replace it or the rest of the draft. */
export function insertDictation(draft:string,start:number,end:number,text:string){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>draft.length||!validDictationText(text,DICTATION_CHARACTERS)||draft.length+text.length>DICTATION_CHARACTERS)throw Error('听写无法加入当前草稿；原文字保留，请缩短草稿后重试');
 return{text:draft.slice(0,start)+text+draft.slice(start),start:start+text.length,end:end+text.length};
}
