import {expect,it} from 'vitest';
import {setImmediate as nextTask} from 'node:timers/promises';
import {codexPageContent} from '../src/codex-prototype/codex-page-state';
import type {Session} from '../src/codex-prototype/session';
const session=(paths:string[][])=>({projection:{items:new Map(paths.map((p,n)=>['row-'+n,{turnId:'turn-'+n,complete:true,item:{type:'userMessage',id:'row-'+n,content:[{type:'text',text:'before'},...p.map(path=>({type:'localImage',path})),{type:'text',text:'after'}]}}])),turns:new Map(),metrics:{forTurn:()=>undefined}},approvals:new Map(),userInputs:new Map(),revertReason:()=> 'fixture does not expose revert',forkReason:()=>''})as unknown as Session;
const images=(value:Awaited<ReturnType<typeof codexPageContent>>)=>value.items.flatMap(r=>(r.item as any).content.filter((v:any)=>v.type==='localImage').map((v:any)=>v.displayImage));
it('shares an in-flight exact source across rows while keeping every public message/index identity',async()=>{
 let release!:()=>void,calls=0;const held=new Promise<void>(r=>release=r),active=session([['same.png','same.png'],['same.png']]),before=JSON.stringify([...active.projection.items.values()]);
 const pending=codexPageContent(active,'thread',async(path,id)=>{calls++;await held;return{id,name:path,src:'data:image/png;base64,YQ=='};});await nextTask();try{expect(calls).toBe(1);}finally{release();await pending;}
 const out=await pending;expect(images(out).map(v=>v.id)).toEqual([JSON.stringify(['thread','turn-0','row-0',1]),JSON.stringify(['thread','turn-0','row-0',2]),JSON.stringify(['thread','turn-1','row-1',1])]);
 expect(new Set(images(out))).toHaveProperty('size',3);expect(images(out).every(v=>v.src==='data:image/png;base64,YQ==')).toBe(true);expect(JSON.stringify([...active.projection.items.values()])).toBe(before);
});
it('shares only exact paths, retaining distinct source results despite matching basenames or aliases',async()=>{
 const paths=['one/image.png','two/image.png','one\\image.png','one/image.png'],calls:string[]=[];
 const out=await codexPageContent(session([paths]),'thread',async(path,id)=>{calls.push(path);return{id,name:path,src:'data:image/png;base64,'+Buffer.from(path).toString('base64')};});
 expect(calls).toEqual(paths.slice(0,3));expect(images(out).map(v=>v.name)).toEqual(paths);expect(images(out)[0].src).not.toBe(images(out)[1].src);
});
it('keeps source checks bounded across a mixture of repeated and distinct paths',async()=>{
 let running=0,peak=0,calls=0;const paths=Array.from({length:32},(_,n)=>'image-'+(n%8)+'.png');
 const out=await codexPageContent(session([paths.slice(0,16),paths.slice(16)]),'thread',async(path,id)=>{calls++;running++;peak=Math.max(peak,running);try{await nextTask();return{id,name:path};}finally{running--;}});
 expect(calls).toBe(8);expect(peak).toBeLessThanOrEqual(4);expect(running).toBe(0);expect(images(out)).toHaveLength(32);
});
it('preserves unavailable source errors in every original slot',async()=>{
 let calls=0;const out=await codexPageContent(session([['missing.png'],['missing.png']]),'thread',async(_path,id)=>{calls++;return{id,name:'图片不可用',error:'source deleted'};});
 expect(calls).toBe(1);expect(images(out)).toHaveLength(2);expect(images(out).every(v=>v.error==='source deleted'&&!v.src)).toBe(true);expect(images(out)[0].id).not.toBe(images(out)[1].id);
});
it('rechecks replacement, deletion and recovery in every later projection and owner',async()=>{
 const active=session([['image.png','image.png']]);let calls=0,revision=0;
 const check=async(_path:string,id:string)=>{calls++;return revision===2?{id,name:'missing',error:'source deleted'}:{id,name:'image.png',src:'data:image/png;base64,'+Buffer.from(String(revision)).toString('base64')};};
 const result=[];for(revision=0;revision<4;revision++)result.push(images(await codexPageContent(active,revision===3?'other':'thread',check)));
 expect(calls).toBe(4);expect(result[0]![0].src).not.toBe(result[1]![0].src);expect(result[2]!.every(v=>v.error==='source deleted')).toBe(true);expect(result[3]![0].src).toBeDefined();expect(JSON.parse(result[3]![0].id)[0]).toBe('other');
});
it('does not retain a rejected check in a later projection',async()=>{
 const active=session([['image.png','image.png']]);let calls=0;
 await expect(codexPageContent(active,'thread',async()=>{calls++;await nextTask();throw Error('check rejected');})).rejects.toThrow('check rejected');expect(calls).toBe(1);
 const out=await codexPageContent(active,'thread',async(path,id)=>{calls++;return{id,name:path};});expect(calls).toBe(2);expect(images(out)).toHaveLength(2);
});
it('does not share in-flight work across separate simultaneous projections',async()=>{
 const active=session([['image.png','image.png']]);let calls=0;
 const [a,b]=await Promise.all(['a','b'].map(thread=>codexPageContent(active,thread,async(path,id)=>{const sequence=++calls;await nextTask();return{id,name:path,src:'data:image/png;base64,'+sequence};})));
 expect(calls).toBe(2);expect(images(a)[0].src).not.toBe(images(b)[0].src);expect(images(a).every(v=>JSON.parse(v.id)[0]==='a')).toBe(true);expect(images(b).every(v=>JSON.parse(v.id)[0]==='b')).toBe(true);
});
it('gives each display binding its own mutable source metadata',async()=>{
 const origin={name:'original.webp',mime:'image/webp' as const,size:7,sha256:'a'.repeat(64),animated:false,transformation:'rasterized' as const};let calls=0;
 const out=images(await codexPageContent(session([['same.png','same.png']]),'thread',async(path,id)=>{calls++;return{id,name:path,src:'data:image/png;base64,YQ==',originHint:origin};}));
 expect(calls).toBe(1);out[0].originHint.name='changed';expect(out[1].originHint.name).toBe('original.webp');expect(origin.name).toBe('original.webp');
});
