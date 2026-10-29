/** Display-only draft shape; no filesystem/runtime imports in browser bundles. */
import {ATTACHMENT_BYTES,FILE_COUNT,ATTACHMENT_COUNT} from './attachment-policy';
import {validSkillReference,matchesSkillPrompt,type SkillReference} from './skill-reference';
export const DRAFT_TEXT_CAP=100_000;
export interface DraftImage {path:string;token:string}
/** First image stays in its existing storage fields, preserving saved v1 drafts. */
export const draftImages=(value:{image:string;imageToken:string;extraImages?:DraftImage[]}):DraftImage[]=>[...(value.image?[{path:value.image,token:value.imageToken}]:[]),...(value.extraImages??[])];
export const imageFields=(images:DraftImage[])=>({image:images[0]?.path??'',imageToken:images[0]?.token??'',extraImages:images.slice(1)});
export function validExtraImages(value:unknown):value is DraftImage[]{return Array.isArray(value)&&value.length<ATTACHMENT_COUNT&&value.every(v=>v&&typeof v.path==='string'&&v.path.length>0&&v.path.length<=4096&&typeof v.token==='string'&&v.token.length>0&&v.token.length<=64);}
export function validAttachmentSet(value:{image:string;imageToken:string;extraImages?:DraftImage[];files?:DraftFile[]}){const images=draftImages(value);return images.length+draftFiles(value).length<=ATTACHMENT_COUNT&&new Set(images.map(v=>v.token)).size===images.length&&(!value.extraImages?.length||!!value.image);}
export interface DraftFile {path:string;name:string;size:number;sha256:string;editorSource?:string}
export const draftFileId=(file:DraftFile)=>JSON.stringify([file.path,file.sha256]);
export const draftFiles=(value:{files?:DraftFile[]})=>value.files??[];
const validEditorFileSlots=(files:any[])=>files.filter(f=>f?.editorSource!==undefined).length<=1&&files.every(f=>f?.editorSource===undefined||typeof f.editorSource==='string'&&f.editorSource.length>0&&f.editorSource.length<=4096&&!/(?:^[\\/]|(?:^|[\\/])\.\.(?:[\\/]|$)|[:\x00-\x1f])/.test(f.editorSource));
export function validFiles(files:unknown):files is DraftFile[]{return Array.isArray(files)&&validEditorFileSlots(files)&&files.length<=FILE_COUNT&&new Set(files.map(f=>f?.path)).size===files.length&&files.every(f=>f&&typeof f.path==='string'&&f.path.length>0&&f.path.length<=4096&&typeof f.name==='string'&&f.name.length>0&&f.name.length<=180&&Number.isSafeInteger(f.size)&&f.size>0&&f.size<=ATTACHMENT_BYTES&&typeof f.sha256==='string'&&/^[0-9a-f]{64}$/.test(f.sha256));}
export interface DraftFields {text:string;image:string;pathInput:string;imageToken:string;files?:DraftFile[];extraImages?:DraftImage[];skill?:SkillReference;draftEditId?:string}
export interface DraftRecovery {id:string;mode:'send'|'queue'|'steer';state:'pending'|'rejected';draft:DraftFields}
export interface DraftRecord extends DraftFields {uncertain:boolean;pendingEditId?:string;recovery?:DraftRecovery}
export interface DraftRecoveryIdentity {recoveryId?:string|undefined;draftEditId?:string|undefined;pendingEditId?:string|undefined}
export const draftRecoveryIdentity=(value:DraftRecord):DraftRecoveryIdentity=>({recoveryId:value.recovery?.id,draftEditId:value.draftEditId,pendingEditId:value.pendingEditId});
export const hasDraftContent=(value:DraftFields)=>!!(value.text||value.image||value.pathInput||value.files?.length||value.extraImages?.length||value.skill);
export function validDraftEditId(value:unknown){return value===undefined||typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);}
export function validDraft(v:any):v is DraftFields{return !!v&&validDraftEditId(v.draftEditId)&&typeof v.text==='string'&&v.text.length<=DRAFT_TEXT_CAP&&typeof v.image==='string'&&v.image.length<=4096&&typeof v.pathInput==='string'&&v.pathInput.length<=4096&&typeof v.imageToken==='string'&&v.imageToken.length<=64&&(v.files===undefined||validFiles(v.files))&&(v.extraImages===undefined||validExtraImages(v.extraImages))&&(v.skill===undefined||validSkillReference(v.skill)&&matchesSkillPrompt(v.text,v.skill))&&validAttachmentSet(v);}
export function validDraftRecord(value:any):value is DraftRecord{
 if(!validDraft(value))return false;const record=value as DraftRecord;
 if(typeof record.uncertain!=='boolean'||!(record.pendingEditId===undefined||record.uncertain&&(record.pendingEditId===''||validDraftEditId(record.pendingEditId))))return false;
 const recovery=record.recovery;if(recovery===undefined)return true;
 return !!recovery&&typeof recovery.id==='string'&&validDraftEditId(recovery.id)&&['send','queue','steer'].includes(recovery.mode)&&validDraft(recovery.draft)&&!('recovery'in recovery.draft)&&!('uncertain'in recovery.draft)&&!('pendingEditId'in recovery.draft)&&(recovery.state==='pending'?record.uncertain&&record.pendingEditId===(recovery.draft.draftEditId??''):recovery.state==='rejected'&&!record.uncertain&&record.pendingEditId===undefined);
}
export const emptyDraft=():DraftRecord=>({text:'',image:'',pathInput:'',imageToken:'',uncertain:false});
