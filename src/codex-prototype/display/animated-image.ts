/** DSH165 frame decode/sampling, with an owned decoder and cancellation lease. */
import {IMAGE_DECODE_PIXELS,IMAGE_RASTER_EDGE,IMAGE_ANIMATION_FRAME_CAP,sourceImage,imageDimensions,checkedRuntimeImage,type ImageMime} from '../image-formats';
import {sourceBytes,closeDecoder,decodeFrame,type Decoder,type Frame} from './image-decode';
type AnimationDecoder=Decoder&{tracks:{ready:Promise<void>;selectedTrack:{frameCount:number}|null};completed:Promise<void>};
type AnimationDecoderConstructor=new(init:{data:Uint8Array;type:string;preferAnimation:boolean})=>AnimationDecoder;
export const MAX_ANIMATION_FRAMES=IMAGE_ANIMATION_FRAME_CAP;
const current=(signal:AbortSignal)=>{if(signal.aborted)throw Error('动图操作已取消');};
export function animationFrameIndices(count:number,maxFrames=60){
 if(!Number.isSafeInteger(count)||count<1||count>MAX_ANIMATION_FRAMES||!Number.isInteger(maxFrames)||maxFrames<1||maxFrames>240)throw Error('动图帧数或抽样数量无效');
 const step=count>maxFrames?Math.ceil(count/maxFrames):1,indices:number[]=[];for(let index=0;index<count;index+=step)indices.push(index);return indices;
}
function waitForTracks(decoder:AnimationDecoder,signal:AbortSignal){
 current(signal);return new Promise<void>((resolve,reject)=>{const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);},abort=()=>{clean();closeDecoder(decoder);reject(Error('动图操作已取消'));},timer=setTimeout(()=>{clean();closeDecoder(decoder);reject(Error('动图元数据读取超时'));},10000);signal.addEventListener('abort',abort,{once:true});Promise.all([decoder.tracks.ready,decoder.completed]).then(()=>{clean();resolve();},error=>{clean();reject(error);});});
}
/** Unknown/truncated animation structure must not silently fall back to sending frame zero. */
export async function verifyStaticAnimationContainer(bytes:Uint8Array,mime:ImageMime,signal:AbortSignal){
 let candidate=mime==='image/gif'||mime==='image/webp';if(mime==='image/png')for(let i=0;i+4<=bytes.length;i++)if(bytes[i]===97&&bytes[i+1]===99&&bytes[i+2]===84&&bytes[i+3]===76){candidate=true;break;}if(!candidate)return;
 current(signal);const Type=(globalThis as unknown as {ImageDecoder?:AnimationDecoderConstructor}).ImageDecoder;if(!Type)throw Error('当前宿主无法核对该格式是否包含动画，未附加');const decoder=new Type({data:bytes,type:mime,preferAnimation:true});try{await waitForTracks(decoder,signal);current(signal);if(decoder.tracks.selectedTrack?.frameCount!==1)throw Error('动画结构或帧数无法核对；不会默认发送首帧');}finally{closeDecoder(decoder);}
}
export class AnimatedImage {
 private closed=false;private request=0;
 private abort=()=>this.close();
 private constructor(private decoder:AnimationDecoder,private signal:AbortSignal,readonly name:string,readonly mime:ImageMime,readonly base64:string,readonly count:number,readonly width:number,readonly height:number){signal.addEventListener('abort',this.abort,{once:true});}
 static async open(name:string,dataUrl:string,signal:AbortSignal){
  current(signal);const source=sourceBytes(dataUrl),info=sourceImage(name,source.bytes),size=imageDimensions(source.bytes,info.mime);if(!info.animated||!size)throw Error('没有可核对的多帧图片');if(size.width*size.height>IMAGE_DECODE_PIXELS)throw Error('动图逻辑画布超过16M像素，未解码');
  const Type=(globalThis as unknown as {ImageDecoder?:AnimationDecoderConstructor}).ImageDecoder;if(!Type)throw Error('当前宿主不支持动图逐帧解码');const decoder=new Type({data:source.bytes,type:info.mime,preferAnimation:true});
  try{await waitForTracks(decoder,signal);current(signal);const count=decoder.tracks.selectedTrack?.frameCount??0;animationFrameIndices(count);if(count<2)throw Error('解码器未确认多帧内容');return new AnimatedImage(decoder,signal,name,info.mime,source.base64,count,size.width,size.height);}catch(error){closeDecoder(decoder);throw error;}
 }
 async frame(index:number){
  this.ensure();if(!Number.isSafeInteger(index)||index<0||index>=this.count)throw Error('动图帧编号越界');const request=++this.request;let image:Frame|undefined,canvas:HTMLCanvasElement|undefined;
  try{image=await decodeFrame(this.decoder,this.signal,10000,index);this.ensure();if(request!==this.request)throw Error('旧帧读取已失效');const width=image.displayWidth??image.codedWidth??0,height=image.displayHeight??image.codedHeight??0;if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>this.width||height>this.height||width*height>IMAGE_DECODE_PIXELS)throw Error('动图帧尺寸与逻辑画布不符');
   canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw Error('动图画布不可用');context.drawImage(image,0,0);const durationMs=typeof image.duration==='number'&&Number.isFinite(image.duration)&&image.duration>0?image.duration/1000:100;return{canvas,index,durationMs};
  }catch(error){if(canvas)canvas.width=canvas.height=0;throw error;}finally{image?.close?.();}
 }
 /** Alpha is retained. Large selected frames shrink as PNG and never become white JPEG. */
 async png(index:number){
  const frame=await this.frame(index);try{for(const edge of [IMAGE_RASTER_EDGE,3072,2253,1536,1024,512]){this.ensure();const scale=Math.min(1,edge/Math.max(frame.canvas.width,frame.canvas.height)),width=Math.max(1,Math.round(frame.canvas.width*scale)),height=Math.max(1,Math.round(frame.canvas.height*scale)),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    try{const context=canvas.getContext('2d');if(!context)throw Error('动图画布不可用');context.drawImage(frame.canvas,0,0,width,height);const dataUrl=canvas.toDataURL('image/png');let encoded;try{encoded=checkedRuntimeImage(dataUrl);}catch{continue;}return{...encoded,mime:'image/png' as const,dataUrl,name:this.name.replace(/\.[^.]+$/,'')+'-帧'+String(index+1)+'.png',index,width,height,scaled:width!==frame.canvas.width||height!==frame.canvas.height,durationMs:frame.durationMs};}finally{canvas.width=canvas.height=0;}
   }throw Error('静态帧PNG缩放后仍超过5 MiB，未选入发送');
  }finally{frame.canvas.width=frame.canvas.height=0;}
 }
 private ensure(){current(this.signal);if(this.closed)throw Error('动图来源已关闭');}
 close(){if(this.closed)return;this.closed=true;this.request++;this.signal.removeEventListener('abort',this.abort);closeDecoder(this.decoder);}
}
