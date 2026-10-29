import {PIN} from './pin';
import {localPowerShell7,type PowerShell7Binding} from './powershell7';
import {validRuntimeEnvironment,type RuntimeEnvironment,type BackendConnection} from './runtime-environment';

/** Local metadata only: never starts RPC, reads account data or mutates settings. */
export async function readRuntimeEnvironment(metadata:{extensionVersion:unknown;extensionPath:unknown;vscodeVersion:unknown},backend:()=>BackendConnection,bind:()=>Promise<PowerShell7Binding>=()=>localPowerShell7.binding()):Promise<RuntimeEnvironment>{
 const known=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=4096&&!/[\x00-\x1f]/.test(v)?v:null;
 const shell=await bind().catch(()=>undefined);
 const powershellVersion=shell?.edition==='Core'&&/^7\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(shell.version)?shell.version:null;
 return{extensionVersion:known(metadata.extensionVersion),extensionPath:known(metadata.extensionPath),vscodeVersion:known(metadata.vscodeVersion),codexTargetVersion:PIN.version,backend:backend(),powershellVersion};
}
/** Each page owns its request sequence; a newer read supersedes a slow reply. */
export class RuntimeEnvironmentHost {
 private latest=0;
 constructor(private read:()=>Promise<RuntimeEnvironment>,private current:()=>boolean){}
 async handle(message:any,post:(reply:object)=>unknown):Promise<boolean>{
  if(message?.type!=='environment-read')return false;
  if(!this.current()||!Number.isSafeInteger(message.id)||message.id<1||message.id<=this.latest)return true;
  const id=this.latest=message.id;let value:RuntimeEnvironment|undefined;
  try{const result=await this.read();if(validRuntimeEnvironment(result))value=result;}catch{}
  if(this.current()&&this.latest===id)await post({type:'environment-result',id,ok:!!value,...(value?{value}:{})});
  return true;
 }
}
