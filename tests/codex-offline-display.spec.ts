import {describe,it,expect} from 'vitest';
import {Replay} from '../src/codex-prototype/offline/replay';
import {FINAL_MARKDOWN,TIMELINES} from '../src/codex-prototype/offline/fixtures';
import {safeImageSource} from '../src/codex-prototype/display/image-preview';
import {offlineHtml} from '../src/codex-prototype/offline/html';
import {readFileSync} from 'node:fs';
describe('offline display — synthetic events, no server or model',()=>{
 it('authoritative completion replaces streaming body and rejects late deltas',()=>{const r=new Replay();r.select('offline-alpha');for(const e of TIMELINES['offline-alpha']!)r.apply(e);expect([...r.messages.values()].find(m=>m.role==='assistant')?.text).toBe(FINAL_MARKDOWN);r.apply({method:'item/agentMessage/delta',params:{threadId:'offline-alpha',turnId:'turn-1',itemId:'same-message-id',delta:'late'}});expect([...r.messages.values()].find(m=>m.role==='assistant')?.text).toBe(FINAL_MARKDOWN);});
 it('same message IDs in different threads and turns stay isolated',()=>{const r=new Replay();r.select('offline-alpha');for(const e of TIMELINES['offline-alpha']!)r.apply(e);r.select('offline-beta');for(const e of TIMELINES['offline-beta']!)r.apply(e);for(const e of TIMELINES['offline-alpha']!)r.apply(e);expect(r.messages.size).toBe(2);expect([...r.messages.values()].every(m=>m.threadId==='offline-beta')).toBe(true);expect([...r.messages.values()].find(m=>m.role==='assistant')?.text).toContain('B-only');r.apply({method:'item/started',params:{threadId:'offline-beta',turnId:'turn-2',itemId:'same-message-id',role:'assistant',text:'new turn'}});expect(r.messages.size).toBe(3);});
 it('reset discards body and does not import approvals or RPC identities',()=>{const r=new Replay();r.select('offline-alpha');for(const e of TIMELINES['offline-alpha']!)r.apply(e);r.select('offline-alpha');expect(r.messages.size).toBe(0);expect(JSON.stringify(TIMELINES)).not.toMatch(/requestApproval|requestId|bearer|C:\\\\Users/);});
 it.each(['https://example.invalid/image.png','file:///outside.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,@@@','command:execute'])('rejects nonlocal or unsupported image source %s',src=>{expect(safeImageSource(src)).toBeUndefined();});
 it('accepts only PNG/JPEG previews within the existing 5 MiB byte limit',()=>{expect(safeImageSource('data:image/png;base64,iVBORw0KGgo=')).toBeTruthy();expect(safeImageSource('data:image/jpeg;base64,/9j/')).toBeTruthy();expect(safeImageSource('data:image/png;base64,'+'A'.repeat(6_990_512))).toBeUndefined();expect(safeImageSource('data:image/png;base64,ABC')).toBeUndefined();});
 it('offline document denies connections, commands, external images and script breakout',()=>{const h=offlineHtml('const a="</script>";','console.log("offline");','test');expect(h).toContain("connect-src 'none'");expect(h).toContain('img-src data:');expect(h).toContain("base-uri 'none'");expect(h).not.toContain('img-src https:');expect((h.match(/<\/script>/g)??[])).toHaveLength(2);expect(h).not.toContain('acquireVsCodeApi');});
 it('keeps the demo separate and acquires no execution authority on ordinary page ready',()=>{
  const s=readFileSync(new URL('../src/codex-prototype/extension.ts',import.meta.url),'utf8'),connect=s.indexOf('async function connect()');
  // Daily drafts require the local workspace identity; the old early return to
  // a demo is intentionally gone. Real activation behavior is in sidebar-lifecycle.
  expect(connect).toBeGreaterThan(0);expect(s.slice(0,connect)).not.toMatch(/new Store|Rpc\.start|\.preflight\(/);
  expect(s).toContain("process.env['CODEX_PROTOTYPE_MODE']==='online'?process.env['CODEX_PROTOTYPE_RUN']:undefined");
  expect(s).toContain('const batch=root&&run?displayBatch(run,root):undefined');
  // Only the explicit daily store auto-connects on ready. Connection alone does
  // not dispatch a model turn; the ordinary/demo lifecycle remains inactive.
  expect(s).toContain("case 'ready': pageReady=true;if(dailyStore&&!connectionAttempted)void connect();break;");
  expect(s.indexOf('if(!root)',connect)).toBeGreaterThan(connect);expect(s.indexOf('if(!root)',connect)).toBeLessThan(s.indexOf('await Rpc.start(',connect));
  expect(s).toContain("await Rpc.start(root!,!!store,!!modeSelections,dailyStore?join(context.extensionPath,'dist/workspace-files-mcp.cjs'):undefined)");expect(s).toContain('store??connectionOnlyStore()');expect(s).toContain('if(!store){await reply(false);throw Error(CONNECTION_ONLY_REASON);}');
  expect(s).toContain('registerOfflinePanel(context,displaySettings,blockFolds,userFolds,false,');
  const demo=readFileSync(new URL('../src/codex-prototype/offline/panel.ts',import.meta.url),'utf8');expect(demo).not.toMatch(/Rpc\.start|new Session|\.preflight\(/);expect(demo).toContain("registerCommand('codexPrototype.openOffline',open)");
 });
});
