import {ATTACHMENT_BYTES,attachmentKind} from './attachment-policy';
const chrome=require('../webview-chrome.js') as {animatedKindOfBytes:(bytes:Uint8Array)=>'gif'|'png'|'webp'|undefined};
export const IMAGE_SOURCE_BYTES=25*1024*1024; // DSH165 default source-file limit; runtime copies remain 5 MiB.
export const IMAGE_DECODE_PIXELS=16*1024*1024;
export const IMAGE_RASTER_EDGE=4096,IMAGE_RASTER_MIN_EDGE=512;
export const IMAGE_ANIMATION_FRAME_CAP=100_000;
export type ImageMime='image/png'|'image/jpeg'|'image/gif'|'image/webp'|'image/svg+xml'|'image/bmp'|'image/vnd.microsoft.icon'|'image/avif'|'image/tiff';
export type ImageOriginInfo={name:string;mime:ImageMime;size:number;sha256:string;animated:boolean;transformation:'rasterized'|'compressed'|'frame'|'animation';groupId?:string;frameIndex?:number;frameCount?:number};
export const ANIMATION_INPUT_NOTICE='未选帧时提交原动图；当前Codex联调仅观察到首帧，多帧请手动选择';
export function originDescription(info:ImageOriginInfo){return info.transformation==='animation'?ANIMATION_INPUT_NOTICE:info.transformation==='frame'?(info.frameIndex===undefined?'已选静态帧':'已选第'+String(info.frameIndex+1)+'帧')+'；原动图保留':info.transformation==='compressed'?'发送白底JPEG副本；原图保留':'发送PNG副本；原图保留';}
export function isAnimationPosterPath(path:string){return /(?:^|\/)\.codex-attachments\/[0-9a-f-]{36}\/animated\/[^/]+$/i.test(path.replace(/\\/g,'/'));}
export function isAnimationSourcePath(path:string){return /(?:^|\/)\.codex-attachments\/[0-9a-f-]{36}\/source\.bin$/i.test(path.replace(/\\/g,'/'));}
export function validAnimationIdentity(value:ImageOriginInfo){const any=value.groupId!==undefined||value.frameIndex!==undefined||value.frameCount!==undefined;if(value.transformation!=='animation'&&!any)return true;return value.animated===true&&['animation','frame'].includes(value.transformation)&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.groupId??'')&&Number.isSafeInteger(value.frameCount)&&value.frameCount!>=2&&value.frameCount!<=IMAGE_ANIMATION_FRAME_CAP&&Number.isSafeInteger(value.frameIndex)&&value.frameIndex!>=0&&value.frameIndex!<value.frameCount!;}
const types:Record<string,ImageMime>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',bmp:'image/bmp',ico:'image/vnd.microsoft.icon',avif:'image/avif',tif:'image/tiff',tiff:'image/tiff'};
export function imageSourceMime(name:unknown):ImageMime|undefined{
 if(typeof name!=='string')return;const type=types[name.split('.').at(-1)?.toLowerCase()??''];if(!type)return;
 // Reuse existing name admission; extensions do not grant any path-read authority.
 if(name.length>180)throw Error('图片名称过长');attachmentKind(name.replace(/\.[^.]+$/,'.png'));return type;
}
const ascii=(bytes:Uint8Array,start:number,length:number)=>String.fromCharCode(...bytes.subarray(start,start+length));
const u32be=(b:Uint8Array,i:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(i,false);
const u32le=(b:Uint8Array,i:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(i,true);
export function imageSignatureMatches(bytes:Uint8Array,mime:ImageMime){
 if(!bytes.length)return false;
 switch(mime){
  case 'image/png':return bytes.length>=24&&ascii(bytes,0,8)==='\x89PNG\r\n\x1a\n'&&ascii(bytes,12,4)==='IHDR';
  case 'image/jpeg':return bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  case 'image/gif':return bytes.length>=13&&['GIF87a','GIF89a'].includes(ascii(bytes,0,6));
  case 'image/webp':return bytes.length>=20&&ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,4)==='WEBP'&&u32le(bytes,4)+8===bytes.length;
  case 'image/bmp':return bytes.length>=26&&ascii(bytes,0,2)==='BM';
  case 'image/vnd.microsoft.icon':return bytes.length>=22&&ascii(bytes,0,4)==='\0\0\x01\0'&&bytes[4]!+bytes[5]!*256>0;
  case 'image/tiff':return bytes.length>=8&&['II\x2a\0','MM\0\x2a'].includes(ascii(bytes,0,4));
  case 'image/avif':{
   if(bytes.length<24||ascii(bytes,4,4)!=='ftyp')return false;const end=u32be(bytes,0);if(end<24||end>bytes.length||end>256)return false;
   for(let i=8;i+4<=end;i+=4)if(i!==12&&['avif','avis'].includes(ascii(bytes,i,4)))return true;return false;
  }
  case 'image/svg+xml':{
   const text=new TextDecoder('utf-8',{fatal:false}).decode(bytes);return /<(?:[a-z_][\w.-]*:)?svg(?:\s|>)/i.test(text)&&!/[\x00]/.test(text);
  }
 }
}
export function sourceImage(name:unknown,bytes:Uint8Array){const mime=imageSourceMime(name);if(!mime||!bytes.length||bytes.length>IMAGE_SOURCE_BYTES||!imageSignatureMatches(bytes,mime))throw Error('原图片格式/签名不匹配、为空或超过25 MiB来源上限');return{mime,animated:chrome.animatedKindOfBytes(bytes)!==undefined};}
export function encodedImageBytes(dataUrl:string){
 const mark=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);if(!mark||!mark[2]||mark[2].length%4)throw Error('转换后图片编码无效');
 const payload=mark[2],padding=payload.endsWith('==')?2:payload.endsWith('=')?1:0;return{mime:mark[1] as 'image/png'|'image/jpeg',base64:payload,bytes:payload.length/4*3-padding};
}
export function checkedRuntimeImage(dataUrl:string){const value=encodedImageBytes(dataUrl);if(!value.bytes||value.bytes>ATTACHMENT_BYTES)throw Error('图片转换后仍超过5 MiB，未附加');return value;}
/** Header dimensions before decode, including large JPEGs; malformed headers remain unavailable. */
export function imageDimensions(bytes:Uint8Array,mime:ImageMime):{width:number;height:number}|undefined{
 let width=0,height=0;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(mime==='image/png'&&bytes.length>=24){width=u32be(bytes,16);height=u32be(bytes,20);}
 else if(mime==='image/gif'&&bytes.length>=10){width=view.getUint16(6,true);height=view.getUint16(8,true);}
 else if(mime==='image/bmp'&&bytes.length>=26){const dib=u32le(bytes,14);if(dib===12){width=view.getUint16(18,true);height=view.getUint16(20,true);}else if(bytes.length>=30){width=Math.abs(view.getInt32(18,true));height=Math.abs(view.getInt32(22,true));}}
 else if(mime==='image/vnd.microsoft.icon'&&bytes.length>=22){
  const count=view.getUint16(4,true);if(!count||count>256||6+count*16>bytes.length)return;
  for(let i=0;i<count;i++){const at=6+i*16,size=u32le(bytes,at+8),offset=u32le(bytes,at+12);if(size<12||offset<6+count*16||size>bytes.length-offset)return;const source=bytes.subarray(offset,offset+size);let w=0,h=0;
   if(imageSignatureMatches(source,'image/png')){const dimensions=imageDimensions(source,'image/png');if(!dimensions)return;w=dimensions.width;h=dimensions.height;}
   else{const dib=u32le(source,0),head=new DataView(source.buffer,source.byteOffset,source.byteLength);if(dib===12){w=head.getUint16(4,true);h=head.getUint16(6,true)/2;}else if(dib>=40&&dib<=size){w=Math.abs(head.getInt32(4,true));h=Math.abs(head.getInt32(8,true))/2;}else return;}
   if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1)return;width=Math.max(width,w);height=Math.max(height,h);
  }
 }
 else if(mime==='image/webp'){
  for(let i=12;i+8<=bytes.length;){const type=ascii(bytes,i,4),size=u32le(bytes,i+4),p=i+8;if(size>bytes.length-p)return;
   if(type==='VP8X'&&size>=10){width=1+bytes[p+4]!+(bytes[p+5]!<<8)+(bytes[p+6]!<<16);height=1+bytes[p+7]!+(bytes[p+8]!<<8)+(bytes[p+9]!<<16);break;}
   if(type==='VP8L'&&size>=5&&bytes[p]===47){const packed=u32le(bytes,p+1);width=1+(packed&16383);height=1+((packed>>>14)&16383);break;}
   if(type==='VP8 '&&size>=10&&ascii(bytes,p+3,3)==='\x9d\x01\x2a'){width=view.getUint16(p+6,true)&16383;height=view.getUint16(p+8,true)&16383;break;}
   i=p+size+(size&1);
  }
 }
 else if(mime==='image/avif'){
  // Read image spatial extents only along ISO-BMFF metadata boxes. Ambiguous
  // primary/thumbnail extents are unavailable rather than guessed before decode.
  const found:{width:number;height:number}[]=[];let boxes=0;
  const walk=(start:number,end:number,depth:number):boolean=>{if(depth>4)return false;for(let i=start;i<end;){if(++boxes>4096||i+8>end)return false;let size=u32be(bytes,i),header=8;const type=ascii(bytes,i+4,4);if(size===0)size=end-i;else if(size===1){if(i+16>end)return false;const large=view.getBigUint64(i+8,false);if(large>BigInt(end-i))return false;size=Number(large);header=16;}if(size<header||size>end-i)return false;
   if(type==='ispe'){if(size!==header+12)return false;found.push({width:u32be(bytes,i+header+4),height:u32be(bytes,i+header+8)});}
   else if(['meta','iprp','ipco'].includes(type)&&!walk(i+header+(type==='meta'?4:0),i+size,depth+1))return false;i+=size;}return true;};
  if(!walk(0,bytes.length,0)||!found.length||found.some(v=>v.width!==found[0]!.width||v.height!==found[0]!.height))return;({width,height}=found[0]!);
 }
 else if(mime==='image/jpeg'){
  let i=2;while(i+4<=bytes.length){if(bytes[i++]!==255)return;while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===undefined||marker===217||marker===218)return;if(marker===1||marker>=208&&marker<=215)continue;if(i+2>bytes.length)return;const size=view.getUint16(i,false);if(size<2||i+size>bytes.length)return;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=8){height=view.getUint16(i+3,false);width=view.getUint16(i+5,false);break;}i+=size;
  }
 }
 return Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0?{width,height}:undefined;
}
