/** Shared validation only; no filesystem or runtime dependency in the webview bundle. */
export const ATTACHMENT_BYTES=5*1024*1024;
// Local memory/IPC admission bound, matching the normal DSH import batch.
// This is not a claim about the model's service-side limit.
export const ATTACHMENT_COUNT=20,FILE_COUNT=ATTACHMENT_COUNT;
export const ATTACHMENT_STORE_DEFAULT_MB=512;
/** DSH165 attach.maxFiles/maxTotalMB apply to one chooser/paste/drop batch, not a draft or disk quota. */
export type AttachmentBatchPolicy={maxFiles:number;maxTotalMB:number};
export const ATTACHMENT_BATCH_DEFAULTS:Readonly<AttachmentBatchPolicy>=Object.freeze({maxFiles:20,maxTotalMB:100});
export const validAttachmentBatchFiles=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1&&v<=200;
export const validAttachmentBatchMB=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1&&v<=2048;
export function attachmentBatchPolicy(value?:{maxFiles?:unknown;maxTotalMB?:unknown}):AttachmentBatchPolicy{return{maxFiles:validAttachmentBatchFiles(value?.maxFiles)?value.maxFiles:ATTACHMENT_BATCH_DEFAULTS.maxFiles,maxTotalMB:validAttachmentBatchMB(value?.maxTotalMB)?value.maxTotalMB:ATTACHMENT_BATCH_DEFAULTS.maxTotalMB};}
export function attachmentBatchReason(policy:AttachmentBatchPolicy,accepted:number,totalBytes:number,nextBytes:number){if(!validAttachmentBatchFiles(policy.maxFiles)||!validAttachmentBatchMB(policy.maxTotalMB)||![accepted,totalBytes,nextBytes].every(Number.isSafeInteger)||accepted<0||totalBytes<0||nextBytes<=0||!Number.isSafeInteger(totalBytes+nextBytes))return'附件批次大小无法核对';return accepted>=policy.maxFiles||totalBytes+nextBytes>policy.maxTotalMB*1024*1024?`超出单次上限（${policy.maxFiles}项 / ${policy.maxTotalMB} MiB），已跳过`:'';}
export const validAttachmentLimit=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&(v===-1||v>=16&&v<=4096);
export const normalizeAttachmentLimit=(v:number)=>v===-1?-1:Math.min(4096,Math.max(16,Math.round(v)));
export type AttachmentStorageStatus={bytes:number|null;files:number|null;checkedAt:number|null;limitMB:number;sizeError:string;maintenanceError:string;exports?:{temporaryGraceMs?:number;knownTemporaryRecords?:number|null;lastTemporary?:{removed:number;bytes:number;missing:number;retained:number;changed:number;unknown:number;checkedAt:number}|undefined;retentionDays:number;knownRecords:number|null;error:string;last?:{removed:number;bytes:number;missing:number;retained:number;changed:number;unknown:number;checkedAt:number}|undefined};collection?:{removed:number;bytes:number;missing:number;remaining:number;changed:number;referenced:number;unobserved:number}};
export type ImageProof={path:string;sha256:string};
/** Ordered evidence of the preview bytes the user submitted, never a server image protocol. */
export function validImageProofs(images:{path:string}[],value:unknown):value is ImageProof[]{return !images.length?(value===undefined||Array.isArray(value)&&!value.length):Array.isArray(value)&&value.length===images.length&&value.every((proof,i)=>proof&&proof.path===images[i]!.path&&typeof proof.sha256==='string'&&/^[0-9a-f]{64}$/.test(proof.sha256));}
const DOCUMENT=/\.(txt|md|csv|json|pdf|docx|xls|xlsx|pptx|log|yaml|yml|xml|html|css|js|ts|py|rs|go|java|c|cpp|h)$/i;
export function attachmentKind(name:unknown){
 if(typeof name!=='string'||!name||name.length>180||/[\\/:*?"<>|\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('附件名称无效');
 if(/\.(png|jpe?g)$/i.test(name))return 'image';
 if(DOCUMENT.test(name))return 'file';throw Error('暂不支持此附件格式；请选择常见文本、PDF、DOCX、XLS、XLSX 或 PPTX 文件');
}
