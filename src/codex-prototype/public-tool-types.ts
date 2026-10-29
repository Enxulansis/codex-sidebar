/** Displayable public call records; this list grants no execution or resource authority. */
import type {SearchSource} from './search-query';
export const PUBLIC_TOOL_TYPES=['mcpToolCall','dynamicToolCall','collabAgentToolCall'] as const;
export type PublicToolKind=typeof PUBLIC_TOOL_TYPES[number];
export function isPublicToolKind(value:unknown):value is PublicToolKind{return typeof value==='string'&&(PUBLIC_TOOL_TYPES as readonly string[]).includes(value);}
export function isToolRecordType(type:unknown){return type==='commandExecution'||type==='fileChange'||isPublicToolKind(type);}
export function toolRecordStatus(item:{type:string;status?:unknown}){
 if(!isToolRecordType(item.type))return'unknown';if(item.status==='inProgress'||item.status==='completed'||item.status==='failed')return item.status;
 if(item.status==='declined'&&(item.type==='commandExecution'||item.type==='fileChange'))return'declined';
 if(item.status==='interrupted'&&item.type==='collabAgentToolCall')return'interrupted';return'unknown';
}
export function isTerminalToolRecord(item:{type:string;status?:unknown}){const status=toolRecordStatus(item);return status!=='unknown'&&status!=='inProgress';}
export type PublicToolDisplayItem={[K in PublicToolKind]:{type:K;id:string;title:string;status:string;durationMs:number|null;failedResult:boolean;unknownResult:boolean;fields:{label:string;text:string}[];searchSources?:SearchSource[]}}[PublicToolKind];
