import type {Session} from './session';import {validPermissionPreset,type PermissionOption} from './permission-selection';
type Owner={session:Session;connectionId:number};
/** Only an explicit user choice can request a higher next-turn policy. Never writes global config. */
export class PermissionSelectionHost{
 private last=0;private busy=false;
 constructor(private owner:()=>Owner|undefined,private current:()=>boolean,private confirm:(option:PermissionOption)=>Promise<boolean>){}
 async handle(message:any,post:(value:object)=>unknown):Promise<boolean>{
  if(message?.type!=='permission-selection')return false;if(!this.current()||!Number.isSafeInteger(message.id)||message.id<1||message.id<=this.last)return true;this.last=message.id;
  const owner=this.owner(),thread=owner?.session.projection.threadId,live=()=>{const now=this.owner();return this.current()&&now?.session===owner?.session&&now?.connectionId===owner?.connectionId&&now?.session.projection.threadId===thread;};
  try{if(!owner||message.threadId!==thread||message.connectionId!==owner.connectionId||!live())throw Error('权限选择线程、连接或页面已失效');if(this.busy)throw Error('上一项权限操作尚未确认');this.busy=true;
   let canceled=false;try{if(message.action==='refresh')await owner.session.refreshPermissions(live);else if(message.action==='select'){
     if(!validPermissionPreset(message.preset))throw Error('权限档位无效');const view=owner.session.permissionView();if(!view.canSelect)throw Error('当前回合或恢复状态不允许改档');const option=owner.session.permissions.require(message.preset);
     if(message.preset!=='read-only'&&message.preset!==view.desired&&!await this.confirm(option))canceled=true;
     if(!live())throw Error('确认期间会话已变化，权限未改变');if(!canceled)owner.session.selectNextPermission(message.preset,live);
    }else throw Error('权限操作无效');if(live())await post({type:'permission-selection-result',id:message.id,threadId:thread,connectionId:owner.connectionId,ok:true,canceled,permissionSelection:owner.session.permissionView()});
   }finally{this.busy=false;}
  }catch(error){if(live())await post({type:'permission-selection-result',id:message.id,threadId:thread,connectionId:owner?.connectionId,ok:false,error:error instanceof Error?error.message:'权限选择未确认',permissionSelection:owner?.session.permissionView()});}return true;
 }
}
