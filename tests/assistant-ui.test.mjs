import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContext,resolveProfile,updateDraft,completeDraft,reviewAction,validSelection,mergeAssistantSnapshot,legacyHistory} from '../src/assistant/helpers.mjs';
const p={id:'p',title:'雨站',view:{tab:'script',sceneId:'s'},scenes:[{id:'s',title:'站台',body:'雨落下来。她没有走。'}],characters:[{id:'c',name:'林夏'}],materials:[],tasks:[{id:'t',title:'核对动机',done:false}]};
const state={revision:3,workspace:{screen:'project',activeProjectId:'p'},projects:[p],sharedMaterials:[]};
test('global pages discard leftover project, focus and selection',()=>{for(const screen of ['overview','projects','tasks','shared'])assert.deepEqual(buildContext({...state,workspace:{...state.workspace,screen}},{projectId:'p',kind:'character',id:'c'},{projectId:'p',sceneId:'s',selection:{start:0,end:1,text:'雨'}}),{page:screen});});
test('library only carries a validated current reference',()=>{const s={...state,projects:[{...p,view:{tab:'library'}}]};assert.deepEqual(buildContext(s,{projectId:'p',kind:'character',id:'c'}),{page:'library',projectId:'p',focus:{kind:'character',id:'c'}});assert.deepEqual(buildContext(s,{projectId:'other',kind:'character',id:'c'}),{page:'library',projectId:'p'});});
test('script selection must match the latest body and exact range',()=>{const signal={projectId:'p',sceneId:'s',selection:{start:0,end:1,text:'雨'}};assert.deepEqual(buildContext(state,null,signal).selection,signal.selection);assert.equal(buildContext(state,null,signal,()=> '雪落下来。').selection,undefined);assert.equal(validSelection('雨',{start:0,end:0,text:''}),false);});
test('empty script project retains discussion context',()=>assert.deepEqual(buildContext({...state,projects:[{...p,scenes:[]}]}),{page:'script',projectId:'p'}));
test('profiles resolve actual overrides without inherited object properties',()=>{const profiles={global:{writer:{name:'默认'}},projects:{constructor:{writer:{name:'本项目'}}}};assert.equal(resolveProfile({profiles},'writer','constructor').name,'本项目');assert.equal(resolveProfile({profiles},'writer','__proto__').name,'默认');});
test('completion clears only the sent draft and preserves new typing and other contexts',()=>{let d=updateDraft({},'a',{instruction:'旧问题',mode:'rewrite',scope:'selection'});d=updateDraft(d,'b',{instruction:'别的项目'});d=updateDraft(d,'a',{instruction:'新问题'});assert.equal(completeDraft(d,'a','旧问题').a.instruction,'新问题');assert.equal(completeDraft(d,'b','别的项目').b.instruction,'');assert.equal(completeDraft(d,'b','别的项目').a.scope,'selection');});
test('older catalog responses cannot overwrite a newer mutation or history snapshot',()=>{const current={revision:8,generation:4,assistant:{roles:['new']}};assert.equal(mergeAssistantSnapshot(current,{revision:7,generation:5,assistant:{roles:['old']}}),current);assert.equal(mergeAssistantSnapshot(current,{revision:8,generation:3,assistant:{roles:['old']}}),current);assert.deepEqual(mergeAssistantSnapshot(current,{revision:9,generation:2,assistant:{roles:['latest']}}).assistant.roles,['latest']);});
test('action reviews identify actual entities, dates, fields and scene order',()=>{const a=reviewAction({type:'task.upsert',projectId:'p',task:{id:'t',title:'检查对白',due:'2026-11-19'}},state);assert.equal(a.title,'雨站 · 修改待办：核对动机');assert.deepEqual(a.fields,[['任务','检查对白'],['截止日期','2026-11-19']]);const b=reviewAction({type:'scene.update',projectId:'p',sceneId:'s',patch:{cast:['c'],summary:'她留下来'}},state);assert.equal(b.title,'雨站 · 场景：站台');assert.deepEqual(b.fields,[['出场人物','林夏'],['本场设想','她留下来']]);});
test('legacy history excludes linked duplicates but retains genuine read-only records',()=>{const records=[{id:'old',sceneId:'s'},{id:'linked',sceneId:'s'},{id:'imported',sceneId:'s',readOnly:true}];assert.deepEqual(legacyHistory({...p,aiHistory:records},'s',[{suggestionId:'linked'}]).map(x=>x.id),['old','imported']);});
test('archived script preserves the exact displayed scene context',()=>assert.equal(buildContext({...state,projects:[{...p,scenes:[{...p.scenes[0],archived:true},{id:'other',body:'别场'}]}]}).sceneId,'s'));
test('completion preserves a question retyped identically while generation is pending',()=>{let drafts=updateDraft({},'a',{instruction:'同一个问题'});const sentGeneration=drafts.a.instructionGeneration;drafts=updateDraft(drafts,'a',{instruction:''});drafts=updateDraft(drafts,'a',{instruction:'同一个问题'});assert.equal(completeDraft(drafts,'a','同一个问题',sentGeneration).a.instruction,'同一个问题');});
test('action review labels categories and reference status in their actual domain',()=>{const review=reviewAction({type:'material.upsert',projectId:'p',material:{title:'雨声',category:'idea',status:'archived'}},state);assert.deepEqual(review.fields,[['名称','雨声'],['分类','灵感'],['状态','已废弃']]);});
test('action review retains literal user field text even when it equals an enum or reserved key',()=>{assert.deepEqual(reviewAction({type:'project.create',title:'idea',kind:'constructor',deadline:''},state).fields,[['名称','idea'],['作品类型','constructor'],['交稿日期','留空']]);assert.equal(reviewAction({type:'project.update',projectId:'p',patch:{synopsis:'__proto__'}},state).fields[0][1],'__proto__');});

test('pending skill import blocks the initially captured dismiss callback and newer saves until completion',async()=>{
  const {createDialogGuard}=await import('../src/assistant/dialogGuard.mjs');
  const gate=createDialogGuard();let open=true,profile={personality:'old',skillIds:['dialogue']},release;
  const initialDismiss=()=>gate.dismiss(()=>{open=false;});
  const imported=new Promise(resolve=>{release=resolve;});
  assert.equal(gate.begin(),true);
  const pending=(async()=>{try{const skill=await imported;profile={personality:'old',skillIds:['dialogue',skill.id]};}finally{gate.finish();}})();
  for(const route of ['Escape','header close','backdrop','footer close'])assert.equal(initialDismiss(),false,route);
  assert.equal(open,true);
  assert.equal(gate.begin(),false,'a reopened/newer save cannot start during the old continuation');
  release({id:'imported-skill'});await pending;
  assert.equal(initialDismiss(),true);assert.equal(open,false);
  const reopened=createDialogGuard();open=true;assert.equal(reopened.begin(),true);
  profile={personality:'newer',skillIds:['continuity']};reopened.finish();
  await Promise.resolve();assert.deepEqual(profile,{personality:'newer',skillIds:['continuity']});
});

test('delayed adoption blocks target text/form mutations while preflight and unrelated work remain available',async()=>{
  const {createEditingGate,adoptionTargets}=await import('../src/assistant/editingGate.mjs');
  const gate=createEditingGate(),targets=adoptionTargets({projectId:'p',mode:'rewrite'}),lock=gate.acquire(targets);
  assert.equal(gate.isProjectLocked('p'),true);
  let body='原稿',localDraft=null,release;
  const edit=text=>{if(gate.isProjectLocked('p'))return false;localDraft=text;return true;};
  const autosave=()=>{if(localDraft!==null){assert.equal(gate.allows({type:'scene.update',projectId:'p'}),true);body=localDraft;localDraft=null;}};
  const apply=(async()=>{assert.equal(gate.allows({type:'scene.update',projectId:'p'},lock),true,'preflight can save already typed content');await new Promise(resolve=>{release=resolve;});body='已采用改写';gate.release(lock);})();
  assert.equal(edit('原稿加新字'),false);assert.equal(localDraft,null);
  for(const type of ['scene.update','project.update','character.upsert','material.upsert','task.upsert'])assert.equal(gate.allows({type,projectId:'p'}),false,type);
  assert.equal(gate.allows({type:'scene.update',projectId:'other'}),true);
  assert.equal(gate.allows({type:'workspace.update'}),true);
  release();await apply;autosave();assert.equal(body,'已采用改写');assert.equal(edit('已采用改写，继续写'),true);autosave();assert.equal(body,'已采用改写，继续写');
});
test('management adoption locks only affected project and shared targets',async()=>{
  const {createEditingGate,adoptionTargets}=await import('../src/assistant/editingGate.mjs');
  const targets=adoptionTargets({actions:[{action:{type:'task.upsert',projectId:'p'}},{action:{type:'project.update',projectId:'other'}}]});
  assert.deepEqual(targets,{projectIds:['p','other'],shared:false});
  const gate=createEditingGate(),lock=gate.acquire(adoptionTargets({actions:[{action:{type:'shared.update',materialId:'m'}}]}));
  assert.equal(gate.isSharedLocked(),true);assert.equal(gate.allows({type:'shared.add'}),false);assert.equal(gate.allows({type:'material.upsert',projectId:'p'}),true);gate.release(lock);assert.equal(gate.isSharedLocked(),false);
});

test('a held startup catalog exposes no editable fallback profile and retains real name/skills after load',async()=>{
  const {configurationProfile}=await import('../src/assistant/helpers.mjs');
  let release,catalog;const initial=new Promise(resolve=>{release=resolve;});const load=initial.then(value=>{catalog=value;});
  assert.equal(configurationProfile(catalog,'writer','p'),null,'settings cannot open or capture fallback edits');
  release({roles:[{id:'writer'}],profiles:{global:{writer:{name:'真实助手',personality:'真实工作方式',skillIds:['dialogue','continuity']}}}});await load;
  assert.deepEqual(configurationProfile(catalog,'writer','p'),{name:'真实助手',personality:'真实工作方式',skillIds:['dialogue','continuity']});
});
test('assistant draft recovery accepts only valid typed fields and page modes',async()=>{
  const {normalizeDrafts}=await import('../src/assistant/helpers.mjs');
  const key='["tasks",null,null,null,null]',script='["script","p","s",null,null]';
  assert.deepEqual(normalizeDrafts(null),{});assert.deepEqual(normalizeDrafts([]),{});
  assert.deepEqual(normalizeDrafts({[key]:{instruction:42,mode:'rewrite',scope:'invalid',instructionGeneration:null},[script]:{instruction:'保留我',mode:'rewrite',scope:'selection',instructionGeneration:3}}),{[key]:{},[script]:{instruction:'保留我',mode:'rewrite',scope:'selection',instructionGeneration:3}});
});

test('forced settings unmount invalidates a delayed import continuation before reopened edits are saved',async()=>{
  const {createDialogGuard}=await import('../src/assistant/dialogGuard.mjs');
  const old=createDialogGuard();old.mount();assert.equal(old.begin(),true);const checkpoint=old.checkpoint();
  let release,profile={personality:'original',skillIds:['dialogue']},oldSaves=0;
  const imported=new Promise(resolve=>{release=resolve;});
  const continuation=(async()=>{const skill=await imported;if(!old.isCurrent(checkpoint))return;oldSaves++;profile={personality:'old captured edits',skillIds:[skill.id]};})();
  old.unmount();
  const reopened=createDialogGuard();reopened.mount();assert.equal(reopened.begin(),true);
  profile={personality:'newer saved edits',skillIds:['continuity']};reopened.finish();
  release({id:'late-skill'});await continuation;
  assert.equal(oldSaves,0);assert.deepEqual(profile,{personality:'newer saved edits',skillIds:['continuity']});
  old.mount();assert.equal(old.isCurrent(checkpoint),false,'a remounted lifecycle cannot revive old continuations');
});

test('unavailable assistant backend cannot report a green model connection',async()=>{
  const {assistantReadiness,assistantError}=await import('../src/assistant/modelState.mjs');
  const error={status:404,message:'找不到此接口'};
  assert.equal(assistantError(error),'完整退出并重新打开 Harness 后加载新版助手');
  assert.deepEqual(assistantReadiness({assistant:null,loadError:assistantError(error),catalog:{connected:true,label:'模型 A'},loading:false}),{ready:false,label:'完整退出并重新打开 Harness 后加载新版助手'});
  assert.equal(assistantReadiness({assistant:{roles:[]},catalog:{connected:true,label:'模型 B'},loading:false}).ready,true);
});

test('execute defaults preserve recovered modes and gate capabilities independently of discussion',async()=>{
  const {assistantMode,executionCapabilities}=await import('../src/assistant/execution.mjs');
  assert.equal(assistantMode({}), 'execute');
  for(const mode of ['discuss','manage','rewrite','execute'])assert.equal(assistantMode({mode}),mode);
  assert.deepEqual(executionCapabilities({roles:[]}),{execute:false,write:false,navigate:false,message:'完整退出并重新打开 Harness 后加载新版执行能力'});
  assert.equal(executionCapabilities({capabilities:{execute:true,write:true,navigate:true}}).execute,true);
});

test('fresh execute reply commits once, flushes author drafts under its lock and releases on failure',async()=>{
  const {createAssistantExecutor}=await import('../src/assistant/execution.mjs');
  const events=[],token=Symbol('lock');let releaseFlush,live={page:'brief',projectId:'p'},fail=false;
  const workbench={acquireEditingLock(targets){events.push(['lock',targets]);return token;},async flush(options){events.push(['flush',options.adoptionToken]);await new Promise(resolve=>{releaseFlush=resolve;});},releaseEditingLock(value){events.push(['release',value]);}};
  const executor=createAssistantExecutor({workbench:()=>workbench,liveContext:()=>live,dialogs:()=>({anyOpen:false,editingTargets:[]}),request:async(path,payload)=>{events.push(['request',path,payload]);if(fail)throw new Error('原稿已修改');return {turn:{id:'t',applied:true},state:{revision:9}};},accept:data=>events.push(['accept',data.state.revision])});
  const turn={id:'t',mode:'execute',page:'brief',projectId:'p',actions:[{action:{type:'project.update',projectId:'p',patch:{synopsis:'生成内容'}}}]};
  let resolveModel;const model=new Promise(resolve=>{resolveModel=resolve;});const generation=model.then(turn=>executor.autoApply(turn));
  assert.deepEqual(events,[],'generation must not acquire the editing lock');
  resolveModel(turn);await Promise.resolve();assert.equal(events[0][0],'lock');assert.equal(events[1][1],token);
  assert.equal(await executor.autoApply(turn),null,'same reply cannot auto-apply twice');
  assert.equal(await executor.apply(turn),null,'manual double click cannot race automatic apply');
  live={page:'brief',projectId:'other'};releaseFlush();await generation;
  assert.deepEqual(events.find(e=>e[0]==='request')[2],{turnId:'t',allowNavigation:false},'navigation uses live context after flush');
  assert.equal(events.at(-1)[0],'release');
  const committed=events.filter(e=>e[0]==='request').length;const heldFlush=workbench.flush;workbench.flush=async()=>{};assert.equal(await executor.apply(turn),null);workbench.flush=heldFlush;assert.equal(events.filter(e=>e[0]==='request').length,committed,'a completed stale callback cannot commit again before React rerenders');
  fail=true;const retry=executor.apply({...turn,id:'retry'});await Promise.resolve();releaseFlush();await assert.rejects(retry,/原稿已修改/);assert.equal(events.at(-1)[0],'release');
});

test('target manual content dialog defers execution without saving or discarding author form edits',async()=>{
  const {createAssistantExecutor,inspectAssistantDialogs}=await import('../src/assistant/execution.mjs');
  const node={closest:()=>({dataset:{projectId:'p',workspacePage:'library'}})},document={querySelectorAll:()=>[node]};
  assert.deepEqual(inspectAssistantDialogs(document),{anyOpen:true,editingTargets:[{projectIds:['p'],shared:false}]});
  let flushes=0,commits=0;const executor=createAssistantExecutor({workbench:()=>({acquireEditingLock:()=>1,flush:async()=>{flushes++;},releaseEditingLock(){}}),liveContext:()=>({page:'library',projectId:'other'}),dialogs:()=>inspectAssistantDialogs(document),request:async()=>{commits++;return {};},accept(){}});
  const turn={id:'dialog',mode:'execute',page:'library',projectId:'p',actions:[{action:{type:'character.upsert',projectId:'p',character:{name:'新人物'}}}]};
  await assert.rejects(executor.autoApply(turn),/编辑窗口/);assert.equal(flushes,0);assert.equal(commits,0);
  const result=await executor.apply({...turn,id:'other',projectId:'other',actions:[{action:{type:'character.upsert',projectId:'other',character:{name:'别的人物'}}}]});
  assert.ok(result);assert.equal(flushes,1);assert.equal(commits,1,'another project can save in the background');
});

test('any open dialog prevents automatic navigation even if it is unrelated to written content',async()=>{
  const {createAssistantExecutor}=await import('../src/assistant/execution.mjs');let payload;
  const executor=createAssistantExecutor({workbench:()=>({acquireEditingLock:()=>1,flush:async()=>{},releaseEditingLock(){}}),liveContext:()=>({page:'brief',projectId:'p'}),dialogs:()=>({anyOpen:true,editingTargets:[]}),request:async(_,value)=>{payload=value;return {};},accept(){}});
  await executor.apply({id:'navigation',page:'brief',projectId:'p',actions:[{action:{type:'ui.navigate',page:'script',projectId:'p'}}]});assert.equal(payload.allowNavigation,false);
});

test('write preview uses captured exact selection, refuses imported turns and locks shared writes without actions',async()=>{
  const {createAssistantExecutor,writePreview,eligibleWriteTargets}=await import('../src/assistant/execution.mjs');
  const turn={id:'write',page:'script',projectId:'p',reply:'正文',selection:{start:2,end:4,text:'原稿'},writeTargets:[{target:'script.append',label:'追加到本场正文'},{target:'script.replace',label:'替换本场全部正文'},{target:'script.selection',label:'覆盖'}]};
  assert.deepEqual(writePreview(turn),{target:'script.selection',text:'正文',title:''});assert.equal(writePreview({...turn,selection:undefined}).target,'script.selection','server-eligible captured selection remains the default even if public reply omits source text');assert.equal(eligibleWriteTargets(turn).at(-1).label,'替换发送时选中的段落');
  assert.equal(writePreview({...turn,selection:undefined,writeTargets:turn.writeTargets.slice(0,2)}).target,'script.append');
  assert.equal(writePreview({...turn,selection:undefined,writeTargets:[turn.writeTargets[1]]}).target,'','whole-scene replacement needs an explicit choice');
  assert.deepEqual(eligibleWriteTargets({...turn,readOnly:true}),[]);
  let locked,requestPayload;const executor=createAssistantExecutor({workbench:()=>({acquireEditingLock:targets=>{locked=targets;return 1;},flush:async()=>{},releaseEditingLock(){}}),liveContext:()=>({page:'overview'}),dialogs:()=>({anyOpen:false,editingTargets:[]}),request:async(_,payload)=>{requestPayload=payload;return {};},accept(){}});
  await assert.rejects(executor.write({...turn,readOnly:true},{target:'script.append',text:'不可写'}),/只读/);
  await executor.write({id:'global',page:'overview',actions:[],writeTargets:[{target:'shared.new',label:'新增共享素材'}]},{target:'shared.new',text:'作者编辑稿',title:'素材标题'});
  assert.deepEqual(locked,{projectIds:[],shared:true});assert.deepEqual(requestPayload,{turnId:'global',target:'shared.new',text:'作者编辑稿',title:'素材标题'});
});

test('execution receipts resolve only actual saved entity IDs and navigation does not lock another project',async()=>{
  const {executionDestinations}=await import('../src/assistant/execution.mjs');const {adoptionTargets}=await import('../src/assistant/editingGate.mjs');
  assert.deepEqual(adoptionTargets({projectId:'p',actions:[{action:{type:'ui.navigate',projectId:'other',page:'brief'}},{action:{type:'project.update',projectId:'p'}}]}),{projectIds:['p'],shared:false});
  const receipt={appliedOutcome:{appliedWrites:[{label:'新人物',action:{type:'character.upsert',projectId:'p',character:{name:'她'}},result:{id:'actual-character'}},{label:'新资料',action:{type:'material.upsert',projectId:'p',material:{title:'线索'}},result:{id:'actual-material'}},{action:{type:'project.create'},result:{projectId:'actual-project'}}]}};
  assert.deepEqual(executionDestinations(receipt),[{page:'library',projectId:'p',focus:{kind:'character',id:'actual-character'},label:'新人物'},{page:'library',projectId:'p',focus:{kind:'material',id:'actual-material'},label:'新资料'},{page:'brief',projectId:'actual-project',label:'新作品'}]);
  assert.deepEqual(executionDestinations({actions:[{action:{type:'character.upsert',projectId:'p'}}]}),[],'model action prose is not an execution receipt');
  assert.deepEqual(reviewAction({type:'scene.write',projectId:'p',sceneId:'s',placement:'selection',text:'写入段落'},state).fields,[['写入范围','发送时选中的段落'],['剧本正文','写入段落']]);
});

test('shared imports open the actual new project material and every project recovery remains reachable',async()=>{
  const {executionDestinations,recoveryVersions}=await import('../src/assistant/execution.mjs');
  const turn={appliedOutcome:{appliedWrites:[{label:'导入雨声资料',action:{type:'shared.import',projectId:'p',materialId:'shared-source'},result:{id:'actual-import'}}]},preEditVersionIds:[{projectId:'p',versionId:'version-p'},{projectId:'other',versionId:'version-other'}]};
  assert.deepEqual(executionDestinations(turn),[{page:'library',projectId:'p',focus:{kind:'material',id:'actual-import'},label:'导入雨声资料'}]);
  assert.deepEqual(recoveryVersions(turn,{projects:[p,{id:'other',title:'另一部作品'}]}),[{projectId:'p',versionId:'version-p',projectTitle:'雨站'},{projectId:'other',versionId:'version-other',projectTitle:'另一部作品'}]);
});

test('recovered questions without a generation freeze a baseline and preserve identically retyped questions',async()=>{
  const {normalizeDrafts}=await import('../src/assistant/helpers.mjs');const key='["brief","p",null,null,null]';
  let drafts=normalizeDrafts({[key]:{instruction:'相同问题',mode:'discuss'}}),sentGeneration=drafts[key].instructionGeneration;
  assert.equal(sentGeneration,0);
  drafts=updateDraft(drafts,key,{instruction:''});drafts=updateDraft(drafts,key,{instruction:'相同问题'});
  assert.equal(completeDraft(drafts,key,'相同问题',sentGeneration)[key].instruction,'相同问题');
});

test('authoritative Brief values refresh unchanged focused inputs while dirty and inflight author work stays intact',async()=>{
  const {syncBriefFields}=await import('../src/briefFields.mjs');
  const synopsis={value:'旧梗概'},theme={value:'作者正在写的主题'},logline={value:'尚在保存的一句话故事'},form={elements:{namedItem:name=>({synopsis,'brief.theme':theme,'brief.logline':logline}[name])},ownerDocument:{activeElement:synopsis}};
  const dirty=new Set(['brief.theme']),inflight=new Map([['brief.logline',{token:1}]]);
  syncBriefFields(form,{synopsis:'已实际写入的新梗概','brief.theme':'服务端旧主题','brief.logline':'服务端旧故事'},dirty,inflight);
  assert.equal(synopsis.value,'已实际写入的新梗概','focus alone cannot leave a server write invisible after batched accept/release');
  assert.equal(theme.value,'作者正在写的主题');assert.equal(logline.value,'尚在保存的一句话故事');
});

test('optional new-item titles omit empty and whitespace values so the server can use its default',async()=>{
  const {createAssistantExecutor}=await import('../src/assistant/execution.mjs');const payloads=[];
  const executor=createAssistantExecutor({workbench:()=>({acquireEditingLock:()=>1,flush:async()=>{},releaseEditingLock(){}}),liveContext:()=>({page:'library',projectId:'p'}),dialogs:()=>({anyOpen:false,editingTargets:[]}),request:async(_,payload)=>{payloads.push(payload);return {};},accept(){}});
  for(const [index,title] of ['', '  \n\t ', '作者指定标题'].entries())await executor.write({id:`optional-title-${index}`,page:'library',projectId:'p',writeTargets:[{target:'material.new',label:'新增参考资料'}]},{target:'material.new',text:'实际素材文字',title});
  assert.equal(Object.hasOwn(payloads[0],'title'),false);assert.equal(Object.hasOwn(payloads[1],'title'),false);assert.equal(payloads[2].title,'作者指定标题');
});

test('popup never opens itself or hides manuscript on resize',async()=>{const {assistantLayout}=await import('../src/assistant/layout.mjs');for(const width of [380,800,960,1440]){assert.equal(assistantLayout(width,null).open,false);assert.equal(assistantLayout(width,true).hideContent,false);assert.equal(assistantLayout(width,true).dedicated,false);}});
test('assistant shortcut is platform-specific, guarded and composition-safe',async()=>{const {shouldSubmitAssistant}=await import('../src/assistant/layout.mjs');assert.equal(typeof shouldSubmitAssistant,'function');const base={key:'Enter',metaKey:true};assert.equal(shouldSubmitAssistant(base,true,'MacIntel'),true);for(const patch of [{isComposing:true},{keyCode:229},{repeat:true},{altKey:true},{shiftKey:true},{ctrlKey:true},{metaKey:false}])assert.equal(shouldSubmitAssistant({...base,...patch},true,'MacIntel'),false);assert.equal(shouldSubmitAssistant({key:'Enter',ctrlKey:true},true,'Win32'),true);assert.equal(shouldSubmitAssistant(base,false,'MacIntel'),false);assert.equal(shouldSubmitAssistant(base,true,'Win32'),false);});
test('episode context isolates empty units and omits unsupported backend fields',async()=>{const series={...p,kind:'电视剧',episodes:[{id:'e1',title:'一'},{id:'e2',title:'二'}],scenes:[{...p.scenes[0],episodeId:'e1'}],view:{tab:'script',episodeId:'e2'}};const live={...state,projects:[series]};assert.deepEqual(buildContext(live,null,null,undefined,{episodes:true}),{page:'script',projectId:'p',episodeId:'e2'});assert.equal(buildContext(live,null,null,undefined,{}).episodeId,undefined);const {normalizeDrafts}=await import('../src/assistant/helpers.mjs');const valid='["script","p",null,null,null,"episode","e2"]',bad='["tasks","p",null,null,null,"episode","e2"]';assert.deepEqual(Object.keys(normalizeDrafts({[valid]:{instruction:'本集'},[bad]:{},'["script",null,null,null,null,"episode","e2"]':{}})),[valid]);});

test('capability disclosure uses only server operations for actual page and mode',async()=>{const mod=await import('../src/assistant/operations.mjs').catch(()=>({}));assert.equal(typeof mod.availableOperations,'function');const catalog={script:{execute:[{type:'episode.add',title:'新增集'},{type:'scene.add',title:'添加场景'},{type:'project.trash',title:'移入废纸篓'}]}};assert.deepEqual(mod.availableOperations(catalog,{page:'script'},{kind:'电影长片'}).map(x=>x.type),['scene.add','project.trash']);assert.equal(mod.availableOperations(catalog,{page:'script',creationMode:'novel'},{format:'novel'})[0].title,'添加章节');assert.equal(mod.availableOperations(undefined,{page:'tasks'}),null);assert.deepEqual(mod.availableOperations(catalog,{page:'tasks'}),[]);});

test('capability disclosure follows execution versus preview mode without inventing discussion writes',async()=>{const {availableOperations}=await import('../src/assistant/operations.mjs');const catalog={tasks:{execute:[{type:'task.upsert',title:'添加待办'}],manage:[{type:'project.update',title:'修改资料'}]}};assert.deepEqual(availableOperations(catalog,{page:'tasks'},null,'manage').map(x=>x.type),['project.update']);assert.deepEqual(availableOperations(catalog,{page:'tasks'},null,'discuss'),[]);});
test('episode execution can navigate only while the captured episode is still current',async()=>{const {createAssistantExecutor}=await import('../src/assistant/execution.mjs');let episodeId='e1';const payloads=[];const executor=createAssistantExecutor({workbench:()=>({flush:async()=>{},acquireEditingLock:()=>1,releaseEditingLock(){}}),liveContext:()=>({page:'scenes',projectId:'p',episodeId}),dialogs:()=>({anyOpen:false,editingTargets:[]}),request:async(_,data)=>{payloads.push(data);return {};},accept(){}});await executor.apply({id:'first',page:'scenes',projectId:'p',episodeId:'e1'});assert.equal(payloads.at(-1).allowNavigation,true);episodeId='e2';await executor.apply({id:'second',page:'scenes',projectId:'p',episodeId:'e1'});assert.equal(payloads.at(-1).allowNavigation,false);});

test('recovered episode identities reject foreign focus fields and invalid scene identifiers',async()=>{const {normalizeDrafts}=await import('../src/assistant/helpers.mjs');const invalid=[['script','p','',null,null,'episode','e'],['scenes','p',42,null,null,'episode','e'],['script','p','s','material','m','episode','e'],['script',' ',null,null,null,'episode','e'],['script','p',null,null,null,'episode',' ']];for(const key of invalid)assert.deepEqual(normalizeDrafts({[JSON.stringify(key)]:{instruction:'bad'}}),{});});

for(const [platform,modifier] of [['MacIntel',{metaKey:true}],['Win32',{ctrlKey:true}]])test(`React ${platform} keyboard adapter keeps composing Enter inert and submits a normal event once`,async()=>{
  const {shouldSubmitAssistant}=await import('../src/assistant/layout.mjs');
    const synthetic={key:'Enter',keyCode:13,...modifier,nativeEvent:{key:'Enter',keyCode:13,isComposing:true}};
    assert.equal(Object.hasOwn(synthetic,'isComposing'),false,'React exposes composition state on the native event');
    assert.equal(shouldSubmitAssistant(synthetic,true,platform),false,platform);
    let submits=0;
    const normal={...synthetic,nativeEvent:{...synthetic.nativeEvent,isComposing:false}};
    if(shouldSubmitAssistant(normal,true,platform))submits++;
    assert.equal(submits,1,platform);
});
