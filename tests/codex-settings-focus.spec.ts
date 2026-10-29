// @vitest-environment happy-dom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DisplaySettingsPanel} from '../src/codex-prototype/display/settings-panel';
import {DISPLAY_DEFAULTS} from '../src/codex-prototype/display-settings';

let panel:DisplaySettingsPanel|undefined;
// happy-dom does not expose the browser's Option constructor.
beforeEach(()=>vi.stubGlobal('Option',function(text:string,value:string,defaultSelected=false,selected=false){const option=document.createElement('option');option.text=text;option.value=value;option.defaultSelected=defaultSelected;option.selected=selected;return option;}));
afterEach(()=>{panel?.dispose();panel=undefined;document.body.replaceChildren();vi.useRealTimers();vi.unstubAllGlobals();});
describe('settings retry keeps keyboard focus within the dialog',()=>{
 it.each([false,true])('preserves focus through a timed-out retry with prior settings %s',async loaded=>{
  vi.useFakeTimers();document.body.innerHTML='<header><button id="settingsOpen">设置</button></header>';
  const messages=new EventTarget(),posts:any[]=[];
  panel=new DisplaySettingsPanel({messages,postMessage:(m:any)=>posts.push(m)} as any,()=>{});
  if(loaded)messages.dispatchEvent(new MessageEvent('message',{data:{type:'display-settings',id:0,ok:true,copySettings:DISPLAY_DEFAULTS}}));
  panel.open();await vi.advanceTimersByTimeAsync(5000);
  const retry=document.getElementById('settingsRetry') as HTMLButtonElement;
  expect(retry.disabled).toBe(false);retry.focus();expect(document.activeElement).toBe(retry);retry.click();
  expect(posts.at(-1).type).toBe('settings-read');
  expect(document.activeElement).toBe(document.getElementById('settingsClose'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(document.getElementById('settingsPanel')!.contains(document.activeElement)).toBe(true);
  expect(retry.disabled).toBe(false);
 });
});
