import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createRevisionChatSender} from '../src/revisions/chat.mjs';
import {createProjectRequestGuard} from '../src/assistant/requestGuard.mjs';

const activity=await import('../src/assistant/activity.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const present=(pending,now)=>{assert.equal(typeof activity.activityPresentation,'function','pending requests need visible, truthful phase feedback');return activity.activityPresentation(pending,now);};
test('activity follows actual request phases without inventing completion or progress',()=>{
  assert.equal(present(null,1000),null);
  assert.equal(present({phase:'preparing',startedAt:1000},1000).title,'准备请求');
  assert.equal(present({phase:'thinking',mode:'discuss',startedAt:1000},2000).title,'正在思考');
  assert.equal(present({phase:'thinking',mode:'execute',startedAt:1000},2000).title,'正在整理操作');
  assert.equal(present({phase:'thinking',mode:'rewrite',startedAt:1000},2000).title,'正在生成修改');
  assert.equal(present({phase:'writing',startedAt:1000},2000).title,'正在写入');
  assert.equal(present({phase:'diagnosing',startedAt:1000},2000).title,'正在会诊');
});
test('elapsed feedback resumes from the captured request time and handles invalid clocks',()=>{
  const start=Date.parse('2026-11-13T00:00:00Z');
  assert.equal(present({phase:'thinking',startedAt:start},start+65000).elapsed,'已等待 1分05秒');
  assert.equal(present({phase:'thinking',startedAt:new Date(start).toISOString()},start+5000).elapsed,'已等待 5秒');
  for(const startedAt of [undefined,'invalid',start+5000])assert.equal(present({phase:'thinking',startedAt},start).elapsed,'已等待 0秒');
  assert.equal(present({phase:'thinking',startedAt:start},start+1000).longWait,false);
  assert.equal(present({phase:'thinking',startedAt:start},start+30000).longWait,true);
  assert.match(present({phase:'thinking',startedAt:start},start+30000).detail,/等待较久/);
  assert.doesNotMatch(present({phase:'writing',startedAt:start},start+30000).detail,/模型回复|已完成/);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
test('paragraph progress stays project scoped and clears after generation failure without automatic retry',async()=>{
  const generated=deferred(),applied=deferred(),guard=createProjectRequestGuard();
  const note={id:'n',version:1},change={noteId:'n',noteVersion:1,status:'pending'},batch={id:'b',chatInstruction:'整体',changes:[change]};
  const project={id:'p',revisionBatches:[batch]};let generationCalls=0,applyCalls=0;
  const controller={generate:async()=>{generationCalls++;return generated.promise;},apply:async()=>{applyCalls++;return applied.promise;},project:()=>({editors:{}})};
  const sender=createRevisionChatSender({controller,getProject:()=>project,completeDraft:()=>{},guard});
  const sending=sender.send({projectId:'p',notes:[note],instruction:'整体'});
  assert.equal(sender.snapshot().pending.p.phase,'thinking');
  assert.ok(sender.snapshot().pending.p.startedAt);
  assert.equal(sender.snapshot().pending.q,undefined);
  assert.equal(await sender.send({projectId:'p',notes:[note]}),null);
  generated.reject(new Error('模型暂时不可用'));await assert.rejects(sending,/不可用/);
  assert.equal(sender.snapshot().pending.p,undefined);assert.equal(guard.busy('p'),false);
  assert.match(sender.snapshot().errors.p,/不可用/);assert.equal(generationCalls,1);assert.equal(applyCalls,0);
});

let render;
async function rendered(props){
  if(!render){const {build}=await import('esbuild');const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {AssistantActivity} from './src/assistant/AssistantActivity.jsx';export const render=props=>renderToStaticMarkup(React.createElement(AssistantActivity,props));",resolveDir:new URL('..',import.meta.url).pathname,loader:'jsx'},bundle:true,platform:'node',format:'cjs',external:['react','react-dom/server'],write:false});const unit={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),unit,unit.exports);render=unit.exports.render;}
  return render(props);
}
test('activity renders an accessible live status and hides its ticking clock from announcements',async()=>{
  assert.equal(present(null,1000),null);
  const html=await rendered({pending:{phase:'thinking',mode:'discuss',startedAt:Date.now()}});
  assert.match(html,/role="status"/);assert.match(html,/正在思考/);assert.match(html,/assistant-activity-star/);
  assert.match(html,/aria-hidden="true"[^>]*>已等待/);
  assert.equal(await rendered({pending:null}),'');
});
