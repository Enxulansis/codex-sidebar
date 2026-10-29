import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {localPowerShell7,type PowerShell7Binding} from './powershell7';
type TextToken={type:string;content:string;children?:TextToken[]};
const MarkdownIt=require('markdown-it') as new(options:{html:boolean})=>{parse(source:string,environment:object):TextToken[]};
export const MAX_SPEECH_CHARS=100_000;
const markdown=new MarkdownIt({html:false});
/** Read only visible public text; links/images contribute labels, never resource paths. */
export function speechText(source:string){if(source.length>MAX_SPEECH_CHARS)throw Error('本机朗读最多100000字符，未截断正文');const text=markdown.parse(source,{}).flatMap(t=>t.type==='inline'?[(t.children??[]).filter(v=>['text','code_inline','image','softbreak','hardbreak'].includes(v.type)).map(v=>v.type.endsWith('break')?'\n':v.content).join('')]:['fence','code_block'].includes(t.type)?[t.content]:[]).join('\n').trim();if(!text)throw Error('该回复没有可朗读正文');return text;}
/** One owned SAPI helper. No model, browser speech service, command interpolation or file input. */
export class LocalSpeech{
 private child:ChildProcessWithoutNullStreams|undefined;private epoch=0;
 constructor(private helper:string,private verify=false,private bind:()=>Promise<PowerShell7Binding>=()=>localPowerShell7.binding()){}
 async probe():Promise<boolean>{let binding:PowerShell7Binding;try{binding=await this.bind();}catch{return false;}return new Promise(resolve=>{const child=spawn(binding.path,['-NoProfile','-NonInteractive','-STA','-File',this.helper,'-Probe'],{windowsHide:true});let data='';const timer=setTimeout(()=>{child.kill();resolve(false)},4000);child.stdout.on('data',v=>{data+=v;if(data.length>16384){child.kill();resolve(false)}});child.on('error',()=>{clearTimeout(timer);resolve(false)});child.on('close',code=>{clearTimeout(timer);try{resolve(code===0&&JSON.parse(data).available===true)}catch{resolve(false)}});});}
 start(text:string,changed:(phase:string,error?:string,bytes?:number)=>void){
  this.stop();const epoch=this.epoch;
  void this.bind().then(binding=>{
   if(epoch!==this.epoch)return;
   const child=spawn(binding.path,['-NoProfile','-NonInteractive','-STA','-File',this.helper,...(this.verify?['-Verify']:[])],{windowsHide:true});this.child=child;
   let buffer='',terminal=false;const current=()=>epoch===this.epoch&&this.child===child;
   const timer=setTimeout(()=>{if(current()&&!terminal){terminal=true;changed('error','本机语音没有及时启动');this.stop()}},5000);
   child.stdout.on('data',chunk=>{if(!current())return;buffer+=chunk.toString('utf8');if(buffer.length>16384){terminal=true;changed('error','本机语音响应无效');this.stop();return;}let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const m=JSON.parse(line);if(['started','ended','stopped','error'].includes(m.phase)){clearTimeout(timer);if(m.phase!=='started')terminal=true;changed(m.phase,m.error,m.verifiedBytes);}}catch{}}});
   child.on('error',()=>{clearTimeout(timer);if(current()&&!terminal){terminal=true;changed('error','本机语音启动失败')}});
   child.on('close',()=>{clearTimeout(timer);if(!current())return;this.child=undefined;if(!terminal){terminal=true;changed('error','本机朗读已中断')}});
   child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify(text)+'\n');
  }).catch(error=>{if(epoch===this.epoch)changed('error',error instanceof Error?error.message:'PowerShell 7 未核对，未开始朗读');});
 }
 stop(){this.epoch++;const child=this.child;if(!child)return;this.child=undefined;try{child.stdin.write('stop\n')}catch{}const timer=setTimeout(()=>{if(child.exitCode===null)child.kill()},500);timer.unref();child.once('close',()=>clearTimeout(timer));}
}
