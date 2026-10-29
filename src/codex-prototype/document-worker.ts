import {parentPort,workerData} from 'node:worker_threads';
import {DOCUMENT_TEXT_CAP} from './document-input';
import {xlsText} from './xls-text';

type Request={format:'pdf'|'docx'|'xls'|'xlsx'|'pptx';bytes:Uint8Array};
const textSafeCodes=new Set(['PERFORMANCE_TIP','PDF_STRUCT_TREE_UNRELIABLE','PDF_OUTLINE_TRUNCATED','WHITESPACE_NODE_SKIPPED']);
const fail=(code:string)=>{throw Object.assign(Error(code),{code});};
/** The worker receives verified bytes only. No path input, OCR, native addon, external program or network. */
async function read(){
  const request=workerData as Request;
  if(!request||!['pdf','docx','xls','xlsx','pptx'].includes(request.format)||!(request.bytes instanceof Uint8Array)||request.bytes.length>5*1024*1024)fail('INVALID_DOCUMENT_REQUEST');
  globalThis.fetch=async()=>{throw Error('Document parser network access is disabled');};
  if(request.format==='xls'){const text=xlsText(request.bytes);parentPort!.postMessage({ok:true,text,format:'xls',notes:['SPREADSHEET_STORED_VALUES']});return;}
  const geometry=require('./vendor/document-geometry.cjs') as {DOMMatrix:typeof DOMMatrix};
  globalThis.DOMMatrix??=geometry.DOMMatrix;
  const {OfficeParser}=await import('./vendor/officeparser.slim.mjs');
  const ast=await OfficeParser.parseOffice(request.bytes,{fileType:request.format,ocr:false,extractAttachments:false,includeRawContent:false,ignoreNotes:false,ignoreComments:false,ignoreHeadersAndFooters:false,ignoreSlideMasters:false,pdfParserConfig:{separateProcess:false,extractTextColor:false,pageRange:''},decompressionLimits:{maxUncompressedBytes:16*1024*1024,maxZipEntries:2048,maxTableCells:100000,maxXmlElements:250000,maxRepeatedContent:80000}});
  const converted=await ast.to('text',{includeImages:false,includeCharts:true,textConfig:{renderNotes:true}}),issues=[...ast.warnings,...converted.messages];
  if(typeof converted.value!=='string'||!converted.value.trim())fail('DOCUMENT_NO_TEXT');
  if(issues.some(issue=>issue.type==='error'||!textSafeCodes.has(issue.code)))fail('INCOMPLETE_DOCUMENT_TEXT');
  if(converted.value.length>DOCUMENT_TEXT_CAP)fail('DOCUMENT_TEXT_TOO_LARGE');
  parentPort!.postMessage({ok:true,text:converted.value,format:request.format,notes:[...new Set(issues.map(issue=>issue.code))].slice(0,16)});
}
void read().catch((error:unknown)=>{
  const value=error as {code?:unknown;officeIssue?:{code?:unknown}},code=value?.officeIssue?.code??value?.code;
  parentPort!.postMessage({ok:false,code:typeof code==='string'&&/^[A-Z_]{1,64}$/.test(code)?code:'DOCUMENT_PARSE_FAILED'});
});
