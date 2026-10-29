import type {DraftMemory} from './draft-memory';
import {draftFiles,draftImages} from '../draft-store-types';

/** Read-only original content, separate from the editable composer. Never submits. */
export class DraftRecoveryPanel {
 private details=document.createElement('details');
 private summary=document.createElement('summary');
 private body=document.createElement('pre');
 private attachments=document.createElement('p');
 private note=document.createElement('p');
 private copied=document.createElement('span');
 private copy=document.createElement('button');
 private restore=document.createElement('button');
 private identity='';
 constructor(root:HTMLElement,private drafts:DraftMemory,private review:HTMLButtonElement){
  this.details.id='draft-original';this.body.tabIndex=0;this.body.style.whiteSpace='pre-wrap';this.body.style.overflowWrap='anywhere';this.body.style.maxHeight='180px';this.body.style.overflow='auto';
  this.copy.textContent='复制原文字';this.copy.type='button';this.restore.textContent='已核对，恢复原内容';this.restore.type='button';this.copied.setAttribute('role','status');
  this.details.append(this.summary,this.body,this.attachments,this.note,this.copy,this.restore,this.copied);root.append(this.details);
  this.copy.onclick=async()=>{const id=this.identity;this.copied.textContent='正在复制…';const ok=await drafts.copyOriginal();if(this.identity===id&&this.details.isConnected)this.copied.textContent=ok?'已复制原文字':'复制未确认，请重试；也可选择上方文字手动复制。';};
  this.restore.onclick=()=>void drafts.restoreOriginal();this.refresh();
 }
 refresh(){
  const value=this.drafts.recovery,id=value?.id??'';if(this.identity!==id){this.identity=id;this.details.open=false;this.copied.textContent='';}
  this.details.hidden=!value;this.review.disabled=!this.drafts.ready||this.drafts.restoring||this.drafts.recoveryBusy;
  this.review.textContent=value?'已核对，关闭原内容':'已核对历史，保留为草稿';
  this.review.title=value?'移除这份本地恢复快照，保留当前草稿；不改变历史，不会发送。':'没有单独保存的原内容快照；仅解除未知保护，保留当前草稿，不会发送。';
  if(!value)return;
  this.summary.textContent=(value.state==='rejected'?'上次未提交内容':'上次未确认内容')+' · '+({send:'发送',queue:'本地排队',steer:'插话'}[value.mode]);
  this.body.textContent=value.draft.text||'（无文字）';
  const names=[...(value.draft.skill?['技能：'+value.draft.skill.name]:[]),...draftImages(value.draft).map(v=>'图片：'+(v.path.split(/[\\/]/).at(-1)||v.path)),...draftFiles(value.draft).map(v=>'文件：'+v.name)];
  this.attachments.textContent=names.join('；');this.attachments.hidden=!names.length;
  this.note.textContent=this.drafts.canRestoreOriginal?'先核对历史或本地队列；恢复只填入输入框，不会发送。':'当前草稿已有内容或正在核对，原内容不会覆盖它。可先复制文字，或清空当前草稿后恢复。';
  this.restore.disabled=!this.drafts.canRestoreOriginal;this.copy.disabled=!this.drafts.ready||this.drafts.restoring||this.drafts.recoveryBusy;
 }
}
