import type {PageState} from './page-model';

type CapabilityState=Pick<PageState,'dispatchMode'|'threadId'|'ready'|'connecting'|'operating'|'needsRecovery'|'toolCheck'|'permissionSelection'>;
const permissionNames={'read-only':'只读','workspace-write':'工作区','full-access':'完全访问'} as const;
const permissionName=(preset:unknown)=>typeof preset==='string'&&Object.hasOwn(permissionNames,preset)?permissionNames[preset as keyof typeof permissionNames]:'未知';

/** Existing public state only. Do not keep message bodies, query tools or grant authority. */
export function runtimeCapabilityRows(state?:Partial<CapabilityState>):[string,string][] {
 if(state?.dispatchMode!=='daily')return [];
 const verified=state.ready===true&&!state.connecting&&!state.operating&&!state.needsRecovery&&!!state.threadId&&state.toolCheck?.verified===true&&state.toolCheck.threadId===state.threadId;
 const permissions=state.permissionSelection,observed=verified?permissions?.observed:undefined;
 const actual=observed?permissionName(observed.preset)+'；网络'+(observed.network===true?'允许':observed.network===false?'关闭':'未知'):'当前会话尚未确认；不沿用其他会话或连接的授权';
 const outcome=permissions?.submitted?.outcome,submitted=outcome==='accepted'?' 上次改档请求已受理，以后端回执为准。':outcome==='rejected'?' 上次改档请求被明确拒绝。':outcome==='unknown'?' 上次改档结果未知，不能据此认定权限已改变。':'';
 return [
  ['当前会话核对',verified?'已核对当前会话的受限工具范围；不表示所有 Codex 工具都可用。':'当前会话的工具范围尚未确认；连接、恢复或核对完成后更新。'],
  ['权限与下一轮',`最近后端回执：${actual}。下一新回合选择：${permissionName(permissions?.desired)}；不改变正在运行的回合，重连恢复只读。${submitted}`],
  ['原生技能','“/”可主动读取 Codex 技能目录并选择技能；尚未读取不等于没有技能。选择技能不会自动启用它依赖的外部工具。'],
  // Keep these descriptions aligned with Session.checkApprovalAcceptance.
  ['命令审批范围','当前审批卡只能允许受控的 Write-Output 测试命令；其他命令的“允许”尚未接入。无需审批的后端操作仍按当前权限执行。'],
  ['文件变更审批','仅接受可核对的当前工作区内完整文件差异，不扩大写入根目录；缺失或未知的差异不能允许，仍可拒绝。删除会话不会撤销文件变更。'],
  ['外部工具与插件',verified?'此连接已确认应用连接器关闭、MCP 无可用工具或资源。侧栏不提供插件安装或启用入口。':'当前连接的外部工具状态尚未确认；侧栏不提供插件安装、启用或自动放行入口。'],
 ];
}
