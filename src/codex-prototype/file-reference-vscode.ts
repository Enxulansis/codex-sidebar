import * as vscode from 'vscode';
import {realpath} from 'node:fs/promises';
import type {OpenReferencedText,OpenReferencedFile} from './file-reference-host';
import {startProcessScript} from '../system-clipboard';
import {runFormulaScript} from './formula-export-host';
/** Same text editor preview surface as attachments. */
export const openReferencedText:OpenReferencedText=async(path,current,line)=>{
 await current();const document=await vscode.workspace.openTextDocument(vscode.Uri.file(path));
 if(document.uri.scheme!=='file'||await realpath(document.uri.fsPath)!==await realpath(path))throw Error('编辑器返回了不同的文件来源');
 await current();const position=line===undefined?undefined:new vscode.Position(Math.min(Math.max(0,line-1),Math.max(0,document.lineCount-1)),0);
 await vscode.window.showTextDocument(document,{preview:true,...(position?{selection:new vscode.Range(position,position)}:{})});
};
/** Explicit editor options route vscode.open to the workbench editor, never env.openExternal.
 * A matching editor resource confirms handoff only, not successful PDF/binary decoding. */
export const openReferencedFile:OpenReferencedFile=async(path,current)=>{
 await current();await vscode.commands.executeCommand('vscode.open',vscode.Uri.file(path),{preview:true});await current();
 const input=vscode.window.tabGroups.activeTabGroup.activeTab?.input;
 if(!(input instanceof vscode.TabInputText||input instanceof vscode.TabInputCustom||input instanceof vscode.TabInputNotebook)||input.uri.scheme!=='file'||await realpath(input.uri.fsPath)!==await realpath(path))throw Error('VS Code 文件编辑器未确认接管此来源；请核对编辑器提示，未自动重试');
 await current();
};
/** Attachment click only: DSH's PDF editor / Office default-app split. */
export const openAttachedFile:OpenReferencedFile=async(path,current)=>{
 if(/\.pdf$/i.test(path)){await openReferencedFile(path,current);return;}
 if(!/\.(docx|xls|xlsx|pptx)$/i.test(path))throw Error('此附件格式没有已接入的预览入口');
 await current();
 if(process.platform==='win32')await runFormulaScript(startProcessScript(path));
 else if(!await vscode.env.openExternal(vscode.Uri.file(path)))throw Error('系统未确认打开文件，请核对默认应用');
 await current();
};
export async function findReferencedFiles(root:string,pattern:string):Promise<string[]>{
 const cancel=new vscode.CancellationTokenSource();let expired=false;
 const timer=setTimeout(()=>{expired=true;cancel.cancel();},3000);
 try{const values=await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(root),pattern),'**/{.git,.codex-*}/**',30,cancel.token);if(expired||cancel.token.isCancellationRequested)throw Error('文件后缀查找超时或取消，结果未知；未自动重试');return values.map(value=>value.fsPath);}
 finally{clearTimeout(timer);cancel.dispose();}
}
