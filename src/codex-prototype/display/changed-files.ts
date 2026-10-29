import {changedFiles,changedFilesFoldKey} from '../changed-files';import type {PageState} from '../page-model';import type {PageHost} from '../page-host';
import {WorkFoldMemory} from './work-fold-memory';import {fileLinkButton,type FileReferenceOptions} from './file-references';import {selectionDragEnded} from './block-fold';
import {validReferencePath} from '../file-reference';
import {changedReviewKey,changedReviewPayload,CHANGED_REVIEW_CAP} from '../changed-review';import {ChangedReviewMemory} from './changed-review-memory';import type {ChangedFile} from '../changed-files';
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,cls:string,text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
/** Original changed-files layout/fold algorithm, with literal public patches and local review metadata. */
export class ChangedFiles{
 private memory:WorkFoldMemory;private review:ChangedReviewMemory;private showReviewed=false;
 private owner='';private expandedDiffs=new Set<string>();
 constructor(host:PageHost,owner:()=>{threadId:string;connectionId:number},private changed:()=>void){this.memory=new WorkFoldMemory(host,owner,changed,'changed-files','变更文件');this.review=new ChangedReviewMemory(host,owner,changed);}
 render(s:PageState,current:()=>boolean,open:(turn:string,item:string)=>FileReferenceOptions['openFile'],keep:(bar:HTMLElement,change:()=>void)=>void){
  const owner=JSON.stringify([s.threadId,s.connectionId]);if(owner!==this.owner){this.owner=owner;this.expandedDiffs.clear();}
  this.memory.configure(s.copySettings?.foldMemory!==false);this.review.configure();const {groups,excluded}=changedFiles(s.items,s.turns);if(!groups.length&&!excluded)return;
  const box=node('section','changed-files'),head=node('div','changed-files-head');head.append(node('span','changed-files-title','变更文件'));box.append(head);
  if(!(s.history?.complete===true&&!s.history.incompleteTurns.length))box.append(node('div','changed-files-note','历史未完整'));
  if(excluded)box.append(node('div','changed-files-note',excluded+' 条变更未计入'));
  const valid=()=>current()&&box.isConnected,pending=node('div','changed-files-note','正在核对补丁身份…');box.append(pending);
  const paint=async()=>{const identities=new Map<ChangedFile,string>();let identityError='';for(const group of groups)for(const file of group.files){try{const bytes=new TextEncoder().encode(changedReviewPayload(file)),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');if(!valid())return;identities.set(file,changedReviewKey(s.threadId,group.turnId,digest));}catch{identityError='部分补丁身份不可核对，未提供其已阅操作';}}if(!valid())return;pending.remove();
  const status=this.review.status(),reviewed=groups.flatMap(g=>g.files).filter(file=>this.review.has(identities.get(file)??'')).length,visibleGroups=groups.map(group=>({...group,files:group.files.filter(file=>this.showReviewed||!this.review.has(identities.get(file)??''))})).filter(group=>group.files.length),allFiles=visibleGroups.flatMap(g=>g.files),unread=groups.flatMap(g=>g.files).map(file=>identities.get(file)).filter((key):key is string=>!!key&&!this.review.has(key));
  const actions=node('div','changed-files-actions'),all=node('button','changed-action changed-review-all','全部标为已阅');all.type='button';all.title='只标记本次已加载且身份可核对的公开补丁，不修改文件';all.disabled=status.disabled||!unread.length||unread.length>CHANGED_REVIEW_CAP;all.onclick=()=>{if(valid())this.review.save(unread,true);};actions.append(all);
  if(reviewed){const show=node('button','changed-action changed-review-toggle',(this.showReviewed?'隐藏':'显示')+'已阅（'+reviewed+'）');show.type='button';show.onclick=()=>{if(valid()){this.showReviewed=!this.showReviewed;this.changed();}};actions.append(show);}head.append(actions);
  if(status.notice||identityError)box.append(node('div','changed-files-note changed-review-status',[status.notice,identityError].filter(Boolean).join('；')));if(unread.length>CHANGED_REVIEW_CAP)box.append(node('div','changed-files-note','已阅批次最多2000项，请逐项标记或缩小已加载范围。'));
  if(!allFiles.length&&groups.length)box.append(node('div','changed-files-note','当前已加载补丁均已阅，可点“显示已阅”恢复查看。'));
  const limit=s.copySettings?.changedFilesLines??6,foldable=s.copySettings?.changedFiles!==false&&allFiles.length>limit,key=changedFilesFoldKey(s.threadId,groups);let folded=foldable&&this.memory.get(key)!=='expanded';
  for(const group of visibleGroups){const section=node('div','changed-turn');section.dataset.turnId=group.turnId;const turnIndex=s.turns?.findIndex(turn=>turn.id===group.turnId)??-1,title=node('div','changed-turn-title',turnIndex>=0?'第 '+(turnIndex+1)+' 回合':'更早的变更');title.title=group.turnId;section.append(title);
   for(const file of group.files){const row=node('div','changed-file'),source=file.sources.at(-1)!,opener=open(group.turnId,source.itemId),path=node('div','changed-file-path'),reviewKey=identities.get(file),reviewed=!!reviewKey&&this.review.has(reviewKey);if(reviewKey)row.dataset.reviewKey=reviewKey;row.dataset.reviewed=String(reviewed);
    const pathNode=(value:string)=>opener&&validReferencePath(value)?fileLinkButton({path:value},value,opener,valid):document.createTextNode(value);path.append(pathNode(file.path));if(file.movePath)path.append(document.createTextNode(' → '),pathNode(file.movePath));
    const stats=node('span','changed-file-stats');if(file.stats)stats.append(node('span','change-additions','+'+file.stats.additions),node('span','change-deletions','−'+file.stats.deletions));else stats.textContent='统计不可用';
    stats.title='补丁累计行数';row.append(path,stats);const details=document.createElement('details'),summary=document.createElement('summary');details.className='changed-file-diffs';summary.className='changed-action';summary.textContent='查看差异'+(file.sources.length>1?' · '+file.sources.length+' 次补丁':'');details.append(summary);let built=false;
    const build=()=>{if(built)return;built=true;for(const [index,patch]of file.sources.entries()){const text=patch.diff.length>100_000?patch.diff.slice(0,100_000)+'\n（差异预览已截断，完整内容见工具卡）':patch.diff||'差异内容未提供';if(file.sources.length>1){const label=node('div','changed-files-note','补丁 '+(index+1));label.title=patch.kind+' · '+patch.itemId;details.append(label);}details.append(node('pre','tool-output',text));}};
    details.open=!!reviewKey&&this.expandedDiffs.has(reviewKey);if(details.open)build();
    summary.addEventListener('click',event=>{if(!valid()){event.preventDefault();return;}if(reviewKey){if(details.open)this.expandedDiffs.delete(reviewKey);else{this.expandedDiffs.add(reviewKey);while(this.expandedDiffs.size>2000)this.expandedDiffs.delete(this.expandedDiffs.values().next().value!);}}if(!details.open)build();});row.append(details);const fileActions=node('div','changed-file-actions'),mark=node('button','changed-action changed-review-mark',reviewed?'标为未阅':'标为已阅');mark.type='button';mark.disabled=status.disabled||!reviewKey;mark.title='标记本地查看状态';mark.onclick=()=>{if(valid()&&reviewKey)this.review.save([reviewKey],!reviewed);};fileActions.append(mark);row.append(fileActions);section.append(row);
   }box.append(section);
  }
  const apply=()=>{let index=0;for(const row of box.querySelectorAll<HTMLElement>('.changed-file'))row.hidden=folded&&index++>=limit;for(const section of box.querySelectorAll<HTMLElement>('.changed-turn'))section.hidden=folded&&[...section.querySelectorAll<HTMLElement>('.changed-file')].every(row=>row.hidden);};
  if(foldable){const more=document.createElement('button');more.type='button';more.className='changed-files-more disclosure-toggle';const refresh=()=>{more.textContent=folded?'展开其余 '+(allFiles.length-limit)+' 个文件':'收起';more.setAttribute('aria-expanded',String(!folded));};
   more.addEventListener('click',event=>{if(!valid()||selectionDragEnded(event))return;keep(more,()=>{folded=!folded;apply();refresh();});void this.memory.save(key,folded?'folded':'expanded').catch(()=>{});});apply();refresh();box.append(more);
  }};void paint();return box;
 }
}
/** Verbatim DSH165 changed-files CSS, plus narrow public-patch notes/details. */
export const CHANGED_FILES_STYLE=`
    .changed-files { margin: 14px 0 4px; padding: 10px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); }
    .changed-files-head { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 7px; font-weight: 600; }
    .changed-files-title { min-width: 0; flex: 1; }
    .changed-files-actions, .changed-file-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; }
    .changed-turn + .changed-turn { margin-top: 9px; }
    .changed-turn-title { padding: 4px 0; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .changed-file { min-width: 0; padding: 6px 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px 8px; border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent); }
    .changed-file .file-link { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .changed-file-stats { display: flex; gap: 5px; font-family: var(--editor-font); font-size: 10px; }
    .change-additions { color: var(--vscode-gitDecoration-addedResourceForeground); }
    .change-deletions { color: var(--vscode-gitDecoration-deletedResourceForeground); }
    .changed-file-actions { grid-column: 1 / -1; }
    .changed-action { min-height: 21px; padding: 1px 5px; border: 0; border-radius: 4px; color: var(--vscode-descriptionForeground); background: transparent; font-size: 10px; }
    .changed-action:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .changed-action.danger { color: var(--vscode-errorForeground); }
    .changed-action:disabled { color: var(--vscode-descriptionForeground); }
    .changed-file[hidden], .changed-turn[hidden] { display: none; }
    .changed-files-more { display: block; width: 100%; margin-top: 6px; padding: 3px 4px 1px; border: 0; border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent); border-radius: 0 0 4px 4px; color: var(--vscode-textLink-foreground, #4d6bfe); background: transparent; font-size: 11px; text-align: left; cursor: pointer; }
    .changed-files-more:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .changed-file-path{min-width:0;overflow:hidden}.changed-file-diffs{grid-column:1 / -1;min-width:0}.changed-file-diffs pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--editor-font)}.changed-files-note{font-size:11px;color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}
`;
