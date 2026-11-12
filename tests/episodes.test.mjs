import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { applyAction, createInitialState, snapshot } from '../server/domain.mjs';
import { assistantContextKey } from '../shared/assistant-context.mjs';
import { prepareAssistantRequest, buildAssistantPrompts, appendAssistantTurn, applyAssistantTurn, writeAssistantReply, getAssistant } from '../server/assistant.mjs';
import { navigationMatches, applyNavigation } from '../server/assistant-execution.mjs';
import { exportDocument } from '../server/exports.mjs';
const helpers = await import('../shared/episodes.mjs').catch(() => ({}));
function fixture() { const state = createInitialState(false); const id = applyAction(state, { type:'project.create', title:'连载', kind:'剧集' }).projectId; return { state, p:state.projects.find(p=>p.id===id), id }; }
const chat = (state,context,mode='execute')=>prepareAssistantRequest(state,{context,mode,instruction:'执行'});
const output = actions=>({text:JSON.stringify({reply:'建议',actions:actions.map(action=>({label:'修改',action}))})});
function xml(bytes) { let at=0; while(at<bytes.length-30){ if(bytes.readUInt32LE(at)!==0x04034b50){at++;continue;} const method=bytes.readUInt16LE(at+8),size=bytes.readUInt32LE(at+18),n=bytes.readUInt16LE(at+26),e=bytes.readUInt16LE(at+28),name=bytes.subarray(at+30,at+30+n).toString(),start=at+30+n+e; if(name==='word/document.xml') return (method===8?inflateRawSync(bytes.subarray(start,start+size)):bytes.subarray(start,start+size)).toString(); at=start+size; } throw Error('document XML missing'); }

test('browser-safe episode projection has stable virtual legacy ownership without read mutations',()=>{
  assert.equal(typeof helpers.projectEpisodes,'function');
  const {p}=fixture(); delete p.episodes; delete p.view.episodeId; p.scenes=[{id:'old',title:'旧稿',body:'保留',archived:false}]; const before=structuredClone(p);
  assert.equal(helpers.isEpisodic(p),true); const first=helpers.projectEpisodes(p)[0]; assert.equal(first.title,'第1集'); assert.equal(helpers.sceneEpisodeId(p,p.scenes[0]),first.id); assert.deepEqual(helpers.episodeScenes(p,first.id),p.scenes); assert.deepEqual(p,before); assert.equal(helpers.projectEpisodes(p)[0].id,first.id);
  for(const kind of ['电视剧','迷你剧','短剧']) assert.equal(helpers.isEpisodic({...p,kind}),true);
  assert.equal(helpers.isEpisodic({...p,format:'novel'}),false); assert.deepEqual(helpers.projectEpisodes({...p,kind:'电影'}),[]);
});
test('episode mutations materialize legacy scenes, preserve dormant data and reject foreign moves',()=>{
  const {state,p,id}=fixture(); assert.equal(p.episodes?.length,1); const first=p.episodes[0].id;
  delete p.episodes; delete p.view.episodeId; p.scenes=[{id:'old',title:'旧稿',body:'保留',revision:0,archived:false}];
  const second=applyAction(state,{type:'episode.add',projectId:id,episode:{title:'第二集',summary:'追赶'}}).episodeId;
  assert.equal(p.episodes.length,2); assert.equal(p.scenes[0].episodeId,p.episodes[0].id); assert.equal(p.scenes[0].body,'保留');
  const sceneId=applyAction(state,{type:'scene.add',projectId:id,scene:{title:'新稿',episodeId:second}}).sceneId;
  applyAction(state,{type:'episode.update',projectId:id,episodeId:second,patch:{summary:'新梗概'}}); applyAction(state,{type:'episode.reorder',projectId:id,episodeIds:[second,p.episodes[0].id]});
  assert.equal(p.episodes[0].summary,'新梗概'); const before=structuredClone(state);
  assert.throws(()=>applyAction(state,{type:'scene.update',projectId:id,sceneId,patch:{episodeId:'foreign'}}),/集/); assert.deepEqual(state,before);
  assert.throws(()=>applyAction(state,{type:'episode.reorder',projectId:id,episodeIds:[second,second]}));
  applyAction(state,{type:'project.update',projectId:id,patch:{kind:'电影'}}); assert.equal(p.episodes[0].id,second); applyAction(state,{type:'project.update',projectId:id,patch:{kind:'剧集'}}); assert.equal(p.scenes[1].episodeId,second); assert.notEqual(first,undefined);
});
test('episode snapshot restore clears stale current ownership and rejects malformed imports atomically',async()=>{
  const {state,p,id}=fixture(); const first=p.episodes[0]?.id; assert.ok(first);
  const old=applyAction(state,{type:'scene.add',projectId:id,scene:{body:'第一稿',episodeId:first}}).sceneId;
  const legacy=snapshot(p); delete legacy.episodes; legacy.scenes.forEach(s=>delete s.episodeId); p.versions.push({id:'legacy',name:'旧版',createdAt:new Date().toISOString(),snapshot:legacy});
  const second=applyAction(state,{type:'episode.add',projectId:id,episode:{title:'第二集'}}).episodeId;
  applyAction(state,{type:'scene.update',projectId:id,sceneId:old,patch:{episodeId:second}}); applyAction(state,{type:'view.save',projectId:id,view:{episodeId:second,sceneId:old}});
  applyAction(state,{type:'version.restore',projectId:id,versionId:'legacy'}); assert.equal(helpers.projectEpisodes(p).length,1); assert.equal(helpers.sceneEpisodeId(p,p.scenes[0]),helpers.projectEpisodes(p)[0].id); assert.equal(p.view.episodeId,helpers.projectEpisodes(p)[0].id); assert.equal(p.scenes[0].body,'第一稿');
  const before=structuredClone(state); for(const episodes of [[{id:'dup',title:'一'},{id:'dup',title:'二'}],[{id:42,title:'坏'}]]) { assert.throws(()=>applyAction(state,{type:'project.import',project:{...snapshot(p),episodes}})); assert.deepEqual(state,before); }
  assert.throws(()=>applyAction(state,{type:'project.import',project:{...snapshot(p),episodes:[{id:'valid',title:'一'}],scenes:[{...p.scenes[0],episodeId:'foreign'}]}})); assert.deepEqual(state,before);
});
test('assistant episode scope captures ownership and navigation freshness while retaining legacy keys',()=>{
  const {state,p,id}=fixture(); const first=p.episodes?.[0]?.id; assert.ok(first); const second=applyAction(state,{type:'episode.add',projectId:id,episode:{title:'第二集'}}).episodeId;
  const s1=applyAction(state,{type:'scene.add',projectId:id,scene:{title:'第一集场',episodeId:first}}).sceneId; const s2=applyAction(state,{type:'scene.add',projectId:id,scene:{title:'第二集秘密',episodeId:second}}).sceneId;
  const context={page:'scenes',projectId:id,episodeId:first}; const prepared=chat(state,context); assert.deepEqual(JSON.parse(prepared.contextKey),['scenes',id,null,null,null,'episode',first]); assert.deepEqual(JSON.parse(assistantContextKey({page:'script',projectId:'p',sceneId:'s'})),['script','p','s',null,null]); assert.equal(JSON.parse(assistantContextKey({page:'script',creationMode:'novel'})).length,6);
  assert.ok(!buildAssistantPrompts(state,prepared).user.includes('第二集秘密')); for(const invalid of [{...context,episodeId:'foreign'},{...context,page:'brief'},{...context,sceneId:s2}]) assert.throws(()=>chat(state,invalid));
  applyNavigation(state,{page:'scenes',projectId:id,episodeId:first,sceneId:s1}); assert.equal(navigationMatches(state,prepared.context),true);
  const turn=appendAssistantTurn(state,prepared,output([{type:'scene.add',projectId:id,scene:{title:'捕获第一集'}}]));
  applyAction(state,{type:'view.save',projectId:id,view:{episodeId:second,sceneId:s2}}); assert.equal(navigationMatches(state,prepared.context),false);
  applyAssistantTurn(state,{turnId:turn.id}); assert.equal(p.scenes.length,2); const current=state.projects.find(p=>p.id===id); assert.equal(current.scenes[2].episodeId,first); assert.equal(current.view.episodeId,second);
  const written=appendAssistantTurn(state,chat(state,context,'discuss'),{text:'第一集补充'}); const result=writeAssistantReply(state,{turnId:written.id,target:'scene.new.summary'}); assert.equal(state.projects.find(p=>p.id===id).scenes.at(-1).episodeId,first); assert.equal(result.destination.episodeId,first);
});
test('episode exports retain ordered headings and JSON ownership through full and named round trips',async()=>{
  const {state,p,id}=fixture(); const first=p.episodes?.[0]?.id; assert.ok(first); const second=applyAction(state,{type:'episode.add',projectId:id,episode:{title:'第二集'}}).episodeId;
  applyAction(state,{type:'scene.add',projectId:id,scene:{title:'甲',body:'甲正文',act:'同一幕',episodeId:first}}); applyAction(state,{type:'scene.add',projectId:id,scene:{title:'乙',body:'乙正文',act:'同一幕',episodeId:second}}); applyAction(state,{type:'episode.reorder',projectId:id,episodeIds:[second,first]});
  const v=applyAction(state,{type:'version.create',projectId:id,name:'分集版'}).id;
  for(const versionId of [undefined,v]) { const backup=JSON.parse((await exportDocument(state,{projectId:id,format:'json',versionId})).bytes); const copyId=applyAction(state,{type:'project.import',project:backup}).projectId; const copy=state.projects.find(p=>p.id===copyId); assert.deepEqual(copy.episodes,p.episodes); assert.deepEqual(copy.scenes.map(s=>s.episodeId),p.scenes.map(s=>s.episodeId)); }
  for(const format of ['fountain','html','docx']){const bytes=(await exportDocument(state,{projectId:id,format})).bytes; const body=format==='docx'?xml(bytes):bytes.toString(); assert.ok(body.indexOf('第二集')<body.indexOf('第1集')); assert.ok(body.indexOf('乙正文')<body.indexOf('甲正文')); if(format==='fountain') assert.equal(body.match(/# 同一幕/g)?.length,2);}
});

test('dormant episode metadata and view roundtrip through film import and new series view captures survive provider latency',async()=>{
 const{state,p,id}=fixture();const first=p.episodes[0].id;const second=applyAction(state,{type:'episode.add',projectId:id,episode:{title:'二'}}).episodeId;const sceneId=applyAction(state,{type:'scene.add',projectId:id,scene:{body:'原稿',episodeId:first}}).sceneId;
 applyAction(state,{type:'project.update',projectId:id,patch:{kind:'电影'}});const dormant=JSON.parse((await exportDocument(state,{projectId:id,format:'json'})).bytes); const copied=applyAction(state,{type:'project.import',project:dormant}).projectId;assert.deepEqual(getAssistant(state).roles.length,12);assert.deepEqual(state.projects.find(p=>p.id===copied).episodes,p.episodes);assert.equal(state.projects.find(p=>p.id===copied).view.episodeId,first);
 applyAction(state,{type:'project.update',projectId:id,patch:{kind:'剧集'}});const prepared=chat(state,{page:'brief',projectId:id});applyAction(state,{type:'view.save',projectId:id,view:{episodeId:second}});const turn=appendAssistantTurn(state,prepared,output([{type:'scene.add',projectId:id,scene:{title:'捕获默认集'}}]));applyAssistantTurn(state,{turnId:turn.id});assert.equal(state.projects.find(p=>p.id===id).scenes.at(-1).episodeId,first);
});

test('episode scene moves invalidate old legacy and paragraph sources and keep execution views coherent',async()=>{
 const domain=await import('../server/domain.mjs');const{state,p,id}=fixture();const first=p.episodes[0].id;const second=applyAction(state,{type:'episode.add',projectId:id,episode:{title:'二'}}).episodeId;const sceneId=applyAction(state,{type:'scene.add',projectId:id,scene:{body:'原稿',episodeId:first}}).sceneId;
 const suggestion=domain.appendSuggestion(state,domain.prepareSuggestion(state,{projectId:id,sceneId,mode:'rewrite',instruction:'改'}),{text:'旧建议'}); const turn=appendAssistantTurn(state,chat(state,{page:'scenes',projectId:id,episodeId:first}),output([{type:'scene.update',projectId:id,sceneId,patch:{episodeId:second}}]));applyAssistantTurn(state,{turnId:turn.id});const current=state.projects.find(p=>p.id===id);assert.equal(current.view.episodeId,second);assert.throws(()=>applyAction(state,{type:'ai.apply',projectId:id,suggestionId:suggestion.id}),/修改/);
});

test('legacy virtual episode assistant history remaps to the imported project and rejects foreign episode history atomically',async()=>{
 const{state,p,id}=fixture();delete p.episodes;delete p.view.episodeId;p.scenes=[];
 const first=helpers.projectEpisodes(p)[0].id; const turn=appendAssistantTurn(state,chat(state,{page:'scenes',projectId:id,episodeId:first},'discuss'),{text:'旧剧集建议'});assert.equal(turn.episodeId,first);
 const backup=JSON.parse((await exportDocument(state,{projectId:id,format:'json'})).bytes);const copyId=applyAction(state,{type:'project.import',project:backup}).projectId;const copied=Object.values(getAssistant(state).threads).flat().find(turn=>turn.projectId===copyId);assert.equal(copied.episodeId,helpers.projectEpisodes(state.projects.find(p=>p.id===copyId))[0].id);assert.deepEqual(JSON.parse(copied.contextKey).slice(-2),['episode',copied.episodeId]);assert.equal(copied.readOnly,true);
 const invalid=structuredClone(backup);invalid.assistant.turns[0].episodeId='foreign';const before=structuredClone(state);assert.throws(()=>applyAction(state,{type:'project.import',project:invalid}));assert.deepEqual(state,before);
});

test('full backups retain dormant and historical episode conversations after a scene moves',async()=>{
 const{state,p,id}=fixture();const first=p.episodes[0].id,second=applyAction(state,{type:'episode.add',projectId:id,episode:{title:'二'}}).episodeId;const sceneId=applyAction(state,{type:'scene.add',projectId:id,scene:{body:'稿',episodeId:first}}).sceneId;appendAssistantTurn(state,chat(state,{page:'script',projectId:id,sceneId,episodeId:first},'discuss'),{text:'历史讨论'});applyAction(state,{type:'scene.update',projectId:id,sceneId,patch:{episodeId:second}});
 for(const kind of ['剧集','电影']) {applyAction(state,{type:'project.update',projectId:id,patch:{kind}});const backup=JSON.parse((await exportDocument(state,{projectId:id,format:'json'})).bytes);const copyId=applyAction(state,{type:'project.import',project:backup}).projectId;const turn=Object.values(getAssistant(state).threads).flat().find(turn=>turn.projectId===copyId);assert.equal(turn.episodeId,first);assert.equal(turn.reply,'历史讨论');assert.equal(turn.readOnly,true);}
});

test('legacy scene AI outline contains only its owned episode',async()=>{
 const domain=await import('../server/domain.mjs'),ai=await import('../server/ai.mjs');const{state,p,id}=fixture();const first=p.episodes[0].id,second=applyAction(state,{type:'episode.add',projectId:id,episode:{title:'二'}}).episodeId;const sceneId=applyAction(state,{type:'scene.add',projectId:id,scene:{title:'选中集',episodeId:first}}).sceneId;applyAction(state,{type:'scene.add',projectId:id,scene:{title:'另一集保密大纲',episodeId:second}});const prompt=ai.buildPrompts(state,domain.prepareSuggestion(state,{projectId:id,sceneId,mode:'discuss',instruction:'讨论'}));assert.ok(!prompt.user.includes('另一集保密大纲'));
});

test('film and novel prompts omit series-only episode operations while series prompts advertise them',()=>{
 const{state,p,id}=fixture();assert.match(buildAssistantPrompts(state,chat(state,{page:'scenes',projectId:id})).system,/"episode\.add":/);for(const patch of [{kind:'电影'},{format:'novel',kind:'长篇小说'}]){Object.assign(p,patch);assert.doesNotMatch(buildAssistantPrompts(state,chat(state,{page:'scenes',projectId:id})).system,/"episode\.(add|update|reorder)":/);}
});

test('live assistant capture survives view change, server reopen, execution recovery and inert JSON roundtrip',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{startServer}=await import('../server/index.mjs');
 const directory=await mkdtemp(join(tmpdir(),'storydesk-episode-live-'));let finish,began,prompt;const started=new Promise(resolve=>{began=resolve;});let app=await startServer({directory,seed:false,port:0,modelAdapter:async input=>{prompt=input;began();return new Promise(resolve=>{finish=resolve;});}});t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const http=async(path,data)=>{const r=await fetch(app.url+path,{method:data?'POST':'GET',headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});return{status:r.status,...await r.json()};};const action=action=>http('/api/actions',{action});
 const created=await action({type:'project.create',title:'连载',kind:'电视剧'}),id=created.result.projectId,first=created.state.projects[0].episodes[0].id;const second=(await action({type:'episode.add',projectId:id,episode:{title:'第二集'}})).result.episodeId;await action({type:'scene.add',projectId:id,scene:{title:'第一集源场',episodeId:first,body:'恢复源稿'}});await action({type:'view.save',projectId:id,view:{tab:'scenes',episodeId:first}});
 const pending=http('/api/assistant',{context:{page:'scenes',projectId:id,episodeId:first},mode:'execute',instruction:'补场并打开分场'});await started;assert.equal(JSON.parse(prompt.user).context.episodeId,first);await action({type:'view.save',projectId:id,view:{episodeId:second}});finish(output([{type:'scene.add',projectId:id,scene:{title:'捕获补场',body:'第一集新增'}},{type:'ui.navigate',page:'scenes',projectId:id,episodeId:first}]));const generated=await pending;assert.equal(generated.status,200,generated.error);assert.equal(generated.turn.episodeId,first);
 await app.close();app=await startServer({directory,port:0,modelAdapter:async()=>{throw Error('must not replay');}});const applied=await http('/api/assistant/apply',{turnId:generated.turn.id});assert.equal(applied.status,200,applied.error);const project=applied.state.projects.find(p=>p.id===id);assert.equal(project.scenes.at(-1).episodeId,first);assert.equal(project.view.episodeId,second);assert.equal(applied.result.appliedNavigation.length,0);assert.equal(applied.result.skippedNavigation.length,1);const version=project.versions.find(v=>v.id===applied.result.preEditVersionIds[0].versionId);assert.equal(version.snapshot.scenes.length,1);assert.equal(version.snapshot.scenes[0].body,'恢复源稿');
 const backup=await(await fetch(app.url+`/api/export?projectId=${id}&format=json`)).json();const copied=await action({type:'project.import',project:backup});assert.equal(copied.status,200,copied.error);const copyId=copied.result.projectId,assistant=await http('/api/assistant');const copyTurn=Object.values(assistant.assistant.threads).flat().find(turn=>turn.projectId===copyId);assert.equal(copyTurn.readOnly,true);assert.equal(JSON.parse(copyTurn.contextKey)[6],first);assert.equal((await http('/api/assistant/apply',{turnId:copyTurn.id})).status,400);
});

test('episode scene reorder replaces only owned global slots and AI binds the captured episode',()=>{
 const{state,p,id}=fixture();const first=p.episodes[0].id,second=applyAction(state,{type:'episode.add',projectId:id,episode:{title:'二'}}).episodeId;
 const add=(title,episodeId,archived=false)=>applyAction(state,{type:'scene.add',projectId:id,scene:{title,episodeId,archived}}).sceneId;
 const a=add('甲',first),hiddenA=add('隐藏甲',second),b=add('乙归档',first,true),hiddenB=add('隐藏乙',second);const before=structuredClone(state);
 assert.throws(()=>applyAction(state,{type:'scene.reorder',projectId:id,episodeId:first,sceneIds:[a]}));assert.deepEqual(state,before);
 applyAction(state,{type:'scene.reorder',projectId:id,episodeId:first,sceneIds:[b,a]});assert.deepEqual(p.scenes.map(s=>s.id),[b,hiddenA,a,hiddenB]);
 const context={page:'scenes',projectId:id,episodeId:first},prepared=chat(state,context);const turn=appendAssistantTurn(state,prepared,output([{type:'scene.reorder',projectId:id,sceneIds:[a,b]}]));assert.equal(turn.actions[0].action.episodeId,first);applyAssistantTurn(state,{turnId:turn.id});assert.deepEqual(state.projects.find(p=>p.id===id).scenes.map(s=>s.id),[a,hiddenA,b,hiddenB]);
 for(const episodeId of [second,'foreign']) assert.throws(()=>appendAssistantTurn(state,chat(state,context),output([{type:'scene.reorder',projectId:id,episodeId,sceneIds:episodeId===second?[hiddenB,hiddenA]:[a,b]}])));
 assert.throws(()=>appendAssistantTurn(state,chat(state,context),output([{type:'scene.reorder',projectId:id,sceneIds:[a,hiddenB,b,hiddenA]}])));
});

test('reentering series after ordinary film navigation persists a coherent owned scene and episode on reopen',async t=>{
 const{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createStore}=await import('../server/store.mjs');const directory=await mkdtemp(join(tmpdir(),'storydesk-kind-reopen-'));t.after(()=>rm(directory,{recursive:true,force:true}));let store=await createStore({directory,seed:false});const create=await store.dispatch({type:'project.create',title:'剧集',kind:'剧集'}),id=create.result.projectId,first=create.state.projects[0].episodes[0].id;const second=(await store.dispatch({type:'episode.add',projectId:id,episode:{title:'二'}})).result.episodeId;const s1=(await store.dispatch({type:'scene.add',projectId:id,scene:{episodeId:first,body:'一稿'}})).result.sceneId,s2=(await store.dispatch({type:'scene.add',projectId:id,scene:{episodeId:second,body:'二稿'}})).result.sceneId;
 await store.dispatch({type:'view.save',projectId:id,view:{episodeId:second,sceneId:s2}});await store.dispatch({type:'project.update',projectId:id,patch:{kind:'电影'}});await store.dispatch({type:'view.save',projectId:id,view:{sceneId:s1}});await store.dispatch({type:'project.update',projectId:id,patch:{kind:'剧集'}});store=await createStore({directory});const p=(await store.read()).projects[0];assert.equal(p.view.sceneId,s1);assert.equal(p.view.episodeId,first);assert.deepEqual(p.episodes.map(e=>e.id),[first,second]);assert.deepEqual(p.scenes.map(s=>s.body),['一稿','二稿']);
});

test('ordinary restored backups preserve proven historical episode discussion across kind changes and refuse forged foreign IDs',async()=>{
 const{state,p,id}=fixture();const first=p.episodes[0].id;const saved=applyAction(state,{type:'version.create',projectId:id,name:'首集版'}).id,second=applyAction(state,{type:'episode.add',projectId:id,episode:{title:'历史第二集'}}).episodeId;appendAssistantTurn(state,chat(state,{page:'scenes',projectId:id,episodeId:second},'discuss'),{text:'第二集历史意见'});applyAction(state,{type:'version.restore',projectId:id,versionId:saved});assert.deepEqual(p.episodes.map(e=>e.id),[first]);
 for(const kind of ['剧集','电影']){applyAction(state,{type:'project.update',projectId:id,patch:{kind}});const backup=JSON.parse((await exportDocument(state,{projectId:id,format:'json'})).bytes);const copyId=applyAction(state,{type:'project.import',project:backup}).projectId,copied=Object.values(getAssistant(state).threads).flat().find(t=>t.projectId===copyId);assert.equal(copied.episodeId,second);assert.equal(copied.reply,'第二集历史意见');assert.equal(copied.readOnly,true);assert.deepEqual(JSON.parse(copied.contextKey).slice(-2),['episode',second]);const invalid=structuredClone(backup);invalid.assistant.turns[0].episodeId='foreign';const before=structuredClone(state);assert.throws(()=>applyAction(state,{type:'project.import',project:invalid}));assert.deepEqual(state,before);}
});

test('materialized virtual episode IDs remain unchanged when retained metadata proves ownership',async()=>{
 const{state,p,id}=fixture();delete p.episodes;delete p.view.episodeId;const virtual=helpers.projectEpisodes(p)[0].id;appendAssistantTurn(state,chat(state,{page:'scenes',projectId:id,episodeId:virtual},'discuss'),{text:'虚拟首集历史'});const saved=applyAction(state,{type:'version.create',projectId:id,name:'旧虚拟首集'}).id;applyAction(state,{type:'episode.add',projectId:id,episode:{title:'二'}});applyAction(state,{type:'version.restore',projectId:id,versionId:saved});applyAction(state,{type:'project.update',projectId:id,patch:{kind:'电影'}});
 const backup=JSON.parse((await exportDocument(state,{projectId:id,format:'json'})).bytes),copyId=applyAction(state,{type:'project.import',project:backup}).projectId,turn=Object.values(getAssistant(state).threads).flat().find(t=>t.projectId===copyId);assert.equal(turn.episodeId,virtual);assert.equal(turn.readOnly,true);assert.equal(state.projects.find(p=>p.id===copyId).episodes[0].id,virtual);const invalid=structuredClone(backup);invalid.assistant.turns[0].episodeId='episode_legacy_foreign';const before=structuredClone(state);assert.throws(()=>applyAction(state,{type:'project.import',project:invalid}));assert.deepEqual(state,before);
});

test('pure-read legacy episode history survives persisted series-to-film backup without accepting foreign IDs',async t=>{
 const{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createStore}=await import('../server/store.mjs');const{state,p,id}=fixture();delete p.episodes;delete p.view.episodeId;p.scenes=[{id:'legacy-scene',title:'旧场',body:'保留旧稿',revision:0,archived:false}];const virtual=helpers.projectEpisodes(p)[0].id;const directory=await mkdtemp(join(tmpdir(),'storydesk-legacy-kind-backup-'));t.after(()=>rm(directory,{recursive:true,force:true}));let store=await createStore({directory,seed:state});
 await store.transaction(current=>appendAssistantTurn(current,chat(current,{page:'scenes',projectId:id,episodeId:virtual},'discuss'),{text:'纯阅读虚拟首集讨论'}));assert.equal((await store.read()).projects[0].episodes,undefined);await store.dispatch({type:'project.update',projectId:id,patch:{kind:'电影'}});store=await createStore({directory});const backup=JSON.parse((await exportDocument(await store.read(),{projectId:id,format:'json'})).bytes);const imported=await store.dispatch({type:'project.import',project:backup});const copy=imported.state.projects.find(p=>p.id===imported.result.projectId),turn=Object.values(getAssistant(imported.state).threads).flat().find(turn=>turn.projectId===copy.id);assert.equal(turn.episodeId,virtual);assert.equal(turn.reply,'纯阅读虚拟首集讨论');assert.equal(turn.readOnly,true);assert.equal(copy.episodes[0].id,virtual);assert.equal(copy.scenes[0].episodeId,virtual);assert.equal(copy.scenes[0].body,'保留旧稿');const invalid=structuredClone(backup);invalid.assistant.turns[0].episodeId='foreign';const before=await store.read();await assert.rejects(()=>store.dispatch({type:'project.import',project:invalid}));assert.deepEqual(await store.read(),before);
});

test('invalid kind patches validate all fields before materializing legacy episode ownership',()=>{
 const{state,p,id}=fixture();delete p.episodes;delete p.view.episodeId;p.scenes=[{id:'old-scene',body:'旧稿',revision:0}];const before=structuredClone(state);for(const patch of [{kind:'电影',brief:null},{kind:'电影',status:'bad'},{kind:'电影',title:''}]){assert.throws(()=>applyAction(state,{type:'project.update',projectId:id,patch}));assert.deepEqual(state,before);}
});

test('store refuses invalid ownership after a transaction before changing bytes and remains readable and writable',async t=>{
 const{mkdtemp,rm,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createStore}=await import('../server/store.mjs');const{state,id}=fixture();const directory=await mkdtemp(join(tmpdir(),'storydesk-transaction-postcondition-'));t.after(()=>rm(directory,{recursive:true,force:true}));let store=await createStore({directory,seed:state});const path=join(directory,'state.json'),bytes=await readFile(path,'utf8'),before=await store.read();
 await assert.rejects(()=>store.transaction(current=>{const p=current.projects.find(project=>project.id===id);p.title='不能保存';p.view.episodeId='foreign';}),/集/);assert.equal(await readFile(path,'utf8'),bytes);assert.deepEqual(await store.read(),before);store=await createStore({directory});assert.deepEqual(await store.read(),before);const next=await store.dispatch({type:'project.update',projectId:id,patch:{title:'安全的后续写入'}});assert.equal(next.state.projects[0].title,'安全的后续写入');assert.equal(next.state.revision,before.revision+1);
});
