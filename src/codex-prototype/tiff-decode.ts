import {IMAGE_DECODE_PIXELS,IMAGE_SOURCE_BYTES} from './image-formats';
const UTIF=require('utif2') as {decodeImage:(buffer:ArrayBuffer,page:Record<string,any>)=>void;toRGBA8:(page:Record<string,any>)=>Uint8Array};
const pako=require('pako') as {inflateRaw:(data:Uint8Array)=>Uint8Array;Inflate:new(options:object)=>{onData:(part:Uint8Array)=>void;push:(data:Uint8Array,last:boolean)=>void;err:number;msg:string}};
const WORK_BYTES=128*1024*1024;
const TAGS=new Set([256,257,258,259,262,266,273,277,278,279,284,317,320,322,323,324,325,338,339]);
/** Only the first raster IFD is relevant. Never recursively decode EXIF/sub-IFD chains. */
export function tiffPage(bytes:Uint8Array){
 if(bytes.length<8||bytes.length>IMAGE_SOURCE_BYTES)throw Error('TIFF来源大小无效');const little=bytes[0]===73&&bytes[1]===73,big=bytes[0]===77&&bytes[1]===77,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const u16=(i:number)=>view.getUint16(i,little),u32=(i:number)=>view.getUint32(i,little);if((!little&&!big)||u16(2)!==42)throw Error('TIFF签名无效');
 const offset=u32(4);if(offset<8||offset+2>bytes.length)throw Error('TIFF目录无效');const count=u16(offset);if(count>256||offset+2+count*12+4>bytes.length)throw Error('TIFF目录过大或不完整');const page:Record<string,number[]>={};
 for(let i=0;i<count;i++){const at=offset+2+i*12,tag=u16(at);if(!TAGS.has(tag))continue;if(page['t'+tag])throw Error('TIFF关键标签重复');const type=u16(at+2),length=u32(at+4),size=type===3?2:type===4?4:type===1?1:0;if(!size||!length||length>8192)throw Error('TIFF关键标签类型或数量不受支持');const start=length*size<=4?at+8:u32(at+8);if(start+length*size>bytes.length)throw Error('TIFF标签越界');page['t'+tag]=Array.from({length},(_,j)=>type===3?u16(start+j*size):type===4?u32(start+j*size):bytes[start+j]!);}
 const width=page.t256?.[0]??0,height=page.t257?.[0]??0,samples=page.t277?.[0]??1,bits=page.t258??[1],bpp=bits[0]??0,compression=page.t259?.[0]??1,photo=page.t262?.[0]??0;
 if(!width||!height||width*height>IMAGE_DECODE_PIXELS||samples<1||samples>4||![1,2,4,8,16].includes(bpp)||bits.some(v=>v!==bpp)||![1,samples].includes(bits.length)||![0,1,2,3,5].includes(photo)||![1,5,8,32946,32773].includes(compression)||(page.t284?.[0]??1)!==1||(page.t339??[1]).some(v=>v!==1))throw Error('TIFF像素、位深、分量、布局或压缩方式不在有界解码范围');
 if((photo===2&&samples<3)||(photo===5&&samples!==4)||([0,1].includes(photo)&&samples>2)||(photo===3&&(bpp>8||samples!==1||page.t320?.length!==3*(1<<bpp))))throw Error('TIFF颜色分量或调色板不完整');
 const row=Math.ceil(width*bpp*samples/8),raw=row*height,rgba=width*height*4,tiled=page.t322!==undefined,tw=page.t322?.[0]??width,th=page.t323?.[0]??height,rows=page.t278?.[0]??height;
 if(!tw||!th||!rows||(tiled&&(tw>4096||th>4096))||raw+rgba+(tiled?Math.ceil(tw*th*bpp*samples/8):raw)>WORK_BYTES)throw Error('TIFF解压工作缓冲区超限');
 const offsets=(tiled?page.t324:page.t273)??[],sizes=(tiled?page.t325:page.t279)??[],expected=tiled?Math.ceil(width/tw)*Math.ceil(height/th):Math.ceil(height/rows);
 if(!offsets.length||offsets.length!==expected||sizes.length!==expected||offsets.some((v,i)=>!sizes[i]||v+sizes[i]!>bytes.length)||expected>8192)throw Error('TIFF数据块缺失或越界');
 if(compression===1&&sizes.reduce((sum,value)=>sum+value,0)<(tiled?Math.ceil(tw*bpp*samples/8)*th*expected:raw))throw Error('TIFF未压缩像素数据不完整');
 return{page,width,height,raw};
}
/** Called inside a terminable worker. Bound deflate output before pako joins it. */
export function decodeTiffPixels(bytes:Uint8Array){
 const {page,width,height,raw}=tiffPage(bytes),previous=pako.inflateRaw;
 pako.inflateRaw=data=>{const chunks:Uint8Array[]=[];let length=0;const inflate=new pako.Inflate({raw:true,chunkSize:65536});inflate.onData=part=>{length+=part.length;if(length>raw)throw Error('TIFF压缩流超出声明的像素缓冲区');chunks.push(part);};inflate.push(data,true);if(inflate.err)throw Error(inflate.msg||'TIFF压缩流无效');const result=new Uint8Array(length);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}return result;};
 try{const buffer=Uint8Array.from(bytes).buffer;UTIF.decodeImage(buffer,page);const rgba=UTIF.toRGBA8(page);if(rgba.length!==width*height*4)throw Error('TIFF像素数据无效');return{width,height,rgba};}finally{pako.inflateRaw=previous;}
}
