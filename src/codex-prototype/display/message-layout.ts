/** 165 message shell. Public roles only; no transport, permission or asset loading. */
import {codexMark} from './codex-mark';
export function messageHead(role:'user'|'assistant',phaseLabel=''){
 const head=document.createElement('div');head.className='message-head';
 const avatar=document.createElement('span');avatar.className='avatar';avatar.setAttribute('aria-hidden','true');if(role==='assistant')avatar.append(codexMark());else avatar.textContent='Y';
 const name=document.createElement('span');name.textContent=role==='user'?'你':'Codex';head.append(avatar,name);
 if(phaseLabel){head.title=phaseLabel;head.dataset.phaseLabel=phaseLabel;}
 return head;
}
export const MESSAGE_LAYOUT_STYLE=`
    .message { width: 100%; min-width: 0; padding: 8px 0 16px; overflow: visible; }
    .message + .message { margin-top: 8px; }
    .message-head { min-width: 0; display: flex; align-items: center; gap: 8px; margin-bottom: 7px; font-size: 12px; font-weight: 600; }
    .avatar { width: 21px; height: 21px; flex: 0 0 21px; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, #4d6bfe 78%, var(--vscode-editor-background)); color: white; font-size: 10px; }
    .assistant .avatar { border-radius: 0; background: transparent; color: var(--vscode-foreground); }
    .assistant .avatar > svg { display: block; width: 100%; height: 100%; }
    .message-body { width: 100%; min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; font-size: 13px; line-height: 1.65; }
    .assistant .message-body { padding-left: 29px; }
    .user .message-head { display: none; }
    /* The prototype has a generic article card and no global border-box rule. */
    #history > article.message { border: 0; border-radius: 0; background: transparent; margin: 0 auto; padding: 8px 0 16px; }
    #history > article.message + article.message { margin-top: 8px; }
    #history > article.message.user { padding-top: 6px; }
    .message-body { box-sizing: border-box; }
`;
