export type EditorPosition={line:number;character:number};
export type EditorRange={start:EditorPosition;end:EditorPosition};
export type EditorCaptureMode='selection'|'diagnostics';
export type EditorCaptureView={revision:number;reason:string;source?:{key:string;path:string;version:number;dirty:boolean;selection:EditorRange;selectionCharacters:number;diagnosticCount:number;diagnosticScope:'selection'|'file'}};
export const EDITOR_CAPTURE_CHARACTERS=12000;
export const EDITOR_CAPTURE_DIAGNOSTICS=20;
export const COMPOSER_CHARACTERS=20000;
/** A late excerpt appends to the latest draft; selected or newly typed text is never replaced. */
export function appendEditorCapture(current:string,excerpt:string){
 if(!excerpt.trim())throw Error('编辑器未返回可附加内容');
 const next=current+(current?'\n\n':'')+excerpt;
 if(next.length>COMPOSER_CHARACTERS)throw Error('加入后会超过消息20000字符上限；现有草稿保留，请缩小选区或诊断范围');
 return next;
}
