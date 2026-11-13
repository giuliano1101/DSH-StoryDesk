import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {createHash} from 'node:crypto';
import { startServer } from '../server/index.mjs';

const body='雨停了。\n她说：我不等了。';
const worldRule='铁门只能由唯一的钥匙打开。';
const craftModes=['motivation','foreshadow','suspense'];
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

for(const format of ['novel','screenplay'])for(const mode of craftModes)test(`${format} ${mode} captures cross-chapter evidence and hands off a classified opinion without rewriting`,async t=>{
 let seen,calls=0;
 const f=await fixture(t,async input=>{calls++;seen=input;const r=reportFor(input.user),source=JSON.parse(input.user).source,ref=source.continuity?.passages[0];r.issues[0]={...r.issues[0],certainty:'supported',basis:ref?[{referenceId:ref.id,quote:ref.text}]:[]};return {text:JSON.stringify(r)};});
 const id=(await f.action({type:'project.create',title:format+'专项验收',format,kind:format==='novel'?'长篇小说':'电视剧'})).result.projectId;
 const previous=(await f.action({type:'scene.add',projectId:id,scene:{title:'前段',body:'她曾发誓绝不离开，钥匙交给哥哥。',summary:'钥匙计划在结局回收；目前尚未写到。'}})).result.sceneId;
 const current=(await f.action({type:'scene.add',projectId:id,scene:{title:'后段',body}})).result.sceneId;
 const before=(await f.request('/state')).state.projects.find(p=>p.id===id);
 const result=await f.request('/doctor',{projectId:id,scope:'scene',sceneId:current,mode});
 assert.equal(result.status,200,result.error);assert.equal(result.capabilities.craftChecks,true);assert.equal(result.report.mode,mode);
 const source=JSON.parse(seen.user).source;assert.equal(source.project.format,format);assert.equal(source.continuity.passages[0].sceneId,previous);assert.match(source.storyBible.markdown,/计划在结局回收/);assert.doesNotMatch(seen.user,/外项目秘密|另一集独占正文/);
 assert.match(seen.system,/创作建议|审美/);assert.match(seen.system,/needs-context/);assert.equal(result.report.issues[0].certainty,'supported');
 assert.deepEqual(result.state.projects.find(p=>p.id===id).scenes,before.scenes);assert.deepEqual(result.state.projects.find(p=>p.id===id).versions,before.versions);
 const added=await f.request('/doctor/handoff',{projectId:id,reportId:result.report.id,issueId:result.report.issues[0].id});assert.equal(added.status,200,added.error);assert.match(added.note.instruction,/有原文依据的创作问题/);assert.doesNotMatch(added.note.instruction,/存在对照冲突|信息不足/);assert.equal(calls,1);
 assert.deepEqual(added.state.projects.find(p=>p.id===id).scenes,before.scenes);assert.deepEqual(added.state.projects.find(p=>p.id===id).versions,before.versions);
 const imported=await f.action({type:'project.import',project:added.state.projects.find(p=>p.id===id)});assert.equal(imported.status,200,imported.error);const copy=imported.state.projects.find(p=>p.id===imported.result.projectId);assert.equal(copy.doctorReports[0].mode,mode);assert.equal(copy.doctorReports[0].issues[0].certainty,'supported');assert.equal(copy.doctorReports[0].readOnly,true);
 await f.action({type:'scene.update',projectId:id,sceneId:previous,patch:{body:'作者补上了动机、回收和知情变化。'}});
 const stale=await f.request('/revisions/generate',{projectId:id,noteIds:[added.note.id]});assert.equal(stale.code,'STALE_DOCTOR_OPINION');assert.equal(calls,1);
});

test('craft checks reject unclassified or unanchored claims and preserve uncertain questions without automatic handoff',async t=>{
 let kind='missing';const f=await fixture(t,async input=>{const r=reportFor(input.user);if(kind!=='missing')r.issues[0].certainty=kind;if(kind==='supported'||kind==='suggestion')r.issues[0].evidence=null;return {text:JSON.stringify(r)};});
 const before=(await f.request('/state')).state;
 for(const value of ['missing','supported','suggestion']){kind=value;assert.equal((await f.diagnose({mode:'foreshadow'})).code,'INVALID_DOCTOR_OUTPUT');}
 assert.deepEqual((await f.request('/state')).state,before);
 kind='needs-context';const q=await f.diagnose({mode:'foreshadow'});assert.equal(q.status,200,q.error);assert.equal((await f.handoff(q.report)).code,'DOCTOR_NEEDS_CONFIRMATION');
});

test('optional craft suggestions retain their label in later assistant opinions',async t=>{
 const f=await fixture(t,async input=>{const r=reportFor(input.user);r.issues[0].certainty='suggestion';return {text:JSON.stringify(r)};});
 const r=await f.diagnose({mode:'suspense'});assert.equal(r.status,200,r.error);const added=await f.handoff(r.report);assert.equal(added.status,200,added.error);assert.match(added.note.instruction,/可选创作建议.*作者决定/);
});

test('specialist guidance distinguishes plans, intentional concealment and unsupported motives in both formats',async()=>{
 const {doctorGuidance}=await import('../server/doctor-guidance.mjs');
 for(const novel of [true,false]){
  const m=doctorGuidance('motivation',{novel}).instruction;assert.match(m,/目标.*阻力.*选择.*代价/);assert.match(m,/隐瞒|不可靠/);assert.match(m,/缺少.*依据|依据不足/);
  const f=doctorGuidance('foreshadow',{novel}).instruction;assert.match(f,/已回收.*计划后续回收.*尚待确认/);assert.match(f,/未写到|尚未写到/);assert.match(f,/非所有细节|不是所有细节/);
  const s=doctorGuidance('suspense',{novel}).instruction;assert.match(s,/读者.*角色.*知情/);assert.match(s,/公平/);assert.match(s,/不强.*悬念|不要求.*悬念/);
  for(const mode of craftModes)assert.match(doctorGuidance(mode,{novel}).instruction,novel?/叙述视角/:/画面.*声音/);
 }
});

test('a selected craft check ends with a single-specialty output boundary even after shared comparison guidance',async t=>{
 let system='';const f=await fixture(t,async input=>{system=input.system;const r=reportFor(input.user);r.issues[0].certainty='supported';return {text:JSON.stringify(r)};});
 for(const [mode,label] of Object.entries({motivation:'人物动机',foreshadow:'伏笔回收',suspense:'悬念信息释放'})){
  const r=await f.diagnose({mode});assert.equal(r.status,200,r.error);
  assert.ok(system.endsWith(`本次只输出「${label}」专项的问题或建议。其他专项发现不得单独成条，也不得退回综合会诊；只在解释当前专项所必需时引用其事实。所有评委视角都必须服务于这个唯一专项。`));
 }
});

for(const mode of craftModes)test(`${mode} resolves a unique literal quote when model offsets drift, without changing prose or weakening imported archives`,async t=>{
 const manuscript='序言😀。\n\n本部完。',quote='本部完。',at=manuscript.indexOf(quote);
 const f=await fixture(t,async input=>{const r=reportFor(input.user);r.issues[0]={...r.issues[0],certainty:'supported',evidence:{sceneId:JSON.parse(input.user).source.scenes[0].id,selection:{start:at-1,end:at-1+quote.length,text:quote}}};return {text:JSON.stringify(r)};});
 await f.action({type:'scene.update',projectId:f.a,sceneId:f.s,patch:{body:manuscript}});const before=(await f.request('/state')).state.projects.find(p=>p.id===f.a);
 const r=await f.diagnose({mode});assert.equal(r.status,200,r.error);assert.deepEqual(r.report.issues[0].evidence.selection,{start:at,end:at+quote.length,text:quote});
 const added=await f.handoff(r.report);assert.equal(added.status,200,added.error);assert.deepEqual(added.note.selection,r.report.issues[0].evidence.selection);assert.deepEqual(added.state.projects.find(p=>p.id===f.a).scenes,before.scenes);assert.deepEqual(added.state.projects.find(p=>p.id===f.a).versions,before.versions);
 const bad=structuredClone(added.state.projects.find(p=>p.id===f.a));bad.doctorReports[0].issues[0].evidence.selection.start--;bad.doctorReports[0].issues[0].evidence.selection.end--;
 assert.equal((await f.action({type:'project.import',project:bad})).status,400,'imported history cannot acquire quote-relocation authority');
});

test('craft quote resolution rejects ambiguous, absent, out-of-range and malformed anchors',async t=>{
 let change=()=>{};const quote='本部完。',manuscript='前言。\n本部完。\n后记。\n本部完。';
 const f=await fixture(t,async input=>{const r=reportFor(input.user);r.issues[0]={...r.issues[0],certainty:'supported',evidence:{sceneId:JSON.parse(input.user).source.scenes[0].id,selection:{start:0,end:4,text:quote}}};change(r.issues[0].evidence);return {text:JSON.stringify(r)};});
 await f.action({type:'scene.update',projectId:f.a,sceneId:f.s,patch:{body:manuscript}});
 for(const mutate of [()=>{},e=>e.selection.text='本部完!',e=>{e.selection.start=-1;e.selection.end=3;},e=>e.selection.end=999,e=>e.selection.start='0',e=>e.sceneId=f.foreign]){change=mutate;assert.equal((await f.diagnose({mode:'foreshadow'})).code,'INVALID_DOCTOR_OUTPUT');}
 assert.equal((await f.request(`/doctor?projectId=${f.a}`)).reports.length,0);
});

for(const mode of craftModes)test(`${mode} accepts quote-only model evidence and derives its canonical range on the server`,async t=>{
 let system='';const quote='她说：我不等了。';const f=await fixture(t,async input=>{system=input.system;const r=reportFor(input.user);r.issues[0]={...r.issues[0],certainty:'supported',evidence:{sceneId:JSON.parse(input.user).source.scenes[0].id,quote}};return {text:JSON.stringify(r)};});
 const r=await f.diagnose({mode});assert.equal(r.status,200,r.error);const at=body.indexOf(quote);assert.deepEqual(r.report.issues[0].evidence,{sceneId:f.s,selection:{start:at,end:at+quote.length,text:quote}});
 assert.match(system,/只提交.*quote.*不计算.*坐标/);assert.match(system,/"evidence":\{"sceneId":"输入正文id","quote"/);
 const added=await f.handoff(r.report);assert.equal(added.status,200,added.error);assert.equal(added.note.selection.text,quote);const p=added.state.projects.find(p=>p.id===f.a);
 const imported=await f.action({type:'project.import',project:p});assert.equal(imported.status,200,imported.error);assert.equal(imported.state.projects.find(x=>x.id===imported.result.projectId).doctorReports[0].issues[0].evidence.selection.text,quote);
 const forged=structuredClone(p);forged.doctorReports[0].issues[0].evidence={sceneId:f.s,quote};assert.equal((await f.action({type:'project.import',project:forged})).status,400,'archive must carry canonical evidence');
});

test('quote-only craft evidence must be literal, unique, owned and exclusive of supplied coordinates',async t=>{
 let evidence;const f=await fixture(t,async input=>{const r=reportFor(input.user);r.issues[0]={...r.issues[0],certainty:'supported',evidence};return {text:JSON.stringify(r)};});
 await f.action({type:'scene.update',projectId:f.a,sceneId:f.s,patch:{body:'句子。\n句子。'}});
 for(const e of [{sceneId:f.s,quote:'句子。'},{sceneId:f.s,quote:'句子!'},{sceneId:f.s,quote:' '},{sceneId:f.foreign,quote:'句子。'},{sceneId:f.s,quote:'句子。',selection:{start:0,end:3,text:'句子。'}}]){evidence=e;assert.equal((await f.diagnose({mode:'foreshadow'})).code,'INVALID_DOCTOR_OUTPUT');}
});

test('the craft JSON example includes the required certainty and exact comparison fields as independent properties',async t=>{
 let system='';const f=await fixture(t,async input=>{system=input.system;const r=reportFor(input.user);r.issues[0].certainty='supported';return {text:JSON.stringify(r)};});
 for(const mode of craftModes){const r=await f.diagnose({mode});assert.equal(r.status,200,r.error);const example=JSON.parse(system.match(/输出必须是严格 JSON：(.+?)。只提交/)[1]);assert.equal(example.issues[0].certainty,'supported|suggestion|needs-context|conflict');assert.deepEqual(Object.keys(example.issues[0].basis[0]),['referenceId','quote']);assert.match(system,/certainty.*独立字段.*不能只写/);}
});

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

test('scene consistency compares the whole outline and adopted canon with exact paired evidence, then becomes stale on off-scope changes',async t=>{
 let prompt;
 const f=await fixture(t,async input=>{prompt=JSON.parse(input.user);const value=reportFor(input.user),ref=prompt.source.storyBible?.references.find(r=>r.kind==='world');value.issues[0]={...value.issues[0],certainty:'conflict',basis:[{referenceId:ref?.id||'missing',quote:worldRule}]};return {text:JSON.stringify(value)};});
 await f.action({type:'material.upsert',projectId:f.a,material:{title:'铁门规则',category:'world',body:worldRule,status:'adopted'}});
 await f.action({type:'scene.update',projectId:f.a,sceneId:f.s2,patch:{summary:'钥匙已被销毁，后续不能再正常开门。'}});
 const before=(await f.request('/state')).state,bible=await f.request(`/doctor?projectId=${f.a}`);
 assert.equal(bible.capabilities?.continuity,true);assert.match(bible.bible?.markdown||'',/钥匙已被销毁/);assert.match(bible.bible?.markdown||'',/铁门只能/);assert.deepEqual((await f.request('/state')).state,before,'bible preview must not write or call a model');
 const result=await f.diagnose({mode:'continuity'});assert.equal(result.status,200,result.error);
 assert.equal(result.report.source.scenes.length,1);assert.equal(result.report.source.continuity.coverage.coveredScenes,1);
 assert.match(prompt.source.storyBible.markdown,/钥匙已被销毁/);assert.match(JSON.stringify(prompt.source.continuity),/另一集独占正文/);assert.doesNotMatch(JSON.stringify(prompt),/外项目秘密/);
 const issue=result.report.issues[0];assert.equal(issue.certainty,'conflict');assert.equal(issue.basis[0].quote,worldRule);assert.equal(issue.basis[0].kind,'world');assert.ok(issue.basis[0].title.includes('铁门规则'));
 const added=await f.handoff(result.report);assert.equal(added.status,200,added.error);assert.match(added.note.instruction,/铁门只能/);assert.deepEqual(added.state.projects.find(p=>p.id===f.a).scenes,before.projects.find(p=>p.id===f.a).scenes);
 const again=await f.diagnose({mode:'continuity'});await f.action({type:'scene.update',projectId:f.a,sceneId:f.s2,patch:{summary:'作者修订了总大纲'}});
 assert.equal((await f.handoff(again.report)).code,'STALE_DOCTOR_REPORT');
});

test('ordinary diagnosis automatically carries the story bible but not unrequested cross-scene body; invalid opposing quotes never become a report',async t=>{
 let prompt,invalid=false;
 const f=await fixture(t,async input=>{prompt=JSON.parse(input.user);const value=reportFor(input.user);if(invalid)value.issues[0]={...value.issues[0],certainty:'conflict',basis:[{referenceId:'foreign',quote:'伪造世界规则'}]};return {text:JSON.stringify(value)};});
 const result=await f.diagnose();assert.equal(result.status,200,result.error);assert.ok(prompt.source.storyBible?.markdown);assert.equal(prompt.source.continuity,undefined);assert.doesNotMatch(JSON.stringify(prompt),/另一集独占正文/);
 invalid=true;const rejected=await f.diagnose({mode:'continuity'});assert.equal(rejected.code,'INVALID_DOCTOR_OUTPUT');assert.equal((await f.request(`/doctor?projectId=${f.a}`)).reports.length,1);
});

test('doctor opinions cannot generate or apply a rewrite after their canon changed, and incomplete evidence must stay a question',async t=>{
 let uncertain=false;
 const f=await fixture(t,async input=>{const prompt=JSON.parse(input.user);if(prompt.notes)return {text:JSON.stringify({changes:prompt.notes.map(n=>({noteId:n.noteId,text:'雨终于停了。'}))})};const result=reportFor(input.user);if(uncertain)result.issues[0]={...result.issues[0],certainty:'needs-context',basis:[]};return {text:JSON.stringify(result)};});
 const r=await f.diagnose(),added=await f.handoff(r.report);assert.equal(added.status,200,added.error);
 const generated=await f.request('/revisions/generate',{projectId:f.a,noteIds:[added.note.id],chatInstruction:'按医生意见处理'});assert.equal(generated.status,200,generated.error);
 await f.action({type:'scene.update',projectId:f.a,sceneId:f.s2,patch:{summary:'大纲已经变更'}});
 const before=(await f.request('/state')).state;
 assert.equal((await f.request('/revisions/apply',{projectId:f.a,batchId:generated.batch.id,changeIds:generated.batch.changes.map(c=>c.id)})).code,'STALE_DOCTOR_OPINION');
 assert.equal((await f.request('/revisions/generate',{projectId:f.a,noteIds:[added.note.id]})).code,'STALE_DOCTOR_OPINION');
 assert.deepEqual((await f.request('/state')).state,before);
 uncertain=true;const q=await f.diagnose();assert.equal(q.status,200,q.error);assert.equal((await f.handoff(q.report)).code,'DOCTOR_NEEDS_CONFIRMATION');
});

test('consistency archives preserve multiline opposing outline evidence and maximum boundaries while legacy archives remain readable',async t=>{
 const summary='钥匙已经销毁。\n  后文须保留这个后果。  \n';
 const f=await fixture(t,async input=>{const prompt=JSON.parse(input.user),r=reportFor(input.user),ref=prompt.source.storyBible.references.find(r=>r.kind==='outline'&&r.title==='另集');r.limitations=Array.from({length:30},(_,i)=>'材料边界 '+i);r.issues[0]={...r.issues[0],certainty:'conflict',basis:[{referenceId:ref.id,quote:summary}]};return {text:JSON.stringify(r)};});
 await f.action({type:'scene.update',projectId:f.a,sceneId:f.s2,patch:{summary}});
 const generated=await f.diagnose({mode:'continuity'});assert.equal(generated.status,200,generated.error);assert.equal(generated.report.limitations.length,31);assert.equal(generated.report.issues[0].basis[0].quote,summary);
 const p=generated.state.projects.find(p=>p.id===f.a),imported=await f.action({type:'project.import',project:p});assert.equal(imported.status,200,imported.error);
 const copy=imported.state.projects.find(p=>p.id===imported.result.projectId);assert.equal(copy.doctorReports[0].readOnly,true);assert.equal(copy.doctorReports[0].issues[0].basis[0].quote,summary);
 const forged=structuredClone(p);forged.doctorReports[0].source.continuity.passages[0].sceneId=f.foreign;assert.equal((await f.action({type:'project.import',project:forged})).status,400);
 const legacy=structuredClone(p);legacy.doctorReports[0].mode='general';delete legacy.doctorReports[0].source.bible;delete legacy.doctorReports[0].source.continuity;delete legacy.doctorReports[0].issues[0].basis;delete legacy.doctorReports[0].issues[0].certainty;legacy.doctorReports[0].sourceFingerprint=createHash('sha256').update(JSON.stringify(legacy.doctorReports[0].source)).digest('hex');
 const old=await f.action({type:'project.import',project:legacy});assert.equal(old.status,200,old.error);assert.equal(old.state.projects.find(p=>p.id===old.result.projectId).doctorReports[0].source.bible,undefined);
 const handed=await f.handoff(generated.report);assert.equal(handed.status,200,handed.error);await f.action({type:'scene.update',projectId:f.a,sceneId:f.s2,patch:{summary:'已调整的故事规则'}});
 assert.equal((await f.request('/revisions/generate',{projectId:f.a,noteIds:[handed.note.id]})).code,'STALE_DOCTOR_OPINION','normalizing a trailing citation must not lose provenance');
});

test('an opposing chapter changed while the rewrite model waits cannot leave a pending write or alter prose',async t=>{
 const entered=waitFor(),release=waitFor();
 const f=await fixture(t,async input=>{const prompt=JSON.parse(input.user);if(prompt.notes){entered.resolve();await release.promise;return {text:JSON.stringify({changes:prompt.notes.map(n=>({noteId:n.noteId,text:'新句子'}))})};}return {text:JSON.stringify(reportFor(input.user))};});
 const generated=await f.diagnose({mode:'general'}),note=await f.handoff(generated.report),pending=f.request('/revisions/generate',{projectId:f.a,noteIds:[note.note.id]});await entered.promise;
 await f.action({type:'scene.update',projectId:f.a,sceneId:f.s2,patch:{summary:'新大纲'}});const before=(await f.request('/state')).state;release.resolve();assert.equal((await pending).code,'STALE_DOCTOR_OPINION');assert.deepEqual((await f.request('/state')).state,before);
});

test('backup import remaps doctor opinion provenance without restoring report authority, and later copied canon changes still block rewriting',async t=>{
 const f=await fixture(t,async input=>{const prompt=JSON.parse(input.user);return {text:JSON.stringify(prompt.notes?{changes:prompt.notes.map(n=>({noteId:n.noteId,text:'雨终于停了。'}))}:reportFor(input.user))};});
 const diagnosed=await f.diagnose(),handed=await f.handoff(diagnosed.report),p=handed.state.projects.find(p=>p.id===f.a),imported=await f.action({type:'project.import',project:p});assert.equal(imported.status,200,imported.error);
 const copy=imported.state.projects.find(p=>p.id===imported.result.projectId),note=copy.revisionNotes[0];assert.notEqual(note.id,handed.note.id);assert.equal(copy.doctorReports[0].issues[0].noteId,note.id);
 const fresh=await f.request('/revisions/generate',{projectId:copy.id,noteIds:[note.id]});assert.equal(fresh.status,200,fresh.error,'unchanged imported opinions can be explicitly sent as before');
 assert.equal((await f.request('/doctor/handoff',{projectId:copy.id,reportId:copy.doctorReports[0].id,issueId:copy.doctorReports[0].issues[0].id})).code,'READ_ONLY_DOCTOR_REPORT');
 await f.action({type:'project.update',projectId:copy.id,patch:{synopsis:'作者更改了故事前提'}});
 const before=(await f.request('/state')).state;assert.equal((await f.request('/revisions/generate',{projectId:copy.id,noteIds:[note.id]})).code,'STALE_DOCTOR_OPINION');assert.deepEqual((await f.request('/state')).state,before);
});

test('unchanged legacy series imports normalize only virtual episode identity for scene and episode doctor opinions',async t=>{
 const f=await fixture(t,async input=>{const prompt=JSON.parse(input.user);return {text:JSON.stringify(prompt.notes?{changes:prompt.notes.map(n=>({noteId:n.noteId,text:'雨终于停了。'}))}:reportFor(input.user))};});
 const legacy=structuredClone((await f.request('/state')).state.projects.find(p=>p.id===f.a));delete legacy.episodes;delete legacy.view;for(const s of legacy.scenes)delete s.episodeId;
 for(const scope of ['scene','episode']){
  const created=await f.action({type:'project.import',project:legacy});assert.equal(created.status,200,created.error);const id=created.result.projectId;
  const diagnosed=await f.request('/doctor',{projectId:id,mode:'general',scope,...(scope==='scene'?{sceneId:f.s}:{episodeId:`episode_legacy_${id}`})});assert.equal(diagnosed.status,200,diagnosed.error);
  const handed=await f.request('/doctor/handoff',{projectId:id,reportId:diagnosed.report.id,issueId:diagnosed.report.issues[0].id});assert.equal(handed.status,200,handed.error);
  const copied=await f.action({type:'project.import',project:handed.state.projects.find(p=>p.id===id)}),p=copied.state.projects.find(p=>p.id===copied.result.projectId),note=p.revisionNotes[0];
  const generated=await f.request('/revisions/generate',{projectId:p.id,noteIds:[note.id]});assert.equal(generated.status,200,`${scope}: ${generated.error}`);
  await f.action({type:'project.update',projectId:p.id,patch:{synopsis:'作者新的故事约束'}});assert.equal((await f.request('/revisions/generate',{projectId:p.id,noteIds:[note.id]})).code,'STALE_DOCTOR_OPINION');
 }
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
