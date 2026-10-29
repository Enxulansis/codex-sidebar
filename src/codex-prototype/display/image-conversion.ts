import {ATTACHMENT_BYTES} from '../attachment-policy';
import {IMAGE_DECODE_PIXELS,IMAGE_RASTER_EDGE,IMAGE_RASTER_MIN_EDGE,sourceImage,imageDimensions,checkedRuntimeImage,ANIMATION_INPUT_NOTICE,type ImageMime} from '../image-formats';
import {sourceBytes,closeDecoder,decodeFrame,type Frame,type Decoder} from './image-decode';
import {AnimatedImage,verifyStaticAnimationContainer} from './animated-image';
declare const TIFF_WORKER_SOURCE:string;
type DecoderConstructor=new(init:{data:Uint8Array;type:string;desiredWidth?:number;desiredHeight?:number;preferAnimation?:boolean})=>Decoder;
type Decoded={source:CanvasImageSource;width:number;height:number;release:()=>void};
export type PreparedImage={name:string;mime:'image/png'|'image/jpeg';base64:string;bytes:number;original:{name:string;mime:ImageMime;base64:string;size:number;groupId?:string;frameIndex?:number;frameCount?:number};transformation:'none'|'rasterized'|'compressed'|'animation'|'frame';note:string};
const DecoderType=()=>(globalThis as unknown as {ImageDecoder?:DecoderConstructor}).ImageDecoder;
const canceled=(signal:AbortSignal)=>{if(signal.aborted)throw Error('图片准备已取消');};
const dimensions=(width:number,height:number)=>{if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>IMAGE_DECODE_PIXELS)throw Error('图片解码像素超限或尺寸无效，未附加');};
export function rasterSize(width:number,height:number){if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('图片尺寸无效');const longest=Math.max(width,height),factor=longest>IMAGE_RASTER_EDGE?IMAGE_RASTER_EDGE/longest:longest<IMAGE_RASTER_MIN_EDGE?IMAGE_RASTER_MIN_EDGE/longest:1;if(!Number.isFinite(factor))throw Error('图片尺寸无效');return{width:Math.max(1,Math.round(width*factor)),height:Math.max(1,Math.round(height*factor))};}
export function compressionSteps(edge=4096,quality=82){return[{edge,quality:quality/100},{edge:Math.max(512,Math.round(edge*.75)),quality:Math.max(.4,quality/100*.88)},{edge:Math.max(512,Math.round(edge*.55)),quality:.6}];}

/** SVG stays an image: no active content, external references, entity expansion or foreign HTML. */
export function safeRasterSvg(bytes:Uint8Array){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('SVG外部实体不允许转码');
 const doc=new DOMParser().parseFromString(text,'image/svg+xml'),root=doc.documentElement;
 if(root.localName!=='svg'||root.namespaceURI!=='http://www.w3.org/2000/svg'||doc.querySelector('parsererror'))throw Error('SVG文档无效');
 if(doc.querySelector('script,foreignObject,iframe,object,embed,audio,video,animate,animateMotion,animateTransform,set'))throw Error('SVG活动内容不允许转码');
 const instructions=doc.createTreeWalker(doc,NodeFilter.SHOW_PROCESSING_INSTRUCTION);if(instructions.nextNode())throw Error('SVG处理指令不允许转码');
 const checkedCss=(value:string)=>{if(/\\|@import|javascript:|image-set\s*\(/i.test(value))throw Error('SVG外部或转义样式资源不允许转码');const local=value.replace(/url\(\s*(['"]?)#[\w.-]+\1\s*\)/gi,'');if(/url\s*\(/i.test(local))throw Error('SVG外部样式资源不允许转码');};
 for(const element of doc.querySelectorAll('*'))for(const attribute of element.attributes){const value=attribute.value.trim();if(/^on/i.test(attribute.localName))throw Error('SVG活动内容不允许转码');if(['href','src'].includes(attribute.localName)&&value&&!value.startsWith('#'))throw Error('SVG外部或嵌套资源不允许转码');checkedCss(value);}
 for(const style of doc.querySelectorAll('style'))checkedCss(style.textContent??'');
 const viewBox=(root.getAttribute('viewBox')??'').trim().split(/[\s,]+/).map(Number),view=viewBox.length===4&&viewBox.every(Number.isFinite)&&viewBox[2]!>0&&viewBox[3]!>0?viewBox:undefined;
 const length=(value:string|null,fallback:number)=>{if(value===null||value===''||value.trim().endsWith('%'))return fallback;const match=/^([\d.]+)(px|pt|pc|mm|cm|in)?$/i.exec(value.trim());if(!match)throw Error('SVG尺寸单位无法核对');return Number(match[1])*({px:1,pt:96/72,pc:16,mm:96/25.4,cm:96/2.54,in:96}[match[2]?.toLowerCase()??'px']??1);};
 const width=length(root.getAttribute('width'),view?.[2]??300),height=length(root.getAttribute('height'),view?.[3]??150),size=rasterSize(width,height);
 if(!view)root.setAttribute('viewBox',`0 0 ${width} ${height}`);root.setAttribute('width',String(size.width));root.setAttribute('height',String(size.height));const style=(root as unknown as SVGSVGElement).style;style.setProperty('width',size.width+'px','important');style.setProperty('height',size.height+'px','important');
 return new XMLSerializer().serializeToString(root);
}
async function decodeNative(src:string,signal:AbortSignal):Promise<Decoded>{
 canceled(signal);const image=new Image();
 try{await new Promise<void>((resolve,reject)=>{const clean=()=>{image.onload=image.onerror=null;signal.removeEventListener('abort',abort);clearTimeout(timer);},abort=()=>{clean();image.removeAttribute('src');reject(Error('图片准备已取消'));},timer=setTimeout(()=>{clean();image.removeAttribute('src');reject(Error('图片解码超时'));},10000);image.onload=()=>{clean();resolve();};image.onerror=()=>{clean();reject(Error('图片无法解码'));};signal.addEventListener('abort',abort,{once:true});image.src=src;});canceled(signal);dimensions(image.naturalWidth,image.naturalHeight);return{source:image,width:image.naturalWidth,height:image.naturalHeight,release:()=>image.removeAttribute('src')};}
 catch(error){image.removeAttribute('src');throw error;}
}
let resizedDecode:boolean|undefined;
/** Check the current host, not just the presence of ImageDecoder. No source image is used here. */
async function supportsResizedDecode(signal:AbortSignal){if(resizedDecode!==undefined)return resizedDecode;const Type=DecoderType();if(!Type)return false;const canvas=document.createElement('canvas');canvas.width=canvas.height=2;let decoder:Decoder|undefined,frame:Frame|undefined;try{const {bytes}=sourceBytes(canvas.toDataURL('image/png'));decoder=new Type({data:bytes,type:'image/png',desiredWidth:1,desiredHeight:1});frame=await decodeFrame(decoder,signal,2000);return resizedDecode=(frame.displayWidth??frame.codedWidth)===1&&(frame.displayHeight??frame.codedHeight)===1;}catch{canceled(signal);return false;}finally{frame?.close?.();if(decoder)closeDecoder(decoder);canvas.width=canvas.height=0;}}
async function decodeScaled(bytes:Uint8Array,mime:ImageMime,src:string,signal:AbortSignal):Promise<Decoded>{
 const original=imageDimensions(bytes,mime),large=!!original&&original.width*original.height>IMAGE_DECODE_PIXELS,Type=DecoderType();
 if(mime!=='image/svg+xml'&&!original)throw Error('无法在解码前可靠核对图片尺寸，未附加');
 if(large){if(!Type||!await supportsResizedDecode(signal))throw Error('当前浏览器不能安全缩放解码此大图；未全量展开或附加');canceled(signal);const factor=Math.min(1,IMAGE_RASTER_EDGE/Math.max(original.width,original.height)),width=Math.max(1,Math.round(original.width*factor)),height=Math.max(1,Math.round(original.height*factor));
  // WebCodecs ImageDecoderInit owns both desired dimensions; decode() only selects a frame.
  const decoder=new Type({data:bytes,type:mime,desiredWidth:width,desiredHeight:height});let frame:Frame|undefined;
  try{frame=await decodeFrame(decoder,signal);canceled(signal);const w=frame.displayWidth??frame.codedWidth??0,h=frame.displayHeight??frame.codedHeight??0;dimensions(w,h);if(w>width||h>height)throw Error('浏览器没有执行请求的缩放解码，未附加');const image=frame;return{source:image,width:w,height:h,release:()=>{image.close?.();closeDecoder(decoder);}};}
  catch(error){frame?.close?.();closeDecoder(decoder);throw error;}
 }
 return decodeNative(src,signal);
}
function canvasOf(decoded:Decoded,width:number,height:number,white=false){dimensions(width,height);const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw Error('图片画布不可用');if(white){context.fillStyle='#ffffff';context.fillRect(0,0,width,height);}context.drawImage(decoded.source,0,0,width,height);return canvas;}
function rasterize(decoded:Decoded,signal:AbortSignal){canceled(signal);const size=rasterSize(decoded.width,decoded.height),canvas=canvasOf(decoded,size.width,size.height);try{return canvas.toDataURL('image/png');}finally{canvas.width=canvas.height=0;}}
function compressForUpload(decoded:Decoded,signal:AbortSignal){
 for(const step of compressionSteps()){canceled(signal);const factor=Math.min(1,step.edge/Math.max(decoded.width,decoded.height)),canvas=canvasOf(decoded,Math.max(1,Math.round(decoded.width*factor)),Math.max(1,Math.round(decoded.height*factor)),true);try{const jpeg=canvas.toDataURL('image/jpeg',step.quality);try{return{dataUrl:jpeg,...checkedRuntimeImage(jpeg)};}catch{ /* Try the next original DSH compression step, including a strict final bound. */ }}finally{canvas.width=canvas.height=0;}}
 throw Error('图片压缩后仍超过5 MiB，已跳过；未把超限结果标为成功');
}
async function decodeTiff(bytes:Uint8Array,signal:AbortSignal):Promise<Decoded>{
 canceled(signal);if(typeof TIFF_WORKER_SOURCE==='undefined'||!TIFF_WORKER_SOURCE)throw Error('TIFF解码资源缺失');const url=URL.createObjectURL(new Blob([TIFF_WORKER_SOURCE],{type:'text/javascript'}));let worker:Worker|undefined;
 try{worker=new Worker(url);const value=await new Promise<{width:number;height:number;rgba:Uint8Array}>((resolve,reject)=>{const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);worker!.onmessage=worker!.onerror=null;},fail=(message:string)=>{clean();worker!.terminate();reject(Error(message));},abort=()=>fail('图片准备已取消'),timer=setTimeout(()=>fail('TIFF解码超时'),10000);signal.addEventListener('abort',abort,{once:true});worker!.onerror=()=>fail('TIFF解码失败');worker!.onmessage=event=>{clean();if(event.data?.error)reject(Error(event.data.error));else resolve(event.data);};const data=Uint8Array.from(bytes);worker!.postMessage(data.buffer,[data.buffer]);});canceled(signal);dimensions(value.width,value.height);if(!(value.rgba instanceof Uint8Array)||value.rgba.length!==value.width*value.height*4)throw Error('TIFF像素数据无效');const pixels=new ImageData(new Uint8ClampedArray(value.rgba.buffer as ArrayBuffer,value.rgba.byteOffset,value.rgba.byteLength),value.width,value.height),bitmap=await createImageBitmap(pixels);try{canceled(signal);return{source:bitmap,width:value.width,height:value.height,release:()=>bitmap.close()};}catch(error){bitmap.close();throw error;}
 }finally{worker?.terminate();URL.revokeObjectURL(url);}
}
/** DSH165 raster/white-JPEG steps, with real byte bounds and a cancellation lease. */
export async function prepareImage(name:string,dataUrl:string,signal:AbortSignal):Promise<PreparedImage>{
 canceled(signal);const source=sourceBytes(dataUrl),info=sourceImage(name,source.bytes);if(info.animated){const animation=await AnimatedImage.open(name,dataUrl,signal);try{const frame=await animation.png(0);return{name:name.replace(/\.[^.]+$/,'')+'-预览.png',mime:'image/png',base64:frame.base64,bytes:frame.bytes,original:{name,mime:info.mime,base64:source.base64,size:source.bytes.length,groupId:crypto.randomUUID(),frameIndex:0,frameCount:animation.count},transformation:'animation',note:ANIMATION_INPUT_NOTICE};}finally{animation.close();}}await verifyStaticAnimationContainer(source.bytes,info.mime,signal);
 const src=info.mime==='image/svg+xml'?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(safeRasterSvg(source.bytes)):`data:${info.mime};base64,${source.base64}`;
 const decoded=info.mime==='image/tiff'?await decodeTiff(source.bytes,signal):await decodeScaled(source.bytes,info.mime,src,signal);
 try{
  canceled(signal);let transformation:PreparedImage['transformation']='none',output=src,note='';const originalDimensions=imageDimensions(source.bytes,info.mime),originalEdge=originalDimensions?Math.max(originalDimensions.width,originalDimensions.height):Math.max(decoded.width,decoded.height);
  if(!['image/png','image/jpeg'].includes(info.mime)){output=rasterize(decoded,signal);transformation='rasterized';note=(info.mime==='image/tiff'?'TIFF仅转换首个图像为PNG':'已转为PNG')+'，保留原文件来源';}
  if(source.bytes.length>ATTACHMENT_BYTES||originalEdge>IMAGE_RASTER_EDGE||(()=>{try{checkedRuntimeImage(output);return false;}catch{return true;}})()){output=compressForUpload(decoded,signal).dataUrl;transformation='compressed';note='已缩放为白底JPEG，保留原文件来源；发送副本不包含透明通道';}
  canceled(signal);const result=checkedRuntimeImage(output),extension=result.mime==='image/png'?'.png':'.jpg',target=transformation==='none'?name:name.replace(/\.[^.]+$/,extension);
  return{name:target,mime:result.mime,base64:result.base64,bytes:result.bytes,original:{name,mime:info.mime,base64:source.base64,size:source.bytes.length},transformation,note};
 }finally{decoded.release();}
}
