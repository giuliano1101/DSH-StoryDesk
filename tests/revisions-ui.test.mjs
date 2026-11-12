import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditingGate} from '../src/assistant/editingGate.mjs';
const module=await import('../src/revisions/controller.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const factory=()=>{assert.equal(typeof module.createRevisionsController,'function','paragraph inbox controller must exist');return module.createRevisionsController;};
const selection={start:0,end:2,text:'雨落'};
const note={id:'n',sceneId:'s',selection,instruction:'让动作更明确',sourceRevision:1,version:1,status:'open'};
const change={id:'c',noteId:'n',noteVersion:1,sceneId:'s',selection,sourceRevision:1,instruction:note.instruction,replacement:'大雨落下',status:'pending'};
const fixture=()=>({revision:1,workspace:{activeProjectId:'p'},projects:[{id:'p',scenes:[{id:'s',title:'站台',body:'雨落。她停下。',revision:1}],revisionNotes:[structuredClone(note)],revisionBatches:[{id:'b',changes:[structuredClone(change)]}]},{id:'q',scenes:[{id:'t',body:'另一部作品',revision:1}]}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(options={}){
  let state=fixture(),saved={},model={catalog:{mode:'host',connected:true,effective:{provider:'real',model:'actual'}}};const events=[],gate=createEditingGate();
  const w={getState:()=>state,body:(p,s)=>s.body,accept:next=>{events.push(['accept',next]);state=next;},acquireEditingLock:targets=>{events.push(['lock',targets]);return gate.acquire(targets);},releaseEditingLock:token=>{events.push(['release']);gate.release(token);},flush:async args=>{events.push(['flush',args]);if(options.flush)await options.flush(args);},toast:message=>events.push(['toast',message])};
  const storage={getItem:()=>saved.value||null,setItem:(_,value)=>{saved.value=value;}};
  const request=async(path,payload)=>{events.push(['request',path,structuredClone(payload)]);if(path==='/revisions')return {capabilities:{notes:true,generate:true,apply:true}};return options.request?options.request(path,payload,state):{state:{...state,revision:state.revision+1},result:{appliedChangeIds:payload?.changeIds||[],preEditVersionIds:[{projectId:'p',versionId:'v'}]}};};
  const controller=factory()({workbench:()=>w,models:()=>model,storage,dialogs:()=>options.dialogs?.()||{anyOpen:false,editingTargets:[]},request});
  return {controller,events,w,gate,storage,setModel:x=>{model=x;},state:()=>state,setState:x=>{state=x;}};
}
async function ready(options){const h=setup(options);await h.controller.refreshCapabilities();h.events.length=0;return h;}

test('captures an exact paragraph and recovers opinion drafts by project and scene without API calls',async()=>{
  const h=await ready();h.controller.capture('p','s',selection);h.controller.setComposerInstruction('p','s','保留雨声');
  assert.deepEqual(h.controller.project('p').composers.s.selection,selection);assert.equal(h.controller.project('q').composers.t,undefined);assert.equal(h.events.length,0);
  const recovered=factory()({workbench:()=>h.w,models:()=>({}),storage:h.storage,request:async()=>{throw new Error('must not replay');}});
  assert.equal(recovered.project('p').composers.s.instruction,'保留雨声');assert.equal(recovered.snapshot().pending.p,undefined);
  assert.throws(()=>h.controller.capture('p','s',{start:1,end:3,text:'不匹配'}),/选中/);
  assert.throws(()=>h.controller.capture('p','s',{start:3,end:5,text:'她停'}),/未保存/);
});

test('save flushes author prose and clears only the exact sent opinion generation',async()=>{
  const held=deferred();const h=await ready({request:()=>held.promise});h.controller.capture('p','s',selection);h.controller.setComposerInstruction('p','s','同一句');
  const saving=h.controller.saveComposer('p','s');await Promise.resolve();await Promise.resolve();
  h.controller.setComposerInstruction('p','s','');h.controller.setComposerInstruction('p','s','同一句');
  h.state().workspace.activeProjectId='q';held.resolve({state:{...h.state(),revision:2}});await saving;
  assert.equal(h.controller.project('p').composers.s.instruction,'同一句','new typing survives identical text');
  assert.equal(h.events[0][0],'lock');assert.ok(h.events.find(e=>e[0]==='flush')[1].adoptionToken);assert.deepEqual(h.events.find(e=>e[0]==='request')[2],{projectId:'p',operation:'add',sceneId:'s',selection,instruction:'同一句'});assert.equal(h.gate.isProjectLocked('p'),false);
});

test('successful unchanged save clears its own composer and leaves another project draft intact',async()=>{
  const h=await ready();h.controller.capture('p','s',selection);h.controller.setComposerInstruction('p','s','本项目');h.controller.capture('q','t',{start:0,end:2,text:'另一'});h.controller.setComposerInstruction('q','t','另一项目');await h.controller.saveComposer('p','s');
  assert.equal(h.controller.project('p').composers.s,undefined);assert.equal(h.controller.project('q').composers.t.instruction,'另一项目');
});

test('failed note save retains selection and instruction and releases target lock',async()=>{
  const h=await ready({request:async()=>{throw new Error('暂时离线');}});h.controller.capture('p','s',selection);h.controller.setComposerInstruction('p','s','不要丢失');await assert.rejects(h.controller.saveComposer('p','s'),/离线/);
  assert.equal(h.controller.project('p').composers.s.instruction,'不要丢失');assert.equal(h.gate.isProjectLocked('p'),false);assert.match(h.controller.snapshot().errors.p,/离线/);
});

test('generation fixes note IDs and the shared real model before flushing and suppresses project duplicate calls',async()=>{
  const held=deferred();const h=await ready({flush:()=>held.promise});const ids=['n'];const run=h.controller.generate('p',ids);ids[0]='other';h.setModel({catalog:{mode:'host',connected:true,effective:{provider:'changed',model:'new'}}});h.state().workspace.activeProjectId='q';
  assert.equal(await h.controller.generate('p',['n']),null);held.resolve();await run;
  assert.deepEqual(h.events.find(e=>e[0]==='request')[2],{projectId:'p',noteIds:['n'],modelSelection:{provider:'real',model:'actual'}});assert.equal(h.events.filter(e=>e[0]==='request').length,1);assert.equal(h.events.some(e=>e[0]==='lock'),false,'generation does not lock prose for a model call');
});

test('disconnected models block generation but allow local opinion capture and server-side note save',async()=>{
  const h=await ready();h.setModel({catalog:{connected:false,label:'尚未连接模型'}});await assert.rejects(h.controller.generate('p',['n']),/连接/);h.controller.capture('p','s',selection);h.controller.setComposerInstruction('p','s','先存意见');await h.controller.saveComposer('p','s');assert.equal(h.events.filter(e=>e[0]==='request').length,1);
});

test('adoption locks only its target, flushes with the token and uses captured selected changes',async()=>{
  const held=deferred();const h=await ready({flush:()=>held.promise});const ids=['c'];const run=h.controller.apply('p','b',ids);ids[0]='wrong';h.state().workspace.activeProjectId='q';assert.equal(h.gate.isProjectLocked('p'),true);assert.equal(h.gate.isProjectLocked('q'),false);assert.equal(await h.controller.apply('p','b',['c']),null);
  held.resolve();await run;assert.deepEqual(h.events.find(e=>e[0]==='lock')[1],{projectIds:['p'],shared:false});assert.ok(h.events.find(e=>e[0]==='flush')[1].adoptionToken);assert.deepEqual(h.events.find(e=>e[0]==='request')[2],{projectId:'p',batchId:'b',changeIds:['c']});assert.equal(h.gate.isProjectLocked('p'),false);assert.equal(h.controller.snapshot().receipts.p.appliedChangeIds.length,1);assert.deepEqual(h.controller.snapshot().receipts.p.preEditVersionIds,[{projectId:'p',versionId:'v'}]);
});

test('manual target dialogs defer adoption without flushing manual edits; unrelated dialogs do not reroute it',async()=>{
  let target='p';const h=await ready({dialogs:()=>({anyOpen:true,editingTargets:[{projectIds:[target],shared:false}]})});await assert.rejects(h.controller.apply('p','b',['c']),/编辑窗口/);assert.equal(h.events.some(e=>e[0]==='flush'),false);target='q';await h.controller.apply('p','b',['c']);assert.equal(h.events.filter(e=>e[0]==='request').length,1);
});

test('a target dialog opened during flush defers adoption and preserves all previews',async()=>{
  const held=deferred();let open=false;const h=await ready({flush:()=>held.promise,dialogs:()=>({anyOpen:open,editingTargets:open?[{projectIds:['p'],shared:false}]:[]})});const run=h.controller.apply('p','b',['c']);open=true;held.resolve();await assert.rejects(run,/编辑窗口/);assert.equal(h.events.some(e=>e[0]==='request'),false);assert.equal(h.state().projects[0].revisionBatches[0].changes[0].status,'pending');assert.equal(h.gate.isProjectLocked('p'),false);
});

test('editing a saved opinion defers its old preview, while cancel restores eligibility',async()=>{
  const h=await ready();h.controller.startEdit('p','n');h.controller.setNoteInstruction('p','n','新意见');await assert.rejects(h.controller.apply('p','b',['c']),/意见/);assert.equal(h.events.length,0);h.controller.cancelEdit('p','n');await h.controller.apply('p','b',['c']);
});

test('saving an edited opinion cannot clear edits typed during its pending save',async()=>{
  const held=deferred();const h=await ready({request:()=>held.promise});h.controller.startEdit('p','n');h.controller.setNoteInstruction('p','n','第一次');const saving=h.controller.saveNote('p','n');h.controller.setNoteInstruction('p','n','第二次');held.resolve({state:{...h.state(),revision:2}});await saving;assert.equal(h.controller.project('p').editors.n.instruction,'第二次');
});

test('stale anchors require an explicit current selection in their own scene and keep the instruction',async()=>{
  const h=await ready();h.state().projects[0].scenes[0].revision=2;assert.equal(module.noteCurrent(h.state().projects[0],note),false);h.controller.beginReanchor('p','n');await assert.rejects(h.controller.reanchor('p','n','t',selection),/原场景/);assert.equal(h.controller.project('p').reanchorId,'n');await h.controller.reanchor('p','n','s',selection);assert.deepEqual(h.events.find(e=>e[0]==='request')[2],{projectId:'p',operation:'reanchor',noteId:'n',selection});assert.equal(h.state().projects[0].revisionNotes[0].instruction,note.instruction);
});

test('individual adoption reads authoritative rebased remaining changes and failed batch retains checks',async()=>{
  const h=await ready({request:async(_,payload,state)=>{const next=structuredClone(state);next.revision++;if(payload.changeIds.includes('d'))throw new Error('原文已变化');next.projects[0].revisionBatches[0].changes=[{...change,status:'applied'},{...change,id:'d',selection:{start:4,end:6,text:'她停'},sourceRevision:2}];return {state:next,result:{appliedChangeIds:['c'],preEditVersionIds:[]}};}});
  h.controller.setView('p',{checkedChanges:{b:['c','d']}});await h.controller.apply('p','b',['c']);assert.equal(h.state().projects[0].revisionBatches[0].changes[1].selection.start,4);await assert.rejects(h.controller.apply('p','b',['d']),/变化/);assert.deepEqual(h.controller.project('p').checkedChanges.b,['d']);
});

test('an older revisions backend shows a full-reopen message and disables remote actions honestly',async()=>{
  const h=setup({request:async()=>{}});const c=factory()({workbench:()=>h.w,models:()=>({catalog:{connected:true}}),request:async()=>{throw Object.assign(new Error('找不到此接口'),{status:404});}});await c.refreshCapabilities();assert.equal(c.snapshot().capabilityError,'完整退出并重新打开 Harness 后加载新版批注功能');await assert.rejects(c.generate('p',['n']),/完整退出/);assert.equal(c.snapshot().capabilities,null);
});

test('cancel and replace during an old save cannot clear the newer composer',async()=>{
  const held=deferred();const h=await ready({request:()=>held.promise});h.controller.capture('p','s',selection);h.controller.setComposerInstruction('p','s','第一份');const saving=h.controller.saveComposer('p','s');h.controller.cancelComposer('p','s');h.controller.capture('p','s',selection);h.controller.setComposerInstruction('p','s','第二份');held.resolve({state:{...h.state(),revision:2}});await saving;assert.equal(h.controller.project('p').composers.s?.instruction,'第二份');
});

test('corrupt local recovery fields cannot become executable drafts and valid text survives',()=>{
  const h=setup();h.storage.setItem('',JSON.stringify({p:{composers:{bad:{instruction:4,selection:{}},s:{instruction:'留在本机',generation:2,selection}},editors:{n:{instruction:'意见',generation:3}},checkedNotes:['n',7],checkedChanges:{b:['c',null]}}}));const c=factory()({workbench:()=>h.w,storage:h.storage,request:async()=>{throw Error('no replay');}});assert.deepEqual(c.project('p').checkedNotes,['n']);assert.equal(c.project('p').composers.bad,undefined);assert.equal(c.project('p').composers.s.instruction,'留在本机');assert.deepEqual(c.project('p').checkedChanges.b,['c']);
});

test('a removed note error is retained honestly and is not mistaken for an older backend',async()=>{
  const h=await ready({request:async()=>{throw Object.assign(new Error('这条意见已不存在，请刷新后重试。'),{status:404,code:'REVISION_NOTE_NOT_FOUND'});}});await assert.rejects(h.controller.remove('p','n'),/已不存在/);assert.equal(h.controller.snapshot().errors.p,'这条意见已不存在，请刷新后重试。');assert.equal(h.controller.snapshot().capabilities.notes,true);
});

test('adoption removes only actually applied opinion selections and preserves remaining note checks',async()=>{
  const h=await ready();h.controller.setView('p',{checkedNotes:['n','other-note']});await h.controller.apply('p','b',['c']);assert.deepEqual(h.controller.project('p').checkedNotes,['other-note']);
});

test('preview eligibility uses live note version, current scene, imported status and manual opinion drafts',()=>{
  const p=fixture().projects[0],batch=p.revisionBatches[0];assert.equal(module.changeAvailable(p,batch,change),true);assert.equal(module.changeAvailable(p,{...batch,readOnly:true},change),false);assert.equal(module.changeAvailable(p,batch,{...change,noteVersion:2}),false);assert.equal(module.changeAvailable(p,batch,change,{n:{instruction:'未保存'}}),false);p.scenes[0].revision=2;assert.equal(module.changeAvailable(p,batch,change),false);
});

let renderInbox;
async function renderedInbox(props){
  if(!renderInbox){const {build}=await import('esbuild'),{createRequire}=await import('node:module');const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {RevisionInbox} from './src/revisions/RevisionInbox.jsx';export const render=props=>renderToStaticMarkup(React.createElement(RevisionInbox,props));",resolveDir:new URL('..',import.meta.url).pathname,loader:'jsx'},bundle:true,platform:'node',format:'cjs',mainFields:['module','main'],external:['react','react-dom/server'],write:false});const unit={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),unit,unit.exports);renderInbox=unit.exports.render;}
  return renderInbox(props);
}

test('inbox renders complete original and replacement, actual model and adopted status from authoritative state',async()=>{
  const h=await ready(),p=h.state().projects[0];p.revisionBatches[0].model='实际提供方 / 实际模型';p.revisionBatches[0].changes[0].replacement='她听见雨声。\n\n整段结尾仍然显示。';p.revisionBatches[0].changes[0].status='applied';const html=await renderedInbox({p,scene:p.scenes[0],w:h.w,revisions:{controller:h.controller,snapshot:h.controller.snapshot(),models:{catalog:{connected:true,label:'实际模型'}},viewOriginal(){},beginReanchor(){}}});assert.ok(html.includes('雨落'));assert.ok(html.includes('整段结尾仍然显示。'));assert.ok(html.includes('实际提供方 / 实际模型'));assert.ok(html.includes('已采用'));assert.ok(html.includes('第 01 场 · 站台'));assert.ok(!html.includes('场景编号'));
});

test('checked stale opinions and previews remain individually removable from the selection',async()=>{
  const h=await ready(),p=h.state().projects[0];p.scenes[0].revision=2;h.controller.setView('p',{checkedNotes:['n'],checkedChanges:{b:['c']}});const html=await renderedInbox({p,scene:p.scenes[0],w:h.w,revisions:{controller:h.controller,snapshot:h.controller.snapshot(),models:{catalog:{connected:false}},viewOriginal(){},beginReanchor(){}}});const checkboxes=html.match(/<input[^>]+type="checkbox"[^>]*>/g)||[];assert.equal(checkboxes.length,2);for(const input of checkboxes){assert.ok(input.includes('checked=""'));assert.ok(!input.includes('disabled=""'));}
});

test('imported history whose scene only survives in a version shows human scene names in text and accessible labels',async()=>{
  const h=await ready(),p=h.state().projects[0],historicalId='scene_5f038f3d-2061-4cd4-af8c-78f4531d2032';
  p.versions=[{id:'version-imported',snapshot:{scenes:[{...p.scenes[0],id:historicalId,title:'旧稿里的候车室'}]}}];
  p.revisionNotes[0].sceneId=historicalId;p.revisionBatches[0].readOnly=true;p.revisionBatches[0].changes[0].sceneId=historicalId;delete p.revisionBatches[0].changes[0].sceneTitle;
  h.controller.startEdit('p','n');h.controller.setView('p',{composers:{[historicalId]:{selection,instruction:'旧场景未保存的意见',generation:7}}});
  const html=await renderedInbox({p,scene:p.scenes[0],w:h.w,revisions:{controller:h.controller,snapshot:h.controller.snapshot(),models:{catalog:{connected:false}},viewOriginal(){},beginReanchor(){}}});
  assert.ok(!html.includes(historicalId),'internal scene identifiers must not appear in text or accessible labels');assert.ok(html.includes('旧稿里的候车室'));assert.ok(html.includes('选择修改：旧稿里的候车室'));assert.ok(html.includes('选择意见：旧稿里的候车室'));assert.ok(html.includes('编辑意见：旧稿里的候车室'));assert.ok(html.includes('修改意见：旧稿里的候车室'));assert.ok(html.includes('导入只读'));assert.ok(html.includes('雨落'));
});

test('adoption receipts identify their batch so another selected history cannot inherit its result',async()=>{
  const h=await ready();await h.controller.apply('p','b',['c']);assert.equal(h.controller.snapshot().receipts.p.batchId,'b');
});

test('selected batch retains every recovery version after another batch was adopted',async()=>{
  const h=await ready(),p=h.state().projects[0];p.versions=[{id:'v-a1',name:'第一条采用前'},{id:'v-a2',name:'第二条采用前'},{id:'v-b',name:'另一批采用前'}];p.revisionBatches[0].preEditVersionIds=[{projectId:'p',versionId:'v-a1'},{projectId:'p',versionId:'v-a2'}];h.controller.setView('p',{batchId:'b'});
  const snapshot={...h.controller.snapshot(),receipts:{p:{batchId:'another-batch',appliedChangeIds:['elsewhere'],preEditVersionIds:[{projectId:'p',versionId:'v-b'}]}}};const html=await renderedInbox({p,scene:p.scenes[0],w:h.w,revisions:{controller:h.controller,snapshot,models:{catalog:{connected:false}},viewOriginal(){},beginReanchor(){}}});assert.ok(html.includes('第一条采用前'));assert.ok(html.includes('第二条采用前'));assert.ok(!html.includes('另一批采用前'));assert.ok(!html.includes('最近一次已采用'));
});

test('a partial adoption exposes earlier selected-batch recovery versions once each alongside the latest receipt',async()=>{
  const h=await ready(),p=h.state().projects[0];p.versions=[{id:'v-first',name:'第一次采用前'},{id:'v-latest',name:'本次采用前'}];p.revisionBatches[0].preEditVersionIds=[{projectId:'p',versionId:'v-first'},{projectId:'p',versionId:'v-latest'}];const snapshot={...h.controller.snapshot(),receipts:{p:{batchId:'b',appliedChangeIds:['c'],preEditVersionIds:[{projectId:'p',versionId:'v-latest'}]}}};const html=await renderedInbox({p,scene:p.scenes[0],w:h.w,revisions:{controller:h.controller,snapshot,models:{catalog:{connected:false}},viewOriginal(){},beginReanchor(){}}});assert.equal(html.split('第一次采用前').length-1,1);assert.equal(html.split('本次采用前').length-1,1);assert.ok(html.includes('最近一次已采用 1 条修改。'));
});

test('an open opinion whose scene remains only in a version can edit its instruction while reanchoring stays unavailable',async()=>{
  const h=await ready(),p=h.state().projects[0],oldScene={...p.scenes[0],id:'historical-scene',title:'恢复前的候车室'};p.versions=[{id:'before-restore',snapshot:{scenes:[oldScene]}}];p.revisionNotes[0].sceneId=oldScene.id;
  const html=await renderedInbox({p,scene:p.scenes[0],w:h.w,revisions:{controller:h.controller,snapshot:h.controller.snapshot(),models:{catalog:{connected:false}},viewOriginal(){},beginReanchor(){}}});
  const buttons=html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)||[],edit=buttons.find(button=>button.includes('编辑意见')),reanchor=buttons.find(button=>button.includes('重新选中段落'));
  assert.ok(edit,'the saved opinion keeps an instruction editor');assert.ok(!edit.includes('disabled=""'),'missing current scene must not block instruction edits');assert.ok(reanchor?.includes('disabled=""'),'reanchoring still needs the scene in the current screenplay');
});
