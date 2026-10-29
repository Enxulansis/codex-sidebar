import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {WorkspaceFiles} from './workspace-files';
import {WORKSPACE_FILES_SERVER,WORKSPACE_FILE_TOOLS} from './workspace-files-contract';
async function main(){
 if(process.argv.length!==3)throw Error('Workspace root required');
 const files=await WorkspaceFiles.create(process.argv[2]!),server=new McpServer({name:WORKSPACE_FILES_SERVER,version:'1.0.0'});
 for(const tool of WORKSPACE_FILE_TOOLS)server.registerTool(tool,{
  title:tool==='list_files'?'列出项目目录':'读取项目文本',
  description:'Read only the selected workspace. Hidden paths, node_modules, links and binary files are excluded. Results are bounded; truncated results are explicit.',
  inputSchema:{path:z.string().max(1024),...(tool==='read_file'?{startLine:z.number().int().min(1).max(1048576).optional()}:{} )},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
 },async args=>{
  try{const result=await files.call(tool,args);return{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{...result},isError:false};}
  catch{return{content:[{type:'text',text:'无法读取：请核对相对路径、文件类型、大小及访问权限。隐藏路径、依赖目录和链接不在支持范围内。'}],isError:true};}
 });
 await server.connect(new StdioServerTransport());
}
void main().catch(()=>{process.stderr.write('Workspace file service failed to start.\n');process.exitCode=1;});
