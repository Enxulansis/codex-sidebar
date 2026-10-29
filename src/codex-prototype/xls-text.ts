import {DOCUMENT_TEXT_CAP} from './document-input';
const XLS_CELL_CAP=100_000,XLS_SHEET_CAP=128;
type Cell={v?:unknown;f?:string;t?:string};
type Sheet=Record<string,Cell|undefined>&{'!ref'?:any};
function fail(code:string):never{throw Object.assign(Error(code),{code});}
/** BIFF/OLE workbook bytes only. Stored cell values, all sheets; no formula evaluation, macros or external reads. */
export function xlsText(bytes:Uint8Array){
 const ole=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((v,i)=>bytes[i]===v),biff=bytes.length>=8&&bytes[0]===9&&[0,2,4,8].includes(bytes[1]!);
 if(!ole&&!biff)fail('UNSUPPORTED_XLS_CONTAINER');
 const xlsx=require('./vendor/xlsx.full.min.js') as {read:(bytes:Uint8Array,options:object)=>{SheetNames:string[];Sheets:Record<string,Sheet>};utils:{decode_range:(ref:string)=>{s:{r:number;c:number};e:{r:number;c:number}};sheet_to_csv:(sheet:Sheet,options:object)=>string}};
 let workbook:ReturnType<typeof xlsx.read>;
 try{workbook=xlsx.read(bytes,{type:'array',cellFormula:true,cellHTML:false,bookVBA:false,bookDeps:false,bookFiles:false,WTF:true});}
 catch(error){if(/password|encrypt|FilePass/i.test(String(error)))fail('DOCUMENT_PASSWORD');throw error;}
 if(!workbook.SheetNames.length||workbook.SheetNames.length>XLS_SHEET_CAP)fail('INCOMPLETE_DOCUMENT_TEXT');
 const parts:string[]=[];let cells=0,length=0;
 for(const name of workbook.SheetNames){
  const sheet=workbook.Sheets[name];if(!sheet)fail('INCOMPLETE_DOCUMENT_TEXT');const ref=sheet['!ref'];if(!ref)continue;if(typeof ref!=='string')fail('INCOMPLETE_DOCUMENT_TEXT');
  const range=xlsx.utils.decode_range(ref),rows=range.e.r-range.s.r+1,columns=range.e.c-range.s.c+1;
  if(![range.s.r,range.s.c,range.e.r,range.e.c,rows,columns].every(Number.isSafeInteger)||range.s.r<0||range.s.c<0||rows<=0||columns<=0||(cells+=rows*columns)>XLS_CELL_CAP)fail('INCOMPLETE_DOCUMENT_TEXT');
  for(const[address,cell]of Object.entries(sheet)){if(address.startsWith('!')||!cell)continue;if(cell.f&&(cell.v===undefined||cell.v===null))fail('INCOMPLETE_DOCUMENT_TEXT');}
  const text=xlsx.utils.sheet_to_csv(sheet,{FS:'\t',RS:'\n',blankrows:false,skipHidden:false});if(!text.trim())continue;const part='工作表：'+name+'\n'+text;length+=part.length+2;if(length>DOCUMENT_TEXT_CAP)fail('DOCUMENT_TEXT_TOO_LARGE');parts.push(part);
 }
 if(!parts.length)fail('DOCUMENT_NO_TEXT');return parts.join('\n\n');
}
