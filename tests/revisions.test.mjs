import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer, createStore } from '../server/index.mjs';

const body = '前言。\n\n雨停了。\n\n她还在等。\n\n尾声。';
const selection = (text, source = body) => ({ start: source.indexOf(text), end: source.indexOf(text) + text.length, text });
const output = changes => ({ text: JSON.stringify({ changes }), model: 'test-model' });
const defaultAdapter = async ({ user }) => output(JSON.parse(user).notes.map(note => ({ noteId: note.noteId, text: `改写：${note.text}` })));
async function fixture(t, adapter = defaultAdapter) {
  const directory = await mkdtemp(join(tmpdir(), 'screenwriter-revisions-'));
  const app = await startServer({ directory, seed: false, port: 0, modelAdapter: adapter });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, data) => {
    const response = await fetch(`${app.url}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, ...(await response.json()) };
  };
  const action = async action => request('/api/actions', { action });
  const a = (await action({ type: 'project.create', title: '雨站' })).result.projectId;
  const s = (await action({ type: 'scene.add', projectId: a, scene: { title: '站台', body } })).result.sceneId;
  const s2 = (await action({ type: 'scene.add', projectId: a, scene: { title: '归家', body: '门开了。她没有回头。' } })).result.sceneId;
  const b = (await action({ type: 'project.create', title: '绝密另项目' })).result.projectId;
  const foreign = (await action({ type: 'scene.add', projectId: b, scene: { body: '另一项目秘密正文' } })).result.sceneId;
  const note = (text, extra = {}) => request('/api/revisions/notes', { projectId: a, operation: 'add', sceneId: s, selection: selection(text), instruction: '用动作表达情绪', ...extra });
  const generate = (noteIds, extra = {}) => request('/api/revisions/generate', { projectId: a, noteIds, ...extra });
  const apply = (batch, ids = batch.changes.map(change => change.id), extra = {}) => request('/api/revisions/apply', { projectId: a, batchId: batch.id, changeIds: ids, ...extra });
  const state = async () => (await request('/api/state')).state;
  return { ...app, request, action, directory, a, b, s, s2, foreign, note, generate, apply, state };
}
function project(state, id) { return state.projects.find(item => item.id === id); }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('offline notes preserve exact prose, support CRUD and reopen, and capabilities never write old state', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; throw Error('offline'); });
  const saved = await readFile(join(f.directory, 'state.json'), 'utf8');
  assert.deepEqual((await f.request('/api/revisions')).capabilities, { notes: true, generate: true, apply: true });
  assert.equal(await readFile(join(f.directory, 'state.json'), 'utf8'), saved);
  const added = await f.note('雨停了。');
  assert.equal(added.status, 200, added.error);
  assert.equal(added.note.version, 1);
  assert.equal(added.note.status, 'open');
  assert.equal(added.note.sourceRevision, 0);
  assert.match(added.note.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(project(added.state, f.a).scenes[0].body, body);
  assert.equal(project(added.state, f.a).versions.length, 0);
  const updated = await f.request('/api/revisions/notes', { projectId: f.a, operation: 'update', noteId: added.note.id, instruction: '保留停顿，不解释' });
  assert.equal(updated.note.version, 2);
  const anchored = await f.request('/api/revisions/notes', { projectId: f.a, operation: 'reanchor', noteId: added.note.id, selection: selection('她还在等。') });
  assert.equal(anchored.note.version, 3);
  assert.deepEqual(anchored.note.selection, selection('她还在等。'));
  const reopened = await createStore({ directory: f.directory });
  assert.deepEqual(project(await reopened.read(), f.a).revisionNotes, [anchored.note]);
  assert.equal((await f.request('/api/revisions/notes', { projectId: f.a, operation: 'remove', noteId: added.note.id })).status, 200);
  assert.deepEqual(project(await f.state(), f.a).revisionNotes, []);
  assert.equal(project(await f.state(), f.a).scenes[0].body, body);
  assert.equal(calls, 0);
});

test('notes strictly reject forged fields, invalid ranges and foreign ownership without mutation', async t => {
  const f = await fixture(t);
  const n = (await f.note('雨停了。')).note;
  assert.ok(n);
  const before = await f.state();
  for (const patch of [
    { selection: { start: 0, end: 0, text: '' } }, { selection: { start: 0, end: 3, text: '伪造' } },
    { selection: { ...selection('雨停了。'), sourceRevision: 0 } }, { sceneId: f.foreign },
    { instruction: '' }, { instruction: 1 }, { noteId: n.id }, { extra: true }, { projectId: null },
  ]) assert.equal((await f.note('雨停了。', patch)).status, patch.sceneId ? 404 : 400);
  for (const payload of [
    { operation: 'update', noteId: n.id, instruction: '改', selection: selection('雨停了。') },
    { operation: 'reanchor', noteId: n.id, sceneId: f.s2, selection: { start: 0, end: 4, text: '门开了。' } },
    { operation: 'remove', noteId: false }, { operation: 'remove', noteId: 'missing' },
    { operation: 'update', projectId: f.b, noteId: n.id, instruction: '越权' },
  ]) assert.ok((await f.request('/api/revisions/notes', { projectId: f.a, ...payload })).status >= 400);
  assert.deepEqual(await f.state(), before);
});

test('one project batch includes two complete selected paragraphs, adopted context, persona and captured host model', async t => {
  let prompt, current = { provider: 'host', model: 'writer-a' };
  const adapter = async input => { prompt = input; return defaultAdapter(input); };
  adapter.defaultSelection = () => ({ ...current });
  adapter.resolveSelection = async value => ({ ...value });
  const f = await fixture(t, adapter);
  await f.action({ type: 'material.upsert', projectId: f.a, material: { title: '采用线索', body: '已采用的红伞' } });
  await f.action({ type: 'material.upsert', projectId: f.a, material: { title: '备选线索', body: '未采用的蓝伞', status: 'alternative' } });
  await f.request('/api/assistant/config', { roleId: 'writer', projectId: f.a, profile: { name: '本项目编剧', personality: '保留动作和留白', skillIds: ['dialogue'] } });
  const first = (await f.note('雨停了。', { instruction: '完整意见一' })).note;
  const second = (await f.note('', { sceneId: f.s2, selection: { start: 0, end: 4, text: '门开了。' }, instruction: '完整意见二' })).note;
  const generated = await f.generate([first.id, second.id]);
  assert.equal(generated.status, 200, generated.error);
  const data = JSON.parse(prompt.user);
  assert.deepEqual(data.notes.map(item => item.text), ['雨停了。', '门开了。']);
  assert.deepEqual(data.notes.map(item => item.instruction), ['完整意见一', '完整意见二']);
  assert.match(prompt.user, /已采用的红伞/);
  assert.doesNotMatch(prompt.user, /未采用的蓝伞|另一项目秘密正文|绝密另项目/);
  assert.match(prompt.system, /本项目编剧|保留动作和留白/);
  assert.deepEqual(prompt.modelSelection, { provider: 'host', model: 'writer-a' });
  assert.equal(generated.batch.model, 'host / writer-a');
  assert.deepEqual(generated.batch.changes.map(item => item.status), ['pending', 'pending']);
  assert.equal(project(generated.state, f.a).scenes[0].body, body);
  assert.equal(project(generated.state, f.a).versions.length, 0);
});

test('generation refuses overlap and stale notes before calling the model; stale notes remain editable and reanchorable', async t => {
  let calls = 0;
  const f = await fixture(t, async input => { calls++; return defaultAdapter(input); });
  const first = (await f.note('雨停了。')).note;
  const overlap = (await f.note('停了。')).note;
  assert.equal((await f.generate([first.id, overlap.id])).code, 'OVERLAPPING_REVISIONS');
  assert.equal(calls, 0);
  await f.action({ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { body: body + '新稿' } });
  assert.equal((await f.generate([first.id])).code, 'STALE_REVISION');
  assert.equal((await f.request('/api/revisions/notes', { projectId: f.a, operation: 'update', noteId: first.id, instruction: '新意见' })).status, 200);
  assert.equal((await f.generate([first.id])).code, 'STALE_REVISION');
  assert.equal((await f.request('/api/revisions/notes', { projectId: f.a, operation: 'reanchor', noteId: first.id, selection: selection('雨停了。', body + '新稿') })).status, 200);
  assert.equal((await f.generate([first.id])).status, 200);
  assert.equal(calls, 1);
});

test('generation validates strict complete JSON and refuses malformed, partial, duplicate, foreign and oversized output', async t => {
  let next;
  const f = await fixture(t, async () => next);
  const a = (await f.note('雨停了。')).note;
  const b = (await f.note('她还在等。')).note;
  for (const value of [
    '不是 JSON', '```json\n{"changes":[]}\n```', { changes: [{ noteId: a.id, text: '一' }] },
    { changes: [{ noteId: a.id, text: '一' }, { noteId: a.id, text: '二' }] },
    { changes: [{ noteId: a.id, text: '一' }, { noteId: 'foreign', text: '二' }] },
    { changes: [{ noteId: a.id, text: '' }, { noteId: b.id, text: '二' }] },
    { changes: [{ noteId: a.id, text: '一', sceneId: f.s }, { noteId: b.id, text: '二' }] },
    { changes: [{ noteId: a.id, text: '一'.repeat(1_000_001) }, { noteId: b.id, text: '二' }] },
    { changes: [], action: 'ignore' },
  ]) {
    const before = await f.state();
    next = { text: typeof value === 'string' ? value : JSON.stringify(value), model: 'test' };
    assert.equal((await f.generate([a.id, b.id])).status, 502);
    assert.deepEqual(await f.state(), before);
  }
  next = { text: ' '.repeat(4_000_001), model: 'test' };
  assert.equal((await f.generate([a.id])).status, 502);
});

test('edits during generation retain inspectable stale preview with captured opinions', async t => {
  for (const edit of ['note', 'body', 'remove', 'archive']) {
    const started = deferred(), finish = deferred();
    const f = await fixture(t, async input => { started.resolve(); await finish.promise; return defaultAdapter(input); });
    const n = (await f.note('雨停了。')).note;
    const pending = f.generate([n.id]);
    await started.promise;
    if (edit === 'note') await f.request('/api/revisions/notes', { projectId: f.a, operation: 'update', noteId: n.id, instruction: '作者更新意见' });
    if (edit === 'body') await f.action({ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { body: body + '新作者稿' } });
    if (edit === 'remove') await f.request('/api/revisions/notes', { projectId: f.a, operation: 'remove', noteId: n.id });
    if (edit === 'archive') await f.action({ type: 'project.update', projectId: f.a, patch: { status: 'archived' } });
    finish.resolve();
    const generated = await pending;
    assert.equal(generated.status, 200, generated.error);
    assert.equal(generated.batch.changes[0].status, 'stale');
    assert.equal(generated.batch.changes[0].instruction, n.instruction);
    assert.equal(generated.batch.changes[0].selection.text, n.selection.text);
    assert.equal(project(generated.state, f.a).scenes[0].body, edit === 'body' ? body + '新作者稿' : body);
  }
});

test('single adoption rebases later exact ranges with changed lengths and retains one recovery version per transaction', async t => {
  const f = await fixture(t, async ({ user }) => output(JSON.parse(user).notes.map((note, index) => ({ noteId: note.noteId, text: index ? '她走。' : '雨终于彻底停住了。' }))));
  const a = (await f.note('雨停了。')).note;
  const b = (await f.note('她还在等。')).note;
  const untouched = project(await f.state(), f.b);
  const workspace = (await f.state()).workspace;
  const generated = await f.generate([a.id, b.id]);
  const first = await f.apply(generated.batch, [generated.batch.changes[0].id]);
  assert.equal(first.status, 200, first.error);
  const p = project(first.state, f.a);
  const firstBody = body.replace('雨停了。', '雨终于彻底停住了。');
  assert.equal(p.scenes[0].body, firstBody);
  assert.deepEqual(p.revisionNotes[1].selection, selection('她还在等。', firstBody));
  assert.equal(p.revisionNotes[1].sourceRevision, 1);
  assert.equal(p.revisionNotes[1].version, 1);
  assert.equal(p.revisionBatches[0].changes[1].status, 'pending');
  assert.deepEqual(p.revisionBatches[0].changes[1].selection, selection('她还在等。', firstBody));
  assert.equal(first.result.preEditVersionIds.length, 1);
  assert.equal(p.versions[0].snapshot.scenes[0].body, body);
  assert.ok(!Object.hasOwn(p.versions[0].snapshot, 'revisionNotes'));
  const second = await f.apply(generated.batch, [generated.batch.changes[1].id]);
  assert.equal(second.status, 200, second.error);
  assert.equal(project(second.state, f.a).scenes[0].body, firstBody.replace('她还在等。', '她走。'));
  assert.equal(project(second.state, f.a).versions[1].snapshot.scenes[0].body, firstBody);
  assert.equal(project(second.state, f.a).revisionBatches[0].preEditVersionIds.length, 2);
  assert.deepEqual(project(second.state, f.b), untouched);
  assert.deepEqual(second.state.workspace, workspace);
});

test('selected multi-scene adoption preserves surroundings and creates one project recovery version', async t => {
  const f = await fixture(t);
  const a = (await f.note('雨停了。')).note;
  const b = (await f.note('', { sceneId: f.s2, selection: { start: 0, end: 4, text: '门开了。' } })).note;
  const generated = await f.generate([a.id, b.id]);
  const applied = await f.apply(generated.batch);
  assert.equal(applied.status, 200, applied.error);
  const p = project(applied.state, f.a);
  assert.equal(p.scenes[0].body, body.replace('雨停了。', '改写：雨停了。'));
  assert.equal(p.scenes[1].body, '改写：门开了。她没有回头。');
  assert.equal(p.versions.length, 1);
  assert.deepEqual(applied.result.sceneIds, [f.s, f.s2]);
  assert.deepEqual(applied.result.appliedChangeIds, generated.batch.changes.map(item => item.id));
  assert.ok(p.revisionNotes.every(item => item.status === 'applied'));
});

test('adoption invalidates overlapping previews while rebasing independent batches', async t => {
  const f = await fixture(t);
  const a = (await f.note('雨停了。')).note;
  const overlap = (await f.note('停了。')).note;
  const later = (await f.note('她还在等。')).note;
  const first = (await f.generate([a.id])).batch;
  const conflicting = (await f.generate([overlap.id])).batch;
  const remaining = (await f.generate([later.id])).batch;
  assert.equal((await f.apply(first)).status, 200);
  const current = project(await f.state(), f.a);
  assert.equal(current.revisionBatches.find(item => item.id === conflicting.id).changes[0].status, 'stale');
  const before = await f.state();
  assert.equal((await f.apply(conflicting)).code, 'STALE_REVISION');
  assert.deepEqual(await f.state(), before);
  assert.equal((await f.generate([overlap.id])).code, 'STALE_REVISION');
  assert.equal((await f.apply(remaining)).status, 200);
});

test('stale or edited mixed batches fail atomically and repeated/concurrent adoption commits once', async t => {
  const f = await fixture(t);
  const a = (await f.note('雨停了。')).note;
  const b = (await f.note('她还在等。')).note;
  const batch = (await f.generate([a.id, b.id])).batch;
  await f.request('/api/revisions/notes', { projectId: f.a, operation: 'update', noteId: b.id, instruction: '较新意见' });
  const before = await f.state();
  assert.equal((await f.apply(batch)).code, 'STALE_REVISION');
  assert.deepEqual(await f.state(), before);
  const good = (await f.generate([a.id])).batch;
  const results = await Promise.all([f.apply(good), f.apply(good)]);
  assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
  const after = await f.state();
  assert.equal(project(after, f.a).versions.length, 1);
  assert.equal((await f.apply(good)).code, 'ALREADY_APPLIED');
  assert.deepEqual(await f.state(), after);
});

test('generation and adoption reject empty, duplicate, missing, foreign and unknown request fields', async t => {
  const f = await fixture(t);
  const n = (await f.note('雨停了。')).note;
  const batch = (await f.generate([n.id])).batch;
  const before = await f.state();
  for (const extra of [{ noteIds: [] }, { noteIds: [n.id, n.id] }, { noteIds: [null] }, { noteIds: ['missing'] }, { projectId: f.b }, { unexpected: true }, { modelSelection: { provider: 'p', model: 'm', apiKey: 'fake' } }]) assert.ok((await f.generate([n.id], extra)).status >= 400);
  for (const extra of [{ changeIds: [] }, { changeIds: [batch.changes[0].id, batch.changes[0].id] }, { changeIds: [false] }, { changeIds: ['missing'] }, { batchId: 'missing' }, { projectId: f.b }, { preEditVersionIds: [] }]) assert.ok((await f.apply(batch, undefined, extra)).status >= 400);
  assert.deepEqual(await f.state(), before);
});

test('archived projects and scenes refuse note writes, generation and adoption without a recovery version', async t => {
  for (const archive of ['project', 'scene']) {
    const f = await fixture(t);
    const n = (await f.note('雨停了。')).note;
    const batch = (await f.generate([n.id])).batch;
    await f.action(archive === 'project' ? { type: 'project.update', projectId: f.a, patch: { status: 'archived' } } : { type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { archived: true } });
    const before = await f.state();
    assert.ok((await f.note('雨停了。')).status >= 400);
    for (const operation of ['update', 'remove', 'reanchor']) assert.ok((await f.request('/api/revisions/notes', { projectId: f.a, operation, noteId: n.id, ...(operation === 'update' ? { instruction: '改' } : operation === 'reanchor' ? { selection: selection('雨停了。') } : {}) })).status >= 400);
    assert.ok((await f.generate([n.id])).status >= 400);
    assert.ok((await f.apply(batch)).status >= 400);
    assert.deepEqual(await f.state(), before);
  }
});

test('JSON backup preserves stale notes and inert remapped previews while named versions stay screenplay-only', async t => {
  const f = await fixture(t);
  const n = (await f.note('雨停了。')).note;
  const batch = (await f.generate([n.id])).batch;
  await f.action({ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { body: '完全不同的新正文' } });
  const response = await fetch(`${f.url}/api/export?projectId=${f.a}&format=json`);
  const backup = await response.json();
  const imported = await f.action({ type: 'project.import', project: backup });
  assert.equal(imported.status, 200, imported.error);
  const p = project(imported.state, imported.result.projectId);
  assert.equal(p.revisionNotes[0].selection.text, '雨停了。');
  assert.equal(p.revisionNotes[0].instruction, n.instruction);
  assert.notEqual(p.revisionNotes[0].id, n.id);
  assert.equal(p.revisionBatches[0].readOnly, true);
  assert.equal(p.revisionBatches[0].changes[0].noteId, p.revisionNotes[0].id);
  assert.equal((await f.apply(p.revisionBatches[0], undefined, { projectId: p.id })).code, 'READ_ONLY_REVISION');
  // A backup cannot opt back into executable status by forging readOnly or current source metadata.
  backup.revisionBatches[0].readOnly = false;
  const forged = await f.action({ type: 'project.import', project: backup });
  const forgedProject = project(forged.state, forged.result.projectId);
  assert.equal((await f.apply(forgedProject.revisionBatches[0], undefined, { projectId: forgedProject.id })).code, 'READ_ONLY_REVISION');
  const version = await f.action({ type: 'version.create', projectId: f.a, name: '仅剧本' });
  const named = await (await fetch(`${f.url}/api/export?projectId=${f.a}&format=json&versionId=${version.result.id}`)).json();
  assert.ok(!Object.hasOwn(named, 'revisionNotes'));
  assert.ok(!Object.hasOwn(named, 'revisionBatches'));
  const restored = await f.action({ type: 'version.restore', projectId: f.a, versionId: version.result.id });
  assert.equal(project(restored.state, f.a).revisionNotes[0].selection.text, '雨停了。');
  assert.equal((await f.apply(batch)).code, 'STALE_REVISION');
});

test('project import rejects malformed revision ownership and fields atomically and accepts older backups', async t => {
  const f = await fixture(t);
  const n = (await f.note('雨停了。')).note;
  await f.generate([n.id]);
  const backup = structuredClone(project(await f.state(), f.a));
  for (const mutate of [
    p => { p.revisionNotes = {}; }, p => { p.revisionNotes = null; }, p => { p.revisionBatches = null; }, p => { p.revisionNotes[0].sceneId = f.foreign; },
    p => { p.revisionNotes[0].version = -1; }, p => { p.revisionNotes[0].selection.end = p.revisionNotes[0].selection.start; },
    p => { p.revisionNotes[0].sourceHash = 'forged'; }, p => { p.revisionNotes[0].status = 'stale'; },
    p => { p.revisionBatches[0].changes[0].noteId = 'foreign'; }, p => { p.revisionBatches[0].changes[0].sceneId = f.foreign; },
    p => { p.revisionBatches[0].changes[0].noteVersion = false; }, p => { p.revisionBatches[0].changes[0].replacement = ''; },
    p => { p.revisionBatches[0].changes[0].unexpected = true; },
  ]) {
    const broken = structuredClone(backup); mutate(broken);
    const before = await f.state();
    assert.equal((await f.action({ type: 'project.import', project: broken })).status, 400);
    assert.deepEqual(await f.state(), before);
  }
  delete backup.revisionNotes; delete backup.revisionBatches;
  assert.equal((await f.action({ type: 'project.import', project: backup })).status, 200);
});

test('complete selected opinions are never truncated and input budget rejects before calling model', async t => {
  let calls = 0, prompt;
  const f = await fixture(t, async input => { calls++; prompt = input; return defaultAdapter(input); });
  const long = '长'.repeat(12_000) + '完整尾部';
  await f.action({ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { body: long } });
  const n = (await f.note('', { selection: { start: 0, end: long.length, text: long }, instruction: '请完整处理结尾意见' })).note;
  assert.equal((await f.generate([n.id])).status, 200);
  assert.equal(JSON.parse(prompt.user).notes[0].text, long);
  const huge = '巨'.repeat(130_000);
  await f.action({ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { body: huge } });
  const big = (await f.note('', { selection: { start: 0, end: huge.length, text: huge } })).note;
  assert.equal((await f.generate([big.id])).code, 'REVISION_CONTEXT_TOO_LARGE');
  assert.equal(calls, 1);
});

test('removed notes and scenes absent after restoration keep recoverable history through JSON roundtrip', async t => {
  const f = await fixture(t);
  const baseVersion = await f.action({ type: 'version.create', projectId: f.a, name: '增加场景前' });
  const lateScene = (await f.action({ type: 'scene.add', projectId: f.a, scene: { title: '后来新增', body: '后来正文。' } })).result.sceneId;
  const removed = (await f.note('雨停了。')).note;
  const late = (await f.note('', { sceneId: lateScene, selection: { start: 0, end: 5, text: '后来正文。' } })).note;
  await f.generate([removed.id, late.id]);
  await f.request('/api/revisions/notes', { projectId: f.a, operation: 'remove', noteId: removed.id });
  await f.action({ type: 'version.restore', projectId: f.a, versionId: baseVersion.result.id });
  const backup = await (await fetch(`${f.url}/api/export?projectId=${f.a}&format=json`)).json();
  const imported = await f.action({ type: 'project.import', project: backup });
  assert.equal(imported.status, 200, imported.error);
  const p = project(imported.state, imported.result.projectId);
  assert.equal(p.revisionNotes[0].sceneId, lateScene);
  assert.equal(p.revisionNotes[0].selection.text, '后来正文。');
  assert.equal(p.revisionBatches[0].changes.length, 2);
  assert.equal(p.revisionBatches[0].changes[0].instruction, removed.instruction);
});

test('saved opinions preserve intentional whitespace and imported current notes can generate new live previews', async t => {
  const f = await fixture(t);
  const opinion = '  保留首尾空白\n\n';
  const n = await f.note('雨停了。', { instruction: opinion });
  assert.equal(n.note.instruction, opinion);
  const backup = project(await f.state(), f.a);
  const imported = await f.action({ type: 'project.import', project: backup });
  assert.equal(imported.status, 200, imported.error);
  const p = project(imported.state, imported.result.projectId);
  const generated = await f.generate([p.revisionNotes[0].id], { projectId: p.id });
  assert.equal(generated.status, 200, generated.error);
  assert.equal(generated.batch.changes[0].instruction, opinion);
  assert.equal((await f.apply(generated.batch, undefined, { projectId: p.id })).status, 200);
});

test('adoption refuses combined oversized prose atomically and provider aborts leave no preview', async t => {
  let abort = false;
  const f = await fixture(t, async ({ user, signal }) => {
    assert.equal(signal.aborted, false);
    if (abort) { const error = new Error('provider abort'); error.name = 'AbortError'; throw error; }
    return output(JSON.parse(user).notes.map(note => ({ noteId: note.noteId, text: '改'.repeat(600_000) })));
  });
  const a = (await f.note('雨停了。')).note;
  const b = (await f.note('她还在等。')).note;
  const generated = await f.generate([a.id, b.id]);
  assert.equal(generated.status, 200, generated.error);
  const before = await f.state();
  assert.equal((await f.apply(generated.batch)).status, 400);
  assert.deepEqual(await f.state(), before);
  abort = true;
  assert.equal((await f.generate([a.id])).code, 'AI_TIMEOUT');
  assert.deepEqual(await f.state(), before);
});

test('two descending adoptions in one scene rebase an untouched middle opinion and preserve imported recovery references', async t => {
  const f = await fixture(t, async ({ user }) => output(JSON.parse(user).notes.map(note => ({ noteId: note.noteId, text: note.text === '前言。' ? '开。' : note.text === '尾声。' ? '这是更长的结尾。' : '她走了。' }))));
  const a = (await f.note('前言。')).note;
  const b = (await f.note('她还在等。')).note;
  const c = (await f.note('尾声。')).note;
  const batch = (await f.generate([a.id, b.id, c.id])).batch;
  const first = await f.apply(batch, [batch.changes[0].id, batch.changes[2].id]);
  assert.equal(first.status, 200, first.error);
  assert.equal(project(first.state, f.a).scenes[0].body, body.replace('前言。', '开。').replace('尾声。', '这是更长的结尾。'));
  assert.equal((await f.apply(batch, [batch.changes[1].id])).status, 200);
  const backup = await (await fetch(`${f.url}/api/export?projectId=${f.a}&format=json`)).json();
  const imported = await f.action({ type: 'project.import', project: backup });
  assert.equal(imported.status, 200, imported.error);
  const copy = project(imported.state, imported.result.projectId);
  assert.equal(copy.revisionBatches[0].preEditVersionIds.length, 2);
  assert.ok(copy.revisionBatches[0].preEditVersionIds.every(ref => ref.projectId === copy.id && copy.versions.some(version => version.id === ref.versionId)));
});

test('maximum-length host provider and model identifiers survive saved batch full-project roundtrip', async t => {
  const chosen = { provider: 'p'.repeat(300), model: 'm'.repeat(300) };
  const adapter = async input => defaultAdapter(input);
  adapter.defaultSelection = () => ({ ...chosen });
  adapter.resolveSelection = async value => ({ ...value });
  const f = await fixture(t, adapter);
  const note = (await f.note('雨停了。')).note;
  const generated = await f.generate([note.id]);
  assert.equal(generated.status, 200, generated.error);
  assert.equal(generated.batch.model, `${chosen.provider} / ${chosen.model}`);
  assert.equal(generated.batch.model.length, 603);
  const backup = await (await fetch(`${f.url}/api/export?projectId=${f.a}&format=json`)).json();
  const imported = await f.action({ type: 'project.import', project: backup });
  assert.equal(imported.status, 200, imported.error);
  const copy = project(imported.state, imported.result.projectId);
  assert.equal(copy.revisionBatches[0].model, generated.batch.model);
  assert.equal(copy.revisionBatches[0].readOnly, true);
});
