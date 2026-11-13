import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectRequestGuard} from '../src/assistant/requestGuard.mjs';
import {createEditingGate} from '../src/assistant/editingGate.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(overrides={}){
 const {createDoctorController}=await import('../src/doctor/controller.mjs');
 let state={revision:0,projects:[{id:'a',status:'active',scenes:[{id:'s',body:'原稿',revision:0}]},{id:'b',status:'active',scenes:[]}],workspace:{activeProjectId:'a'}},calls=[],locks=createEditingGate(),guard=createProjectRequestGuard();
 const w={getState:()=>state,flush:async()=>{},accept:next=>state=next,isNavigating:()=>false,acquireEditingLock:locks.acquire,releaseEditingLock:locks.release,toast:()=>{}};
 let models={catalog:{mode:'host',effective:{provider:'host',model:'a'},connected:true},loading:false};
 const request=async(path,payload)=>{calls.push({path,payload});if(payload)return {state,report:{id:'r',projectId:'a',status:'current',issues:[]}};return {reports:[]};};
 let dialogs={editingTargets:[]},opinions={composers:{},editors:{}};
 const c=createDoctorController({workbench:()=>w,models:()=>models,request,dialogs:()=>dialogs,opinionDrafts:()=>opinions,guard,...overrides});
 return {c,w,calls,guard,locks,setModels:v=>models=v,setState:v=>state=v,setDialogs:v=>dialogs=v,setOpinions:v=>opinions=v};
}

test('doctor captures project/options/model before flush and retains result without opening assistant or navigating',async()=>{
 const flushing=deferred(),entered=deferred(),f=await fixture();f.w.flush=async()=>{entered.resolve();await flushing.promise;};
 f.c.open('a',{sceneId:'s'});f.c.change('a',{platform:'抖音',mode:'dialogue'});
 const pending=f.c.diagnose('a');await entered.promise;assert.equal(f.c.close(),false);assert.equal(f.locks.isProjectLocked('a'),true);assert.equal(f.guard.busy('a'),true);
 f.setModels({catalog:{mode:'host',effective:{provider:'host',model:'b'},connected:true}});f.setState({...f.w.getState(),workspace:{activeProjectId:'b'}});f.c.change('a',{platform:'别的平台'});
 flushing.resolve();await pending;assert.equal(f.calls[0].payload.projectId,'a');assert.equal(f.calls[0].payload.platform,'抖音');assert.deepEqual(f.calls[0].payload.modelSelection,{provider:'host',model:'a'});
 assert.equal(f.w.getState().workspace.activeProjectId,'b');assert.equal(f.c.snapshot().reports.a[0].id,'r');assert.equal(f.locks.isProjectLocked('a'),false);assert.equal(f.guard.busy('a'),false);assert.equal(f.c.close(),true);
});

test('doctor rejects pending manual dialogs, opinion drafts, unavailable models and navigation before sending',async()=>{
 const f=await fixture();f.c.open('a',{sceneId:'s'});f.setDialogs({editingTargets:[{projectIds:['a']}]});await assert.rejects(f.c.diagnose('a'),/编辑窗口/);assert.equal(f.calls.length,0);
 f.setDialogs({editingTargets:[]});f.setOpinions({composers:{s:{instruction:'未保存'}},editors:{}});await assert.rejects(f.c.diagnose('a'),/意见/);assert.equal(f.calls.length,0);
 f.setOpinions({composers:{},editors:{}});f.setModels({catalog:{mode:'host',effective:null,connected:false,label:'所选模型不可用'}});await assert.rejects(f.c.diagnose('a'),/不可用/);assert.equal(f.calls.length,0);
 f.w.isNavigating=()=>true;await assert.rejects(f.c.diagnose('a'),/切换/);assert.equal(f.calls.length,0);
});

test('doctor rejects manual edits that open during flush, releases locks and preserves options/errors',async()=>{
 const f=await fixture();f.c.open('a',{sceneId:'s'});f.c.change('a',{targetDuration:'90 秒'});f.w.flush=async()=>f.setDialogs({editingTargets:[{projectIds:['a']}]});
 await assert.rejects(f.c.diagnose('a'),/编辑窗口/);assert.equal(f.calls.length,0);assert.equal(f.locks.isProjectLocked('a'),false);assert.equal(f.guard.busy('a'),false);assert.equal(f.c.snapshot().options.a.targetDuration,'90 秒');assert.match(f.c.snapshot().errors.a,/编辑窗口/);
});

test('report load completion cannot overwrite a newer diagnosis and handoff only makes one explicit note request',async()=>{
 const read=deferred(),calls=[];let state={projects:[{id:'a',status:'active',scenes:[{id:'s'}]}],workspace:{activeProjectId:'a'}};
 const f=await fixture({request:async(path,payload)=>{calls.push({path,payload});if(!payload)return read.promise;return path.endsWith('handoff')?{state,note:{id:'n'}}:{state,report:{id:'new',projectId:'a',status:'current',issues:[{id:'i',evidence:{sceneId:'s',selection:{start:0,end:1,text:'原'}}}]}};}});
 f.c.open('a',{sceneId:'s'});const loading=f.c.refresh('a');await f.c.diagnose('a');read.resolve({reports:[{id:'old'}]});await loading;assert.equal(f.c.snapshot().reports.a[0].id,'new');
 await f.c.handoff('a','new','i');assert.equal(calls.filter(x=>x.path==='/doctor/handoff').length,1);assert.equal(calls.filter(x=>x.path==='/revisions/generate'||x.path==='/assistant').length,0);assert.equal(f.c.snapshot().reports.a[0].issues[0].noteId,'n');
 await assert.rejects(f.c.handoff('a','new','i'),/已经/);assert.equal(calls.filter(x=>x.path==='/doctor/handoff').length,1);
});

test('new mutation clears invalidated history loading even when diagnosis fails and old backend stays honest',async()=>{
 const read=deferred();const f=await fixture({request:async(path,payload)=>{if(!payload)return read.promise;throw Object.assign(new Error('找不到此接口'),{status:404,code:'NOT_FOUND'});}});
 f.c.open('a',{sceneId:'s'});const loading=f.c.refresh('a');assert.equal(f.c.snapshot().loading.a,true);
 await assert.rejects(f.c.diagnose('a'));assert.equal(f.c.snapshot().loading.a,false);assert.match(f.c.snapshot().errors.a,/完整退出并重新打开 Harness/);
 read.resolve({reports:[]});await loading;assert.match(f.c.snapshot().errors.a,/完整退出并重新打开 Harness/);
});

test('stale server handoff denial updates report status and retains source and diagnosis',async()=>{
 const f=await fixture({request:async(path,payload)=>{if(path.endsWith('/handoff'))throw Object.assign(new Error('诊断依据已变化'),{code:'STALE_DOCTOR_REPORT'});return {report:{id:'r',projectId:'a',status:'current',summary:'原报告',issues:[{id:'i',evidence:{sceneId:'s',selection:{start:0,end:1,text:'原'}}}]}};}});
 f.c.open('a',{sceneId:'s'});await f.c.diagnose('a');await assert.rejects(f.c.handoff('a','r','i'),/依据已变化/);
 assert.equal(f.c.snapshot().reports.a[0].status,'stale');assert.equal(f.c.snapshot().reports.a[0].summary,'原报告');assert.equal(f.c.snapshot().reports.a[0].issues[0].noteId,undefined);
});

test('story bible is project scoped and an old backend cannot silently run a consistency diagnosis',async()=>{
 const f=await fixture();f.c.open('a',{sceneId:'s'});f.c.change('a',{mode:'continuity'});
 await assert.rejects(f.c.diagnose('a'),/一致性|故事档案|完整退出/);assert.equal(f.calls.length,0);
 const bible={fingerprint:'saved',markdown:'# 故事档案',coverage:{outlineScenes:1}},g=await fixture({request:async(path,payload)=>payload?{report:{id:'fresh',projectId:'a',issues:[]},bible:{...bible,fingerprint:'captured'},capabilities:{storyBible:true,continuity:true}}:{reports:[],bible,capabilities:{storyBible:true,continuity:true}}});
 g.c.open('a',{sceneId:'s'});await g.c.refresh('a');assert.equal(g.c.snapshot().bibles.a.markdown,bible.markdown);assert.equal(g.c.snapshot().bibles.b,undefined);
 g.c.change('a',{mode:'continuity'});await g.c.diagnose('a');assert.equal(g.c.snapshot().bibles.a.fingerprint,'captured');
});

for(const mode of ['motivation','foreshadow','suspense'])test(`${mode} requires backend capability and captures its selected options once`,async()=>{
 const f=await fixture();let flushes=0;f.w.flush=async()=>{flushes++;};f.c.open('a',{sceneId:'s'});f.c.change('a',{mode});
 await assert.rejects(f.c.diagnose('a'),/完整退出.*专项检查/);assert.equal(f.calls.length,0);assert.equal(flushes,0);
 const sent=[];const g=await fixture({request:async(path,payload)=>{sent.push({path,payload});return payload?{report:{id:'new',projectId:'a',issues:[]}}:{reports:[],capabilities:{storyBible:true,continuity:true,craftChecks:true}};}});
 g.c.open('a',{sceneId:'s'});await g.c.refresh('a');g.c.change('a',{mode});await g.c.diagnose('a');assert.equal(sent[1].payload.mode,mode);
});
