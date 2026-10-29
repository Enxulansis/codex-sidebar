/** Narrow host bridge for the DSH formula exports. No server/session authority. */
import {execFile} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {extname,relative} from 'node:path';
import {cfHtmlDocument,svgClipScript,mathmlClipScript,imageClipScript,toEncodedCommand} from '../system-clipboard';
import {prepareMath} from './display/dsh-math';
import type {FormulaExport,FormulaExportResult} from './display/dsh-math-export';
import {ownedPath} from './storage';
import {FORMULA_NATIVE_TIMEOUT_MS} from './formula-export-limits';
import {displayExportCarriers} from './display-export-carriers';
import {localPowerShell7} from './powershell7';
const MarkdownIt=require('markdown-it') as new()=>{parse(source:string,env:object):any[]};
const parser=new MarkdownIt();
const MAX_XML_BYTES=2*1024*1024,MAX_PNG_BYTES=5*1024*1024;
export interface FormulaOwner {threadId:string;connectionId:number;items:{turnId:string;complete:boolean;item:{type:string;id:string;text?:string}}[]}
export type FormulaRequest=FormulaExport&{id:number;threadId:string;connectionId:number;turnId:string;itemId:string};
export function validateFormulaPayload(value:FormulaExport):void{
 const markup=(text:unknown,root:string)=>{
  if(typeof text!=='string'||!text.trimStart().startsWith('<'+root)||Buffer.byteLength(text)>MAX_XML_BYTES||/<!|<\?/.test(text))throw Error('公式导出数据无效或超出大小限制');
 };
 if(!['svg','png','mathml','save-svg','save-png'].includes(value.kind))throw Error('未接入的公式导出类型');
 if(value.kind==='svg'||value.kind==='save-svg')markup(value.svg,'svg');if(value.kind==='mathml')markup(value.mathml,'math');
 if(value.kind==='svg'||value.kind==='png'||value.kind==='save-png'){
  if(typeof value.png!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.png)||value.png.length>Math.ceil(MAX_PNG_BYTES/3)*4+22)throw Error('PNG导出数据无效或超过5 MiB');
  const bytes=Buffer.from(value.png.slice(22),'base64');
  if(bytes.length<24||bytes.length>MAX_PNG_BYTES||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)||bytes.readUInt32BE(16)>4096||bytes.readUInt32BE(20)>4096)throw Error('PNG签名或尺寸不符合公式导出限制');
 }
 if((value.kind==='save-svg'||value.kind==='save-png')&&!/^formula-\d{8}-\d{6}\.(svg|png)$/.test(value.name))throw Error('公式建议文件名无效');
}
const quote=(text:string)=>"'"+text.replaceAll("'","''")+"'";
/** Use the mature XML reader; DTD/resolvers are disabled and only static,
 * resource-free SVG/MathML vocabulary may reach the native clipboard or disk. */
export function formulaValidationScript(xmlPath:string,kind:'svg'|'math',pngPath=''):string{
 return String.raw`$ErrorActionPreference = 'Stop'
$kind=${quote(kind)}; $xmlPath=${quote(xmlPath)}; $pngPath=${quote(pngPath)}
if ($xmlPath -ne '') {
 $settings=[System.Xml.XmlReaderSettings]::new(); $settings.DtdProcessing=[System.Xml.DtdProcessing]::Prohibit; $settings.XmlResolver=$null
 $reader=[System.Xml.XmlReader]::Create($xmlPath,$settings)
 $allowed=if($kind -eq 'svg'){@('svg','g','defs','path','use','rect','line','polyline','polygon','circle','ellipse','text','tspan','title','desc')}else{@('math','semantics','annotation','mrow','mi','mo','mn','ms','mtext','mspace','mfrac','msqrt','mroot','msub','msup','msubsup','munder','mover','munderover','mtable','mtr','mtd','menclose','mpadded','mphantom','mlabeledtr','mstyle','none','mmultiscripts','mprescripts')}
 try { $rootSeen=$false; while($reader.Read()) {
  if($reader.NodeType -ne [System.Xml.XmlNodeType]::Element){continue}
  if(!$rootSeen){if($reader.LocalName -ne $kind){throw 'Invalid formula root'};$rootSeen=$true}
  $expected=if($kind -eq 'svg'){'http://www.w3.org/2000/svg'}else{'http://www.w3.org/1998/Math/MathML'}
  if($reader.NamespaceURI -ne $expected -or $reader.LocalName -cnotin $allowed){throw 'Restricted formula element'}
  if($reader.MoveToFirstAttribute()){do {
   $name=$reader.LocalName; $value=$reader.Value
   if($name -match '^on' -or $name -in @('src','base') -or ($name -eq 'href' -and $value -notmatch '^#[A-Za-z0-9_.:-]+$') -or $value -match 'url\s*\(|@import|expression\s*\('){throw 'Restricted formula resource'}
   if($reader.NamespaceURI -eq 'http://www.w3.org/2000/xmlns/' -and $value -notin @('http://www.w3.org/2000/svg','http://www.w3.org/1998/Math/MathML','http://www.w3.org/1999/xlink')){throw 'Restricted namespace'}
  }while($reader.MoveToNextAttribute());[void]$reader.MoveToElement()}
 }; if(!$rootSeen){throw 'Empty formula XML'} } finally { $reader.Dispose() }
}
if($pngPath -ne '') {
 Add-Type -AssemblyName System.Drawing
 $bytes=[IO.File]::ReadAllBytes($pngPath); $stream=[IO.MemoryStream]::new($bytes,$false)
 try { $image=[Drawing.Image]::FromStream($stream,$true,$true); try {if($image.Width -gt 4096 -or $image.Height -gt 4096){throw 'Formula PNG too large'}}finally{$image.Dispose()} }finally{$stream.Dispose()}
}`;
}
export async function runFormulaScript(script:string):Promise<void>{
 const binding=await localPowerShell7.binding();
 return new Promise((resolve,reject)=>execFile(binding.path,['-NoProfile','-NonInteractive','-STA','-WindowStyle','Hidden','-EncodedCommand',toEncodedCommand("$ErrorActionPreference = 'Stop'\n"+script)],{timeout:FORMULA_NATIVE_TIMEOUT_MS,windowsHide:true},(error,_stdout,stderr)=>{
  if(!error){resolve();return;}
  if(error.code==='ENOENT'){reject(Error('已绑定的 PowerShell 7 不可读取；请重载候选窗口后重新核对'));return;}
  reject(Error(/Restricted formula|Restricted namespace/.test(stderr)?'公式导出被拒绝：含受限元素或外部资源':'公式原生转换或剪贴板操作失败'));
 }));
}
export class FormulaExporter {
 private busy=false;
 constructor(private root:string,private owner:()=>FormulaOwner|undefined,private chooseTarget:(kind:'svg'|'png',name:string)=>Promise<string|undefined>,private native=runFormulaScript){}
 private assertCurrent(value:FormulaRequest){
  const state=this.owner();
  if(!Number.isSafeInteger(value.id)||value.id<1||!state||value.threadId!==state.threadId||value.connectionId!==state.connectionId||typeof value.raw!=='string'||value.raw.length>2000||typeof value.display!=='boolean')throw Error('公式显示身份已失效');
  const row=state.items.find(v=>v.turnId===value.turnId&&v.item.id===value.itemId);
  if(!row?.complete||!['agentMessage','plan'].includes(row.item.type)||typeof row.item.text!=='string')throw Error('公式尚未完成或已移除');
  const formulas=prepareMath(row.item.text,parser).values;
  if(![...formulas.values()].some(v=>v.tex===value.raw&&v.display===value.display))throw Error('公式来源已变化');
 }
 async handle(value:FormulaRequest):Promise<FormulaExportResult>{
  this.assertCurrent(value);validateFormulaPayload(value);if(this.busy)throw Error('上一项公式导出尚未结束');this.busy=true;
  try{
   const carriers=await displayExportCarriers(this.root);this.assertCurrent(value);const payloads:{name:string;bytes:Buffer}[]=[];
   if(value.kind==='svg'||value.kind==='save-svg'||value.kind==='mathml')payloads.push({name:'formula.xml',bytes:Buffer.from(value.kind==='mathml'?value.mathml:value.svg,'utf8')});
   if(value.kind==='svg'||value.kind==='png'||value.kind==='save-png')payloads.push({name:'formula.png',bytes:Buffer.from(value.png.slice(22),'base64')});
   if(value.kind==='mathml')payloads.push({name:'fragment.html',bytes:Buffer.from(cfHtmlDocument(value.mathml),'utf8')});
   return await carriers.temporary<FormulaExportResult>('formula',payloads,async()=>this.assertCurrent(value),async paths=>{
    const xml=paths.get('formula.xml')??'',png=paths.get('formula.png')??'';await this.native(formulaValidationScript(xml,value.kind==='mathml'?'math':'svg',png));this.assertCurrent(value);
    if(value.kind==='save-svg'||value.kind==='save-png'){
     if(!this.root)throw Error('请先打开本地文件夹，再保存公式');await ownedPath(this.root,'.');this.assertCurrent(value);
     const kind=value.kind==='save-svg'?'svg':'png',target=await this.chooseTarget(kind,value.name);if(!target)return 'canceled';this.assertCurrent(value);
     const safe=await ownedPath(this.root,target);if(relative(this.root,safe).split(/[\\/]/)[0]!.toLowerCase().startsWith('.codex-'))throw Error('不能覆盖内部附件或导出存储');if(extname(safe).toLowerCase()!=='.'+kind)throw Error('请选择正确的公式文件扩展名');this.assertCurrent(value);
     await writeFile(safe,value.kind==='save-svg'?Buffer.from(value.svg,'utf8'):Buffer.from(value.png.slice(22),'base64'));this.assertCurrent(value);return 'saved';
    }
    const script=value.kind==='svg'?svgClipScript(xml,png):value.kind==='png'?imageClipScript(png):mathmlClipScript(paths.get('fragment.html')!);this.assertCurrent(value);await this.native(script);this.assertCurrent(value);return 'copied';
   });
  }finally{this.busy=false;}
 }
}
