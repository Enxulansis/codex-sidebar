import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { readFile, realpath, stat, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename } from 'node:path';

export const REAL_TURN_LIMIT = 12;
export type Attempt = {id: string; threadId: string; purpose: string; reservedAt: string; turnId?: string; status?: string; usage?: unknown};
export type PendingApproval = {threadId: string; turnId: string; kind: string};
export type InvalidatedApproval = PendingApproval & {reason: string; at: string};
export type LedgerData = {attempts: Attempt[]; threads: string[]; selected?: string; pendingApprovals?: PendingApproval[]; invalidatedApprovals?: InvalidatedApproval[]};
export type StorePolicy = {validate(data:LedgerData):void;blockedReason(data:LedgerData,purpose:string):string};
const reservationIdentity=({id,threadId,purpose,reservedAt}:Attempt)=>({id,threadId,purpose,reservedAt});
export class StoreLockedError extends Error {
  readonly code='EEXIST';
  constructor(readonly lockPath:string){super('会话记录正在被另一实例写入，或上次异常退出留下了锁；本次未写入、未重建记录。请先关闭使用此资料的全部侧栏实例；若仍受阻，保留记录和锁文件交由离线核验，不要在实例运行时删除锁。锁文件：'+lockPath);this.name='StoreLockedError';}
}
/** Task-owned ledger, shared across Reloads and hosts; never silently resets. */
export class Store {
  constructor(readonly path: string, readonly limit:number|null = REAL_TURN_LIMIT, private readonly priorAttemptThreads: readonly string[] = [],private readonly policy?:StorePolicy) { mkdirSync(dirname(path), {recursive: true}); }
  hasAttempts(threadId: string): boolean { return this.priorAttemptThreads.includes(threadId) || this.read().attempts.some(a => a.threadId === threadId); }
  read(): LedgerData {
    if (!existsSync(this.path)) {if(this.policy)throw Error('验收账本缺失；禁止重建额度或发送');return {attempts: [], threads: []};}
    const data = JSON.parse(readFileSync(this.path, 'utf8')) as LedgerData;
    if (!Array.isArray(data.attempts) || !Array.isArray(data.threads)) throw new Error('测试用量记录损坏；停止调用');
    this.policy?.validate(data);return data;
  }
  dispatchReason(purpose='text/tool'):string {return this.policy?.blockedReason(this.read(),purpose)??'';}
  update(fn: (data: LedgerData) => void): LedgerData {
    const lock = this.path + '.lock';
    let fd:number;
    try{fd=openSync(lock,'wx');}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new StoreLockedError(lock);throw error;}
    try {
      const data = this.read(),reserved=this.policy?data.attempts.map(reservationIdentity):undefined;fn(data);
      if(reserved&&(data.attempts.length<reserved.length||reserved.some((value,index)=>JSON.stringify(value)!==JSON.stringify(reservationIdentity(data.attempts[index]!)))))throw Error('不能删除、重排或替换已预留的验收额度');
      this.policy?.validate(data);
      const next = this.path + '.next';
      writeFileSync(next, JSON.stringify(data, null, 2), 'utf8'); renameSync(next, this.path); return data;
    } finally { closeSync(fd); unlinkSync(lock); }
  }
  reserve(threadId: string, purpose: string): string {
    const id = randomUUID();
    this.update(data => {
      if (!data.threads.includes(threadId)) throw new Error('只允许本任务新建的线程');
      if (this.limit!==null&&data.attempts.length >= this.limit) throw new Error(`本批 ${this.limit} 次真实轮次预算已用尽`);
      const blocked=this.policy?.blockedReason(data,purpose);if(blocked)throw Error(blocked);
      data.attempts.push({id, threadId, purpose, reservedAt: new Date().toISOString()});
      data.selected = threadId;
    });
    return id;
  }
  record(id: string, values: Partial<Attempt>): void {
    this.update(data => { const item = data.attempts.find(a => a.id === id); if (item) Object.assign(item, values); });
  }
  // An empty thread has no durable runtime history yet. Keep ownership without
  // replacing the last recoverable selection until an explicit send is reserved.
  own(threadId: string): void { this.update(data => { if (!data.threads.includes(threadId)) data.threads.push(threadId); }); }
  select(threadId: string): void { this.update(data => { if (!data.threads.includes(threadId)) throw new Error('无法选择非本任务线程'); data.selected = threadId; }); }
  clearSelection(threadId: string): void { this.update(data => { if (data.selected === threadId) delete data.selected; }); }
  pending(value: PendingApproval): void { this.update(data => { data.pendingApprovals ??= []; if (!data.pendingApprovals.some(v => v.threadId === value.threadId && v.turnId === value.turnId && v.kind === value.kind)) data.pendingApprovals.push(value); }); }
  clearPending(threadId: string, turnId: string): void { this.update(data => { data.pendingApprovals = (data.pendingApprovals ?? []).filter(v => v.threadId !== threadId || v.turnId !== turnId); }); }
  invalidate(threadId: string, reason: string): InvalidatedApproval[] {
    let values: InvalidatedApproval[] = [];
    this.update(data => {
      values = (data.pendingApprovals ?? []).filter(v => v.threadId === threadId).map(v => ({...v, reason, at: new Date().toISOString()}));
      data.invalidatedApprovals = [...(data.invalidatedApprovals ?? []), ...values];
      data.pendingApprovals = (data.pendingApprovals ?? []).filter(v => v.threadId !== threadId);
    });
    return values;
  }
}
export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel));
}
/** Existing ancestors must also stay in root: reject symlink/junction escape, including new files. */
export async function ownedPath(root: string, target: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const path = resolve(root, target);
  if (!isInside(canonicalRoot, path)) throw new Error('路径超出临时测试工作区');
  let ancestor = path;
  while (true) {
    try { if (!isInside(canonicalRoot, await realpath(ancestor))) throw new Error('路径包含工作区外链接'); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; ancestor = dirname(ancestor); }
  }
  return path;
}
export async function imageInput(root: string, path: string): Promise<string> {
  const safe = await ownedPath(root, path);
  const info = await stat(safe);
  if (!info.isFile() || info.size > 5 * 1024 * 1024 || !/\.(png|jpe?g)$/i.test(safe)) throw new Error('原型仅支持工作区内不超过 5 MiB 的 PNG/JPEG');
  const bytes = await readFile(safe);
  const signature = /\.png$/i.test(safe) ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!signature) throw new Error('图片签名不匹配，未发送');
  return safe;
}
export async function assertOwnedWorkspace(root: string): Promise<void> {
  const canonical = await realpath(root);
  if (!isInside(await realpath(tmpdir()), canonical) || !basename(canonical).startsWith('codex-prototype-') || (await readFile(resolve(canonical, '.codex-prototype-owned'), 'utf8')) !== 'restricted-prototype') throw new Error('只允许启动脚本创建的临时工作区');
}

const workspaceFileAccess=new Map<string,()=>Promise<void>>();
const workspaceKey=(root:string)=>process.platform==='win32'?resolve(root).toLowerCase():resolve(root);
/** File access in an explicitly selected daily workspace. This grants no RPC or tool authority. */
export async function authorizeWorkspaceFiles(root:string,verify:()=>unknown){
  const key=workspaceKey(root),canonical=await realpath(root),initial=await lstat(root,{bigint:true});
  if(initial.isSymbolicLink()||!initial.isDirectory()||initial.ino<=0n||workspaceKey(canonical)!==key)throw Error('附件工作区不是可核验的普通目录，未启用附件');
  if(workspaceFileAccess.has(key))throw Error('附件工作区已经由其他实例管理');
  let active=true;
  const check=async()=>{
    if(!active)throw Error('附件工作区已关闭');
    await verify();const info=await lstat(root,{bigint:true});
    if(!active||info.isSymbolicLink()||!info.isDirectory()||info.dev!==initial.dev||info.ino!==initial.ino||workspaceKey(await realpath(root))!==workspaceKey(canonical))throw Error('附件工作区身份已改变，未读取或清理');
  };
  await check();workspaceFileAccess.set(key,check);
  return {dispose(){active=false;if(workspaceFileAccess.get(key)===check)workspaceFileAccess.delete(key);}};
}
/** Experimental callers still require their marker; daily callers need an active host-owned registration. */
export async function assertWorkspaceFiles(root:string){
  const check=workspaceFileAccess.get(workspaceKey(root));
  if(check)await check();else await assertOwnedWorkspace(root);
}
