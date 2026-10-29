import {execFile} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import {basename,delimiter,isAbsolute,join,resolve} from 'node:path';

export type PowerShell7Binding={path:string;version:string;edition:'Core'};
type Stamp={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint};
const sameStamp=(a:Stamp,b:Stamp)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const probeScript="$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); @{path=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName;version=$PSVersionTable.PSVersion.ToString();major=$PSVersionTable.PSVersion.Major;edition=$PSVersionTable.PSEdition} | ConvertTo-Json -Compress";
const isLocalAbsolute=(path:string)=>isAbsolute(path)&&!path.startsWith('\\\\')&&!/[\x00-\x1f\"]/.test(path);
const pathKey=(path:string)=>resolve(path).toLowerCase();

/** Bind only local display helpers. Does not select a Codex shell or grant tool permission. */
export class PowerShell7 {
 private pending:Promise<{binding:PowerShell7Binding;stamp:Stamp|undefined}>|undefined;
 constructor(private environment:NodeJS.ProcessEnv=process.env){}
 private async discover(){
  if(process.platform!=='win32')throw Error('此实验版本机导出与朗读仅支持 Windows / PowerShell 7');
  const explicit=this.environment['CODEX_PROTOTYPE_PWSH'];
  if(explicit!==undefined&&(!isLocalAbsolute(explicit)||basename(explicit).toLowerCase()!=='pwsh.exe'))throw Error('CODEX_PROTOTYPE_PWSH 必须是本地绝对路径的 pwsh.exe；未回退到其它解释器');
  const entries=(this.environment['PATH']??this.environment['Path']??'').split(delimiter).map(value=>value.trim().replace(/^"([^"]+)"$/,'$1')).filter(isLocalAbsolute);
  const candidates=explicit!==undefined?[explicit]:[...new Set([...entries.map(folder=>join(folder,'pwsh.exe')),...(this.environment['ProgramFiles']&&isLocalAbsolute(this.environment['ProgramFiles'])?[join(this.environment['ProgramFiles'],'PowerShell','7','pwsh.exe'),join(this.environment['ProgramFiles'],'PowerShell','7-preview','pwsh.exe')]:[]),...(this.environment['LOCALAPPDATA']&&isLocalAbsolute(this.environment['LOCALAPPDATA'])?[join(this.environment['LOCALAPPDATA'],'Microsoft','WindowsApps','pwsh.exe')]:[])])];
  let path:string|undefined,stampable=true;
  for(const candidate of candidates){try{const info=await stat(candidate);if(!info.isFile())throw Error('PowerShell 7 路径不是文件');path=await realpath(candidate);break;}catch(error){
   const code=(error as NodeJS.ErrnoException).code;
   if(explicit===undefined&&code==='ENOENT')continue;
   // The Microsoft Store install is an execution alias: stat/realpath return
   // EACCES while spawning the alias works. Accept it without a file stamp and
   // let the version probe decide whether it is really PowerShell 7.
   if(explicit===undefined&&(code==='EACCES'||code==='EPERM')){path=candidate;stampable=false;break;}
   throw Error('无法读取指定 PowerShell 7；未回退到其它解释器');}}
  if(!path)throw Error('未找到 PowerShell 7；请通过专用启动器运行，或为本次进程设置 CODEX_PROTOTYPE_PWSH 绝对路径');
  const before=stampable?await stat(path,{bigint:true}):undefined;
  const output=await new Promise<string>((accept,reject)=>execFile(path!,['-NoProfile','-NonInteractive','-Command',probeScript],{timeout:4000,maxBuffer:16*1024,windowsHide:true,encoding:'utf8'},(error,stdout)=>error?reject(Error('PowerShell 7 身份核对失败或超时；未执行导出或朗读')):accept(stdout)));
  let value:any;try{value=JSON.parse(output.trim());}catch{throw Error('PowerShell 7 身份响应无法核对；未执行导出或朗读');}
  if(value?.major!==7||value.edition!=='Core'||typeof value.version!=='string'||!/^7\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value.version)||typeof value.path!=='string'||!isLocalAbsolute(value.path))throw Error('解释器路径、版本或 Core 身份不符；需要 PowerShell 7，未回退到 Windows PowerShell');
  if(stampable&&pathKey(value.path)!==pathKey(path))throw Error('解释器路径、版本或 Core 身份不符；需要 PowerShell 7，未回退到 Windows PowerShell');
  const after=stampable?await stat(path,{bigint:true}):undefined;if(before&&after&&(!before.isFile()||!after.isFile()||!sameStamp(before,after)))throw Error('PowerShell 7 文件在核对期间变化；请重载候选窗口后重新核对');
  return{binding:{path,version:value.version,edition:'Core'} as PowerShell7Binding,stamp:after};
 }
 async binding():Promise<PowerShell7Binding>{
  // A failed/changed binding is sticky for this extension host. Never silently
  // switch binaries during an export or while a speech helper is being stopped.
  this.pending??=this.discover();const value=await this.pending;
  if(!value.stamp)return{...value.binding};
  const current=await stat(value.binding.path,{bigint:true}).catch(()=>undefined);
  if(!current?.isFile()||!sameStamp(current,value.stamp))throw Error('PowerShell 7 文件已变化或不可读取；请重载候选窗口后重新核对');
  return{...value.binding};
 }
}
export const localPowerShell7=new PowerShell7();
