import {workSegments,type WorkRow,type WorkTurn,type WorkSegment,assistantPhaseLabel} from '../work-segments';import type {UserFoldState} from '../user-fold-store';import {selectionDragEnded} from './block-fold';
import {materializeToolCards} from './tool-cards';
import {rowIdentity} from './body-window-units';
const chrome=require('../../webview-chrome.js') as {formatRunDuration:(ms:number)=>string};
export {assistantPhaseLabel};
type FoldState={threadId:string;items:WorkRow[];turns?:WorkTurn[];copySettings?:{workSegments?:boolean;lazyFoldedBodies?:boolean}};
export function foldedWorkItems(state:FoldState,memory:{get:(key:string)=>UserFoldState|undefined}){const ids=new Set<string>();if(state.copySettings?.workSegments===false||state.copySettings?.lazyFoldedBodies===false)return ids;for(const segment of workSegments(state.threadId,state.items,state.turns??[]))if(memory.get(segment.key)!=='expanded')for(const member of segment.members)ids.add(rowIdentity(member.turnId,member.itemId));return ids;}
type WorkMemory={get:(key:string)=>UserFoldState|undefined;save:(key:string,state:UserFoldState)=>Promise<void>};
type WorkBinding={bar:HTMLButtonElement;segment:WorkSegment;rows:HTMLElement[];folded:boolean;valid:()=>boolean;memory:WorkMemory;keepControl:(bar:HTMLElement,change:()=>void)=>void;revision:number;changed?:(()=>void)|undefined};
// A removed bar is not a cache root. Current bars update their row/callback
// binding so an earlier page snapshot is never retained just for its handler.
const workBindings=new WeakMap<HTMLButtonElement,WorkBinding>();
function paintWork(binding:WorkBinding){
 const {bar,rows,segment,folded}=binding;
 for(const row of rows){if(!folded)materializeToolCards(row);if(row.hidden!==folded)row.hidden=folded;if(!row.classList.contains('work-folded'))row.classList.add('work-folded');if(row.dataset.workFoldKey!==segment.key)row.dataset.workFoldKey=segment.key;}
 const time=typeof segment.durationMs==='number'&&Number.isFinite(segment.durationMs)&&segment.durationMs>=1000?' · 回合'+chrome.formatRunDuration(segment.durationMs):'',label=folded?'过程 · '+segment.members.length+' 步'+time:'过程 · 收起',title=folded?'展开过程':'收起过程',expanded=folded?'false':'true';
 if(bar.textContent!==label)bar.textContent=label;if(bar.title!==title)bar.title=title;if(bar.getAttribute('aria-expanded')!==expanded)bar.setAttribute('aria-expanded',expanded);
}
function createWorkBinding(segment:WorkSegment,rows:HTMLElement[],valid:()=>boolean,memory:WorkMemory,keepControl:WorkBinding['keepControl']):WorkBinding{
 const bar=document.createElement('button');bar.type='button';bar.className='work-fold-bar disclosure-toggle';bar.dataset.workKey=segment.key;bar.dataset.workFirstItem=segment.firstItemId;bar.dataset.turnId=segment.turnId;
 const binding:WorkBinding={bar,segment,rows,folded:memory.get(segment.key)!=='expanded',valid,memory,keepControl,revision:0};workBindings.set(bar,binding);
 bar.addEventListener('click',event=>{if(!binding.valid()||!bar.isConnected||selectionDragEnded(event))return;const previous=binding.folded,revision=++binding.revision;binding.folded=!binding.folded;const saved=binding.memory.save(binding.segment.key,binding.folded?'folded':'expanded');binding.keepControl(bar,()=>paintWork(binding));binding.changed?.();void saved.catch(()=>{if(binding.valid()&&bar.isConnected&&revision===binding.revision){const saved=binding.memory.get(binding.segment.key);binding.folded=saved?saved==='folded':previous;binding.keepControl(bar,()=>paintWork(binding));binding.changed?.();}});});return binding;
}
export function applyWorkSegments(history:HTMLElement,state:{threadId:string;items:WorkRow[];turns?:WorkTurn[];copySettings?:{workSegments?:boolean}},valid:()=>boolean,memory:WorkMemory,keepControl:WorkBinding['keepControl'],changed?:()=>void){
 const children=Array.from(history.children) as HTMLElement[],nodes=new Map(children.filter(row=>row.dataset.itemId).map(row=>[rowIdentity(row.dataset.turnId??'',row.dataset.itemId!),row])),bars=new Map(children.filter((row):row is HTMLButtonElement=>row instanceof HTMLButtonElement&&row.classList.contains('work-fold-bar')).map(bar=>[bar.dataset.workKey,bar]));
 const segments=(state.copySettings?.workSegments===false?[]:workSegments(state.threadId,state.items,state.turns??[])).flatMap(segment=>{const rows=segment.members.map(m=>nodes.get(rowIdentity(m.turnId,m.itemId))).filter((row):row is HTMLElement=>!!row);return rows.length?[{segment,rows}]:[];}),activeRows=new Set(segments.flatMap(value=>value.rows));
 for(const row of children)if(row.dataset.workFoldKey&&!activeRows.has(row)){if(row.hidden)row.hidden=false;row.classList.remove('work-folded');delete row.dataset.workFoldKey;}
 for(const {segment,rows}of segments){
  if(!nodes.has(rowIdentity(segment.turnId,segment.firstItemId))){for(const row of rows){row.hidden=memory.get(segment.key)!=='expanded';row.dataset.workFoldKey=segment.key;row.classList.add('work-folded');}continue;}
  const previous=bars.get(segment.key);let binding=previous?workBindings.get(previous):undefined;
  if(!binding){previous?.remove();binding=createWorkBinding(segment,rows,valid,memory,keepControl);}
  else{binding.segment=segment;binding.rows=rows;binding.valid=valid;binding.memory=memory;binding.keepControl=keepControl;binding.folded=memory.get(segment.key)!=='expanded';}
  binding.changed=changed;if(binding.bar.nextElementSibling!==rows[0])history.insertBefore(binding.bar,rows[0]!);paintWork(binding);bars.delete(segment.key);
 }
 for(const bar of bars.values())bar.remove();
}
export const WORK_SEGMENT_STYLE=`
    .work-folded[hidden] { display: none; }
    .work-fold-bar { display: block; width: 100%; margin: 6px 0 4px; padding: 4px 9px; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 20%, transparent); border-radius: 4px 4px 0 0; background: color-mix(in srgb, var(--vscode-foreground) 7%, transparent); color: var(--vscode-foreground); font-size: 12px; line-height: 18px; text-align: left; cursor: pointer; }
    .work-fold-bar:hover { background: color-mix(in srgb, var(--vscode-foreground) 13%, transparent); }
    .work-fold-bar { box-sizing: border-box; }
    #history > .work-fold-bar { max-width: var(--content-max,760px); margin-inline: auto; }
`;
