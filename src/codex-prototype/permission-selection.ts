import {resolve} from 'node:path';
import type {Transport} from './rpc';
import type {AskForApproval} from './protocol/v2/AskForApproval';
import type {ApprovalsReviewer} from './protocol/v2/ApprovalsReviewer';
import type {SandboxPolicy} from './protocol/v2/SandboxPolicy';

export type PermissionPreset='read-only'|'workspace-write'|'full-access';
export type PermissionRequest={approvalPolicy:AskForApproval;approvalsReviewer:ApprovalsReviewer;sandboxPolicy:SandboxPolicy};
export type PermissionOption={preset?:PermissionPreset;id:string;title:string;description:string;available:boolean;reason:string};
export type PermissionReceipt={preset?:PermissionPreset|undefined;label:string;approval:string;reviewer:string;network:boolean|null;source:'thread-receipt'|'settings-notification'};
export type PermissionSelectionView={generation:number;loading:boolean;complete:boolean;stale:boolean;error:string;options:PermissionOption[];desired:PermissionPreset;observed?:PermissionReceipt|undefined;submitted?:{preset:PermissionPreset;outcome:'accepted'|'rejected'|'unknown'}|undefined;canSelect:boolean};
const PRESETS=[
 {preset:'read-only',id:':read-only',title:'只读',description:'不直接修改文件；需要额外操作时请求审批。',mode:'read-only',approval:'untrusted'},
 {preset:'workspace-write',id:':workspace',title:'工作区',description:'允许在当前工作区写入；联网与越界操作仍需审批。',mode:'workspace-write',approval:'on-request'},
 {preset:'full-access',id:':danger-full-access',title:'完全访问',description:'取消文件沙箱和命令审批；可能访问工作区外文件及网络。',mode:'danger-full-access',approval:'never'},
] as const;
export const validPermissionPreset=(value:unknown):value is PermissionPreset=>PRESETS.some(p=>p.preset===value);
export function permissionRequest(preset:PermissionPreset,root:string):PermissionRequest{
 if(!validPermissionPreset(preset))throw Error('权限档位无效');
 return {approvalPolicy:PRESETS.find(p=>p.preset===preset)!.approval,approvalsReviewer:'user',sandboxPolicy:preset==='read-only'?{type:'readOnly',networkAccess:false}:preset==='workspace-write'?{type:'workspaceWrite',writableRoots:[resolve(root)],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true}:{type:'dangerFullAccess'}};
}
const samePath=(a:string,b:string)=>resolve(a).toLowerCase()===resolve(b).toLowerCase();
export function permissionMatches(value:{approvalPolicy:unknown;approvalsReviewer:unknown;sandboxPolicy:unknown},preset:PermissionPreset,root:string):boolean{
 const request=permissionRequest(preset,root),sandbox=value.sandboxPolicy as SandboxPolicy|undefined;
 if(value.approvalPolicy!==request.approvalPolicy||value.approvalsReviewer!=='user'||!sandbox||sandbox.type!==request.sandboxPolicy.type)return false;
 if(sandbox.type==='dangerFullAccess')return true;
 if(sandbox.type==='readOnly')return sandbox.networkAccess===false;
 return sandbox.type==='workspaceWrite'&&sandbox.networkAccess===false&&sandbox.excludeTmpdirEnvVar===true&&sandbox.excludeSlashTmp===true&&Array.isArray(sandbox.writableRoots)&&sandbox.writableRoots.length===1&&typeof sandbox.writableRoots[0]==='string'&&samePath(sandbox.writableRoots[0],root);
}
export function permissionReceipt(value:{approvalPolicy:unknown;approvalsReviewer:unknown;sandboxPolicy:unknown},root:string,source:PermissionReceipt['source']):PermissionReceipt{
 const preset=PRESETS.find(p=>permissionMatches(value,p.preset,root)),sandbox=value.sandboxPolicy as SandboxPolicy|undefined;
 return {preset:preset?.preset,label:preset?.title??'自定义／未核对',approval:typeof value.approvalPolicy==='string'?value.approvalPolicy:'自定义／未知',reviewer:typeof value.approvalsReviewer==='string'?value.approvalsReviewer:'未知',network:sandbox?.type==='dangerFullAccess'?true:sandbox&&(sandbox.type==='readOnly'||sandbox.type==='workspaceWrite')?sandbox.networkAccess:null,source};
}
type Constraints={approvals:unknown[]|null;sandboxes:string[]|null;profiles:Record<string,boolean>|null};
/** Public metadata only. Catalog availability never grants permission or changes config. */
export class PermissionCatalog{
 private generation=0;private loading=false;private complete=false;private stale=false;private error='';private options:PermissionOption[]=[];
 constructor(private rpc:Transport,private root:string){}
 snapshot(){return structuredClone({generation:this.generation,loading:this.loading,complete:this.complete,stale:this.stale,error:this.error,options:this.options});}
 invalidate(reason:string){this.generation++;this.loading=false;this.complete=false;this.stale=true;this.error=reason;}
 private async metadata(method:'configRequirements/read'|'permissionProfile/list',params:any):Promise<any>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([this.rpc.request(method,params),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('权限目录查询超过15秒，未改变权限')),15000);})]);}finally{clearTimeout(timer);}}
 async refresh(current:()=>boolean=()=>true){const generation=++this.generation,valid=()=>generation===this.generation&&current();this.loading=true;this.complete=false;this.error='';
  try{
   const constraintsPromise=this.metadata('configRequirements/read',{});const profilesPromise=(async()=>{const rows:{id:string;description:string|null;allowed:boolean}[]=[],seen=new Set<string>(),cursors=new Set<string>();let cursor:string|undefined;
    for(let page=0;page<8;page++){const response=await this.metadata('permissionProfile/list',{cwd:this.root,limit:100,...(cursor?{cursor}:{})});if(!valid())throw Error('权限目录身份已失效');if(!Array.isArray(response?.data)||response.data.length>100||!Object.hasOwn(response,'nextCursor'))throw Error('权限目录返回不完整');
     for(const row of response.data){if(!row||typeof row.id!=='string'||!row.id||row.id.length>256||/[\x00-\x1f\x7f]/.test(row.id)||seen.has(row.id)||typeof row.allowed!=='boolean'||row.description!==null&&(typeof row.description!=='string'||row.description.length>2000))throw Error('权限目录条目无法核对');seen.add(row.id);rows.push(row);}
     if(response.nextCursor===null)return rows;if(typeof response.nextCursor!=='string'||!response.nextCursor||response.nextCursor.length>4096||cursors.has(response.nextCursor)||!response.data.length)throw Error('权限目录分页无法核对');cursors.add(response.nextCursor);cursor=response.nextCursor;
    }throw Error('权限目录超过8页，未发布不完整选项');})();
   const results=await Promise.allSettled([constraintsPromise,profilesPromise]);if(!valid())throw Error('权限目录身份已失效');for(const result of results)if(result.status==='rejected')throw result.reason;
   const requirements=(results[0] as PromiseFulfilledResult<any>).value,rows=(results[1] as PromiseFulfilledResult<{id:string;description:string|null;allowed:boolean}[]>).value;
   if(!requirements||!Object.hasOwn(requirements,'requirements'))throw Error('权限约束返回不完整');const raw=requirements.requirements;let limits:Constraints={approvals:null,sandboxes:null,profiles:null};
   if(raw!==null){if(!raw||typeof raw!=='object'||!['allowedApprovalPolicies','allowedSandboxModes','allowedPermissionProfiles'].every(key=>Object.hasOwn(raw,key)))throw Error('权限约束返回不完整');if(raw.allowedApprovalPolicies!==null&&!Array.isArray(raw.allowedApprovalPolicies)||raw.allowedSandboxModes!==null&&(!Array.isArray(raw.allowedSandboxModes)||!raw.allowedSandboxModes.every((x:unknown)=>typeof x==='string'))||raw.allowedPermissionProfiles!==null&&(!raw.allowedPermissionProfiles||Array.isArray(raw.allowedPermissionProfiles)||typeof raw.allowedPermissionProfiles!=='object'||!Object.values(raw.allowedPermissionProfiles).every(x=>typeof x==='boolean')))throw Error('权限约束格式无法核对');limits={approvals:raw.allowedApprovalPolicies,sandboxes:raw.allowedSandboxModes,profiles:raw.allowedPermissionProfiles};}
   this.options=PRESETS.map(p=>{const row=rows.find(x=>x.id===p.id),reason=!row?'后端未列出此档位':!row.allowed?'后端禁止此档位':limits.profiles&&limits.profiles[p.id]!==true?'管理策略未允许此档位':limits.sandboxes&&!limits.sandboxes.includes(p.mode)?'管理策略限制此沙箱':limits.approvals&&!limits.approvals.includes(p.approval)?'管理策略限制此审批方式':'';return{preset:p.preset,id:p.id,title:p.title,description:p.description,available:!reason,reason};});
   for(const row of rows)if(!PRESETS.some(p=>p.id===row.id))this.options.push({id:row.id,title:row.id,description:row.description??'自定义后端权限配置',available:false,reason:row.allowed?'当前公开调用未接入此自定义配置的应用字段':'后端禁止此配置'});
   this.complete=true;this.stale=false;
  }catch(error){if(valid()){this.complete=false;this.stale=true;this.error=error instanceof Error?error.message:'权限目录未核对';}throw error;}finally{if(generation===this.generation)this.loading=false;}
 }
 require(preset:PermissionPreset){if(!validPermissionPreset(preset))throw Error('权限档位无效');if(this.loading||!this.complete||this.stale)throw Error(this.error||'权限目录未完整核对；当前权限未改变');const option=this.options.find(p=>p.preset===preset);if(!option?.available)throw Error(option?.reason||'此权限档位不可用');return option;}
}
