import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import type {DraftFile} from './draft-store-types';
import {isTextDocument,textDocument,DOCUMENT_TEXT_CAP,type DocumentText} from './document-input';

export const DOCUMENT_READ_TIMEOUT_MS=16000;
export type DocumentReader=(file:DraftFile,bytes:Uint8Array)=>Promise<DocumentText>;
const canceled=()=>Object.assign(Error('文档读取已取消；草稿和附件保留'),{name:'AbortError'});
function parseError(file:DraftFile,code:unknown){
  const reason=code==='UNSUPPORTED_XLS_CONTAINER'?'此文件不是可读取的旧版 Excel 二进制格式，请另存为 .xlsx 后附加':code==='DOCUMENT_NO_TEXT'?'没有可提取的文字；当前不启用OCR，请附加图片或文字副本':code==='DOCUMENT_TEXT_TOO_LARGE'?'可提取文字超过'+DOCUMENT_TEXT_CAP+'字符，请拆分后附加；未截断':typeof code==='string'&&/PASSWORD|DECRYPT/.test(code)?'文档已加密或无法解密，请附加未加密副本':code==='INCOMPLETE_DOCUMENT_TEXT'?'部分文字或结构无法完整提取，请另存文字副本；未发送部分结果':'文档格式损坏或解析失败，未发送路径引用';
  return Error(file.name+'：'+reason+'；原文件和草稿保留');
}
/** A finite-lived thread keeps synchronous ZIP/XML/PDF parsing off the extension host. */
export function readBinaryDocument(file:DraftFile,bytes:Uint8Array,signal?:AbortSignal,workerPath=join(__dirname,'document-worker.cjs'),timeoutMs=DOCUMENT_READ_TIMEOUT_MS):Promise<DocumentText>{
  if(signal?.aborted)return Promise.reject(canceled());
  const format=file.name.split('.').at(-1)?.toLowerCase();
  if(!format||!['pdf','docx','xls','xlsx','pptx'].includes(format))return Promise.reject(parseError(file,'UNSUPPORTED_DOCUMENT'));
  return new Promise((resolve,reject)=>{
    let worker:Worker;try{worker=new Worker(workerPath,{workerData:{format,bytes},env:{},resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:16,stackSizeMb:4}});}catch{return reject(parseError(file,'DOCUMENT_WORKER_START_FAILED'));}
    let settled=false;
    const finish=(error?:Error,value?:DocumentText)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.removeAllListeners('message');
      void worker.terminate().then(()=>error?reject(error):resolve(value!),()=>reject(error??Error(file.name+'：文档工作线程退出未确认，未发送')));
    };
    const abort=()=>finish(canceled()),timer=setTimeout(()=>finish(Error(file.name+'：文档读取超过16秒，已停止；原文件和草稿保留，未发送部分结果')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    worker.on('message',(message:unknown)=>{
      const result=message as {ok?:unknown;text?:unknown;format?:unknown;notes?:unknown};
      if(result?.ok!==true)return finish(parseError(file,(message as {code?:unknown})?.code));
      if(signal?.aborted)return abort();
      if(typeof result.text!=='string'||!result.text.trim()||result.text.length>DOCUMENT_TEXT_CAP||result.format!==format||!Array.isArray(result.notes)||result.notes.length>16||!result.notes.every(note=>typeof note==='string'&&/^[A-Z_]{1,64}$/.test(note)))return finish(parseError(file,'INVALID_DOCUMENT_RESULT'));
      finish(undefined,{name:file.name,size:file.size,sha256:file.sha256,format,text:result.text,notes:result.notes});
    });
    worker.on('error',()=>finish(parseError(file,'DOCUMENT_WORKER_FAILED')));
    worker.on('exit',()=>{if(!settled)finish(parseError(file,'DOCUMENT_WORKER_EXITED'));});
    if(signal?.aborted)abort();
  });
}
/** A send rechecks file bytes twice; reuse only extraction from the same verified digest within that send. */
export function createDocumentReader(signal?:AbortSignal,workerPath?:string):DocumentReader{
  const cache=new Map<string,DocumentText>();
  return async(file,bytes)=>{
    if(signal?.aborted)throw canceled();const key=JSON.stringify([file.path,file.name,file.size,file.sha256]),previous=cache.get(key);if(previous)return previous;
    const value=isTextDocument(file.name)?textDocument(file,bytes):await readBinaryDocument(file,bytes,signal,workerPath);
    if(signal?.aborted)throw canceled();cache.set(key,value);return value;
  };
}
