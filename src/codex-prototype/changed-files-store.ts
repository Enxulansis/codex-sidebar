import {WorkFoldStore} from './work-fold-store';
import {changedFiles,changedFilesFoldKey,CHANGED_FILES_FOLD_KEY} from './changed-files';
import type {DisplayStateStorage} from './display-settings';import type {PageRow,WorkTurn} from './page-model';
export class ChangedFilesStore extends WorkFoldStore{constructor(storage:DisplayStateStorage){super(storage,CHANGED_FILES_FOLD_KEY);}}
type Owner={threadId:string;connectionId:number;items:PageRow[];turns:WorkTurn[]};
export function changedFilesFoldMatches(m:any,owner:Owner|undefined){if(!owner||m.threadId!==owner.threadId||m.connectionId!==owner.connectionId)return false;const {groups}=changedFiles(owner.items,owner.turns);return groups.length>0&&m.key===changedFilesFoldKey(owner.threadId,groups);}
export async function handleChangedFilesFold(store:ChangedFilesStore,m:any,post:(m:any)=>unknown,owner:()=>Owner|undefined,active:()=>boolean,remember:()=>boolean){
 if(!['changed-files-fold-read','changed-files-fold-save'].includes(m?.type))return false;if(!active())return true;
 if(m.type==='changed-files-fold-read'){const records=await store.load();if(active())await post({type:'changed-files-folds',readId:m.readId,records});return true;}if(!Number.isSafeInteger(m.id)||m.id<1)return true;
 let ok=false;try{await store.set(m.key,m.state,()=>active()&&remember()&&changedFilesFoldMatches(m,owner()));ok=active()&&changedFilesFoldMatches(m,owner());}catch{}
 if(active())await post({type:'changed-files-fold-saved',id:m.id,key:m.key,state:m.state,threadId:m.threadId,connectionId:m.connectionId,ok});return true;
}
