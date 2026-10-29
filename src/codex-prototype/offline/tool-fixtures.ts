import type {ToolDisplayItem} from '../tool-display';
const command=(id:string,status:'completed'|'failed'|'declined'|'inProgress',output:string,exitCode:number|null=0):ToolDisplayItem=>({type:'commandExecution',id,command:'echo synthetic-'+id,cwd:'synthetic-workspace',status,aggregatedOutput:output,exitCode,durationMs:status==='declined'||status==='inProgress'?null:1240});
/** Synthetic display data; commands and paths are labels, never executed or read. */
export function toolFixtureRows():Array<{turnId:string;complete:boolean;item:ToolDisplayItem}>{return[
 {turnId:'tool-turn',complete:true,item:command('command-ok','completed','第一行合成输出\n第二行合成输出\n最后一行也必须复制')},
 {turnId:'tool-turn',complete:true,item:command('command-long','completed',Array.from({length:500},(_,i)=>'合成输出 '+i+'：仅用于复制完整公开文本的边界核验。'.repeat(2)).join('\n'))},
 {turnId:'tool-turn',complete:true,item:command('command-failed','failed','合成错误：<script>不能执行</script>\ncommand:workbench.action.reloadWindow\nhttps://blocked.invalid/example',1)},
 {turnId:'tool-turn',complete:true,item:command('command-declined','declined','',null)},
 {turnId:'patch-turn',complete:true,item:{type:'fileChange',id:'patch-ok',status:'completed',changes:[{path:'synthetic-a.txt',kind:{type:'update',move_path:null},diff:'@@ -1,2 +1,2 @@\n-old line\n+new line\n unchanged line'},{path:'synthetic-b.txt',kind:{type:'add'},diff:'+合成新增文件\n+第二行'}]}},
 {turnId:'patch-turn',complete:true,item:{type:'fileChange',id:'patch-failed',status:'failed',changes:[{path:'../inert-outside-label.txt',kind:{type:'update',move_path:null},diff:'合成应用失败，路径只作公开文本显示，不读取。'}]}},
 ];}
export function liveToolFixture(){return{turnId:'live-turn',complete:false,item:command('command-live','inProgress','首段合成输出',null)};}
