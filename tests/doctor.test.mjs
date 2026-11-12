import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.mjs';

const body='雨停了。\n她说：我不等了。';
const waitFor=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const reportFor=user=>{const s=JSON.parse(user).source.scenes[0];return {summary:'本次只依据已提供正文；优先处理人物行动。',limitations:['未提供录制时间轴，秒数未知'],disagreement:'结构编辑希望压缩，人物视角希望保留停顿。',nextStep:'先核对这处行动动机，再加入助手意见。',issues:[{priority:'high',reviewer:'结构编辑',title:'行动没有代价',impact:'人物决定缺少可感知后果。',suggestion:'保留剧情走向，用行动体现离开的代价。',evidence:{sceneId:s.id,selection:{start:0,end:4,text:s.body.slice(0,4)}}}]};};
async function fixture(t,respond=async input=>({text:JSON.stringify(reportFor(input.user)),model:'doctor-test'})){
 const directory=await mkdtemp(join(tmpdir(),'screenwriter-doctor-'));let app=await startServer({directory,seed:false,port:0,modelAdapter:respond});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const request=async(path,data)=>{const res=await fetch(`${app.url}/api${path}`,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});return {status:res.status,...await res.json()};};
 const action=async action=>request('/actions',{action});
 const a=(await action({type:'project.create',title:'雨站',kind:'短剧'})).result.projectId;
 const p=(await request('/state')).state.projects.find(p=>p.id===a),ep=p.episodes[0].id;
 const s=(await action({type:'scene.add',projectId:a,scene:{title:'站台',body}})).result.sceneId;
 const ep2=(await action({type:'episode.add',projectId:a,episode:{title:'第二集'}})).result?.episodeId;
 const s2=(await action({type:'scene.add',projectId:a,scene:{title:'另集',body:'另一集独占正文',episodeId:ep2}})).result.sceneId;
 const b=(await action({type:'project.create',title:'外项目秘密'})).result.projectId;
 const foreign=(await action({type:'scene.add',projectId:b,scene:{body:'外项目秘密正文'}})).result.sceneId;
 const diagnose=patch=>request('/doctor',{projectId:a,scope:'scene',sceneId:s,mode:'general',...patch});
 const handoff=(report,patch={})=>request('/doctor/handoff',{projectId:a,reportId:report.id,issueId:report.issues[0].id,...patch});
 return {request,action,a,b,s,s2,ep,ep2,foreign,diagnose,handoff,directory,restart:async()=>{await app.close();app=await startServer({directory,seed:false,port:0,modelAdapter:respond});}};
}

test('doctor diagnoses captured scope read-only, persists provenance/model and transfers exact opinion atomically once',async t=>{
 let prompt; const adapter=async input=>{prompt=input;return {text:JSON.stringify(reportFor(input.user)),model:'test'};};
 adapter.defaultSelection=()=>({provider:'host',model:'a'});adapter.resolveSelection=async value=>value;
 const f=await fixture(t,adapter),before=(await f.request('/state')).state.projects.find(p=>p.id===f.a);
 const result=await f.diagnose({platform:'抖音',rhythm:'慢节奏但高信息',targetDuration:''});
 assert.equal(result.status,200,result.error);assert.equal(result.report.status,'current');assert.equal(result.report.readOnly,false);
 assert.deepEqual(prompt.modelSelection,{provider:'host',model:'a'});assert.deepEqual(result.report.modelSelection,{provider:'host',model:'a'});
 assert.doesNotMatch(prompt.user,/外项目秘密|另一集独占正文/);assert.match(prompt.system,/只诊断|不改写/);assert.match(prompt.system,/未知/);
 assert.equal(result.report.source.scenes[0].body,body);assert.ok(result.report.sourceFingerprint);assert.ok(result.report.guidance.sources.length);
 const p=result.state.projects.find(p=>p.id===f.a);assert.deepEqual(p.scenes,before.scenes);assert.deepEqual(p.versions,before.versions);
 const added=await f.handoff(result.report);assert.equal(added.status,200,added.error);assert.deepEqual(added.note.selection,result.report.issues[0].evidence.selection);assert.equal(added.state.projects.find(p=>p.id===f.a).scenes[0].body,body);
 const duplicate=await f.handoff(result.report);assert.equal(duplicate.status,409);assert.equal(duplicate.code,'DOCTOR_ALREADY_HANDED_OFF');
 const history=await f.request(`/doctor?projectId=${f.a}`);assert.equal(history.reports[0].issues[0].noteId,added.note.id);
});

test('episode scope excludes other episodes, whole project includes them; foreign/archived and unsupported scope denied',async t=>{
 let prompts=[];const f=await fixture(t,async input=>{prompts.push(input);return {text:JSON.stringify(reportFor(input.user))};});
 assert.ok(f.ep2);assert.equal((await f.diagnose({scope:'episode',sceneId:undefined,episodeId:f.ep})).status,200);assert.doesNotMatch(prompts[0].user,/另一集独占正文/);
 assert.equal((await f.diagnose({scope:'project',sceneId:undefined})).status,200);assert.match(prompts[1].user,/另一集独占正文/);
 for(const patch of [{sceneId:f.foreign},{scope:'episode',sceneId:undefined,episodeId:'foreign'},{scope:'other'},{mode:'rewrite'},{tool:'write'}])assert.ok((await f.diagnose(patch)).status>=400);
 await f.action({type:'scene.update',projectId:f.a,sceneId:f.s,patch:{archived:true}});assert.equal((await f.diagnose()).status,409);
 await f.action({type:'project.update',projectId:f.a,patch:{status:'archived'}});assert.equal((await f.diagnose({scope:'project',sceneId:undefined})).status,409);
});

test('invalid/foreign evidence and oversize context reject without recording reports or changing source',async t=>{
 let mutate=()=>{},calls=0;const f=await fixture(t,async input=>{calls++;const value=reportFor(input.user);mutate(value);return {text:JSON.stringify(value)};});
 for(const change of [v=>v.issues[0].evidence.sceneId=f.foreign,v=>v.issues[0].evidence.selection.text='伪造原文',v=>v.issues[0].evidence.selection.end=999,v=>v.issues[0].priority='score-90',v=>v.actions=[]]){mutate=change;const r=await f.diagnose();assert.equal(r.status,502,r.error);assert.equal(r.code,'INVALID_DOCTOR_OUTPUT');}
 assert.deepEqual((await f.request(`/doctor?projectId=${f.a}`)).reports,[]);
 await f.action({type:'scene.update',projectId:f.a,sceneId:f.s,patch:{body:'字'.repeat(130000)}});const previous=calls;
 assert.equal((await f.diagnose()).status,413);assert.equal(calls,previous);
});

test('generation captures model before awaits, marks changed source stale and blocks busy/foreign/stale handoff',async t=>{
 const entered=waitFor(),released=waitFor();let current={provider:'host',model:'first'};
 const adapter=async input=>{entered.resolve(input);await released.promise;return {text:JSON.stringify(reportFor(input.user))};};adapter.defaultSelection=()=>({...current});adapter.resolveSelection=async value=>({...value});
 const f=await fixture(t,adapter),pending=f.diagnose();const prompt=await entered.promise;current.model='second';
 assert.equal((await f.diagnose()).code,'DOCTOR_BUSY');
 await f.action({type:'scene.update',projectId:f.a,sceneId:f.s,patch:{body:body+'改动'}});released.resolve();const result=await pending;
 assert.equal(result.status,200,result.error);assert.deepEqual(prompt.modelSelection,{provider:'host',model:'first'});assert.equal(result.report.status,'stale');
 assert.equal((await f.handoff(result.report)).code,'STALE_DOCTOR_REPORT');assert.ok((await f.handoff(result.report,{projectId:f.b})).status>=400);
});

test('report backups import as inert history with remapped ids and restart retains readable history without authority',async t=>{
 const f=await fixture(t),generated=await f.diagnose();assert.equal(generated.status,200,generated.error);
 const p=generated.state.projects.find(p=>p.id===f.a),imported=await f.action({type:'project.import',project:p});assert.equal(imported.status,200,imported.error);
 const copy=imported.state.projects.find(p=>p.id===imported.result.projectId);assert.ok(copy.doctorReports?.length);assert.notEqual(copy.doctorReports[0].id,generated.report.id);
 assert.equal((await f.request('/doctor/handoff',{projectId:copy.id,reportId:copy.doctorReports[0].id,issueId:copy.doctorReports[0].issues[0].id})).code,'READ_ONLY_DOCTOR_REPORT');
 const forged=structuredClone(p);forged.doctorReports[0].issues[0].evidence.sceneId=f.foreign;assert.equal((await f.action({type:'project.import',project:forged})).status,400);
 await f.restart();const history=await f.request(`/doctor?projectId=${f.a}`);assert.equal(history.reports.length,1);assert.equal(history.reports[0].readOnly,true);assert.equal((await f.handoff(generated.report)).code,'READ_ONLY_DOCTOR_REPORT');
});

test('same exact paragraph merges doctor directions into one open note; partial overlap rejects atomically',async t=>{
 const f=await fixture(t,async input=>{const value=reportFor(input.user);value.issues.push({...structuredClone(value.issues[0]),reviewer:'角色视角',suggestion:'体现决定前后的关系变化。'});value.issues.push({...structuredClone(value.issues[0]),evidence:{sceneId:value.issues[0].evidence.sceneId,selection:{start:1,end:4,text:'停了。'}}});return {text:JSON.stringify(value)};});
 const generated=await f.diagnose(),r=generated.report;assert.equal(generated.status,200,generated.error);
 const first=await f.handoff(r),second=await f.handoff(r,{issueId:r.issues[1].id});assert.equal(second.status,200,second.error);assert.equal(second.note.id,first.note.id);
 const notes=second.state.projects.find(p=>p.id===f.a).revisionNotes;assert.equal(notes.length,1);assert.match(notes[0].instruction,/离开的代价/);assert.match(notes[0].instruction,/关系变化/);
 const partial=await f.handoff(r,{issueId:r.issues[2].id});assert.equal(partial.status,409);assert.equal(partial.code,'OVERLAPPING_DOCTOR_OPINION');
 assert.deepEqual((await f.request('/state')).state,second.state);
});

test('novel doctor adapts evidence method without screenplay constraints and refuses empty materials',async t=>{
 let prompt;const f=await fixture(t,async input=>{prompt=input;return {text:JSON.stringify(reportFor(input.user))};});
 const created=await f.action({type:'project.create',title:'小说',format:'novel'}),id=created.result.projectId;
 assert.equal((await f.diagnose({projectId:id,scope:'project',sceneId:undefined})).code,'DOCTOR_MATERIAL_MISSING');
 const s=(await f.action({type:'scene.add',projectId:id,scene:{body:'她在想，雨终于停了。'}})).result.sceneId;
 assert.equal((await f.diagnose({projectId:id,sceneId:s,mode:'dialogue'})).status,200);assert.match(prompt.system,/小说适配/);assert.match(prompt.system,/叙述视角/);assert.match(prompt.system,/无对白/);
 assert.equal((await f.diagnose({projectId:id,scope:'episode',sceneId:undefined,episodeId:f.ep})).status,400);
});

test('later source edits and trash deny an otherwise current explicit handoff without changing saved report',async t=>{
 const f=await fixture(t),generated=await f.diagnose();assert.equal(generated.status,200,generated.error);
 await f.action({type:'scene.update',projectId:f.a,sceneId:f.s,patch:{body:body+'作者继续写'}});
 assert.equal((await f.handoff(generated.report)).code,'STALE_DOCTOR_REPORT');assert.equal((await f.request(`/doctor?projectId=${f.a}`)).reports[0].status,'stale');
 await f.action({type:'project.trash',projectId:f.a});assert.equal((await f.diagnose()).code,'PROJECT_TRASHED');assert.equal((await f.handoff(generated.report)).code,'PROJECT_TRASHED');
});
