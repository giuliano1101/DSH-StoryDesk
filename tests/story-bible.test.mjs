import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { captureStoryBible, storyBibleDocument, validateStoryBible, storyBibleReferenceText } from '../server/story-bible.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const signed = snapshot => { const { fingerprint, ...core } = snapshot; return { ...core, fingerprint: hash(core) }; };
function project() {
  return { id:'p', title:'雨站', kind:'短剧', brief:{logline:'寻找一封信',theme:'承认',constraints:'两位演员',pov:'第一人称\n不可靠叙述者'}, synopsis:'完整故事结局',
    episodes:[{id:'e1',title:'第一集',summary:'进入车站'},{id:'e2',title:'第二集',summary:'终于离开'}],
    characters:[{id:'c1',name:'林夏',role:'邮递员',goal:'找到信',secret:'没有寄出',voice:'短句',notes:'原始笔记',status:'adopted'},{id:'c2',name:'备选秘密',status:'alternative'},{id:'c3',name:'归档秘密',status:'archived'},{id:'cx',projectId:'foreign',name:'外项目人物',status:'adopted'}],
    materials:[{id:'w',title:'车站法则',category:'world',body:'每天只开一次门',source:'作者',status:'adopted'},{id:'r',title:'铁路采访',category:'research',body:'采访并不等于故事事实',source:'采访原稿',status:'adopted'},{id:'i',title:'后续想法',category:'idea',body:'可能加入新结局',status:'adopted'},{id:'a',title:'备选素材秘密',status:'alternative'},{id:'x',projectId:'foreign',title:'外项目素材',status:'adopted'}],
    scenes:[{id:'s1',episodeId:'e1',title:'进站',summary:'来信引发争执',intent:'找线索',outcome:'发现隐瞒',act:'第一幕',location:'候车室',time:'夜',interior:'内景',body:'不应复制的完整正文'},{id:'s2',episodeId:'e2',title:'离站',summary:'离开车站',intent:'放下',outcome:'和解',act:'第三幕',body:'另一集正文'},{id:'old',archived:true,title:'归档场景秘密'},{id:'foreign',projectId:'elsewhere',title:'外项目场景秘密'}] };
}

test('captures a deterministic whole-work read-only outline and adopted canon without manuscript bodies',()=>{
  assert.equal(typeof captureStoryBible,'function','captureStoryBible is implemented');
  const p=project(),before=structuredClone(p),a=captureStoryBible(p),b=captureStoryBible(p);
  assert.deepEqual(a,b);assert.deepEqual(p,before);assert.equal(a.schemaVersion,1);assert.equal(a.format,'screenplay');
  assert.equal(new Set(a.entries.map(e=>e.id)).size,a.entries.length);
  assert.deepEqual({...a.coverage,missing:undefined},{outlineScenes:2,episodes:2,characters:1,worldMaterials:1,researchMaterials:1,missing:undefined});
  assert.equal(a.entries.filter(e=>e.kind==='outline').length,2);assert.equal(a.entries.find(e=>e.sceneId==='s2').episodeId,'e2');
  const text=a.entries.map(e=>e.text).join('\n');assert.match(text,/第一人称\n不可靠叙述者/);assert.match(text,/候车室/);assert.match(text,/终于离开/);assert.match(text,/发现隐瞒/);
  assert.doesNotMatch(JSON.stringify(a),/备选秘密|归档秘密|外项目|归档场景|备选素材|不应复制的完整正文|另一集正文/);
  assert.equal(a.entries.find(e=>e.title==='铁路采访').kind,'reference');assert.equal(a.entries.find(e=>e.title==='后续想法').kind,'idea');
  assert.deepEqual(validateStoryBible(a,new Set(['s1','s2'])),a);
});

test('fingerprints track every saved outline or canon change while ignoring body/revision/UI state',()=>{
  const p=project(),initial=captureStoryBible(p);for(const mutate of [q=>q.scenes[1].summary+='改变',q=>q.characters[0].secret+='改变',q=>q.materials[0].body+='改变',q=>q.episodes[1].summary+='改变',q=>q.brief.pov+='改变']){const q=structuredClone(p);mutate(q);assert.notEqual(captureStoryBible(q).fingerprint,initial.fingerprint);}
  p.scenes[0].body+='只是正文';p.scenes[0].revision=6;p.updatedAt='later';p.view={tab:'script'};assert.equal(captureStoryBible(p).fingerprint,initial.fingerprint);
});

test('novel chapters retain volume/POV context and legacy episodes use the shared read projection',()=>{
  const novel={...project(),format:'novel',kind:'长篇小说'};novel.scenes[0].act='第一卷';const snapshot=captureStoryBible(novel);
  assert.equal(snapshot.format,'novel');assert.equal(snapshot.coverage.episodes,0);assert.match(snapshot.entries.find(e=>e.sceneId==='s1').text,/第一卷/);assert.ok(snapshot.entries.filter(e=>e.kind==='outline').every(e=>e.episodeId===undefined));
  const legacy=project();delete legacy.episodes;delete legacy.scenes[0].episodeId;delete legacy.scenes[1].episodeId;const before=structuredClone(legacy),read=captureStoryBible(legacy);
  assert.equal(read.coverage.episodes,1);assert.equal(read.entries.find(e=>e.sceneId==='s1').episodeId,'episode_legacy_p');assert.deepEqual(legacy,before);
});

test('missing source sections are explicit and an empty snapshot validates without invented facts',()=>{
  const empty=captureStoryBible({id:'empty'});assert.deepEqual(empty.entries,[]);assert.deepEqual(empty.coverage,{outlineScenes:0,episodes:0,characters:0,worldMaterials:0,researchMaterials:0,missing:['title','logline','synopsis','theme','constraints','characters','worldMaterials','outlineScenes']});
  assert.deepEqual(validateStoryBible(empty,new Set()),empty);assert.equal('markdown' in empty,false);
});

test('derived Markdown preserves exact literal evidence in safe fences and supplies a safe filename',()=>{
  const p=project();p.title='../CON:<script>\n/危险*?';const literal='   原文\r\n```\n# 伪造标题\n<script>alert(1)</script>\n````\n最后一行  ';p.materials[0].body=literal;
  const snapshot=captureStoryBible(p),before=structuredClone(snapshot),doc=storyBibleDocument(snapshot);
  assert.equal(doc.markdown.includes(literal),true);assert.match(doc.markdown,/来源|source/i);assert.match(doc.markdown,/计划/);assert.match(doc.markdown,/参考资料.*事实|参考资料.*设定/);assert.match(doc.markdown,/已采用/);
  assert.match(doc.markdown,/`````text\n/);assert.match(doc.filename,/\.md$/);assert.doesNotMatch(doc.filename,/[\\/:*?"<>|\x00-\x1f]/);assert.ok(!doc.filename.startsWith('.'));assert.deepEqual(snapshot,before);
  const {markdown,filename,...copy}=doc;assert.deepEqual(copy,snapshot);assert.equal('markdown' in snapshot,false);
});

test('validation rejects forged imports, wrong coverage, unsupported fields, duplicate and foreign scene IDs',()=>{
  const snapshot=captureStoryBible(project()),owned=new Set(['s1','s2']);
  const tampered=structuredClone(snapshot);tampered.entries[0].text+='tampered';assert.throws(()=>validateStoryBible(tampered,owned));
  // A checksum is integrity evidence, not authorship; inert historical text can be re-signed.
  assert.doesNotThrow(()=>validateStoryBible(signed(tampered),owned));
  const invalid=[s=>s.markdown='injected',s=>s.entries[0].unknown=true,s=>s.coverage.outlineScenes=999,s=>s.coverage.missing=['characters'],s=>s.entries.push(structuredClone(s.entries[0])),s=>s.entries.find(e=>e.sceneId).sceneId='foreign',s=>s.entries[0].kind='invented',s=>s.schemaVersion=2,s=>s.title=42,s=>s.entries[0].episodeId='made-up',s=>s.coverage.characters=-1];
  for(const mutate of invalid){const forged=structuredClone(snapshot);mutate(forged);assert.throws(()=>validateStoryBible(forged,owned));assert.throws(()=>validateStoryBible(signed(forged),owned));}
  const validated=validateStoryBible(snapshot,owned);validated.entries[0].text='changed clone';assert.notEqual(validated.entries[0].text,snapshot.entries[0].text);
  assert.doesNotThrow(()=>validateStoryBible(snapshot,owned),'historical removed character/material IDs need not exist in current state');
});

test('fence rendering handles large legitimate research notes without overflowing the call stack',()=>{
  const p=project(),text='` x '.repeat(150000);p.materials[1].body=text;const snapshot=captureStoryBible(p);assert.equal(storyBibleDocument(snapshot).markdown.includes(text),true);
});

test('coverage discloses outlines with only titles or locations, even headings embedded in saved titles',()=>{
  const p={id:'p',scenes:[{id:'s',title:'概要：\n伪造标题',location:'候车室',body:'正文不能代替大纲'}]};
  const snapshot=captureStoryBible(p);assert.equal(snapshot.coverage.outlineScenes,1);assert.ok(snapshot.coverage.missing.includes('outlineDetails'));
  assert.deepEqual(validateStoryBible(snapshot,new Set(['s'])),snapshot);
  const forged=structuredClone(snapshot);forged.coverage.missing=forged.coverage.missing.filter(value=>value!=='outlineDetails');assert.throws(()=>validateStoryBible(signed(forged),new Set(['s'])));
  p.scenes[0].summary='实际故事概要\r\n保留空白  ';const complete=captureStoryBible(p);assert.ok(!complete.coverage.missing.includes('outlineDetails'));assert.ok(storyBibleDocument(complete).markdown.includes(p.scenes[0].summary));
});

test('reference text uses the literal field rendering shown in Markdown, including multiline summaries',()=>{
  const p=project(),summary='开门前的犹豫\n  保留缩进与空白  \r\n终于开门';p.scenes[0].summary=summary;
  const snapshot=captureStoryBible(p),outline=snapshot.entries.find(entry=>entry.sceneId==='s1');
  assert.ok(!outline.text.includes(summary));const reference=storyBibleReferenceText(outline);assert.ok(reference.includes(summary));assert.ok(storyBibleDocument(snapshot).markdown.includes(reference));
  const world=snapshot.entries.find(entry=>entry.kind==='world');assert.equal(storyBibleReferenceText(world),world.text);
});

test('download filenames reserve the full suffix within 240 UTF-8 bytes without splitting Unicode codepoints',()=>{
  for (const title of ['故'.repeat(80),'故'.repeat(79)+'😀','a'.repeat(221)+'😀结束','😀'.repeat(100)]) {
    const filename=storyBibleDocument(captureStoryBible({id:'p',title})).filename;
    assert.ok(Buffer.byteLength(filename,'utf8')<=240,`UTF-8 byte budget exceeded: ${Buffer.byteLength(filename,'utf8')}`);
    assert.equal(filename.isWellFormed(),true);assert.ok(filename.endsWith('-故事档案.md'));
  }
});

test('download filenames trim whitespace before removing leading dots',()=>{
  const filename=storyBibleDocument(captureStoryBible({id:'p',title:'  ...隐藏作品  '})).filename;
  assert.equal(filename,'隐藏作品-故事档案.md');
});

test('download filenames escape Windows reserved names before the first dot',()=>{
  for (const title of ['CON.txt','nul.笔记','LPT1.backup.md','COM9.']) {
    const filename=storyBibleDocument(captureStoryBible({id:'p',title})).filename;
    assert.ok(filename.startsWith('_'),filename);
  }
});

test('episodic outline follows current episode order while preserving scene order inside each episode',()=>{
  const p=project();p.episodes.reverse();
  p.scenes=[p.scenes[0],p.scenes[1],{id:'s3',episodeId:'e1',title:'第一集后场',summary:'继续调查'},{id:'s4',episodeId:'e2',title:'第二集后场',summary:'交出信件'},{id:'archived',episodeId:'e2',archived:true},{id:'foreign',projectId:'elsewhere',episodeId:'e2'}];
  const before=structuredClone(p),snapshot=captureStoryBible(p);
  assert.deepEqual(snapshot.entries.filter(entry=>entry.kind==='outline').map(entry=>entry.sceneId),['s2','s4','s1','s3']);
  assert.equal(snapshot.coverage.outlineScenes,4);assert.deepEqual(p,before);
});
