/** Read-only local runtime facts. A build target is never a compatibility verdict. */
export type BackendConnection='offline'|'not-connected'|'connecting'|'connected'|'disconnected';
export interface RuntimeEnvironment {
 extensionVersion:string|null;extensionPath:string|null;vscodeVersion:string|null;
 codexTargetVersion:string|null;backend:BackendConnection;powershellVersion:string|null;
}
const fact=(value:unknown):value is string|null=>value===null||typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\x00-\x1f]/.test(value);
export function validRuntimeEnvironment(value:unknown):value is RuntimeEnvironment {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as RuntimeEnvironment;
 return [v.extensionVersion,v.extensionPath,v.vscodeVersion,v.codexTargetVersion,v.powershellVersion].every(fact)&&['offline','not-connected','connecting','connected','disconnected'].includes(v.backend);
}
export function runtimeEnvironmentRows(value:RuntimeEnvironment):[string,string][] {
 const states:Record<BackendConnection,string>={offline:'离线显示；未启动 Codex 后端', 'not-connected':'尚未连接',connecting:'正在连接；尚未就绪',connected:'连接存活；不代表在线验收通过',disconnected:'连接已断开；当前后端状态不可用'};
 return [
  ['当前扩展',`${value.extensionVersion??'版本未知'} · 加载来源：${value.extensionPath??'未知'}`],
  ['VS Code',value.vscodeVersion??'版本未知'],
  ['Codex 接口目标',`${value.codexTargetVersion??'未知'}。固定构建目标；未将其当作当前后端的实测版本或兼容性结论。`],
  ['后端连接',states[value.backend]],
  ['本机导出与朗读',value.powershellVersion?`PowerShell ${value.powershellVersion} / Core 身份已核对；具体导出与朗读能力另行核对，不代表 Codex 工具使用此解释器。`:'PowerShell 7 绑定不可用；本机系统导出与朗读不可用，未切换到其它解释器。'],
  ['验证范围','真实在线与人工体验仍待验收；本地或合成宿主测试不能替代。'],
 ];
}
