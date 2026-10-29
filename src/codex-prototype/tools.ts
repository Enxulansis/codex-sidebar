import type {Transport} from './rpc';
import type {ConfigReadResponse} from './protocol/v2/ConfigReadResponse';
import type {ListMcpServerStatusResponse} from './protocol/v2/ListMcpServerStatusResponse';
import {WORKSPACE_FILES_SERVER,WORKSPACE_FILE_TOOLS} from './workspace-files-contract';
import type {McpServerStatus} from './protocol/v2/McpServerStatus';

export type WorkspaceFilesPolicy={command:string;script:string;root:string};
export function workspaceFilesConfig(p:WorkspaceFilesPolicy){return{enabled:true,command:p.command,args:[p.script,p.root],env:{ELECTRON_RUN_AS_NODE:'1'},environment_id:'local',enabled_tools:[...WORKSPACE_FILE_TOOLS],startup_timeout_sec:15,tool_timeout_sec:15};}
export function instanceArgs(policy?:WorkspaceFilesPolicy){
 if(!policy)return [...INSTANCE_ARGS];
 const config=workspaceFilesConfig(policy),quote=(v:string)=>JSON.stringify(v),toml=Object.entries(config).map(([k,v])=>k+' = '+(typeof v==='object'?Array.isArray(v)?'['+v.map(quote).join(',')+']':'{ ELECTRON_RUN_AS_NODE = "1" }':typeof v==='string'?quote(v):String(v))).join(', ');
 return [...INSTANCE_ARGS,'-c',`mcp_servers.${WORKSPACE_FILES_SERVER}={ ${toml} }`];
}
export function assertWorkspaceCatalog(s:McpServerStatus){
 if(s.name!==WORKSPACE_FILES_SERVER||s.runtimeStatus!=='connected'||s.toolsError||!s.tools||Array.isArray(s.tools)||!Array.isArray(s.resources)||!Array.isArray(s.resourceTemplates)||s.resources.length!==0||s.resourceTemplates.length!==0||Object.keys(s.tools).length!==WORKSPACE_FILE_TOOLS.length)throw Error('工作区文件服务目录未就绪');
 for(const name of WORKSPACE_FILE_TOOLS){const tool=s.tools[name],a=tool?.annotations as any,schema=tool?.inputSchema as any;
  if(tool?.name!==name||a?.readOnlyHint!==true||a.destructiveHint!==false||a.idempotentHint!==true||a.openWorldHint!==false||schema?.type!=='object'||schema.properties?.path?.type!=='string'||!Array.isArray(schema.required)||!schema.required.includes('path')||Object.keys(schema.properties).some(k=>k!=='path'&&(name!=='read_file'||k!=='startLine')))throw Error('工作区文件工具契约未核对');
 }
}

export const DISABLED_MCP = ['fastctx', 'node_repl'] as const;
export const DISABLED_PLUGINS = ['unified-computer-use@openai-bundled', 'codex-app-tools@openai-bundled', 'code-review@openai-bundled'] as const;
// The pinned CLI splits dotted paths literally; quoted path components become different keys.
// The backend validates transport fields even for disabled entries. Supply a
// complete inactive transport so a clean Codex profile needs no desktop config.
export const INSTANCE_OVERRIDES = ['features.apps=false', 'apps._default.enabled=false', ...DISABLED_MCP.flatMap(n => [`mcp_servers.${n}.enabled=false`, `mcp_servers.${n}.command=${JSON.stringify(process.execPath)}`]), ...DISABLED_PLUGINS.map(n => `plugins.${n}.enabled=false`)];
export const INSTANCE_ARGS = ['app-server', '--listen', 'stdio://', ...INSTANCE_OVERRIDES.flatMap(v => ['-c', v])];
export type ToolCheck = {verified: boolean; reason: string; threadId: string; evidence?: unknown};

/** Never retain credential fields, commands, headers, config layers or resource contents. */
export async function checkConfig(rpc: Transport, cwd: string) {
  const response = await rpc.request<'config/read', ConfigReadResponse>('config/read', {cwd, includeLayers: false});
  const c = response.config as Record<string, any>;
  if (!c || c.features?.apps !== false || c.apps?._default?.enabled !== false) throw new Error('应用连接器禁用状态未确认');
  for (const n of DISABLED_MCP) if (c.mcp_servers?.[n]?.enabled !== false) throw new Error(`MCP 配置未禁用：${n}`);
  for (const [n, value] of Object.entries(c.mcp_servers ?? {}) as [string, any][]) {
    if(n===WORKSPACE_FILES_SERVER&&rpc.workspaceFiles){
      const expected=workspaceFilesConfig(rpc.workspaceFiles);
      if(rpc.workspaceFiles.root!==cwd||Object.keys(value??{}).length!==Object.keys(expected).length||Object.entries(expected).some(([key,v])=>JSON.stringify(value?.[key])!==JSON.stringify(v)))throw Error('工作区文件服务启动配置不一致');
      continue;
    }
    if (!(DISABLED_MCP as readonly string[]).includes(n) || value?.enabled !== false) throw new Error(`未获准的 MCP 配置：${n}`);
  }
  if(rpc.workspaceFiles&&!c.mcp_servers?.[WORKSPACE_FILES_SERVER])throw Error('工作区文件服务配置缺失');
  for (const n of DISABLED_PLUGINS) if (c.plugins?.[n]?.enabled !== false) throw new Error(`插件工具禁用状态未确认：${n}`);
  return {featuresApps: c.features.apps, appsDefaultEnabled: c.apps._default.enabled,
    mcpServers: {...Object.fromEntries(DISABLED_MCP.map(n => [n, {enabled: false}])),...(rpc.workspaceFiles?{[WORKSPACE_FILES_SERVER]:{enabled:true,tools:[...WORKSPACE_FILE_TOOLS]}}:{})},
    plugins: Object.fromEntries(DISABLED_PLUGINS.map(n => [n, {enabled: false}]))};
}

export async function verifyTools(rpc: Transport, cwd: string, threadId: string,current:()=>boolean=()=>true): Promise<ToolCheck> {
  const check=()=>{if(!current())throw Error('工具检查来源已失效');};check();
  const config = await checkConfig(rpc, cwd);
  check();
  if (!threadId) throw new Error('缺少线程上下文，无法确认实际工具目录');
  const servers = []; const cursors = new Set<string>(); const names = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: ListMcpServerStatusResponse = await rpc.request('mcpServerStatus/list', {threadId, cursor, limit: 100, detail: 'full'});
    check();
    if (!Array.isArray(page?.data) || page.data.length>100 || page.nextCursor!==null&&(typeof page.nextCursor!=='string'||!page.nextCursor||page.nextCursor.length>4096)) throw new Error('工具目录返回不完整');
    for (const s of page.data) {
      if(!s||typeof s.name!=='string')throw Error('工具目录返回不完整');
      if (names.has(s.name)) throw new Error(`重复的 MCP 目录项：${s.name}`); names.add(s.name);
      if(s.name===WORKSPACE_FILES_SERVER&&rpc.workspaceFiles){assertWorkspaceCatalog(s);servers.push({name:s.name,runtimeStatus:s.runtimeStatus,toolNames:[...WORKSPACE_FILE_TOOLS],resourceCount:0,resourceTemplateCount:0});continue;}
      if (!(DISABLED_MCP as readonly string[]).includes(s.name)) throw new Error(`未获准的 MCP：${s.name}`);
      if (s.runtimeStatus !== 'disabled') throw new Error(`MCP 状态未确认禁用：${s.name} (${s.runtimeStatus ?? '未知'})`);
      if (s.toolsError || !s.tools || !Array.isArray(s.resources) || !Array.isArray(s.resourceTemplates)) throw new Error(`工具目录核对失败：${s.name}`);
      if (Object.keys(s.tools).length || s.resources.length || s.resourceTemplates.length) throw new Error(`仍有未获准的工具或资源：${s.name}`);
      servers.push({name: s.name, runtimeStatus: s.runtimeStatus, toolNames: [], resourceCount: 0, resourceTemplateCount: 0});
    }
    cursor = page.nextCursor;
    if (cursor) { if (cursors.has(cursor) || cursors.size >= 20) throw new Error('工具目录分页无法核对'); cursors.add(cursor); }
  } while (cursor);
  // A missing configured server is not proof it is disabled in this thread.
  for (const n of [...DISABLED_MCP,...(rpc.workspaceFiles?[WORKSPACE_FILES_SERVER]:[])]) if (!names.has(n)) throw new Error(`实际工具目录缺少配置项：${n}`);
  return {verified: true, reason: rpc.workspaceFiles?'实例工具已核对：仅工作区文件只读服务可用，其他服务关闭':'实例工具已核对：应用连接器关闭，MCP 全部禁用，目录中 0 个工具/资源', threadId,
    evidence: {at: new Date().toISOString(), config, servers, inspection: 'public metadata only; no tool/resource calls or outside-workspace probes'}};
}
