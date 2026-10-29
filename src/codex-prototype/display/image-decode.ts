import {IMAGE_SOURCE_BYTES} from '../image-formats';
export type Frame=CanvasImageSource&{displayWidth?:number;displayHeight?:number;codedWidth?:number;codedHeight?:number;duration?:number|null;close?:()=>void};
export type Decoder={decode:(options:{frameIndex:number;completeFramesOnly?:boolean})=>Promise<{image:Frame}>;close:()=>void};
export function sourceBytes(dataUrl:string){const match=/^data:[^,]*;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);if(!match||match[1]!.length%4||match[1]!.length>Math.ceil(IMAGE_SOURCE_BYTES/3)*4)throw Error('原图片编码无效或超限');const raw=atob(match[1]!),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return{bytes,base64:match[1]!};}
export function closeDecoder(decoder:Decoder){try{decoder.close();}catch{/* Already closed by cancellation. */}}
/** A timed-out/canceled request owns and releases even a decoder's late frame. */
export function decodeFrame(decoder:Decoder,signal:AbortSignal,timeout=10000,frameIndex=0):Promise<Frame>{
 if(signal.aborted)return Promise.reject(Error('图片准备已取消'));return new Promise((resolve,reject)=>{let settled=false;const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);},fail=(message:string)=>{if(settled)return;settled=true;clean();closeDecoder(decoder);reject(Error(message));},abort=()=>fail('图片准备已取消'),timer=setTimeout(()=>fail('图片解码超时'),timeout);signal.addEventListener('abort',abort,{once:true});
  let pending:Promise<{image:Frame}>;try{pending=decoder.decode({frameIndex,completeFramesOnly:true});}catch(error){settled=true;clean();reject(error);return;}
  pending.then(result=>{if(settled){result.image.close?.();return;}settled=true;clean();resolve(result.image);},error=>{if(settled)return;settled=true;clean();reject(error);});
 });
}
