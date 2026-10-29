import type {SearchSource} from './search-query';
import {PUBLIC_TOOL_FIELD_CHARS} from './public-tool-value';
/** Read-only records, distinct from tools with a defined execution status. */
export const PUBLIC_RECORD_TYPES=['webSearch','imageView','imageGeneration','sleep','subAgentActivity','enteredReviewMode','exitedReviewMode','contextCompaction','functionCallOutput','hookPrompt'] as const;
export type PublicRecordKind=typeof PUBLIC_RECORD_TYPES[number];
export function isPublicRecordKind(value:unknown):value is PublicRecordKind{return typeof value==='string'&&(PUBLIC_RECORD_TYPES as readonly string[]).includes(value);}
export type PublicRecordDisplayItem={type:PublicRecordKind|'unavailableRecord';id:string;title:string;status:'record';detail:string;fields:{label:string;text:string}[];searchSources:SearchSource[]};
export function isPublicRecordDisplay(item:unknown):item is PublicRecordDisplayItem{
 if(!item||typeof item!=='object')return false;const v=item as Partial<PublicRecordDisplayItem>;
 return(isPublicRecordKind(v.type)||v.type==='unavailableRecord')&&v.status==='record'&&typeof v.id==='string'&&!!v.id&&typeof v.title==='string'&&v.title.length<=512&&typeof v.detail==='string'&&v.detail.length<=512
  &&Array.isArray(v.fields)&&v.fields.length<=8&&v.fields.every(f=>f&&typeof f.label==='string'&&f.label.length<=256&&typeof f.text==='string'&&f.text.length<=PUBLIC_TOOL_FIELD_CHARS)
  &&Array.isArray(v.searchSources)&&v.searchSources.length<=8&&v.searchSources.every(s=>s&&s.kind==='工具'&&(s.field==='调用'||s.field==='结果')&&typeof s.text==='string'&&s.text.length<=PUBLIC_TOOL_FIELD_CHARS&&(s.incomplete===undefined||typeof s.incomplete==='boolean'));
}
