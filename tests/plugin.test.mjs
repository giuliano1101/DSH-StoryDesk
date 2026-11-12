import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
