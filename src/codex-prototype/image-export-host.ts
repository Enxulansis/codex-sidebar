/** Host-owned image exports. Frame PNG bytes come from the bounded production browser decoder; source paths remain host-resolved. */
import {writeFile} from 'node:fs/promises';
import {extname,relative} from 'node:path';import {createHash} from 'node:crypto';
import {originalImageClipScript,imageClipScript,imageFileClipScript} from '../system-clipboard';
import {runFormulaScript,formulaValidationScript} from './formula-export-host';
import {exportCarriers} from './export-carriers';
import {displayExportCarriers} from './display-export-carriers';
import {assertWorkspaceFiles,ownedPath} from './storage';import {checkedImage} from './online-image';
import {safeImageSource} from './display/image-preview';
import {imageExportName} from './image-export-name';
import {draftImages,type DraftRecord} from './draft-store-types';
import {readImageOrigin} from './image-origin';
import {imageDimensions,imageSignatureMatches,sourceImage,IMAGE_RASTER_EDGE,type ImageOriginInfo} from './image-formats';
export type ImageSaveFormat='png'|'jpg'|'jpeg'|'gif'|'webp'|'svg'|'bmp'|'ico'|'avif'|'tif'|'tiff';
export type ExportImage={id:string;name:string;path?:string;src?:string|undefined};
export type ImageExportOwner={threadId:string;connectionId:number;images:{turnId:string;itemId:string;image:ExportImage}[]};
export type ImageRequest={type:'image-export';source?:'draft';expectedSha256?:string;id:number;threadId:string;connectionId:number;turnId:string;itemId:string;imageId:string;kind:'name'|'original'|'png'|'save'};
export type ImageSourceRequest=Omit<ImageRequest,'type'|'kind'>&{type:'image-origin-read';expectedOriginSha256:string};
export type ImageOriginSource={info:ImageOriginInfo;src:string};
export type ImageFrameRequest=Omit<ImageSourceRequest,'type'>&{type:'image-frame-copy';frameIndex:number;png:string};
/** Pixels come from our production browser decoder; this host validates the bounded static PNG and source lease. */
export function animationFrameBytes(png:string,original:ImageOriginSource){
 const src=safeImageSource(png);if(!src?.startsWith('data:image/png;base64,'))throw Error('帧PNG编码无效或超过5 MiB');const body=src.slice(src.indexOf(',')+1),bytes=Buffer.from(body,'base64');if(bytes.toString('base64')!==body||!imageSignatureMatches(bytes,'image/png')||sourceImage('frame.png',bytes).animated)throw Error('帧PNG签名或静态身份无效');const size=imageDimensions(bytes,'image/png'),raw=Buffer.from(original.src.slice(original.src.indexOf(',')+1),'base64'),originSize=imageDimensions(raw,original.info.mime);if(!size||!originSize||size.width>Math.min(IMAGE_RASTER_EDGE,originSize.width)||size.height>Math.min(IMAGE_RASTER_EDGE,originSize.height))throw Error('帧PNG尺寸超出原动画或导出边界');return bytes;
}
export class ImageExporter{
 private busy=false;
 constructor(private root:string,private owner:(request:ImageRequest)=>ImageExportOwner|undefined,private chooseTarget:(kind:ImageSaveFormat,name:string)=>Promise<string|undefined>,private writeText:(text:string)=>PromiseLike<void>,private native=runFormulaScript){}
 private current(m:ImageRequest){if(m.source!==undefined&&m.source!=='draft')throw Error('图片来源类型无效');const o=this.owner(m);if(!o||!Number.isSafeInteger(m.id)||m.id<1||m.threadId!==o.threadId||m.connectionId!==o.connectionId||!['name','original','png','save'].includes(m.kind))throw Error('图片显示身份已失效');const row=o.images.find(v=>v.turnId===m.turnId&&v.itemId===m.itemId&&v.image.id===m.imageId);if(!row)throw Error('图片来源已移除');return row.image;}
 /** Read only a current image's verified animation bytes; never accepts a source path. */
 async readOrigin(m:ImageSourceRequest):Promise<ImageOriginSource>{
  const request:ImageRequest={...m,type:'image-export',kind:'original'},source=this.current(request),check=()=>{const now=this.current(request);if(now.path!==source.path||now.src!==source.src||now.name!==source.name)throw Error('动图显示来源已改变');};
  if(!/^[a-f0-9]{64}$/.test(m.expectedOriginSha256??''))throw Error('原动图显示摘要无效');await assertWorkspaceFiles(this.root);check();if(!source.path)throw Error('该图片没有受控原动图来源');const image=await checkedImage(this.root,source.path,source.id),src=safeImageSource(image.src);if(!src)throw Error('动图预览副本不可用');const bytes=Buffer.from(src.slice(src.indexOf(',')+1),'base64');if(!/^[a-f0-9]{64}$/.test(m.expectedSha256??'')||createHash('sha256').update(bytes).digest('hex')!==m.expectedSha256)throw Error('动图预览已改变');check();
  const origin=await readImageOrigin(this.root,source.path);check();if(!origin?.info.animated||!['image/gif','image/png','image/webp'].includes(origin.info.mime)||origin.info.sha256!==m.expectedOriginSha256)throw Error('原动图缺失、格式或显示摘要已变化');return{info:origin.info,src:`data:${origin.info.mime};base64,${origin.bytes.toString('base64')}`};
 }
  async copyFrame(m:ImageFrameRequest):Promise<'copied'>{
   const request:ImageRequest={...m,type:'image-export',kind:'png'};this.current(request);if(this.busy)throw Error('上一项图片操作尚未结束');if(!Number.isSafeInteger(m.frameIndex)||m.frameIndex<0)throw Error('动图帧编号无效');this.busy=true;
   try{const original=await this.readOrigin({...m,type:'image-origin-read'});if(!Number.isSafeInteger(original.info.frameCount)||m.frameIndex>=original.info.frameCount!)throw Error('动图帧编号越界');const bytes=animationFrameBytes(m.png,original);return await exportCarriers(this.root).temporary<'copied'>('frame',[{name:'frame.png',bytes}],async()=>{this.current(request);},async paths=>{const path=paths.get('frame.png')!;await this.native(formulaValidationScript('','svg',path));const fresh=await this.readOrigin({...m,type:'image-origin-read'});if(JSON.stringify(fresh.info)!==JSON.stringify(original.info)||fresh.src!==original.src)throw Error('复制前原动画来源已改变');await this.native(imageClipScript(path));this.current(request);return 'copied';});}
   finally{this.busy=false;}
  }
 async handle(m:ImageRequest):Promise<'copied'|'saved'|'canceled'>{
  const source=this.current(m);if(this.busy)throw Error('上一项图片操作尚未结束');this.busy=true;
  const check=()=>{const now=this.current(m);if(now.path!==source.path||now.src!==source.src||now.name!==source.name)throw Error('图片来源已改变');};
  try{
   check();
   const image=source.path?await checkedImage(this.root,source.path,source.id):source;
   const src=safeImageSource(image.src);if(!src)throw Error('图片缺失、格式或大小不符合限制');check();
   const bytes=Buffer.from(src.slice(src.indexOf(',')+1),'base64'),kind=src.startsWith('data:image/png;')?'png':'jpg';
   if((m.source==='draft'||source.path)&&(!/^[a-f0-9]{64}$/.test(m.expectedSha256??'')||createHash('sha256').update(bytes).digest('hex')!==m.expectedSha256))throw Error('图片内容已改变，请重新显示后再操作');
   if(kind==='png'?!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw Error('图片签名不匹配');
   const carriers=await displayExportCarriers(this.root);check();
   return await carriers.temporary<'copied'|'saved'|'canceled'>('image',[{name:'image.'+kind,bytes}],async()=>check(),async paths=>{const path=paths.get('image.'+kind)!;
   // Existing mature decoder and 4096-edge export bound; even signature-only corrupt fixtures cannot export.
   await this.native(formulaValidationScript('','svg',path));check();
   const needsOriginal=m.kind!=='png',origin=source.path&&needsOriginal?await readImageOrigin(this.root,source.path):undefined;check();
   const originalName=origin?.info.name??source.name,name=origin?originalName:imageExportName(source.name,kind),originalBytes=origin?.bytes??bytes,format=(origin?extname(name).slice(1).toLowerCase():kind) as ImageSaveFormat;
   const verify=async()=>{check();if(source.path){const fresh=await checkedImage(this.root,source.path,source.id);if(fresh.src!==src)throw Error('图片来源内容已改变');if(needsOriginal){const now=await readImageOrigin(this.root,source.path);if(JSON.stringify(now?.info)!==JSON.stringify(origin?.info))throw Error('原图片来源已改变');}}check();};
   if(m.kind==='name'){await verify();await this.writeText(originalName);check();return 'copied';}
   // A user-selected display export stays inside the open workspace. It does not
   // require (or grant) the separate model/attachment test-workspace authority.
   if(m.kind==='save'){if(!this.root)throw Error('请先打开本地文件夹，再保存图片');await ownedPath(this.root,'.');const target=await this.chooseTarget(format,name);if(!target)return 'canceled';await verify();const safe=await ownedPath(this.root,target);if(relative(this.root,safe).split(/[\\/]/)[0]!.toLowerCase().startsWith('.codex-'))throw Error('不能覆盖内部附件或导出存储');if(format==='jpg'||format==='jpeg'?!/^\.jpe?g$/i.test(extname(safe)):extname(safe).toLowerCase()!=='.'+format)throw Error('请选择与原图片一致的扩展名');check();await writeFile(safe,originalBytes);check();return 'saved';}
   if(m.kind==='png'){await verify();await this.native(kind==='png'?imageClipScript(path):imageFileClipScript(path));check();return 'copied';}
   // Validate format before retaining a carrier; unsupported originals never
   // report a file path or text copy as a successful image copy.
   originalImageClipScript('',format);
   return await carriers.copy('image',name,originalBytes,verify,path=>this.native(originalImageClipScript(path,format)));
   });
  }finally{this.busy=false;}
 }
}
/** Draft identity is local display metadata; never a fabricated runtime history item. */
export function draftImageOwner(identity:{threadId:string;connectionId:number},draft:DraftRecord):ImageExportOwner{
 return {threadId:identity.threadId,connectionId:identity.connectionId,images:draftImages(draft).filter(v=>v.token).map(v=>({turnId:'',itemId:'',image:{id:v.token,path:v.path,name:v.path.split(/[\\/]/).at(-1)||'图片'}}))};
}
/** Only local images from the current public projection are admitted online. */
export function projectionImages(o:{threadId:string;connectionId:number;items:{turnId:string;item:{id:string;type:string;content?:unknown}}[]}):ImageExportOwner{
 const images:ImageExportOwner['images']=[];for(const row of o.items){if(row.item.type!=='userMessage'||!Array.isArray(row.item.content))continue;row.item.content.forEach((part,index)=>{if(part.type==='localImage'&&typeof part.path==='string')images.push({turnId:row.turnId,itemId:row.item.id,image:{id:part.displayImage?.id??JSON.stringify([o.threadId,row.turnId,row.item.id,index]),path:part.path,name:part.displayImage?.name??part.path.split(/[\\/]/).at(-1)??'image'}});});}return{threadId:o.threadId,connectionId:o.connectionId,images};
}
