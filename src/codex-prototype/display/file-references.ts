import {fileReference,fileHref,textFileReferences,type FileReference} from '../file-reference';
import {showFormulaToast} from './dsh-math-export';
export type FileReferenceOptions={openFile?:((reference:FileReference)=>Promise<string>)|undefined};
export function fileLinkButton(reference:FileReference,label:string,open:NonNullable<FileReferenceOptions['openFile']>,current:()=>boolean,code=false){
 const element=document.createElement('button');element.className='file-link'+(code?' code-link':'');element.type='button';element.textContent=label;element.title='打开 '+reference.path+(reference.line?':'+reference.line:'');let pending=false;
 element.addEventListener('click',async event=>{event.preventDefault();event.stopPropagation();if(pending||!current()||!element.isConnected)return;pending=true;element.disabled=true;
  try{const result=await open(reference);if(result==='delegated'&&current()&&element.isConnected)showFormulaToast('已交由 VS Code 编辑器处理；能否显示此格式取决于可用查看器，请查看编辑器提示。');}catch(error){if(current()&&element.isConnected)showFormulaToast(error instanceof Error?error.message:'文件打开未确认',true);}finally{pending=false;if(element.isConnected)element.disabled=false;}
 });return element;
}
export function markFileHref(element:HTMLElement,href:unknown,options:FileReferenceOptions){if(options.openFile){const reference=fileHref(href);if(reference)element.dataset.localFileHref=JSON.stringify(reference);}}
export function appendFileText(parent:HTMLElement,text:string,open:NonNullable<FileReferenceOptions['openFile']>,current:()=>boolean){let last=0;for(const match of textFileReferences(text)){parent.append(document.createTextNode(text.slice(last,match.start)),fileLinkButton(match.reference,text.slice(match.start,match.end),open,current));last=match.end;}parent.append(document.createTextNode(text.slice(last)));}
/** Enhance only plain text/inline code. Math, fences, images and ordinary links stay intact. */
export function bindFileReferences(root:HTMLElement,open:FileReferenceOptions['openFile'],current:()=>boolean){
 if(!open)return;
 for(const link of root.querySelectorAll<HTMLElement>('[data-local-file-href]')){const reference=JSON.parse(link.dataset.localFileHref!) as FileReference,element=fileLinkButton(reference,link.textContent??reference.path,open,current);element.replaceChildren(...link.childNodes);link.replaceWith(element);}
 for(const code of root.querySelectorAll<HTMLElement>('code')){if(code.closest('pre,.math,.katex,button,.inert-link'))continue;const reference=fileReference(code.textContent??'');if(reference)code.replaceWith(fileLinkButton(reference,code.textContent!,open,current,true));}
 const texts:Text[]=[];const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const text=walker.currentNode as Text;if(!text.parentElement?.closest('pre,code,.math,.katex,button,.inert-link,[data-mkd] > .block-actions'))texts.push(text);}
 for(const text of texts){if(!textFileReferences(text.data).length)continue;const fragment=document.createElement('span');appendFileText(fragment,text.data,open,current);text.replaceWith(...fragment.childNodes);}
}
/** Verbatim original DSH165 file-link/code-link rules. */
export const FILE_REFERENCE_STYLE=`
    .file-link { min-width: 0; padding: 0; border: 0; color: var(--vscode-textLink-foreground); background: transparent; text-align: left; font-family: var(--editor-font); cursor: pointer; overflow-wrap: anywhere; }
    .file-link:hover { text-decoration: underline; }
    .code-link { padding: 1px 4px; border-radius: 4px; color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); }
`;
