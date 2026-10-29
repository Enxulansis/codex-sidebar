import type {Store} from './storage';

/** Session ownership and dispatch are separate from starting a restricted connection. */
export type SessionStore=Pick<Store,'read'|'hasAttempts'|'dispatchReason'|'reserve'|'record'|'own'|'select'|'clearSelection'|'pending'|'clearPending'|'invalidate'>;
export const CONNECTION_ONLY_REASON='未配置发送额度，发送禁用；连接仅核对后端状态，本地草稿可继续编辑';

/** No ledger is created, imported or reset. This connection owns no chat threads. */
export function connectionOnlyStore():SessionStore{
  const denied=():never=>{throw Error(CONNECTION_ONLY_REASON);};
  return{
    read:()=>({attempts:[],threads:[]}),
    hasAttempts:()=>false,
    dispatchReason:()=>CONNECTION_ONLY_REASON,
    reserve:denied,record:denied,own:denied,select:denied,clearSelection:denied,
    pending:denied,clearPending:denied,
    invalidate:()=>[],
  };
}
