import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {DisplaySettingsStore,DISPLAY_DEFAULTS,DISPLAY_SETTINGS_KEY,handleDisplaySettings,normalizeDisplaySettings} from '../src/codex-prototype/display-settings';
function fixture(){const values=new Map<string,unknown>([[DISPLAY_SETTINGS_KEY,{sessionTabMinWidth:148,hoverActions:false,mathButtons:false}]]),io={get:<T>(key:string,fallback:T)=>structuredClone(values.get(key)??fallback)as T,update:vi.fn(async(key:string,value:unknown)=>{values.set(key,structuredClone(value));})};return{values,io,store:new DisplaySettingsStore(io)};}
describe('independent session-tab button preferences',()=>{
 it('keeps existing button visibility and unrelated saved preferences for older stores',()=>{const f=fixture();expect(f.store.read()).toMatchObject({sessionTabRenameButton:true,sessionTabArchiveButton:true,sessionTabMinWidth:148,hoverActions:false,mathButtons:false});expect(f.io.update).not.toHaveBeenCalled();expect(DISPLAY_DEFAULTS).toMatchObject({sessionTabRenameButton:true,sessionTabArchiveButton:true});});
 it.each([[true,true],[false,true],[true,false],[false,false]])('persists rename=%s archive=%s independently through a new store',async(rename,archive)=>{
  const f=fixture();await f.store.set('ui.sessionTabRenameButton',rename);await f.store.set('ui.sessionTabArchiveButton',archive);
  expect(new DisplaySettingsStore(f.io).read()).toMatchObject({sessionTabRenameButton:rename,sessionTabArchiveButton:archive,sessionTabMinWidth:148,hoverActions:false,mathButtons:false});expect([...f.values.keys()]).toEqual([DISPLAY_SETTINGS_KEY]);
 });
 it.each(['false',0,1,null,undefined,{}])('rejects non-boolean %j without a write',async(value)=>{const f=fixture();await expect(f.store.set('ui.sessionTabRenameButton',value)).rejects.toThrow();await expect(f.store.set('ui.sessionTabArchiveButton',value)).rejects.toThrow();expect(f.io.update).not.toHaveBeenCalled();expect(normalizeDisplaySettings({sessionTabRenameButton:value,sessionTabArchiveButton:value})).toMatchObject({sessionTabRenameButton:true,sessionTabArchiveButton:true});});
 it('returns confirmed values when saving fails without reverting the other preference',async()=>{
  const f=fixture();await f.store.set('ui.sessionTabRenameButton',false);f.io.update.mockRejectedValueOnce(Error('synthetic disk failure'));const post=vi.fn();
  await handleDisplaySettings(f.store,{type:'settings-save',id:2,key:'ui.sessionTabArchiveButton',value:false},post,()=>true);
  expect(post).toHaveBeenCalledWith(expect.objectContaining({id:2,ok:false,copySettings:expect.objectContaining({sessionTabRenameButton:false,sessionTabArchiveButton:true})}));expect(new DisplaySettingsStore(f.io).read()).toMatchObject({sessionTabRenameButton:false,sessionTabArchiveButton:true});
 });
 it('serializes concurrent independent switches and exposes only confirmed values until persisted',async()=>{
  const f=fixture(),update=f.io.update.getMockImplementation()!;let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);f.io.update.mockImplementation(async(k,v)=>{await wait;await update(k,v);});
  const a=f.store.set('ui.sessionTabRenameButton',false),b=f.store.set('ui.sessionTabArchiveButton',false);expect(f.store.read()).toMatchObject({sessionTabRenameButton:true,sessionTabArchiveButton:true});release();await Promise.all([a,b]);expect(new DisplaySettingsStore(f.io).read()).toMatchObject({sessionTabRenameButton:false,sessionTabArchiveButton:false});
 });
 it('does not mutate preferences after the panel owner expires',async()=>{const f=fixture();await expect(f.store.set('ui.sessionTabRenameButton',false,()=>false)).rejects.toThrow();expect(f.io.update).not.toHaveBeenCalled();});
 it('treats both switches as non-body display settings, preserving the message-context key',()=>{
  const source=readFileSync(new URL('../src/codex-prototype/page-entry.ts',import.meta.url),'utf8'),initializer=/^const NON_BODY_SETTINGS=(.*);$/m.exec(source)?.[1];expect(initializer).toBeTruthy();const nonBody=new Function('return '+initializer)()as Set<string>;
  const before=normalizeDisplaySettings({mathButtons:false}),after={...before,sessionTabRenameButton:false,sessionTabArchiveButton:false},body=(s:object)=>JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k])=>!nonBody.has(k))));expect(body(after)).toBe(body(before));expect(body({...before,mathButtons:true})).not.toBe(body(before));
 });
});
