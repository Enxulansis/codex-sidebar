/** Production UI scenes with synthetic history/metadata; screenshots are real browser renders. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const options={};for(const arg of process.argv.slice(2)){const match=/^--(source|candidate|out|browser|playwright|docs)=(.+)$/.exec(arg);assert(match&&!Object.hasOwn(options,match[1]));options[match[1]]=match[2];}
assert(options.source&&options.out);
const source=resolve(options.source),out=resolve(options.out),require=createRequire(join(source,'package.json'));
const {buildSync}=require('esbuild'),{chromium}=require(options.playwright??'playwright');await mkdir(out,{recursive:false});
const compiled=buildSync({stdin:{contents:"export {html} from './src/codex-prototype/webview';export {DISPLAY_DEFAULTS,DisplaySettingsStore,handleDisplaySettings} from './src/codex-prototype/display-settings';export {DraftStore} from './src/codex-prototype/draft-store';export {syntheticTailMeta} from './src/codex-prototype/offline/tail-fixtures';export {publicRecordDisplay} from './src/codex-prototype/public-record-display';",resolveDir:source,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,mod={exports:{}};
new Function('module','exports','require',compiled)(mod,mod.exports,require);
const {html,DISPLAY_DEFAULTS,DisplaySettingsStore,handleDisplaySettings,DraftStore,syntheticTailMeta,publicRecordDisplay}=mod.exports;
const assetRoot=options.candidate?join(resolve(options.candidate),'extension/dist'):join(source,'experiments/codex-panel/dist');
const assets={vendor:await readFile(join(assetRoot,'offline-vendor.js'),'utf8'),display:await readFile(join(assetRoot,'online-display.js'),'utf8')};
const assetHashes=Object.fromEntries(Object.entries(assets).map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]));
const file=join(out,'ui-cleanup.html');await writeFile(file,html('ui-cleanup-probe',assets),'utf8');
const memory=new Map(),io={get:(key,fallback)=>memory.get(key)??fallback,update:async(key,value)=>memory.set(key,structuredClone(value))};
const settings=new DisplaySettingsStore(io),drafts=new DraftStore(io),now=Date.now();
const state={threadId:'ui-a',connectionId:1,status:'就绪',ready:true,contentReady:true,operating:false,busy:false,model:'gpt-6-luna',threads:['ui-a'],used:null,limit:null,oldUsed:null,dispatchMode:'daily',copySettings:DISPLAY_DEFAULTS,approvals:[],serviceStatusAvailable:true,attachmentImportAvailable:true,toolCheck:{verified:true,threadId:'ui-a'},editorCapture:{revision:1,reason:'没有活动文本编辑器'},history:{generation:1,mode:'legacy',loading:false,loadingTurn:'',error:'',hasMore:false,loadedTurns:2,incompleteTurns:[],complete:true},outline:{complete:true,nodes:[]},
 modelSelection:{models:[{id:'gpt-6-luna',model:'gpt-6-luna',displayName:'GPT-6-Luna',description:'',defaultEffort:'low',efforts:[{value:'low',description:'Low'},{value:'high',description:'High'}],serviceTiers:[{id:'priority',name:'Fast',description:'Faster processing'}],defaultServiceTier:'priority'}],nextChoice:{model:'gpt-6-luna',effort:'high',serviceTier:'priority'},observed:{model:'gpt-6-luna',effort:'low',serviceTier:'default'},canSelect:true,canDefault:true,complete:true,loading:false,stale:false,saving:false,selectionError:'',error:''},
 permissionSelection:{desired:'read-only',options:[{preset:'read-only',title:'只读',available:true,reason:''}],observed:{preset:'read-only',label:'只读',approval:'untrusted',reviewer:'user'},complete:true,stale:false,canSelect:true,generation:1,error:''},
 skills:{skills:[{name:'inspect',path:'D:/example/inspect/SKILL.md',description:'检查文件并整理要点',scope:'repo',enabled:true,unavailable:''},{name:'diagram',path:'D:/example/diagram/SKILL.md',description:'绘制可编辑的流程图',scope:'user',enabled:true,unavailable:''}],generation:1,loading:false,complete:true,stale:false,error:''},
 attachmentStorage:{bytes:8388608,files:6,limitMB:512,checkedAt:now,collection:{removed:2,bytes:4096,remaining:0,changed:0,referenced:6,unobserved:0},exports:{retentionDays:7,knownRecords:4,knownTemporaryRecords:0,temporaryGraceMs:10000,last:{checkedAt:now,removed:2,bytes:1024,changed:0,unknown:0},lastTemporary:{checkedAt:now,removed:1,bytes:128,changed:0,unknown:0}}},
 localQueue:{items:[{id:'q1',text:'整理测试结果并更新记录',preview:'整理测试结果并更新记录',status:'queued',attachments:0}],paused:false,blocked:false,reason:'',steerTurnId:''},
 turns:[{id:'t1',status:'completed',itemsView:'full',durationMs:42000},{id:'t2',status:'completed',itemsView:'full',durationMs:1200}],
 items:[{turnId:'t1',complete:true,item:{type:'userMessage',id:'u1',content:[{type:'text',text:'检查脚本并整理结果。',text_elements:[]}]}},{turnId:'t1',complete:true,item:{type:'commandExecution',id:'c1',command:'node verify.mjs',cwd:'D:/example/project',aggregatedOutput:'12 checks passed',exitCode:0,status:'completed',durationMs:400}},{turnId:'t1',complete:true,item:{type:'webSearch',id:'w1',query:'索引构建',action:{type:'search',query:'索引构建',queries:[]},results:[]}},{turnId:'t1',complete:true,item:{type:'fileChange',id:'f1',status:'completed',changes:[{path:'src/index.ts',kind:{type:'update',move_path:null},diff:'@@ -1 +1 @@\n-old\n+new'}]}},{turnId:'t1',complete:true,item:{type:'agentMessage',id:'a1',text:'检查完成，已修正配置中的重复项。\n\n- 12 项检查通过\n- 保留了原有文件和草稿'},displayMeta:syntheticTailMeta(0)}]};
state.sessionCatalog={sessions:[{id:state.threadId,title:'界面检查',updatedAt:now,archived:false,observed:true,unread:false}],recycle:[],sort:'persisted',loading:false,error:'',hasMore:false,recycleHasMore:false,scope:'project'};
for(const row of state.items)if(row.item.type==='webSearch')row.item=publicRecordDisplay(row.item);
const account={readAt:now,ordinaryUsageAllowed:true,buckets:[{id:'example',name:'示例额度',primary:{usedPercent:35,windowDurationMins:300,resetsAt:Math.floor(now/1000)+7200},secondary:{usedPercent:20,windowDurationMins:10080,resetsAt:Math.floor(now/1000)+86400}}]};
const checks=[],failures=[],errors=[],external=[],requests=[],screenshots=[];let lease='',active=true;
const browser=await chromium.launch({headless:true,...(options.browser?{executablePath:options.browser}:{channel:'msedge'}),timeout:20000,args:['--no-first-run','--disable-background-networking']});
const page=await browser.newPage({viewport:{width:540,height:960}});page.setDefaultTimeout(5000);
page.on('pageerror',error=>errors.push(String(error)));await page.route(/^https?:/,route=>{external.push(route.request().url());return route.abort();});
const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function post(message,id=lease){if(!active||id!==lease)return;await page.evaluate(value=>window.postMessage(value,'*'),{...message,pageId:id});await frames();}
async function publish(){state.copySettings=settings.read();await post({type:'state',state});}
async function idle(){for(let i=0;i<2;i++){await page.waitForFunction(()=>window.probeTasks===0);await frames();}}
async function shot(name){await frames();await page.screenshot({path:join(out,name),fullPage:false});screenshots.push(name);}
async function check(name,run){try{await run();checks.push(name);}catch(error){failures.push({name,error:String(error.stack??error)});}}
async function theme(name){const light=name.includes('light'),contrast=name.includes('contrast');await page.emulateMedia({colorScheme:light?'light':'dark'});await page.evaluate(({name,light,contrast})=>{document.body.className='vscode-'+name;const colors={foreground:light?'#202020':'#dddddd',descriptionForeground:light?'#525252':'#aaaaaa','editor-background':light?'#ffffff':'#181818','sideBar-background':light?'#f5f5f5':'#181818','editorWidget-background':light?'#ffffff':'#252526','input-background':light?'#ffffff':'#252526','input-foreground':light?'#202020':'#dddddd','dropdown-background':light?'#ffffff':'#303030','dropdown-foreground':light?'#202020':'#dddddd','menu-background':light?'#ffffff':'#252526','widget-border':contrast?light?'#000000':'#ffffff':light?'#bbbbbb':'#454545',focusBorder:contrast?'#ffab00':'#007fd4','textLink-foreground':light?'#005fb8':'#4daafc','button-background':contrast?light?'#0f4a85':'#1aebff':light?'#0078d4':'#005fb8','button-foreground':contrast&&!light?'#000000':'#ffffff','button-hoverBackground':light?'#006cbe':'#006fc7','toolbar-hoverBackground':light?'#e8e8e8':'#333333','icon-foreground':light?'#444444':'#cccccc'};for(const[key,value]of Object.entries(colors))document.documentElement.style.setProperty('--vscode-'+key,value);document.documentElement.style.setProperty('--vscode-font-family','system-ui');document.documentElement.style.setProperty('--vscode-font-size','13px');document.documentElement.style.setProperty('--vscode-editor-font-family','Consolas, monospace');document.documentElement.style.setProperty('--vscode-textCodeBlock-background',light?'#f0f0f0':'#242424');document.documentElement.style.setProperty('--vscode-editor-foreground',light?'#202020':'#dddddd');},{name,light,contrast});await frames();}
try{
 await page.exposeFunction('probeHost',async message=>{requests.push(message);const id=message.pageId;
  try{if(message.type==='ready'){lease=id;await publish();return;}if(id!==lease)return;if(await handleDisplaySettings(settings,message,value=>post(value,id),()=>active&&id===lease))return;
   let result;
   if(message.type==='draft-read'||message.type==='draft-save'){const value=message.type==='draft-save'?await drafts.save(message.threadId,message.value):await drafts.load(message.threadId);result={...message,type:'draft-result',ok:true,value,preview:'',imagePreviews:{}};}
   else if(message.type==='search-query'){state.search={...state.search,requestId:message.id,query:message.query,scope:message.scope,includeTools:message.includeTools};await publish();return;}
   else if(message.type==='environment-read')result={...message,type:'environment-result',ok:false};
   else if(message.type==='account-limits-read')result={...message,type:'account-limits-result',ok:true,snapshot:account};
   else if(message.type==='service-status-read')result={...message,type:'service-status-result',ok:true,serviceStatusRevision:0,appCatalogRevision:0,value:{threadId:state.threadId,revision:1,readAt:now,isolated:true,workspaceFiles:true,errors:[],mcp:[{name:'workspace_files',auth:'unsupported',runtime:'connected',tools:['list_files','read_file'],resources:0,templates:0}],mcpComplete:true,apps:[{id:'app-a',name:'Example app',enabled:false,callable:false,toolsKnown:true,tools:[]}],disabledPlugins:[]}};
   else if(message.type==='model-selection'){state.modelSelection.nextChoice=message.choice??state.modelSelection.nextChoice;result={...message,type:'model-selection-result',ok:true,modelSelection:state.modelSelection};}
   else if(message.type==='user-fold-read')result={type:'user-folds',records:[]};else if(message.type==='block-fold-read')result={type:'block-folds',keys:[]};else if(message.type==='work-fold-read')result={type:'work-folds',readId:message.readId,records:[]};else if(message.type==='changed-files-fold-read')result={type:'changed-files-folds',readId:message.readId,records:[]};else if(message.type==='changed-review-read')result={...message,type:'changed-review-records',keys:[]};else if(message.type==='tool-expansion-read')result={type:'tool-expansions',keys:[]};else if(message.type==='rail-view-read')result={...message,type:'rail-view-result',ok:true,records:[]};else if(message.type==='scroll-view-read'||message.type==='scroll-view-save')result={...message,type:'scroll-view-result',ok:true,value:message.value};else if(message.type==='search-history')result={...message,type:'search-history-result',ok:true,values:[]};else if(['send','steer','queue-action','attachment-import'].includes(message.type))throw Error('Unexpected dispatch during UI-only checks');
   if(result)await post(result,id);
  }catch(error){errors.push(String(error));}
 });
 await page.addInitScript(()=>{window.probeTasks=0;window.acquireVsCodeApi=()=>({setState:()=>{},postMessage:message=>{window.probeTasks++;void window.probeHost(message).finally(()=>window.probeTasks--);}});});
 await page.goto(pathToFileURL(file).href);await idle();await theme('dark');

 await check('diff preview stays open after a routine state refresh',async()=>{
  const details=page.locator('.changed-file-diffs').first();await details.locator('summary').click();await frames();assert(await details.evaluate(e=>e.open));
  await publish();await idle();await page.waitForSelector('.changed-file-diffs');assert.equal(await details.evaluate(e=>e.open),true,'An unchanged state publish collapsed the open diff');
 });
 await check('diff collapse choice survives refresh and changed patch starts closed',async()=>{
  const d=page.locator('.changed-file-diffs').first();assert(await d.evaluate(e=>e.open));await d.locator('summary').click();await publish();await idle();assert.equal(await d.evaluate(e=>e.open),false);
  await d.locator('summary').click();state.items.find(r=>r.item.type==='fileChange').item.changes[0].diff+='\n+changed';await publish();await idle();assert.equal(await d.evaluate(e=>e.open),false);
 });
 await page.locator('#settingsOpen').click();await idle();await page.locator('#service-status [data-service-action="refresh"]').click();await idle();
 for(const width of [540,280])for(const name of ['dark','light','high-contrast','high-contrast-light'])await check('storage Enter/Space and width '+width+' '+name,async()=>{
  await page.setViewportSize({width,height:960});await theme(name);
  for(const selector of ['[data-storage-audit="attachmentCollectionStatus"]','[data-storage-audit="exportStorageStatus"]','[data-storage-audit="temporaryExportStorageStatus"]','#service-status details:has([data-service-action="mcp-summary:workspace_files"])','[data-service-app="app-a"]']){
   const details=page.locator(selector),summary=details.locator('summary');
   if(await details.evaluate(e=>e.open))await summary.click();
   await summary.scrollIntoViewIfNeeded();await summary.focus();const closed=await summary.evaluate(e=>getComputedStyle(e,'::before').transform);await page.keyboard.press('Enter');await frames();assert(await details.evaluate(e=>e.open));assert.notEqual(await summary.evaluate(e=>getComputedStyle(e,'::before').transform),closed);
   await publish();await idle();assert(await details.evaluate(e=>e.open));assert(await summary.evaluate(e=>e===document.activeElement));
   await page.keyboard.press('Space');await frames();assert.equal(await details.evaluate(e=>e.open),false);
   const bounds=await details.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1,JSON.stringify(bounds));assert.equal(await summary.evaluate(e=>getComputedStyle(e).listStyleType),'none');assert.equal(await summary.evaluate(e=>getComputedStyle(e,'::before').width),'5.5px');
  }
 });
 await check('storage summary retains focus after external settings refresh',async()=>{
  const details=page.locator('[data-storage-audit="exportStorageStatus"]'),summary=details.locator('summary');await summary.focus();await page.keyboard.press('Enter');await frames();assert(await details.evaluate(e=>e.open));
  await post({type:'settings-changed'});await idle();assert(await details.evaluate(e=>e.open));assert.equal(await summary.evaluate(e=>e===document.activeElement),true,'Settings reread replaced the focused summary without restoring focus');
 });
 await check('MCP and Apps preserve focus and expansion after settings reread',async()=>{
  for(const selector of ['[data-service-action="mcp-summary:workspace_files"]','[data-service-action="app-summary:app-a"]']){
   const summary=page.locator(selector);await summary.focus();await page.keyboard.press('Enter');await post({type:'settings-changed'});await idle();assert(await summary.evaluate(e=>e.parentElement.open&&e===document.activeElement));
  }
 });
 await check('settings dropdown caret reflects keyboard open and Escape close',async()=>{
  const trigger=page.locator('[data-setting="copy.mathFormat"] .ds-trigger'),caret=trigger.locator('.disclosure-caret');await trigger.scrollIntoViewIfNeeded();await trigger.focus();
  const closed=await caret.evaluate(e=>getComputedStyle(e,'::before').transform);await page.keyboard.press('Enter');await frames();assert.equal(await trigger.getAttribute('aria-expanded'),'true');assert.notEqual(await caret.evaluate(e=>getComputedStyle(e,'::before').transform),closed);
  await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await caret.evaluate(e=>getComputedStyle(e,'::before').transform),closed);
 });
 await check('settings disclosures render consistently in dark and narrow light layouts',async()=>{
  for(const [width,name] of [[540,'dark'],[280,'light']]){await page.setViewportSize({width,height:960});await theme(name);await page.locator('[data-storage-audit="attachmentCollectionStatus"]').scrollIntoViewIfNeeded();await shot('disclosures-'+name+'-'+width+'.png');}
  await page.locator('#settingsClose').click();
 });
 await check('tool card has a visible disclosure indicator and keyboard toggles',async()=>{
  await page.setViewportSize({width:540,height:960});await theme('dark');
  const work=page.locator('.work-fold-bar').first();if(await work.count()&&await work.getAttribute('aria-expanded')==='false')await work.click();
  const summary=page.locator('.tool:not(.empty)>summary').first();await summary.scrollIntoViewIfNeeded();await summary.focus();const before=await summary.evaluate(e=>e.parentElement.open);
  assert.equal(await summary.evaluate(e=>getComputedStyle(e,'::before').width),'5.5px');await page.keyboard.press('Enter');await frames();assert.equal(await summary.evaluate(e=>e.parentElement.open),!before);await page.keyboard.press('Space');await frames();assert.equal(await summary.evaluate(e=>e.parentElement.open),before);await shot('disclosures-chat-dark-540.png');
 });
 await check('search help shares chevron directions and retains keyboard focus',async()=>{
  await page.locator('#tabSearchToggle').click();const summary=page.locator('.tab-search-help>summary');await summary.focus();await page.keyboard.press('Enter');await publish();await idle();assert(await summary.evaluate(e=>e.parentElement.open&&e===document.activeElement));assert.equal(await summary.evaluate(e=>getComputedStyle(e,'::before').width),'5.5px');await page.keyboard.press('Space');assert.equal(await summary.evaluate(e=>e.parentElement.open),false);await page.keyboard.press('Escape');
 });
 await check('audit makes no model or network requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert(!requests.some(m=>['send','steer','queue-action','attachment-import'].includes(m.type)));});
 if(options.docs){
  if(await page.locator('.tab-search-close').isVisible())await page.locator('.tab-search-close').click();
  const docs=resolve(options.docs);await mkdir(docs,{recursive:true});
  const docShot=async name=>{await frames();await page.screenshot({path:join(docs,name),fullPage:false});};
  state.items=state.items.filter(r=>['userMessage','agentMessage'].includes(r.item.type));
  state.items[0].item.content[0].text='把项目说明整理成一份容易核对的清单，并说明下一步。';
  state.items[1].item.text='### 项目检查清单\n\n先确认入口和边界，再按小步骤验证。\n\n| 项目 | 核对重点 |\n|---|---|\n| 使用入口 | 安装说明与首次连接 |\n| 草稿保护 | 中断后保留输入和附件 |\n| 长对话 | 搜索、折叠与阅读恢复 |\n\n### 建议的验证顺序\n\n1. 阅读项目说明，确认支持环境。\n2. 运行已有检查，保留失败记录。\n3. 核对最终版本与发布说明。\n\n```powershell\npnpm typecheck\npnpm test\n```\n\n这是一组界面展示用的示例内容，尚未执行以上命令。';
  state.sessionCatalog.sessions[0].title='项目阅读笔记';state.localQueue.items=[];
  state.accountLimits={revision:1,pending:false,error:'',snapshot:account};
  await page.setViewportSize({width:620,height:900});await theme('dark');await publish();await idle();await page.locator('#history').evaluate(e=>e.scrollTop=0);await frames();await docShot('conversation-dark.png');
  await theme('light');await docShot('conversation-light.png');await theme('dark');
  await page.locator('.usage-trigger').click();await idle();await docShot('quota.png');await page.keyboard.press('Escape');
  await page.locator('#settingsOpen').click();await idle();await page.locator('#settingsBody').evaluate(e=>e.scrollTop=0);await frames();await docShot('settings.png');
  await page.locator('#service-status [data-service-action="refresh"]').click();await idle();await page.locator('#service-status').scrollIntoViewIfNeeded();await docShot('services.png');await page.locator('#settingsClose').click();
  await page.locator('#tabSearchToggle').click();await page.locator('.tab-search-help>summary').click();await docShot('search.png');await page.keyboard.press('Escape');
  await writeFile(join(docs,'README.md'),'# 图片说明\n\n这些图片由当前生产 HTML 与构建资源在无头浏览器中渲染，使用虚构对话、目录和额度。不是用户真实聊天截图，也不代表账号在线调用或原生 VS Code 宿主验收。\n');
 }
}finally{active=false;await browser.close();}
const report={at:new Date().toISOString(),passed:!failures.length&&!errors.length,checks,failures,errors,external,screenshots,assetHashes,boundary:'Headless production HTML/bundles with synthetic history, quotas, skills, services and storage snapshots; screenshots are browser pixels. No actual model, system clipboard, external network or native user window actions.'};
await writeFile(join(out,'VALIDATION.json'),JSON.stringify(report,null,2)+'\n','utf8');console.log(JSON.stringify({passed:report.passed,checks:checks.length,failures,errors,screenshots:screenshots.length}));if(!report.passed)process.exitCode=1;
