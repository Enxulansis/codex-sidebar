import type {Transport} from './rpc';
import type {DisplayStateStorage} from './display-settings';
import type {CollaborationMode} from './protocol/CollaborationMode';
import type {CollaborationModeMask} from './protocol/v2/CollaborationModeMask';
import type {ModelChoice} from './model-selection';

export type ChatMode = CollaborationMode['mode'];
export type ModeCatalogState = {modes:{mode:ChatMode;name:string}[];loading:boolean;complete:boolean;error:string;generation:number};
export type ModeSelectionView = ModeCatalogState & {desired:ChatMode;explicit:boolean;canSelect:boolean;saving:boolean;selectionError:string};
export const DAILY_MODE_SELECTION_KEY='codexPrototype.dailyChatModes.v1';
export const validChatMode=(mode:unknown):mode is ChatMode=>mode==='default'||mode==='plan';

/** Presets advertise available modes, never authorize a different model/effort. */
export class ModeCatalog {
  private value:ModeCatalogState={modes:[],loading:false,complete:false,error:'模式目录尚未读取',generation:0};
  private intent=0;
  constructor(private rpc:Pick<Transport,'request'>){}
  snapshot():ModeCatalogState{return structuredClone(this.value);}
  invalidate(error:string){this.value={...this.value,loading:false,complete:false,error,generation:++this.intent};}
  async refresh(current:()=>boolean=()=>true){
    const intent=++this.intent;this.value={...this.value,loading:true,complete:false,error:'',generation:intent};
    try {
      const reply=await this.rpc.request<'collaborationMode/list',{data:CollaborationModeMask[]}>('collaborationMode/list',{});
      if(intent!==this.intent||!current())throw Error('模式目录回执已失效');
      if(!reply||!Array.isArray(reply.data)||!reply.data.length||reply.data.length>16)throw Error('模式目录未完整核对');
      const seen=new Set<ChatMode>();
      const modes=reply.data.map(value=>{
        if(!value||!validChatMode(value.mode)||typeof value.name!=='string'||!value.name.trim()||value.name.length>128||seen.has(value.mode))throw Error('模式目录存在未知或重复标识');
        seen.add(value.mode);return{mode:value.mode,name:value.name};
      });
      this.value={modes,loading:false,complete:true,error:'',generation:intent};
    }catch(error){if(intent===this.intent)this.value={...this.value,loading:false,complete:false,error:error instanceof Error?error.message:'模式目录读取失败'};throw error;}
  }
  require(mode:ChatMode){if(!this.value.complete||this.value.loading||!this.value.modes.some(v=>v.mode===mode))throw Error('所选模式尚未由当前连接核对；请刷新模式目录');}
  request(mode:ChatMode,choice:ModelChoice):CollaborationMode {
    this.require(mode);
    if(!choice.model||!choice.effort)throw Error('切换模式前请明确选择当前模型与思考强度；不会采用模式预设的模型或强度');
    return{mode,settings:{model:choice.model,reasoning_effort:choice.effort as NonNullable<CollaborationMode['settings']['reasoning_effort']>,developer_instructions:null}};
  }
}

type Data={version:1;threads:{id:string;mode:ChatMode}[]};
const validData=(raw:any):raw is Data=>raw?.version===1&&Array.isArray(raw.threads)&&raw.threads.length<=128&&new Set(raw.threads.map((v:any)=>v?.id)).size===raw.threads.length&&raw.threads.every((v:any)=>v&&typeof v.id==='string'&&!!v.id.trim()&&v.id.length<=256&&validChatMode(v.mode));
/** Workspace-local, per-thread intent. Explicit default resets a sticky plan mode. */
export class ModeSelections {
  private data:Data={version:1,threads:[]};private original:unknown;private writing:Data|undefined;private blocked='';private tail:Promise<unknown>=Promise.resolve();private forgotten=new Set<string>();private pending=0;revision=0;
  constructor(private storage:DisplayStateStorage,private key=DAILY_MODE_SELECTION_KEY){const raw=storage.get<unknown>(key,undefined);this.original=structuredClone(raw);if(raw===undefined)return;if(!validData(raw)){this.blocked='模式记录无法读取；原数据保留，未覆盖';return;}this.data=structuredClone(raw);}
  private assert(){if(this.blocked)throw Error(this.blocked);const actual=JSON.stringify(this.storage.get(this.key,undefined));if(actual!==JSON.stringify(this.original)&&(!this.writing||actual!==JSON.stringify(this.writing))){this.blocked='模式记录已变化，请窗口 Reload 后核对；未覆盖';throw Error(this.blocked);}}
  read(thread:string){this.assert();return this.data.threads.find(v=>v.id===thread)?.mode;}
  error(){return this.blocked;}get saving(){return this.pending>0;}
  private change(edit:(data:Data)=>void,current:()=>boolean){
    this.pending++;const task=this.tail.then(async()=>{if(!current())throw Error('模式选择页面或会话已失效');this.assert();const next=structuredClone(this.data);edit(next);if(!validData(next))throw Error('模式记录无效或超过128会话；未淘汰已有记录');if(!current())throw Error('模式保存前身份已失效');this.writing=next;
      try{await this.storage.update(this.key,next);if(this.blocked||JSON.stringify(this.storage.get(this.key,undefined))!==JSON.stringify(next))throw Error('mode acknowledgement mismatch');this.data=next;this.original=structuredClone(next);this.revision++;}
      catch{this.blocked||='模式保存未确认，请窗口 Reload 后核对；未自动重试';throw Error(this.blocked);}finally{this.writing=undefined;}
    });const settled=task.finally(()=>{this.pending--;});this.tail=settled.catch(()=>{});return settled;
  }
  set(thread:string,mode:ChatMode,current:()=>boolean){return this.change(data=>{if(this.forgotten.has(thread))throw Error('会话模式记录已清理，旧保存失效');data.threads=data.threads.filter(v=>v.id!==thread);data.threads.push({id:thread,mode});},current);}
  forget(thread:string){this.forgotten.add(thread);return this.change(data=>{data.threads=data.threads.filter(v=>v.id!==thread);},()=>true);}
}
