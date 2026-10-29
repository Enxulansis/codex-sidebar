import type {CommandDisplayItem,FileDisplayItem} from './page-model';
import {isPublicToolKind,toolRecordStatus,type PublicToolDisplayItem} from './public-tool-types';
import {isPublicRecordDisplay,type PublicRecordDisplayItem} from './public-record-types';
export type ToolDisplayItem=CommandDisplayItem|FileDisplayItem|PublicToolDisplayItem|PublicRecordDisplayItem;
export function isToolDisplayItem(item:unknown):item is ToolDisplayItem{if(!item||typeof item!=='object')return false;const value=item as {type?:string;fields?:unknown};return ['commandExecution','fileChange'].includes(value.type??'')||isPublicToolKind(value.type)&&Array.isArray(value.fields)||isPublicRecordDisplay(value);}
/** Public protocol copy text only. File preview separately rechecks reference and workspace identity. */
export function toolOutputText(item:ToolDisplayItem):string{
 if(item.type==='commandExecution')return [item.cwd,item.aggregatedOutput??'',item.exitCode===null?'':'退出码 '+item.exitCode].filter(Boolean).join('\n');
 if(item.type==='fileChange')return item.changes.map(change=>change.path+'\n'+change.diff).join('\n\n');
 return item.fields.map(row=>row.label+'\n'+row.text).join('\n\n');
}
export function toolPresentation(item:ToolDisplayItem,complete:boolean){
 if(isPublicRecordDisplay(item))return{failed:false,live:false,declined:false,title:item.title,detail:item.detail+(complete?' · 记录已结束（不代表操作成功）':' · 仍可能更新'),brief:'',icon:'−'};
 const status=toolRecordStatus(item),resultFailure='failedResult'in item&&item.failedResult&&status==='completed',failed=status==='failed'||resultFailure,declined=status==='declined',live=!complete&&status==='inProgress';
 const unknownResult='unknownResult'in item&&item.unknownResult&&status==='completed';
 const label=resultFailure?'已结束（工具报告失败）':failed?'失败':declined?'已拒绝':live?'进行中':status==='inProgress'?'已停止（结束状态未提供）':status==='interrupted'?'已中断':unknownResult?'调用已结束（结果未提供）':status==='completed'?'已完成':'状态未知（当前接口未确认）';
 const brief=resultFailure||failed?'失败':declined?'已拒绝':live?'进行中':status==='inProgress'?'已停止':status==='interrupted'?'已中断':status==='completed'?'已完成':'状态未知';
 const elapsed='durationMs'in item?item.durationMs:null,duration=typeof elapsed==='number'&&Number.isFinite(elapsed)&&elapsed>=0?' · '+(elapsed/1000).toFixed(1)+'秒':'';
 return {failed,live,declined,title:item.type==='commandExecution'?item.command||'命令执行':item.type==='fileChange'?'文件变更 · '+item.changes.length+' 个文件':item.title,detail:label+duration,brief:brief+duration,icon:live?'…':failed?'!':status==='completed'&&!unknownResult?'✓':'−'};
}
