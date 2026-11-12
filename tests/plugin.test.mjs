import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import plugin,{hostModel} from '../plugin/host.mjs';

test('host model follows current DSH selection and streams scoped authoring requests',async()=>{
  let selected={provider:'subscription',model:'writer-a'},sent,prepared;
  const ctx={get(name){return name==='agentDefaultModel'?{currentSelection:()=>selected}:name==='llm'?{listProviders:async()=>[{id:'subscription'}],listModels:async()=>[{id:'writer-a'},{id:'writer-b'}],prepareCall:async(options,signal)=>{prepared=options;return {config:{},async *stream(request){sent=request;yield{type:'text-delta',text:'改写'};yield{type:'text-delta',text:'后的对白'};}};}}:null;}};
  const adapter=hostModel(ctx);
  assert.equal((await adapter.status()).connected,true);
  selected={provider:'subscription',model:'writer-b'};
  const result=await adapter({system:'仅当前项目',user:'改写本场',signal:new AbortController().signal});
  assert.deepEqual(result,{text:'改写后的对白',model:'writer-b'});
  assert.equal(prepared.model,'writer-b');assert.equal(sent.system,'仅当前项目');
  assert.equal(sent.messages[0].content[0].text,'改写本场');assert.match(sent.sessionId,/^screenwriter-desk-/);
});
test('DSH API route denies unauthenticated access before serving any project data',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'screenwriter-plugin-')),previous=process.env.DSH_HOME;
  process.env.DSH_HOME=directory;
  let handler,code,body;
  try{
    await plugin.apply({get:()=>null,webServer:{register(route){handler=route.handler;return()=>{};}},effect:fn=>fn()});
    const response={writeHead(status){code=status;},end(data){body=data;}};
    await handler({url:'/screenwriter-desk/api/state',headers:{}},response);
    assert.equal(code,403);assert.ok(!body.includes('projects'));assert.ok(!body.includes('apiKey'));
  }finally{if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(directory,{recursive:true,force:true});}
});

test('host catalog enumerates connected providers and isolates failures without leaking provider details',async()=>{
  const llm={async listProviders(){return [{id:'a',name:'账户 A',apiKey:'private-key'},{id:'broken',name:'失效账户'},{id:'b',name:'账户 B'}];},async listModels(id){if(id==='broken')throw new Error('private-key');return [{id:`${id}-writer`,name:'写作模型',credentials:'private-key'}];}};
  const adapter=hostModel({get:name=>name==='llm'?llm:name==='agentDefaultModel'?{currentSelection:()=>({provider:'a',model:'a-writer'})}:null});
  assert.equal(typeof adapter.catalog,'function');
  const catalog=await adapter.catalog();
  assert.deepEqual(catalog.providers,[{id:'a',name:'账户 A',models:[{id:'a-writer',name:'写作模型'}]},{id:'b',name:'账户 B',models:[{id:'b-writer',name:'写作模型'}]}]);
  assert.equal(catalog.partial,true);assert.ok(!JSON.stringify(catalog).includes('private-key'));
});

test('explicit nondefault host selection determines the actual call and removed models never call a fallback',async()=>{
  let models=[{id:'writer-a'},{id:'writer-b'}],prepared,calls=0;
  const llm={listProviders:async()=>[{id:'subscription',name:'已连接账户'}],listModels:async()=>models,prepareCall:async options=>{calls++;prepared=options;return {config:{},async *stream(){yield {type:'text-delta',text:'结果'};}};}};
  const adapter=hostModel({get:name=>name==='llm'?llm:name==='agentDefaultModel'?{currentSelection:()=>({provider:'subscription',model:'writer-a'})}:null});
  await adapter({system:'s',user:'u',modelSelection:{provider:'subscription',model:'writer-b'}});
  assert.equal(prepared.model,'writer-b');
  models=[{id:'writer-a'}];
  await assert.rejects(adapter({system:'s',user:'u',modelSelection:{provider:'subscription',model:'writer-b'}}),error=>error.code==='MODEL_UNAVAILABLE');
  assert.equal(calls,1);
});

test('native screenwriter titlebar clearance follows actual host attributes and fullscreen state',async()=>{
  const {nativeTopInset,readNativeTopInset}=await import('../plugin/chrome.mjs');
  assert.equal(nativeTopInset({isHarness:true,platform:'darwin',hostClearance:'0px'}),48);
  assert.equal(nativeTopInset({isHarness:true,platform:'darwin',hostClearance:'64px'}),64);
  assert.equal(nativeTopInset({isHarness:false,platform:'darwin'}),0);
  assert.equal(nativeTopInset({isHarness:true,platform:'darwin',fullScreen:true}),0);
  const html={dataset:{platform:'darwin'},hasAttribute:()=>false},doc={documentElement:html},win={getComputedStyle:()=>({getPropertyValue:()=>''})};
  assert.equal(readNativeTopInset(doc,win),48);html.dataset.platform='win32';assert.equal(readNativeTopInset(doc,win),0);html.dataset.platform='darwin';doc.fullscreenElement={};assert.equal(readNativeTopInset(doc,win),0);
});

test('default host route is captured before asynchronous discovery and never follows later default changes',async()=>{
  let current={provider:'p',model:'a'},release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const llm={listProviders:async()=>{entered();await new Promise(resolve=>{release=resolve;});return [{id:'p',name:'账户'}];},listModels:async()=>[{id:'a'},{id:'b'}]};
  const adapter=hostModel({get:name=>name==='llm'?llm:name==='agentDefaultModel'?{currentSelection:()=>current}:null});
  const capture=adapter.resolveSelection(null);await started;current={provider:'p',model:'b'};release();
  assert.deepEqual(await capture,{provider:'p',model:'a'});
});

test('top-level host discovery failure reports a safe unavailable catalog',async()=>{
  const adapter=hostModel({get:name=>name==='llm'?{listProviders:async()=>{throw new Error('private-account-token');}}:null});
  const catalog=await adapter.catalog();assert.deepEqual(catalog.providers,[]);assert.equal(typeof catalog.error,'string');assert.ok(!JSON.stringify(catalog).includes('private-account-token'));
});

test('omitted request choice freezes the host default before private settings load while saved overrides still win',async()=>{
  const {captureModelSelection}=await import('../server/models.mjs');
  for(const {initial,saved,expected} of [
    {initial:{provider:'p',model:'a'},saved:null,expected:{provider:'p',model:'a'}},
    {initial:{provider:'p',model:'a'},saved:{provider:'p',model:'c'},expected:{provider:'p',model:'c'}},
    {initial:null,saved:null,expected:null},
  ]){
    let current=initial,release;
    const store={readSettings:()=>new Promise(resolve=>{release=resolve;})};
    const llm={listProviders:async()=>[{id:'p',name:'Account'}],listModels:async()=>[{id:'a'},{id:'b'},{id:'c'}]};
    const adapter=hostModel({get:name=>name==='llm'?llm:name==='agentDefaultModel'?{currentSelection:()=>current}:null});
    const capture=captureModelSelection(store,adapter,{});
    current={provider:'p',model:'b'};
    release({modelSelection:saved});
    if(expected)assert.deepEqual(await capture,expected);
    else await assert.rejects(capture,error=>error.code==='AI_NOT_CONFIGURED');
  }
});

// Exercise the actual registered Harness handler, not startServer/createApi.
// Report authority and project reservations must share the plugin store lifetime.
async function doctorHostFixture(t,{waitFirst=false}={}){
 const directory=await mkdtemp(join(tmpdir(),'screenwriter-doctor-host-')),previous=process.env.DSH_HOME;
 process.env.DSH_HOME=directory;
 let handler,calls=0,release,entered,rejection=null;
 const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 t.after(async()=>{release();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(directory,{recursive:true,force:true});});
 const llm={listProviders:async()=>[{id:'p'}],listModels:async()=>[{id:'a'}],prepareCall:async()=>({config:{},async *stream(request){
  const ordinal=++calls;entered();if(waitFirst&&ordinal===1)await gate;
  const source=JSON.parse(request.messages[0].content[0].text).source,s=source.scenes[0];
  yield {type:'text-delta',text:JSON.stringify({summary:'依据当前正文诊断。',limitations:['时间轴未知'],disagreement:'编辑关注推进，人物视角关注停顿。',nextStep:'先核对行动动机。',issues:[{priority:'high',reviewer:'结构编辑',title:'动作信息未推进',impact:'当前段落重复前提。',suggestion:'压缩重复信息，保留人物决定。',evidence:{sceneId:s.id,selection:{start:0,end:4,text:s.body.slice(0,4)}}}]})};
 }})};
 const ctx={get:name=>name==='connection'?{requestRejection:()=>rejection}:name==='llm'?llm:name==='agentDefaultModel'?{currentSelection:()=>({provider:'p',model:'a'})}:null,webServer:{register(route){handler=route.handler;return()=>{};}},effect:fn=>fn()};
 await plugin.apply(ctx);
 const request=async(path,payload)=>{
  const req=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]);req.url=`/screenwriter-desk/api${path}`;req.method=payload===undefined?'GET':'POST';req.headers=payload===undefined?{}:{'content-type':'application/json'};
  const res=new EventEmitter();res.headersSent=false;res.writableEnded=false;res.destroyed=false;res.setHeader=()=>{};let status,body;
  res.writeHead=value=>{status=value;res.headersSent=true;};res.end=value=>{body=value;res.writableEnded=true;};
  await handler(req,res);assert.equal(req.url,`/screenwriter-desk/api${path}`,'plugin restores the prefixed URL');return {status,...JSON.parse(String(body))};
 };
 const created=await request('/actions',{action:{type:'project.create',title:'实际插件会诊'}}),projectId=created.result.projectId;
 const added=await request('/actions',{action:{type:'scene.add',projectId,scene:{body:'雨停了。她仍在等。'}}}),sceneId=added.result.sceneId;
 return {request,projectId,sceneId,diagnose:()=>request('/doctor',{projectId,sceneId,scope:'scene',mode:'general'}),started,release,calls:()=>calls,restart:()=>plugin.apply(ctx),reject:status=>rejection=status};
}

test('registered Harness handler retains generated report authority across GET and explicit handoff requests',async t=>{
 const f=await doctorHostFixture(t),generated=await f.diagnose();assert.equal(generated.status,200,generated.error);assert.equal(generated.report.readOnly,false);
 const history=await f.request(`/doctor?projectId=${f.projectId}`);assert.equal(history.status,200);assert.equal(history.reports[0].readOnly,false,'same plugin store session retains explicit handoff authority');
 const report=generated.report,transferred=await f.request('/doctor/handoff',{projectId:f.projectId,reportId:report.id,issueId:report.issues[0].id});
 assert.equal(transferred.status,200,transferred.error);assert.equal(transferred.note.selection.text,'雨停了。');assert.equal(f.calls(),1);
 const repeated=await f.request('/doctor/handoff',{projectId:f.projectId,reportId:report.id,issueId:report.issues[0].id});assert.equal(repeated.code,'DOCTOR_ALREADY_HANDED_OFF');
});

test('registered Harness handler shares project doctor busy guard across concurrent requests and releases it',async t=>{
 const f=await doctorHostFixture(t,{waitFirst:true}),pending=f.diagnose();await f.started;
 try{const duplicate=await f.diagnose();assert.equal(duplicate.status,409);assert.equal(duplicate.code,'DOCTOR_BUSY');assert.equal(f.calls(),1);}finally{f.release();}
 assert.equal((await pending).status,200);assert.equal((await f.diagnose()).status,200);assert.equal(f.calls(),2);
});

test('cached Harness API still checks authentication per request and a new plugin session restores only read-only history',async t=>{
 const f=await doctorHostFixture(t),generated=await f.diagnose();assert.equal(generated.status,200);
 f.reject(403);assert.equal((await f.request(`/doctor?projectId=${f.projectId}`)).status,403);assert.equal(f.calls(),1);
 f.reject(null);assert.equal((await f.request(`/doctor?projectId=${f.projectId}`)).reports[0].readOnly,false);
 await f.restart();const history=await f.request(`/doctor?projectId=${f.projectId}`);assert.equal(history.reports[0].id,generated.report.id);assert.equal(history.reports[0].readOnly,true);
 const transferred=await f.request('/doctor/handoff',{projectId:f.projectId,reportId:generated.report.id,issueId:generated.report.issues[0].id});assert.equal(transferred.code,'READ_ONLY_DOCTOR_REPORT');assert.equal(f.calls(),1);
});
