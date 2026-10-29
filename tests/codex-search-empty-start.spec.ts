import {describe, it, expect, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Session} from '../src/codex-prototype/session';
import {Store} from '../src/codex-prototype/storage';
import {ThreadSearch} from '../src/codex-prototype/thread-search';
import {SearchCache} from '../src/codex-prototype/search-cache';
import {RpcRequestRejected, type Transport} from '../src/codex-prototype/rpc';
import {DISABLED_MCP, DISABLED_PLUGINS} from '../src/codex-prototype/tools';
import type {Thread} from '../src/codex-prototype/protocol/v2/Thread';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'codex-search-empty-'));
  const root = join(dir, 'workspace'); mkdirSync(root);
  const empty = {id: 'fresh', cwd: root, historyMode: 'paginated', status: {type: 'idle'}, turns: []} as unknown as Thread;
  const turn = {id: 'turn', status: 'completed', itemsView: 'full', error: null,
    items: [{id: 'answer', type: 'agentMessage', text: 'needle', phase: 'final_answer'}]};
  let materialized = false;
  const rpc = Object.assign(new EventEmitter(), {
    request: vi.fn(async (method: string, params: any): Promise<any> => {
      if (method === 'config/read') return {config: {features: {apps: false}, apps: {_default: {enabled: false}},
        mcp_servers: Object.fromEntries(DISABLED_MCP.map(n => [n, {enabled: false}])),
        plugins: Object.fromEntries(DISABLED_PLUGINS.map(n => [n, {enabled: false}]))}};
      if (method === 'mcpServerStatus/list') return {data: DISABLED_MCP.map(name => ({name, runtimeStatus: 'disabled', tools: {}, toolsError: null, resources: [], resourceTemplates: []})), nextCursor: null};
      if (method === 'thread/start') return {thread: structuredClone(empty), cwd: root, model: 'gpt-6-luna', approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: {type: 'readOnly', networkAccess: false}};
      if (method === 'turn/start') return {turn: {...turn, status: 'inProgress', items: []}};
      if (params.threadId !== 'fresh') throw new RpcRequestRejected('thread not loaded: ' + params.threadId);
      if (method === 'thread/read') return {thread: structuredClone(empty)};
      if (method === 'thread/turns/list') {
        if (!materialized) throw new RpcRequestRejected('thread fresh is not materialized yet; thread/turns/list is unavailable before first user message');
        return {data: [turn], nextCursor: null, backwardsCursor: 'back'};
      }
      throw Error('Unexpected fixture request: ' + method);
    }),
    respond: vi.fn(), reject: vi.fn(), dispose: vi.fn(async () => {})
  });
  const store = new Store(join(dir, 'ledger.json'));
  const session = new Session(rpc as unknown as Transport, root, store);
  const data = new Map<string, unknown>();
  const storage = {get: <T>(key: string, fallback: T) => (data.get(key) ?? fallback) as T,
    update: vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); })};
  return {root, empty, turn, rpc, store, session, storage, materialize: () => { materialized = true; }};
}
async function all(search: ThreadSearch) {
  for (let i = 0; i < 30 && search.snapshot().hasMore; i++) await search.runBatch();
  expect(search.snapshot().done).toBe(true);
}

describe('search coverage of live never-sent native threads', () => {
  it('counts the current verified start receipt as an empty thread without invoking unavailable pagination', async () => {
    const f = fixture(); await f.session.newThread(); f.rpc.request.mockClear();
    await f.session.searchHistory('needle', 'thread', false, 1, () => true);
    expect(f.session.search.snapshot()).toMatchObject({complete: true, totalThreads: 1, scannedThreads: 1, scannedTurns: 0, failures: [], hits: []});
    expect(f.rpc.request).not.toHaveBeenCalled();
  });
  it('retains an unknown old source failure while counting the live empty source in the same workspace scope', async () => {
    const f = fixture(); await f.session.newThread(); f.store.own('old'); f.rpc.request.mockClear();
    await f.session.searchHistory('needle', 'workspace', false, 2, () => true);
    expect(f.session.search.snapshot()).toMatchObject({complete: false, totalThreads: 2, scannedThreads: 2, failures: [{threadId: 'old', reason: 'thread not loaded: old'}]});
    expect(f.rpc.request.mock.calls.map(([, p]) => p.threadId)).toEqual(['old']);
  });
  it('does not infer emptiness from a metadata read with an empty turns array', async () => {
    const f = fixture(); f.materialize();
    const search = new ThreadSearch(f.rpc as unknown as Transport, f.root);
    search.start('needle', ['fresh'], 'thread', false, () => true); await all(search);
    expect(search.snapshot()).toMatchObject({complete: true, scannedTurns: 1, hits: [{itemId: 'answer'}]});
    expect(f.rpc.request.mock.calls.map(([m]) => m)).toEqual(['thread/read', 'thread/turns/list']);
  });
  it.each(['workspace', 'identity', 'active', 'content'])('rejects a contradictory %s start proof rather than hiding history', async kind => {
    const f = fixture(), empty = structuredClone(f.empty);
    if (kind === 'workspace') empty.cwd = join(f.root, 'other');
    if (kind === 'identity') empty.id = 'other';
    if (kind === 'active') empty.status = {type: 'active', activeFlags: []};
    if (kind === 'content') empty.turns = [f.turn as any];
    const search = new ThreadSearch(f.rpc as unknown as Transport, f.root, undefined, () => empty);
    search.start('needle', ['fresh'], 'thread', false, () => true); await all(search);
    expect(search.snapshot()).toMatchObject({complete: false, hits: [], scannedThreads: 1});
    expect(search.snapshot().failures).toHaveLength(1);
    expect(f.rpc.request).not.toHaveBeenCalled();
  });
  it('does not persist a live empty receipt as recoverable search history or overwrite a conflicting cached body', async () => {
    const f = fixture(), cache = new SearchCache(f.storage, f.root);
    const search = new ThreadSearch(f.rpc as unknown as Transport, f.root, cache, () => f.empty);
    search.start('needle', ['fresh'], 'thread', false, () => true); await all(search);
    expect(search.snapshot().complete).toBe(true); expect(f.storage.update).not.toHaveBeenCalled();
    const capture = cache.begin('fresh', 'prior content'); capture.entry('prior', 'item', [{kind: '正文', text: 'needle'}]);
    await cache.save(capture, () => true); const before = cache.read('fresh');
    search.start('needle', ['fresh'], 'thread', false, () => true); await all(search);
    expect(search.snapshot()).toMatchObject({complete: false, hits: [{cached: true}]});
    expect(search.snapshot().failures[0].reason).toContain('空会话');
    expect(cache.read('fresh')).toEqual(before);
  });
  it('falls back to public pages if activity revokes the proof before the empty result commits', async () => {
    const f = fixture(); f.materialize(); let reads = 0;
    const search = new ThreadSearch(f.rpc as unknown as Transport, f.root, undefined, () => ++reads === 1 ? f.empty : undefined);
    search.start('needle', ['fresh'], 'thread', false, () => true); await all(search);
    expect(search.snapshot()).toMatchObject({complete: true, scannedTurns: 1, hits: [{itemId: 'answer'}]});
  });
  it.each(['turn/started', 'thread/status/changed'])('revokes a live empty proof on %s and makes the old query stale', async method => {
    const f = fixture(); await f.session.newThread(); await f.session.searchHistory('needle', 'thread', false, 1, () => true);
    f.materialize(); f.rpc.emit('notification', {method, params: {threadId: 'fresh', turn: f.turn, status: {type: 'active', activeFlags: []}}});
    expect(f.session.search.snapshot()).toMatchObject({stale: true, complete: false});
    await f.session.searchHistory('needle', 'thread', false, 2, () => true);
    expect(f.session.search.snapshot()).toMatchObject({complete: true, scannedTurns: 1, hits: [{itemId: 'answer'}]});
  });
  it('invalidates the empty search result when a send is reserved, before the backend emits any content notification', async () => {
    const f = fixture(); await f.session.newThread(); await f.session.searchHistory('needle', 'thread', false, 1, () => true);
    await f.session.send('Non-sensitive fixture send');
    expect(f.session.search.snapshot()).toMatchObject({stale: true, complete: false});
    f.materialize(); await f.session.searchHistory('needle', 'thread', false, 2, () => true);
    expect(f.session.search.snapshot().hits).toMatchObject([{itemId: 'answer'}]);
  });
  it('does not carry a live empty receipt across a disconnect or replacement Session', async () => {
    const f = fixture(); await f.session.newThread(); await f.session.searchHistory('needle', 'thread', false, 1, () => true);
    f.rpc.emit('disconnect', Error('Own test connection closed'));
    expect(f.session.search.snapshot().complete).toBe(false);
    const replacement = new Session(f.rpc as unknown as Transport, f.root, f.store);
    replacement.projection.snapshot(f.empty);
    await replacement.searchHistory('needle', 'thread', false, 2, () => true);
    expect(replacement.search.snapshot()).toMatchObject({complete: false, failures: [{threadId: 'fresh'}]});
    expect(f.rpc.request.mock.calls.some(([m]) => m === 'thread/resume')).toBe(false);
  });
});
