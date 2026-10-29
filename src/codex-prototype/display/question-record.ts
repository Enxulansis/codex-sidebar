import type {PublicQuestionRecord} from '../public-questions';
const node=(tag:string,cls:string,value='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=value;return e;};
/** Original record shell, with options explicitly distinguished from a recorded answer. */
export function renderQuestionRecord(record:PublicQuestionRecord){
 const box=node('section','ask-record');box.setAttribute('aria-label','公开提问信息');
 const head=node('div','record-head');head.append(node('span','record-title','提问'),node('span','record-summary',record.notice));box.append(head);
 for(const question of record.questions){const row=node('div','ask-record-item');row.append(node('div','ask-record-question',question.title||'（标题为空）'));if(question.options?.length){const options=node('div','ask-record-answers');options.append(node('span','ask-record-skipped','可选项：'+question.options.join('、')));row.append(options);}box.append(row);}
 return box;
}
export const QUESTION_RECORD_STYLE=`
.ask-record { margin: 6px 0; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--vscode-foreground) 16%, transparent); border-left: 3px solid var(--vscode-charts-blue, #4d6bfe); border-radius: 6px; background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent); font-size: 12px; line-height: 18px; }
.record-head { display: flex; align-items: center; gap: 8px; }
.record-title { font-weight: 600; color: var(--vscode-foreground); }
.record-summary, .record-time { color: var(--vscode-descriptionForeground); }
.ask-record-item { margin-top: 6px; }
.ask-record-question { color: var(--vscode-descriptionForeground); }
.ask-record-answers { margin-top: 2px; display: flex; flex-wrap: wrap; gap: 4px; }
.ask-record-skipped { color: var(--vscode-descriptionForeground); }
`;
