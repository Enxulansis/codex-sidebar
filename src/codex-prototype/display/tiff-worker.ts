import {decodeTiffPixels} from '../tiff-decode';
const scope=globalThis as unknown as {onmessage:(event:MessageEvent)=>void;postMessage:(value:unknown,transfer?:ArrayBuffer[])=>void};
scope.onmessage=event=>{try{const image=decodeTiffPixels(new Uint8Array(event.data));scope.postMessage(image,[image.rgba.buffer as ArrayBuffer]);}catch(error){scope.postMessage({error:error instanceof Error?error.message:'TIFF解码失败'});}};
