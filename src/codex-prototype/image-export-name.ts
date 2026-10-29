/** The same basename is used by the host's actual file and the display receipt. */
export function imageExportName(source:string,format:'png'|'jpg'){
 const clean=source.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim();
 const extension=/\.(png|jpe?g)$/i.exec(clean)?.[1]?.toLowerCase();
 const stem=Array.from(clean.replace(/\.[^./\\]+$/,'')).slice(0,100).join('').replace(/[ .]+$/,'')||'image';
 return stem+'.'+(format==='jpg'&&(extension==='jpg'||extension==='jpeg')?extension:format);
}
export function imageExportFeedback(name:string,mime:'png'|'jpg',operation:'name'|'original'|'png'|'save',result:string,originalName?:string){
 if(result==='canceled')return '';
 if(result==='saved')return originalName?'已保存原图：'+originalName:'已保存 '+(mime==='png'?'PNG':'JPEG')+' 图片';
 if(operation==='name')return '已复制文件名：'+name;
 return operation==='png'?'已复制 PNG：'+imageExportName(name,'png'):'已复制原格式：'+(originalName??imageExportName(name,mime));
}
