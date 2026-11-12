import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {assistantContextKey} from '../shared/assistant-context.mjs';
import {buildContext,normalizeDrafts,reviewAction} from '../src/assistant/helpers.mjs';
import {createAssistantExecutor} from '../src/assistant/execution.mjs';
import {applyAction,createInitialState} from '../server/domain.mjs';
import {exportDocument} from '../server/exports.mjs';
const ui=await import('../src/creationUI.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const chapter={id:'c',title:'归来',act:'第一卷',cast:[],body:'她想起多年前的那个夜晚。',summary:'返回故乡',intent:'寻找母亲',outcome:'发现线索'};
const novel={id:'n',format:'novel',title:'回声',kind:'长篇小说',stage:'outline',status:'active',brief:{},synopsis:'',characters:[],materials:[],tasks:[],scenes:[chapter],versions:[],view:{tab:'script',sceneId:'c'}};
const film={...novel,id:'f',format:undefined,title:'旧剧本'};
const state={revision:1,workspace:{screen:'project',activeProjectId:'n',creationMode:'novel',openProjectIds:['f','n']},projects:[film,novel],sharedMaterials:[]};
const available={creationFormats:['screenplay','novel']};
let renders;
async function render(name,props){
  if(!renders){const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {CreationEntry} from './src/creationUI.jsx';import {SharedLibrary} from './src/overview.jsx';import {RevisionInbox} from './src/revisions/RevisionInbox.jsx';import {NewProject,Versions,ExportPanel} from './src/dialogs.jsx';import {BriefPage,ScenesPage,WriterPage} from './src/pages.jsx';import {AssistantPanel} from './src/assistant/AssistantPanel.jsx';import {AssistantSettings} from './src/assistant/AssistantSettings.jsx';export const render=(name,props)=>renderToStaticMarkup(React.createElement(({CreationEntry,SharedLibrary,RevisionInbox,NewProject,Versions,ExportPanel,BriefPage,ScenesPage,WriterPage,AssistantPanel,AssistantSettings})[name],props));`,resolveDir:new URL('..',import.meta.url).pathname,loader:'jsx'},bundle:true,platform:'node',format:'cjs',mainFields:['module','main'],external:['react','react-dom/server'],write:false});const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);renders=module.exports;}
  globalThis.document={activeElement:null};globalThis.window={};return renders.render(name,props);
}
const w={state,capabilities:available,body:(_,s)=>s.body,isProjectLocked:()=>false};
const revisions={controller:{project:()=>({open:false})},snapshot:{pending:{},capabilities:{}}};

test('novel creation captures explicit type and old backend refuses novel create/import/resume',()=>{
  assert.equal(typeof ui.newProjectAction,'function');const fields={title:'新小说',kind:'连载小说',text:'内心独白'};
  assert.deepEqual(ui.newProjectAction(fields,'novel',available),{type:'project.create',...fields,format:'novel'});
  assert.deepEqual(ui.newProjectAction(fields,'screenplay',{}),{type:'project.create',...fields});
  for(const project of [novel,{project:novel}])assert.throws(()=>ui.importProjectAction(project,{}),/完整退出并重新打开 Harness 后加载小说创作功能/);
  assert.throws(()=>ui.newProjectAction(fields,'novel',{}),/小说创作功能/);
  assert.equal(ui.importProjectAction({project:novel},available).project.format,'novel');
  assert.equal(ui.importProjectAction(film,{}).project.id,'f');
});
test('workspace entry and mode switch flush first and retain destination on failed saves',async()=>{
  assert.equal(typeof ui.createWorkspaceNavigation,'function');const calls=[];let failing=true;
  const nav=ui.createWorkspaceNavigation({getState:()=>state,getCapabilities:()=>available,flush:async()=>{calls.push('flush');if(failing)throw new Error('保存失败');},mutate:async a=>calls.push(a),dialogs:()=>false});
  await assert.rejects(nav.enter(),/保存失败/);await assert.rejects(nav.choose('novel'),/保存失败/);assert.deepEqual(calls,['flush','flush']);
  failing=false;await nav.enter();assert.deepEqual(calls.at(-1),{type:'workspace.update',patch:{screen:'entry'}});await nav.choose('novel');assert.deepEqual(calls.at(-1),{type:'workspace.update',patch:{screen:'overview',creationMode:'novel'}});
  const old=ui.createWorkspaceNavigation({getState:()=>state,getCapabilities:()=>({}),flush:async()=>{},mutate:async()=>{throw new Error('must not navigate');},dialogs:()=>false});await assert.rejects(old.open('n'),/小说创作功能/);
});
test('mode projections preserve full source state and closing a novel never activates hidden film tabs',()=>{
  assert.equal(typeof ui.projectsForMode,'function');const original=structuredClone(state);assert.deepEqual(ui.projectsForMode(state),[novel]);assert.deepEqual(state,original);
  assert.deepEqual(ui.closeProjectPatch(state,'n'),{openProjectIds:['f'],activeProjectId:null,screen:'overview'});assert.deepEqual(ui.closeProjectPatch(state,'f'),{openProjectIds:['n']});
});
test('novel contexts and recovered questions isolate all six roles while film keeps the legacy key',()=>{
  const context=buildContext(state,null,null);assert.equal(context.creationMode,'novel');assert.equal(ui.roleForContext(context),'novel-writer');
  const global=buildContext({...state,workspace:{screen:'tasks',creationMode:'novel'}});assert.deepEqual(global,{page:'tasks',creationMode:'novel'});assert.equal(ui.roleForContext(global),'novel-manager');
  const legacy=buildContext({...state,workspace:{screen:'project',activeProjectId:'f'}});assert.equal(legacy.creationMode,undefined);assert.equal(JSON.parse(assistantContextKey(legacy)).length,5);
  const key=assistantContextKey(context),old=assistantContextKey(legacy),bad=JSON.stringify(['script','n','c',null,null,'screenplay']),extra=JSON.stringify(['script','n','c',null,null,'novel','extra']);
  assert.deepEqual(Object.keys(normalizeDrafts({[key]:{instruction:'小说问题'},[old]:{instruction:'旧问题'},[bad]:{},[extra]:{}})),[key,old]);
});
test('novel execute navigation matches captured mode and defers after entrance or another mode',async()=>{
  let live={page:'tasks',creationMode:'novel'};const payloads=[];const executor=createAssistantExecutor({workbench:()=>({flush:async()=>{},acquireEditingLock:()=>1,releaseEditingLock(){}}),liveContext:()=>live,dialogs:()=>({anyOpen:false,editingTargets:[]}),request:async(_,p)=>{payloads.push(p);return {};},accept(){}});
  await executor.apply({id:'a',page:'tasks',creationMode:'novel'});assert.equal(payloads.at(-1).allowNavigation,true);
  live={page:'tasks'};await executor.apply({id:'b',page:'tasks',creationMode:'novel'});assert.equal(payloads.at(-1).allowNavigation,false);
  live={page:'entry',creationMode:'novel'};await executor.apply({id:'c',page:'tasks',creationMode:'novel'});assert.equal(payloads.at(-1).allowNavigation,false);
});
test('entrance renders both creation cards and recent works from both formats',async()=>{
  const html=await render('CreationEntry',{state,w,onChoose(){},onResume(){}});assert.match(html,/小说创作/);assert.match(html,/剧本创作/);assert.match(html,/回声/);assert.match(html,/旧剧本/);
});
test('novel project form and pages render novel fields without film staging controls',async()=>{
  const form=await render('NewProject',{w,onClose(){},go(){}});assert.match(form,/已有小说正文/);assert.match(form,/连载小说/);assert.doesNotMatch(form,/Fountain|电影长片/);
  const brief=await render('BriefPage',{p:novel,w});assert.match(brief,/目标字数/);assert.match(brief,/目标读者/);assert.match(brief,/视角与文风约束/);
  const scenes=await render('ScenesPage',{p:novel,w});assert.match(scenes,/新建章节/);assert.match(scenes,/章卡/);assert.doesNotMatch(scenes,/内景|外景|分场|场景/);
  const writer=await render('WriterPage',{p:novel,w,revisions});assert.match(writer,/小说正文：归来/);assert.match(writer,/章节大纲/);assert.doesNotMatch(writer,/内景|外景|本场|剧本正文|第.*场/);
});
test('novel export and legacy snapshots inherit chapter vocabulary',async()=>{
  const p={...novel,versions:[{id:'v',name:'第一稿',createdAt:'2026-11-12',snapshot:{...novel,format:undefined,scenes:[]}}]};
  const html=await render('ExportPanel',{p,w});assert.match(html,/Markdown/);assert.match(html,/纯文本/);assert.doesNotMatch(html,/Fountain|本场|内景/);
  const versions=await render('Versions',{p,w});assert.match(versions,/章正文不同/);assert.match(versions,/章节顺序与设定/);assert.doesNotMatch(versions,/原场景|该场景|场正文/);
});
test('every novel export option including its default reaches a supported server format',async()=>{
  const data=createInitialState(false),projectId=applyAction(data,{type:'project.create',format:'novel',title:'小说导出验收',text:'她想起那阵雨。'}).projectId;
  const p=data.projects.find(project=>project.id===projectId),html=await render('ExportPanel',{p,w});
  const formats=[...html.matchAll(/<select[^>]*>(.*?)<\/select>/gs)][1][1];
  const selected=formats.match(/<option value="([^"]+)" selected=""/)[1];
  const defaultFile=await exportDocument(data,{projectId,format:selected});
  assert.equal(defaultFile.filename,'小说导出验收.md');assert.match(defaultFile.contentType,/text\/markdown/);
  for(const [,format] of formats.matchAll(/<option value="([^"]+)"/g)){
    const file=await exportDocument(data,{projectId,format});assert.ok(file.bytes.length,format);
  }
});
test('novel action reviews expose chapter names and prose rather than IDs or film fields',()=>{
  const review=reviewAction({type:'scene.write',projectId:'n',sceneId:'c',placement:'replace',text:'她回忆往事'},state);assert.match(review.title,/章节：归来/);assert.deepEqual(review.fields,[['写入范围','替换当前章节全部正文'],['小说正文','她回忆往事']]);
  const brief=reviewAction({type:'project.update',projectId:'n',patch:{brief:{length:'十万字',audience:'青年',constraints:'第一人称'}}},state);assert.deepEqual(brief.fields,[['目标字数','十万字'],['目标读者','青年'],['视角与文风约束','第一人称']]);
});

test('novel role settings and starters use six independent prose personas and compatible common skills',async()=>{
  const roles=['manager','librarian','story','character','structure','writer'].flatMap(id=>[{id,name:'电影'+id,description:'影视'},{id:'novel-'+id,name:'小说'+id,description:'章节'}]);
  const skills=[{id:'screenwriting',name:'可拍摄动作',builtin:true},{id:'novel-voice',name:'叙述视角与文风',builtin:true},{id:'project-planning',name:'项目推进',builtin:true},{id:'material-curation',name:'资料整理',builtin:true}];
  const a={roleId:'novel-writer',context:{page:'script',projectId:'n',sceneId:'c',creationMode:'novel'},key:'novel',assistant:{roles,skills,profiles:{global:Object.fromEntries(roles.map(r=>[r.id,{name:r.name,skillIds:['novel-voice'],personality:'尊重视角'}]))}},models:{catalog:null},draft:{mode:'discuss',instruction:''},applying:{},turnErrors:{},capabilities:{execute:true},readiness:{label:'未连接'},scope:'scene'};
  const settings=await render('AssistantSettings',{a,project:novel,w});assert.match(settings,/小说manager/);assert.match(settings,/小说writer/);assert.match(settings,/项目推进/);assert.match(settings,/资料整理/);assert.doesNotMatch(settings,/电影writer|可拍摄动作/);
  const panel=await render('AssistantPanel',{a,w,open:true});assert.match(panel,/当前章节：归来/);assert.match(panel,/叙述视角|人物内心/);assert.doesNotMatch(panel,/当前场景|本场|用动作表达情绪/);
});
test('novel inbox and controller guidance retain chapter anchors and never expose screenplay terms',async()=>{
  const {createRevisionsController}=await import('../src/revisions/controller.mjs');
  const note={id:'note',sceneId:'c',status:'open',selection:{start:0,end:2,text:'她想'},instruction:'保留内心',sourceRevision:1,version:1};const p={...novel,revisionNotes:[note],revisionBatches:[],scenes:[{...chapter,revision:1}]};
  const controller=createRevisionsController({workbench:()=>({...w,getState:()=>({...state,projects:[p]})}),storage:{getItem:()=>null,setItem(){}},request:async()=>({})});
  controller.capture('n','c',note.selection);assert.throws(()=>controller.capture('n','c',{start:2,end:4,text:'起多'}),/本章还有未保存/);
  await assert.rejects(controller.reanchor('n','note','wrong',note.selection),/原章节/);
  controller.setView('n',{reanchorId:'note'});const html=await render('RevisionInbox',{p,scene:p.scenes[0],w,revisions:{controller,snapshot:controller.snapshot(),models:{catalog:null}}});assert.match(html,/第 01 章/);assert.match(html,/全部章节/);assert.match(html,/保留人物内心/);assert.doesNotMatch(html,/原场景|当前场景|历史场景|用动作表达犹豫/);
});
test('navigation refuses mode changes while an unregistered editing dialog remains open',async()=>{
  const calls=[];const nav=ui.createWorkspaceNavigation({getState:()=>state,getCapabilities:()=>available,flush:async()=>calls.push('flush'),mutate:async()=>calls.push('mutation'),dialogs:()=>true});
  await assert.rejects(nav.enter(),/保存或取消/);await assert.rejects(nav.choose('novel'),/保存或取消/);assert.deepEqual(calls,[]);
});
test('old screenplay backends can choose screenplay using only their existing workspace fields',async()=>{
  const calls=[];const nav=ui.createWorkspaceNavigation({getState:()=>state,getCapabilities:()=>({}),flush:async()=>{},mutate:async a=>calls.push(a),dialogs:()=>false});
  await nav.choose('screenplay');assert.deepEqual(calls,[{type:'workspace.update',patch:{screen:'overview'}}]);
});
test('novel enabled imported profile skills remain visible for inspection and removal',()=>{
  const skills=[{id:'screenwriting',builtin:true},{id:'novel-voice',builtin:true},{id:'custom',builtin:false}];
  assert.deepEqual(ui.skillsForMode(skills,'novel',['screenwriting']).map(s=>s.id),['screenwriting','novel-voice','custom']);
});
test('novel chapter editing fields include characters and exclude film slugline data',()=>{
  assert.equal(typeof ui.unitFields,'function');const fields=ui.unitFields({...novel,characters:[{id:'person',name:'林岚',status:'adopted'}]},[]);assert.deepEqual(fields.map(f=>f.label),['章节名','所属卷','概要','此章目标','章末变化','人物']);assert.equal(fields.at(-1).multiple,true);assert.deepEqual(fields.at(-1).options,{person:'林岚'});
});
test('chapter form values preserve every selected character and an explicit empty cast',()=>{
  assert.equal(typeof ui.formFieldValues,'function');const data=new FormData();data.append('title','归来');data.append('cast','a');data.append('cast','b');
  assert.deepEqual(ui.formFieldValues(data,[{name:'cast',multiple:true}]),{title:'归来',cast:['a','b']});data.delete('cast');assert.deepEqual(ui.formFieldValues(data,[{name:'cast',multiple:true}]),{title:'归来',cast:[]});
});
test('novel execution destinations and removed entities retain readable chapter labels',async()=>{
  const {executionDestinations}=await import('../src/assistant/execution.mjs');
  const destinations=executionDestinations({creationMode:'novel',appliedOutcome:{appliedWrites:[{action:{type:'scene.add',projectId:'n'},result:{sceneId:'new'}},{action:{type:'project.update',projectId:'n'}},{action:{type:'scene.write',projectId:'n',sceneId:'c'}}]}});
  assert.deepEqual(destinations.map(d=>d.label),['新章节','作品设定','章节']);
  const review=reviewAction({type:'scene.reorder',projectId:'n',sceneIds:['c','dead-uuid']},state);assert.doesNotMatch(JSON.stringify(review),/dead-uuid/);
});
test('novel chapter character editing preserves archived character associations',()=>{
  const fields=ui.unitFields({...novel,characters:[{id:'archived-character',name:'旧人物',status:'archived'}],scenes:[{...chapter,cast:['archived-character']}]},[]);assert.match(fields.at(-1).options['archived-character'],/旧人物/);
});
test('legacy screenplay headings and creation pages retain the existing vocabulary',async()=>{
  const output=await build({stdin:{contents:"export {sceneHeading,recentPosition} from './src/api.js';",resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'cjs',write:false});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  assert.equal(module.exports.sceneHeading({title:'站台'}),'内景 · 站台 · 日');assert.equal(module.exports.sceneHeading(chapter,novel),'归来');
  const html=await render('NewProject',{w:{...w,state:{...state,workspace:{screen:'project',activeProjectId:'f'}}}});assert.match(html,/已有剧本/);assert.match(html,/电影长片/);assert.match(html,/Fountain/);
  const writer=await render('WriterPage',{p:film,w,revisions});assert.match(writer,/剧本正文：归来/);assert.match(writer,/内景/);
});
test('the mounted root opens the common entrance before resuming an existing project',async()=>{
  const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import App from './src/App.jsx';export const render=()=>renderToStaticMarkup(React.createElement(App));",resolveDir:new URL('..',import.meta.url).pathname,loader:'jsx'},plugins:[{name:'injected-workbench',setup(build){build.onLoad({filter:/src\/useWorkbench.js$/},()=>({contents:'export function useWorkbench(){return globalThis.__novelWorkbench;}',loader:'js'}));}}],bundle:true,platform:'node',format:'cjs',mainFields:['module','main'],external:['react','react-dom/server'],write:false});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  globalThis.__novelWorkbench={...w,ai:{connected:false},getState:()=>state};const html=module.exports.render();assert.match(html,/class="app-shell entry-shell/);assert.match(html,/小说创作/);assert.match(html,/剧本创作/);assert.doesNotMatch(html,/aria-label="当前项目页面"/);globalThis.__novelWorkbench={...globalThis.__novelWorkbench,navigating:true,isNavigating:()=>true};const pending=module.exports.render();assert.match(pending,/<div[^>]*inert=""[^>]*aria-busy="true"/);delete globalThis.__novelWorkbench;
});

test('novel chapter creation review labels prose and volume fields naturally',()=>{
  const result=reviewAction({type:'scene.add',projectId:'n',scene:{title:'余响',act:'第二卷',body:'她的心慢慢静下来。'}},state);assert.deepEqual(result.fields,[['名称','余响'],['所属卷','第二卷'],['小说正文','她的心慢慢静下来。']]);
});
test('entry and mode switches preserve a manual editing dialog opened while author drafts flush',async()=>{
  for(const transition of ['enter','choose']){
    let opened=false,release;const mutations=[];const held=new Promise(resolve=>{release=resolve;});const nav=ui.createWorkspaceNavigation({getState:()=>state,getCapabilities:()=>available,flush:()=>held,mutate:async action=>mutations.push(action),dialogs:()=>opened});
    const pending=transition==='enter'?nav.enter():nav.choose('novel');opened=true;release();await assert.rejects(pending,/保存或取消/);assert.deepEqual(mutations,[]);
  }
});
test('navigation stays busy through a deferred workspace response and releases after success or failure',async()=>{
  for(const operation of ['enter','choose','open']){
    let release;const held=new Promise(resolve=>{release=resolve;}),busy=[];let started=false;
    const nav=ui.createWorkspaceNavigation({getState:()=>state,getCapabilities:()=>available,flush:async()=>{},mutate:async()=>{started=true;await held;},dialogs:()=>false,onBusy:value=>busy.push(value)});
    assert.equal(typeof nav.isBusy,'function');const run=operation==='enter'?nav.enter():operation==='choose'?nav.choose('novel'):nav.open('n');
    await Promise.resolve();await Promise.resolve();assert.equal(started,true);assert.equal(nav.isBusy(),true,'old content must stay protected until navigation accepts its response');assert.deepEqual(busy,[true]);
    await assert.rejects(nav.enter(),/正在切换/);release();await run;assert.equal(nav.isBusy(),false);assert.deepEqual(busy,[true,false]);
  }
  const busy=[];const nav=ui.createWorkspaceNavigation({getState:()=>state,getCapabilities:()=>available,flush:async()=>{},mutate:async()=>{throw new Error('离线');},dialogs:()=>false,onBusy:value=>busy.push(value)});await assert.rejects(nav.enter(),/离线/);assert.equal(nav.isBusy(),false);assert.deepEqual(busy,[true,false]);
});
test('shared imports synchronously repair an archived target and revalidate the captured click against live state',async()=>{
  assert.equal(typeof ui.sharedImportAction,'function');const activeB={...novel,id:'b',title:'另一部小说'};
  const changed={...state,workspace:{screen:'shared',creationMode:'novel'},projects:[{...novel,status:'archived'},activeB,film]};
  assert.equal(ui.eligibleSharedTarget(changed,'n').id,'b');assert.throws(()=>ui.sharedImportAction(changed,'n','material'),/重新选择/);assert.deepEqual(ui.sharedImportAction(changed,'b','material'),{type:'shared.import',projectId:'b',materialId:'material'});
  assert.throws(()=>ui.sharedImportAction({...changed,projects:[{...novel,status:'archived'},film]},'n','material'),/先创建或恢复/);
  const html=await render('SharedLibrary',{state:changed,w});assert.doesNotMatch(html,/<option value="n"/);assert.match(html,/<option value="b" selected=""/);
});
function walkElements(node,found=[]){if(Array.isArray(node)){for(const child of node)walkElements(child,found);}else if(node&&typeof node==='object'){found.push(node);walkElements(node.children,found);}return found;}
async function hookComponent(entry,{slots=[],stubs={}}={}){
  let cursor=0;const react={createElement:(type,props,...children)=>({type,props:props||{},children}),useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useEffect(){},useLayoutEffect(){},useCallback:fn=>fn,useMemo:fn=>fn(),useRef:()=>({current:null}),useSyncExternalStore:(_,get)=>get()};
  const output=await build({stdin:{contents:entry,resolveDir:new URL('..',import.meta.url).pathname},plugins:[{name:'hook-inputs',setup(build){for(const [name,contents] of Object.entries(stubs))build.onLoad({filter:new RegExp(name.replaceAll('.','\\.')+'$')},()=>({contents,loader:'js'}));}}],bundle:true,platform:'node',format:'cjs',mainFields:['module','main'],external:['react','@phosphor-icons/react'],write:false});
  const unit={exports:{}};const require=createRequire(import.meta.url);new Function('require','module','exports',output.outputFiles[0].text)(name=>name==='react'?react:name==='@phosphor-icons/react'?new Proxy({},{get:(_,key)=>String(key)}):require(name),unit,unit.exports);
  return {render(props){cursor=0;return unit.exports.Component(props);},slots};
}
test('mounted shared library repairs status-only target changes before import and validates clicks against live state',async()=>{
  const b={...novel,id:'b',title:'第二部小说'},material={id:'material',title:'参考',body:'资料',category:'research'};let live={...state,workspace:{screen:'shared',creationMode:'novel'},projects:[novel,b,film],sharedMaterials:[material]};const actions=[];
  const harness=await hookComponent("export {SharedLibrary as Component} from './src/overview.jsx';"),wb={...w,getState:()=>live,act:async action=>actions.push(action),toast(){}};
  let tree=harness.render({state:live,w:wb});assert.equal(walkElements(tree).find(node=>node.type==='select').props.value,'n');
  live={...live,projects:[{...novel,status:'archived'},b,film]};tree=harness.render({state:live,w:wb});assert.equal(walkElements(tree).find(node=>node.type==='select').props.value,'b');
  const button=walkElements(tree).find(node=>node.props.onClick&&node.children.flat().includes('加入作品 '));assert.ok(button);await button.props.onClick();assert.equal(actions.at(-1).projectId,'b');
  live={...live,projects:[{...novel,status:'archived'},{...b,status:'archived'},{...novel,id:'c',title:'未选择的小说'},film]};await button.props.onClick();assert.equal(actions.length,1,'a stale click must not silently retarget another available work');live={...live,projects:[{...novel,status:'archived'},{...b,status:'archived'},film]};await button.props.onClick();assert.equal(actions.length,1,'a click captured before archive cannot post an archived destination');tree=harness.render({state:live,w:wb});assert.equal(walkElements(tree).find(node=>node.type==='select').props.value,'');assert.equal(walkElements(tree).find(node=>node.props.onClick&&node.children.flat().includes('加入作品 ')).props.disabled,true);
});
test('root captures interaction before the busy render and a delayed modal request cannot open during navigation',async()=>{
  let busy=false,release;const held=new Promise(resolve=>{release=resolve;});globalThis.__novelWorkbench={...w,ai:{connected:false},drafts:{},getState:()=>state,navigating:false,isNavigating:()=>busy,flush:()=>held,toast(){}};
  const harness=await hookComponent("export {default as Component} from './src/App.jsx';",{slots:[false],stubs:{'src/useWorkbench.js':'export function useWorkbench(){return globalThis.__novelWorkbench;}','src/assistant/useAssistant.js':'export function useAssistant(){return {models:{}};}','src/revisions/useRevisions.js':'export function useRevisions(){return {};}','src/revisions/useRevisionChat.js':'export function useRevisionChat(){return {};}'}});
  let tree=harness.render();const versionButton=walkElements(tree).find(node=>node.children.flat().includes('版本')&&node.props.onClick);assert.ok(versionButton);const pendingModal=versionButton.props.onClick();busy=true;
  const events=[];tree.props.onClickCapture({preventDefault:()=>events.push('prevent'),stopPropagation:()=>events.push('stop')});assert.deepEqual(events,['prevent','stop']);release();await pendingModal;assert.equal(harness.slots[2],null,'delayed version dialog must stay closed until navigation ends');
  globalThis.__novelWorkbench.navigating=true;tree=harness.render();assert.equal(tree.props.inert,true);assert.equal(tree.props['aria-busy'],true);delete globalThis.__novelWorkbench;
});

test('normal mode projections and recent entry exclude recoverable trash',async()=>{const trashed={...film,id:'trash',title:'废纸篓作品',trashedAt:'2026-11-12'};const live={...state,workspace:{...state.workspace,screen:'overview',creationMode:'screenplay'},projects:[film,trashed,novel]};assert.deepEqual(ui.projectsForMode(live).map(p=>p.id),['f']);assert.deepEqual(ui.projectsForMode(live,{trashed:true}).map(p=>p.id),['trash']);assert.doesNotMatch(await render('CreationEntry',{state:live,w,onChoose(){},onResume(){}}),/废纸篓作品/);});
test('episode navigation derives owned scene and preserves empty episode destination',async()=>{const series={...film,kind:'电视剧',episodes:[{id:'e1',title:'第一集'},{id:'e2',title:'第二集'}],scenes:[{...chapter,episodeId:'e1'}],view:{tab:'scenes',episodeId:'e1'}};const calls=[];const nav=ui.createWorkspaceNavigation({getState:()=>({...state,projects:[series]}),getCapabilities:()=>({...available,episodes:true}),flush:async()=>{},mutate:async a=>calls.push(a),getView:()=>({cursor:{start:2,end:3}})});await nav.open('f','script',undefined,'e2');assert.deepEqual(calls[0].view,{tab:'script',episodeId:'e2'});await nav.open('f','script','c');assert.equal(calls[2].view.episodeId,'e1');});
test('episodic outline and empty writer keep episode controls, film and novel do not',async()=>{const series={...film,kind:'电视剧',episodes:[{id:'e1',title:'雪夜'},{id:'e2',title:'晨光'}],scenes:[{...chapter,title:'属于别集',episodeId:'e1'}],view:{tab:'script',episodeId:'e2'}};const enabled={...w,capabilities:{...available,episodes:true}};for(const component of ['ScenesPage','WriterPage']){const html=await render(component,{p:series,w:enabled,revisions});assert.match(html,/当前集/);assert.match(html,/晨光/);assert.match(html,/新增集/);assert.doesNotMatch(html,/属于别集/);}for(const project of [film,novel])assert.doesNotMatch(await render('ScenesPage',{p:project,w:enabled}),/当前集|新增集/);});

test('project trash flushes first, blocks manual edits and leaves recovery data to its owner',async()=>{assert.equal(typeof ui.createProjectLifecycle,'function');const calls=[];let targets=[],fail=true;const live={...state,projects:[film,novel]};const lifecycle=ui.createProjectLifecycle({getState:()=>live,getCapabilities:()=>({projectTrash:true}),flush:async()=>{calls.push('flush');if(fail)throw new Error('保存失败');},mutate:async a=>calls.push(a),dialogs:()=>({editingTargets:targets})});await assert.rejects(lifecycle.trash('f'),/保存失败/);assert.deepEqual(calls,['flush']);fail=false;targets=[{projectIds:['f']}];await assert.rejects(lifecycle.trash('f'),/编辑窗口/);assert.deepEqual(calls,['flush']);targets=[];await lifecycle.trash('f');assert.deepEqual(calls.at(-1),{type:'project.trash',projectId:'f'});});
test('episode scene order includes archived owned scenes and retains other episode slots',()=>{assert.equal(typeof ui.sceneReorderAction,'function');const series={...film,kind:'电视剧',episodes:[{id:'e1'},{id:'e2'}],view:{episodeId:'e1'},scenes:[{id:'a',episodeId:'e1'},{id:'b',episodeId:'e2'},{id:'archive',episodeId:'e1',archived:true},{id:'c',episodeId:'e1'}]};assert.deepEqual(ui.sceneReorderAction(series,'c','a',{episodes:true}),{type:'scene.reorder',projectId:'f',episodeId:'e1',sceneIds:['c','a','archive']});assert.throws(()=>ui.sceneReorderAction(series,'c','a',{}),/重新打开 Harness/);});

test('project and global page navigation refuses real manual dialogs before flushing',async()=>{const calls=[];const nav=ui.createWorkspaceNavigation({getState:()=>state,getCapabilities:()=>available,dialogs:()=>true,flush:async()=>calls.push('flush'),mutate:async()=>calls.push('mutate')});await assert.rejects(nav.open('n','script','c'),/编辑窗口/);assert.equal(typeof nav.show,'function');await assert.rejects(nav.show('trash'),/编辑窗口/);assert.deepEqual(calls,[]);});

test('manual episode and scene forms cannot be dismissed while their save is pending',async()=>{const harness=await hookComponent("export {FormModal as Component} from './src/components.jsx';");let closeCount=0,release;const held=new Promise(resolve=>{release=resolve;});const tree=harness.render({title:'编辑集',fields:[],onClose:()=>closeCount++,onSave:()=>held});const form=walkElements(tree).find(node=>node.type==='form');const Original=globalThis.FormData;globalThis.FormData=class extends Original{constructor(){super();}};try{const pending=form.props.onSubmit({preventDefault(){},currentTarget:{}});tree.props.onClose();assert.equal(closeCount,0);release();await pending;assert.equal(closeCount,1);}finally{globalThis.FormData=Original;release();}});

test('writer exposes one episode selector shared by narrow and wide layouts',async()=>{const series={...film,kind:'短剧',episodes:[{id:'e1',title:'第一集'}],scenes:[{...chapter,episodeId:'e1'}],view:{tab:'script',episodeId:'e1',sceneId:'c'}};const html=await render('WriterPage',{p:series,w:{...w,capabilities:{episodes:true}},revisions});assert.equal((html.match(/aria-label="当前集"/g)||[]).length,1);});

test('writer ignores recovered inbox visibility and keeps blue assistant entry in every writer state',async()=>{
  const recovered={controller:{project:()=>({open:true})},snapshot:{pending:{},capabilities:{}}};
  for(const p of [film,{...film,scenes:[]},{...film,scenes:[{...chapter,archived:true}]}]){
    const html=await render('WriterPage',{p,w,revisions:recovered});
    assert.doesNotMatch(html,/批注箱|revision-inbox|段落批注/);
    assert.match(html,/<button class="button primary[^"]*"[^>]*>[\s\S]*?AI 协助<\/button>/);
    if(p.scenes.length&&!p.scenes[0].archived){assert.match(html,/剧本正文：归来/);assert.doesNotMatch(html,/writer-manuscript-pane" hidden/);}
  }
});

test('paragraph attachments enable empty-instruction send and replace range modes with one collapsed group and honest history',async()=>{
  const note={id:'queued',sceneId:'c',selection:{start:0,end:2,text:'她想'},instruction:'保留犹豫',version:1,status:'open'};
  const batch={id:'sent',createdAt:'2026-11-12T02:00:00Z',chatInstruction:'统一克制',model:'真实模型',changes:[{...note,id:'written',noteId:'earlier',noteVersion:1,replacement:'她回忆起',status:'applied'}],preEditVersionIds:[{projectId:'n',versionId:'before'}]};
  const a={roleId:'novel-writer',context:{page:'script',projectId:'n',sceneId:'c',creationMode:'novel'},key:'novel',assistant:{roles:[{id:'novel-writer',name:'小说助手'}],skills:[],profiles:{global:{'novel-writer':{name:'小说助手',skillIds:[]}}},threads:{}},models:{catalog:null},draft:{mode:'execute',instruction:''},applying:{},turnErrors:{},capabilities:{execute:true},readiness:{label:'可用'},scope:'scene',sendReady:true,pendingCount:0};
  const revisionChat={notes:[note],batches:[batch],ready:true,busy:false,issue:'',error:'',snapshot:{batchErrors:{}},revisions:{controller:{project:()=>({editors:{}})},viewOriginal(){}},send(){},retry(){}};
  const html=await render('AssistantPanel',{a,w,open:true,revisionChat});
  assert.match(html,/1 条段落意见/);assert.doesNotMatch(html,/<details[^>]* open/);assert.match(html,/发送后统一修改标注段落，修改前保留版本/);
  assert.doesNotMatch(html,/助手工作模式|助手改写范围|一起推进|type="checkbox"/);
  const send=html.match(/<button[^>]*aria-label="发送助手问题"[^>]*>[\s\S]*?<\/button>/)?.[0];assert.ok(send);assert.doesNotMatch(send,/disabled/);assert.match(send,/发送/);
  assert.match(html,/统一克制/);assert.match(html,/已写入 1 条段落修改/);assert.match(html,/查看修改前版本/);
});

test('mounted opinion composer sends by click and guarded shortcut with attachments alone',async()=>{
  const harness=await hookComponent("export {AssistantComposer as Component} from './src/assistant/AssistantComposer.jsx';"),sent=[];
  const props={a:{context:{page:'script'},draft:{mode:'rewrite',instruction:''},capabilities:{},scope:'selection',change(){},submit:()=>assert.fail('attachments must use exact revision route')},project:novel,revisionChat:{notes:[{id:'n'}],ready:true,busy:false,send:()=>sent.push('send')}};
  const tree=harness.render(props),textarea=walkElements(tree).find(node=>node.type==='textarea'),submit=()=>tree.props.onSubmit({preventDefault(){}});
  submit();assert.equal(sent.length,1);
  for(const event of [{key:'Enter',metaKey:true,isComposing:true},{key:'Enter',ctrlKey:true,nativeEvent:{isComposing:true}},{key:'Enter'},{key:'Enter',metaKey:true,repeat:true}])textarea.props.onKeyDown({...event,currentTarget:{form:{requestSubmit:submit}},preventDefault(){}});
  assert.equal(sent.length,1);
  textarea.props.onKeyDown({key:'Enter',metaKey:true,nativeEvent:{isComposing:false},currentTarget:{form:{requestSubmit:submit}},preventDefault(){}});assert.equal(sent.length,2);
  const blocked=harness.render({...props,revisionChat:{...props.revisionChat,ready:false}});blocked.props.onSubmit({preventDefault(){}});assert.equal(sent.length,2);
});

test('opinion inspection waits for navigation and reports blocked navigation without scheduling a false focus',async()=>{
  let finish,closed=0;const held=new Promise(resolve=>{finish=resolve;}),harness=await hookComponent("import {useRevisions} from './src/revisions/useRevisions.js';export const Component=props=>useRevisions(props.w,{},props.onViewed);"),note={id:'n',sceneId:'c',sourceRevision:0,selection:{start:0,end:2,text:'她想'}};
  const mounted=harness.render({w:{...w,getState:()=>state,go:()=>held,toast(){}},onViewed:()=>closed++});
  const inspecting=mounted.viewOriginal('n',note);assert.equal(typeof inspecting?.then,'function');assert.equal(harness.slots[0],null);assert.equal(closed,0);
  finish(false);await assert.rejects(inspecting,/无法|未能|编辑|跳转/);assert.equal(harness.slots[0],null);assert.equal(closed,0);
});


test('successful opinion inspection reveals the manuscript only after navigation and preserves captured focus',async()=>{
  let finish,closed=0;const held=new Promise(resolve=>{finish=resolve;}),harness=await hookComponent("import {useRevisions} from './src/revisions/useRevisions.js';export const Component=props=>useRevisions(props.w,{},props.onViewed);"),note={id:'n',sceneId:'c',selection:{start:0,end:2,text:'她想'}};
  const mounted=harness.render({w:{...w,getState:()=>state,go:()=>held,toast(){}},onViewed:()=>closed++});
  const inspecting=mounted.viewOriginal('n',note);assert.equal(closed,0);assert.equal(harness.slots[0],null);
  finish(true);await inspecting;assert.equal(closed,1);assert.equal(harness.slots[0].projectId,'n');assert.equal(harness.slots[0].sceneId,'c');assert.deepEqual(harness.slots[0].selection,note.selection);
});
