import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {ImageExporter,type ImageRequest,type ImageExportOwner} from '../src/codex-prototype/image-export-host';
import {IMAGE_ASSETS} from '../src/codex-prototype/offline/image-assets';
import {checkedImage} from '../src/codex-prototype/online-image';
import {originalImageClipScript} from '../src/system-clipboard';
const roots:string[]=[];
async function directory(){const root=await mkdtemp(join(tmpdir(),'ordinary-daily-image-'));roots.push(root);return root;}
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await directory(),bytes=Buffer.from(IMAGE_ASSETS.png!.src!.split(',')[1]!,'base64'),path=join(root,'local.png');await writeFile(path,bytes);
 let owner:ImageExportOwner|undefined={threadId:'local',connectionId:0,images:[{turnId:'',itemId:'',image:{id:'image',name:'local.png',path}}]};
 const request:ImageRequest={type:'image-export',source:'draft',id:1,threadId:'local',connectionId:0,turnId:'',itemId:'',imageId:'image',kind:'png',expectedSha256:createHash('sha256').update(bytes).digest('hex')};
 const native=vi.fn(async(_script:string)=>{}),text=vi.fn(async(_value:string)=>{}),exporter=new ImageExporter(root,()=>owner,async()=>undefined,text,native);
 return{root,path,bytes,request,native,text,exporter,setOwner:(value:ImageExportOwner|undefined)=>owner=value};
}
describe('ordinary local image copies do not acquire model workspace authority',()=>{
 it('copies PNG and exact original bytes with a real bitmap without marking or writing the source workspace',async()=>{
  const f=await fixture();expect((await checkedImage(f.root,f.path,'preview')).src).toBeTruthy();
  await expect(f.exporter.handle(f.request)).resolves.toBe('copied');expect(f.native.mock.calls.at(-1)![0]).toContain('SetImage');expect(f.native.mock.calls.at(-1)![0]).toContain("SetData('PNG'");
  await expect(f.exporter.handle({...f.request,kind:'original'})).resolves.toBe('copied');const script=f.native.mock.calls.at(-1)![0];expect(script).toContain('SetImage');expect(script).toContain('SetFileDropList');expect(script).toContain("'image/png'");expect(f.text).not.toHaveBeenCalled();expect(await readdir(f.root)).toEqual(['local.png']);expect(await readFile(f.path)).toEqual(f.bytes);
 });
 it.each(['missing','changed','outside','junction','stale']as const)('rejects %s source before copying, with the source identity checks intact',async fault=>{
  const f=await fixture();if(fault==='missing')await rm(f.path);if(fault==='changed')await writeFile(f.path,Buffer.concat([f.bytes,Buffer.from('changed')]));
  if(fault==='outside'||fault==='junction'){const outside=await directory(),foreign=join(outside,'outside.png');await writeFile(foreign,f.bytes);let path=foreign;if(fault==='junction'){await symlink(outside,join(f.root,'link'),process.platform==='win32'?'junction':'dir');path=join(f.root,'link','outside.png');}f.setOwner({threadId:'local',connectionId:0,images:[{turnId:'',itemId:'',image:{id:'image',name:'outside.png',path}}]});}
  if(fault==='stale')f.setOwner(undefined);
  await expect(f.exporter.handle(f.request)).rejects.toThrow();expect(f.native).not.toHaveBeenCalled();expect(f.text).not.toHaveBeenCalled();
 });
 it('keeps a native decode failure explicit and never substitutes clipboard text',async()=>{const f=await fixture();f.native.mockRejectedValueOnce(Error('Corrupt PNG decoder rejected payload'));await expect(f.exporter.handle(f.request)).rejects.toThrow('Corrupt PNG');expect(f.native).toHaveBeenCalledOnce();expect(f.text).not.toHaveBeenCalled();});
 it('rejects unsupported original clipboard formats instead of succeeding with a file path',()=>{expect(()=>originalImageClipScript('verified.webp','webp')).toThrow('不支持图片剪贴板');for(const format of ['png','jpg']){const script=originalImageClipScript('verified.'+format,format);expect(script).toContain('SetImage');expect(script).toContain('SetData');}});
});
