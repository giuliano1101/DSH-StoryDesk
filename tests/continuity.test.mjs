import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../server/continuity.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const capture=(p,targets)=>{assert.equal(typeof mod.captureContinuity,'function');return mod.captureContinuity(p,targets);};
const fixture=()=>({id:'p',format:'novel',characters:[{id:'c',name:'林夏',status:'adopted'}],scenes:[{id:'a',title:'第一章',body:'林夏已交出唯一钥匙。',revision:1,cast:['c']},{id:'b',title:'第二章',body:'林夏拿出那把钥匙。',revision:2,cast:['c']},{id:'hidden',title:'废稿',body:'不应传入的废稿秘密',archived:true,cast:[]}]});
test('continuity captures only same-work active opposing prose and exposes exact addressable passages',()=>{
 const p=fixture(),before=structuredClone(p),s=capture(p,[p.scenes[1]]);
 assert.equal(s.passages.length,1);assert.equal(s.passages[0].sceneId,'a');assert.equal(s.passages[0].text,p.scenes[0].body);
 assert.equal(s.passages[0].text,p.scenes[0].body.slice(s.passages[0].start,s.passages[0].end));
 assert.equal(s.coverage.totalScenes,1);assert.equal(s.coverage.coveredScenes,1);assert.equal(s.coverage.omittedScenes,0);
 assert.doesNotMatch(JSON.stringify(s),/废稿秘密/);assert.deepEqual(p,before);
});
test('cross-scene edits invalidate the captured reference fingerprint even outside selected excerpts',()=>{
 const p=fixture(),a=capture(p,[p.scenes[1]]);p.scenes[0].body+='作者补充';p.scenes[0].revision++;
 assert.notEqual(capture(p,[p.scenes[1]]).sourceFingerprint,a.sourceFingerprint);
});
test('long projects bound reference text and disclose incomplete coverage without truncating target prose',()=>{
 const p=fixture();p.scenes.unshift(...Array.from({length:50},(_,i)=>({id:'long-'+i,title:'长章'+i,body:'序'+('雨'.repeat(10000))+'末',revision:0,cast:[]})));
 const s=capture(p,[p.scenes.find(x=>x.id==='b')]);
 assert.ok(s.passages.reduce((n,p)=>n+p.text.length,0)<=24000);
 assert.ok(s.coverage.excerptScenes>0||s.coverage.omittedScenes>0);
 for(const passage of s.passages)assert.equal(passage.text,p.scenes.find(x=>x.id===passage.sceneId).body.slice(passage.start,passage.end));
 assert.equal(p.scenes.find(x=>x.id==='b').body,'林夏拿出那把钥匙。');
});
test('imported reference snapshots reject foreign ids, invalid ranges and inconsistent coverage',()=>{
 const p=fixture(),s=capture(p,[p.scenes[1]]),owned=new Set(p.scenes.map(x=>x.id));
 assert.equal(typeof mod.validateContinuity,'function');assert.deepEqual(mod.validateContinuity(s,owned),s);
 for(const edit of [x=>x.passages[0].sceneId='foreign',x=>x.passages[0].end++,x=>x.coverage.coveredScenes=99]){const bad=structuredClone(s);edit(bad);assert.throws(()=>mod.validateContinuity(bad,owned));}
});

test('surrogate-aligned excerpts never exceed the remaining budget and validate their own Unicode snapshots',()=>{
 const p=fixture();p.scenes=Array.from({length:30},(_,i)=>({id:'unicode-'+i,title:'章节'+i,body:'x'.repeat((i+7)%9)+'😀'.repeat(7000)+'y'.repeat((i*3+7)%7),revision:0,cast:[]}));
 const s=capture(p,[p.scenes[0]]);assert.ok(s.passages.reduce((n,p)=>n+p.text.length,0)<=24000);
 for(const passage of s.passages){assert.equal(passage.text.isWellFormed(),true);assert.equal(passage.text,p.scenes.find(x=>x.id===passage.sceneId).body.slice(passage.start,passage.end));}
 assert.deepEqual(mod.validateContinuity(s,new Set(p.scenes.map(s=>s.id))),s);
});
