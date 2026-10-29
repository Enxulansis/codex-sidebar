import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';import {StringDecoder} from 'node:string_decoder';
import {localPowerShell7,type PowerShell7Binding} from './powershell7';import {dictationCatalog,DICTATION_CHARACTERS,DICTATION_DURATION_MS,validDictationText,type DictationCatalog,type DictationEvent} from './dictation-types';
type Launch=(path:string,args:string[],options:{windowsHide:true;stdio:'pipe'})=>ChildProcessWithoutNullStreams;
type Capture={child?:ChildProcessWithoutNullStreams;current:()=>boolean;changed:(event:DictationEvent)=>void;timers:ReturnType<typeof setTimeout>[];listening:boolean;stopping:boolean;sequence:number;characters:number};
const failure='本地听写未完成，请核对Windows麦克风权限、设备、识别语言和PowerShell 7';
/** One owned local recognition process. No audio file, browser microphone, model or network service. */
export class LocalDictation{
 private capture:Capture|undefined;private dead=false;private closing:Promise<void>=Promise.resolve();private probes=new Set<ChildProcessWithoutNullStreams>();private probing=false;private owned=new Set<ChildProcessWithoutNullStreams>();
 constructor(private helper:string,private bind:()=>Promise<PowerShell7Binding>=()=>localPowerShell7.binding(),private launch:Launch=spawn){}
 async probe():Promise<DictationCatalog>{
  if(this.capture||this.probing)throw Error('本地听写进程仍在使用');this.probing=true;
  try{await this.closing;const binding=await this.bind();if(this.dead)throw Error('本地听写页面已关闭');
  return await new Promise((resolve,reject)=>{
   const child=this.launch(binding.path,['-NoProfile','-NonInteractive','-STA','-File',this.helper,'-Probe'],{windowsHide:true,stdio:'pipe'});this.probes.add(child);this.owned.add(child);const decoder=new StringDecoder('utf8');let buffer='',settled=false;
   const finish=(value?:DictationCatalog)=>{if(settled)return;settled=true;clearTimeout(timer);if(value)resolve(value);else{this.reap(child);reject(Error('本地听写语言未确认；请核对Windows识别组件和PowerShell 7'));}};
   const timer=setTimeout(()=>finish(),5000);child.stdout.on('data',chunk=>{if(settled)return;buffer+=decoder.write(chunk);if(Buffer.byteLength(buffer)>128*1024)finish();});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.stdin.end();child.on('error',()=>finish());child.on('close',code=>{this.probes.delete(child);this.owned.delete(child);if(settled)return;try{buffer+=decoder.end();finish(!this.dead&&code===0?dictationCatalog(JSON.parse(buffer)):undefined);}catch{finish();}});
  });}finally{this.probing=false;}
 }
 start(recognizerId:string,changed:(event:DictationEvent)=>void,current:()=>boolean){
  this.cancel();if(this.dead)return;const value:Capture={changed,current,timers:[],listening:false,stopping:false,sequence:0,characters:0};this.capture=value;
  void (async()=>{
   try{
    await this.closing;if(this.probing||this.probes.size)throw Error('语言读取进程仍未退出');const binding=await this.bind();if(!this.live(value)){if(this.capture===value)this.cancel();return;}
    const child=this.launch(binding.path,['-NoProfile','-NonInteractive','-STA','-File',this.helper],{windowsHide:true,stdio:'pipe'});value.child=child;this.owned.add(child);const decoder=new StringDecoder('utf8');let buffer='';
    const startup=setTimeout(()=>this.finish(value,{phase:'error',error:'本地听写启动超时；原草稿保留'}),7000);value.timers.push(startup,setTimeout(()=>this.stop(),DICTATION_DURATION_MS));
    child.stdout.on('data',chunk=>{
     if(!this.live(value)){if(this.capture===value)this.cancel();return;}buffer+=decoder.write(chunk);if(Buffer.byteLength(buffer)>128*1024){this.finish(value,{phase:'error',error:'本地听写响应超过上限；已确认片段保留'});return;}
     let index:number;while((index=buffer.indexOf('\n'))>=0&&this.capture===value){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{
      const event=JSON.parse(line);if(!event||typeof event!=='object')throw Error();
      if(event.phase==='listening'){if(value.listening)throw Error();value.listening=true;clearTimeout(startup);changed({phase:'listening'});}
      else if(event.phase==='text'){if(!value.listening||event.sequence!==value.sequence+1||!validDictationText(event.text)||value.characters+event.text.length>DICTATION_CHARACTERS||event.sequence>512)throw Error();value.sequence=event.sequence;value.characters+=event.text.length;changed({phase:'text',sequence:event.sequence,text:event.text});}
      else if(event.phase==='stopping'){if(!value.listening)throw Error();if(!value.stopping){value.stopping=true;value.timers.push(setTimeout(()=>this.finish(value,{phase:'error',error:'听写停止未确认；已确认片段保留'}),6000));}changed({phase:'stopping'});}
      else if(event.phase==='ended'||event.phase==='cancelled'){if(!value.listening)throw Error();this.finish(value,{phase:event.phase});}
      else if(event.phase==='error')this.finish(value,{phase:'error',error:failure});else throw Error();
     }catch{this.finish(value,{phase:'error',error:'本地听写回执无效；已确认片段保留'});}}
    });
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>this.finish(value,{phase:'error',error:failure}));child.on('error',()=>this.finish(value,{phase:'error',error:failure}));child.on('close',()=>{this.owned.delete(child);if(this.capture===value)this.finish(value,{phase:'error',error:'本地听写进程已退出；已确认片段保留'});});
    if(!this.live(value)){this.cancel();return;}child.stdin.write(JSON.stringify({command:'start',recognizerId})+'\n');
   }catch{this.finish(value,{phase:'error',error:failure});}
  })();
 }
 stop(){const value=this.capture;if(!value||value.stopping)return;if(!value.listening){this.finish(value,{phase:'cancelled'});return;}value.stopping=true;try{value.child!.stdin.write('{"command":"stop"}\n');value.timers.push(setTimeout(()=>this.finish(value,{phase:'error',error:'听写停止未确认；已确认片段保留，未自动重试'}),6000));}catch{this.finish(value,{phase:'error',error:failure});}}
 cancel(){const value=this.capture;if(value){this.capture=undefined;for(const timer of value.timers)clearTimeout(timer);if(value.child)this.reap(value.child);}return this.closing;}
 dispose(){this.dead=true;void this.cancel().catch(()=>{});for(const child of this.owned)child.kill();}
 private live(value:Capture){return !this.dead&&this.capture===value&&value.current();}
 private finish(value:Capture,event:DictationEvent){
  if(this.capture!==value)return;const notify=this.live(value),closed=this.cancel();
  // A terminal speech frame can precede Dispose/process exit. Keep the page
  // capture pending until this owned process really exits, or report uncertainty.
  void closed.then(()=>{if(notify&&!this.dead&&value.current())value.changed(event);},()=>{if(notify&&!this.dead&&value.current())value.changed({phase:'error',cleanupUnknown:true,error:'听写进程退出未确认；请核对Windows麦克风指示，确认关闭后再读取本机语言'});});
 }
 private reap(child:ChildProcessWithoutNullStreams){
  if(child.exitCode!==null||child.signalCode!==null)return;
  let closing:Promise<void>;closing=new Promise<void>((resolve,reject)=>{
   const deadline=setTimeout(()=>{child.kill();reject(Error('旧听写进程退出未确认'));},1500);deadline.unref();
   child.once('close',()=>{clearTimeout(deadline);if(this.closing===closing)this.closing=Promise.resolve();resolve();});try{child.stdin.end('{"command":"cancel"}\n');}catch{}child.kill();
  });this.closing=closing;void closing.catch(()=>{});
 }
}
