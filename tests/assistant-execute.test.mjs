import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.mjs';

const proposal = actions => ({ text: JSON.stringify({ reply: '处理所请求的内容。', actions: actions.map(action => ({ label: '执行修改', action })) }), model: 'test' });
async function fixture(t) {
  let output = { text: '她终于转身。', model: 'test' }, prompt;
  const directory = await mkdtemp(join(tmpdir(), 'screenwriter-execute-'));
  const app = await startServer({ directory, seed: false, port: 0, modelAdapter: async input => { prompt = input; return output; } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, data) => { const response = await fetch(`${app.url}${path}`, { method: data ? 'POST' : 'GET', headers: data ? { 'content-type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined }); return { status: response.status, ...(await response.json()) }; };
  const action = async value => request('/api/actions', { action: value });
  const a = (await action({ type: 'project.create', title: '雨站' })).result.projectId;
  const s = (await action({ type: 'scene.add', projectId: a, scene: { title: '站台', body: '雨停了。她还在等。' } })).result.sceneId;
  const b = (await action({ type: 'project.create', title: '另一项目' })).result.projectId;
  await action({ type: 'project.update', projectId: b, patch: { synopsis: '绝密另一项目梗概' } });
  const context = { page: 'script', projectId: a, sceneId: s };
  const activate = async (value = context) => { await action({ type: 'workspace.update', patch: value.projectId ? { screen: 'project', activeProjectId: value.projectId } : { screen: value.page } }); if (value.projectId) await action({ type: 'view.save', projectId: value.projectId, view: { tab: value.page, ...(value.sceneId ? { sceneId: value.sceneId } : {}) } }); };
  await activate();
  return { ...app, request, action, a, b, s, context, activate, output: value => { output = value; }, prompt: () => prompt, chat: (value = context, extra = {}) => request('/api/assistant', { context: value, mode: 'execute', instruction: '按要求执行', ...extra }), project: state => state.projects.find(p => p.id === a) };
}

test('execute persists validated batch without writing until apply, then writes and navigates with recovery version', async t => {
  const f = await fixture(t);
  f.output(proposal([{ type: 'project.update', projectId: f.a, patch: { brief: { theme: '等待的代价' } } }, { type: 'material.upsert', projectId: f.a, material: { title: '候车灵感', body: '空站台' } }, { type: 'scene.add', projectId: f.a, scene: { title: '离站', body: '列车穿过雨幕。' } }, { type: 'ui.navigate', page: 'scenes', projectId: f.a }]));
  const generated = await f.chat();
  assert.equal(generated.status, 200, generated.error);
  assert.equal(generated.turn.executionStatus, 'pending');
  assert.equal(f.project(generated.state).scenes.length, 1);
  assert.deepEqual(generated.assistant.capabilities, { execute: true, write: true, navigate: true });
  const user = JSON.parse(f.prompt().user);
  assert.deepEqual(user.projectIndex.find(p => p.id === f.b), { id: f.b, title: '另一项目', stage: 'idea' });
  assert.ok(!f.prompt().user.includes('绝密另一项目梗概'));
  assert.match(f.prompt().system, /scene\.write/);
  const applied = await f.request('/api/assistant/apply', { turnId: generated.turn.id });
  assert.equal(applied.status, 200, applied.error);
  const project = f.project(applied.state);
  assert.equal(project.brief.theme, '等待的代价');
  assert.equal(project.scenes[1].body, '列车穿过雨幕。');
  assert.equal(applied.state.workspace.screen, 'project');
  assert.equal(project.view.tab, 'scenes');
  assert.equal(applied.result.appliedWrites.length, 3);
  assert.equal(applied.result.appliedNavigation.length, 1);
  assert.deepEqual(applied.result.preEditVersionIds, [{ projectId: f.a, versionId: project.versions[0].id }]);
  assert.equal(project.versions[0].snapshot.scenes.length, 1);
  assert.equal(applied.turn.executionStatus, 'applied');
  assert.equal((await f.request('/api/assistant/apply', { turnId: generated.turn.id })).code, 'ALREADY_APPLIED');
});

test('execute navigation uses real known owned targets and skips navigation after author switches or opt-out', async t => {
  const f = await fixture(t);
  for (const clientOptOut of [false, true]) {
    await f.activate();
    f.output(proposal([{ type: 'scene.write', projectId: f.a, sceneId: f.s, placement: 'append', text: '她离开。' }, { type: 'ui.navigate', page: 'brief', projectId: f.b }]));
    const generated = await f.chat();
    assert.equal(generated.status, 200, generated.error);
    if (!clientOptOut) await f.activate({ page: 'tasks' });
    const applied = await f.request('/api/assistant/apply', { turnId: generated.turn.id, ...(clientOptOut ? { allowNavigation: false } : {}) });
    assert.equal(applied.status, 200, applied.error);
    assert.equal(applied.result.appliedWrites.length, 1);
    assert.equal(applied.result.appliedNavigation.length, 0);
    assert.equal(applied.result.skippedNavigation.length, 1);
    assert.equal(applied.state.workspace.screen, clientOptOut ? 'project' : 'tasks');
    assert.equal(f.project(applied.state).view.tab, 'script');
  }
  f.output(proposal([{ type: 'ui.navigate', page: 'script', projectId: f.b, sceneId: f.s }]));
  assert.ok((await f.chat()).status >= 400);
  f.output(proposal([{ type: 'ui.navigate', page: 'https://evil.example', command: 'code' }]));
  assert.equal((await f.chat()).status, 400);
});

test('execute selection keeps exact boundaries, rejects implicit whole-scene replacement and stale sources', async t => {
  const f = await fixture(t);
  const context = { ...f.context, selection: { start: 4, end: 9, text: '她还在等。' } };
  f.output(proposal([{ type: 'scene.write', projectId: f.a, sceneId: f.s, placement: 'replace', text: '不能暗中扩大' }]));
  assert.equal((await f.chat(context)).status, 400);
  f.output(proposal([{ type: 'scene.write', projectId: f.a, sceneId: f.s, placement: 'selection', text: '她走了。' }]));
  const generated = await f.chat(context);
  assert.equal(generated.status, 200, generated.error);
  const applied = await f.request('/api/assistant/apply', { turnId: generated.turn.id });
  assert.equal(applied.status, 200, applied.error);
  assert.equal(f.project(applied.state).scenes[0].body, '雨停了。她走了。');
  assert.equal(f.project(applied.state).versions[0].snapshot.scenes[0].body, '雨停了。她还在等。');
  f.output(proposal([{ type: 'scene.write', projectId: f.a, sceneId: f.s, placement: 'append', text: '新结尾' }]));
  const stale = await f.chat();
  await f.action({ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { body: '作者改过' } });
  assert.equal((await f.request('/api/assistant/apply', { turnId: stale.turn.id })).code, 'STALE_PROPOSAL');
});

test('execute rejects cross-project, malformed, archived and partial batches before any commit', async t => {
  const f = await fixture(t);
  f.output(proposal([{ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { title: '允许的资料修改' } }]));
  assert.equal((await f.chat()).status, 200);
  const invalid = [
    { type: 'project.update', projectId: f.b, patch: { title: '越项目' } },
    { type: 'scene.write', projectId: f.a, sceneId: f.s, placement: 'append', text: '正文', revision: 999 },
    { type: 'scene.write', projectId: f.a, sceneId: f.s, placement: 'selection', text: '无选区' },
    { type: 'scene.add', projectId: f.a, scene: { id: '伪造', body: '正文' } },
    { type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { body: '绕开保护' } },
    { type: 'ui.navigate', page: 'overview', projectId: f.a },
  ];
  for (const action of invalid) {
    f.output(proposal([{ type: 'project.update', projectId: f.a, patch: { title: '不能部分保存' } }, action]));
    assert.equal((await f.chat()).status, 400);
  }
  assert.equal(f.project(await f.store.read()).title, '雨站');
  await f.action({ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { archived: true } });
  f.output(proposal([{ type: 'scene.write', projectId: f.a, sceneId: f.s, placement: 'append', text: '归档不能改' }]));
  assert.equal((await f.chat()).status, 400);
});

test('execute plaintext cannot claim a completed operation and remains inspectable non-action history', async t => {
  const f = await fixture(t);
  f.output({ text: '已完成保存，并切换到正文页。', model: 'test' });
  const generated = await f.chat();
  assert.equal(generated.status, 200, generated.error);
  assert.equal(generated.turn.executionStatus, 'needs_input');
  assert.match(generated.turn.reply, /^未执行任何操作/);
  assert.equal(generated.turn.applied, false);
  assert.equal((await f.request('/api/assistant/apply', { turnId: generated.turn.id })).status, 400);
});

test('write reply saves persisted text or explicit edits to captured targets exactly once and versions the original', async t => {
  const f = await fixture(t);
  const generated = await f.chat(f.context, { mode: 'discuss' });
  assert.equal(generated.status, 200, generated.error);
  assert.ok(generated.turn.writeTargets.some(item => item.target === 'script.append'));
  await f.activate({ page: 'brief', projectId: f.b });
  const written = await f.request('/api/assistant/write', { turnId: generated.turn.id, target: 'script.append' });
  assert.equal(written.status, 200, written.error);
  assert.equal(f.project(written.state).scenes[0].body, '雨停了。她还在等。\n\n她终于转身。');
  assert.equal(written.destination.projectId, f.a);
  assert.equal(written.destination.sceneId, f.s);
  assert.equal(written.turn.write.text, generated.turn.reply);
  assert.equal(f.project(written.state).versions[0].snapshot.scenes[0].body, '雨停了。她还在等。');
  assert.deepEqual(written.preEditVersionIds, [{ projectId: f.a, versionId: f.project(written.state).versions[0].id }]);
  assert.equal(written.state.workspace.activeProjectId, f.b);
  assert.equal((await f.request('/api/assistant/write', { turnId: generated.turn.id, target: 'script.append' })).code, 'ALREADY_WRITTEN');
  const editable = await f.chat({ page: 'brief', projectId: f.a }, { mode: 'discuss' });
  const brief = await f.request('/api/assistant/write', { turnId: editable.turn.id, target: 'brief.theme', text: '经过作者编辑的主题' });
  assert.equal(brief.status, 200, brief.error);
  assert.equal(f.project(brief.state).brief.theme, '经过作者编辑的主题');
});

test('direct selection write never falls back and arbitrary target scope/fields are refused atomically', async t => {
  const f = await fixture(t);
  const context = { ...f.context, selection: { start: 4, end: 9, text: '她还在等。' } };
  const selected = await f.chat(context, { mode: 'discuss' });
  const written = await f.request('/api/assistant/write', { turnId: selected.turn.id, target: 'script.selection', text: '她走了。' });
  assert.equal(written.status, 200, written.error);
  assert.equal(f.project(written.state).scenes[0].body, '雨停了。她走了。');
  const missing = await f.chat(f.context, { mode: 'discuss' });
  assert.equal((await f.request('/api/assistant/write', { turnId: missing.turn.id, target: 'script.selection' })).status, 400);
  assert.equal((await f.request('/api/assistant/write', { turnId: missing.turn.id, target: 'script.replace', projectId: f.b })).status, 400);
  const stale = await f.chat(f.context, { mode: 'discuss' });
  await f.action({ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { body: '作者再次更改' } });
  const before = await f.store.read();
  assert.equal((await f.request('/api/assistant/write', { turnId: stale.turn.id, target: 'script.append' })).code, 'STALE_PROPOSAL');
  assert.deepEqual(await f.store.read(), before);
});

test('direct write target choices follow page focus, allow new material/scenes, and never modify archived references', async t => {
  const f = await fixture(t);
  const id = (await f.action({ type: 'character.upsert', projectId: f.a, character: { name: '她', notes: '原笔记' } })).result.id;
  const library = await f.chat({ page: 'library', projectId: f.a, focus: { kind: 'character', id } }, { mode: 'discuss' });
  assert.ok(library.turn.writeTargets.some(item => item.target === 'character.notes'));
  const written = await f.request('/api/assistant/write', { turnId: library.turn.id, target: 'character.notes' });
  assert.equal(written.status, 200, written.error);
  assert.equal(f.project(written.state).characters[0].notes, library.turn.reply);
  for (const [page, target, field] of [['library', 'material.new', 'materials'], ['scenes', 'scene.new.body', 'scenes'], ['scenes', 'scene.new.summary', 'scenes']]) {
    const generated = await f.chat({ page, projectId: f.a }, { mode: 'discuss' });
    const saved = await f.request('/api/assistant/write', { turnId: generated.turn.id, target, title: '作者指定标题' });
    assert.equal(saved.status, 200, saved.error);
    assert.equal(f.project(saved.state)[field].at(-1).title, '作者指定标题');
    assert.equal(saved.destination.projectId, f.a);
  }
  await f.action({ type: 'character.upsert', projectId: f.a, character: { id, status: 'archived' } });
  const archived = await f.chat({ page: 'library', projectId: f.a, focus: { kind: 'character', id } }, { mode: 'discuss' });
  assert.ok(!archived.turn.writeTargets.some(item => item.target === 'character.notes'));
  assert.equal((await f.request('/api/assistant/write', { turnId: archived.turn.id, target: 'character.notes' })).status, 400);
  const global = await f.chat({ page: 'overview' }, { mode: 'discuss' });
  assert.deepEqual(global.turn.writeTargets.map(item => item.target), ['shared.new']);
  const shared = await f.request('/api/assistant/write', { turnId: global.turn.id, target: 'shared.new' });
  assert.equal(shared.status, 200, shared.error);
  assert.equal(shared.state.sharedMaterials.at(-1).body, global.turn.reply);
});

test('imported execute and written conversations remain read-only through apply and write', async t => {
  const f = await fixture(t);
  f.output(proposal([{ type: 'scene.write', projectId: f.a, sceneId: f.s, placement: 'append', text: '待采用正文' }]));
  const execute = await f.chat();
  assert.equal(execute.status, 200, execute.error);
  const discussed = await f.chat(f.context, { mode: 'discuss' });
  const backup = await (await fetch(`${f.url}/api/export?projectId=${f.a}&format=json`)).json();
  const copied = await f.action({ type: 'project.import', project: backup });
  const turns = Object.values((await f.request('/api/assistant')).assistant.threads).flat().filter(turn => turn.projectId === copied.result.projectId);
  assert.equal(turns[0].mode, 'execute');
  assert.equal(turns[0].actions.length, 0);
  for (const turn of turns) {
    assert.equal(turn.readOnly, true);
    assert.deepEqual(turn.writeTargets, []);
    assert.equal((await f.request('/api/assistant/apply', { turnId: turn.id })).status, 400);
    assert.equal((await f.request('/api/assistant/write', { turnId: turn.id, target: 'script.append' })).status, 400);
  }
  assert.equal(discussed.status, 200);
});


test('execute creative writes refuse archived references and archived projects', async t => {
  const f = await fixture(t);
  const id = (await f.action({ type: 'material.upsert', projectId: f.a, material: { title: '归档素材', status: 'archived', body: '保留原文' } })).result.id;
  f.output(proposal([{ type: 'material.upsert', projectId: f.a, material: { id, body: '不能写入归档素材' } }]));
  assert.equal((await f.chat()).status, 400);
  await f.action({ type: 'project.update', projectId: f.a, patch: { status: 'archived' } });
  f.output(proposal([{ type: 'scene.add', projectId: f.a, scene: { title: '归档项目中新场', body: '不可写' } }]));
  assert.equal((await f.chat()).status, 400);
});

test('an oversized destination write retains the inspectable turn and commits neither versions nor text', async t => {
  const f = await fixture(t);
  const generated = await f.chat({ page: 'scenes', projectId: f.a }, { mode: 'discuss' });
  const before = await f.store.read();
  const rejected = await f.request('/api/assistant/write', { turnId: generated.turn.id, target: 'scene.new.summary', text: '雨'.repeat(100_001) });
  assert.equal(rejected.status, 400);
  assert.deepEqual(await f.store.read(), before);
  assert.equal((await f.request('/api/assistant')).assistant.threads[generated.turn.contextKey][0].id, generated.turn.id);
});

test('concurrent direct writes serialize once and the write record survives backup as inert history', async t => {
  const f = await fixture(t);
  const generated = await f.chat(f.context, { mode: 'discuss' });
  const requests = await Promise.all([1, 2].map(() => f.request('/api/assistant/write', { turnId: generated.turn.id, target: 'script.append' })));
  assert.deepEqual(requests.map(result => result.status).sort(), [200, 409]);
  assert.equal(f.project(await f.store.read()).versions.length, 1);
  const backup = await (await fetch(`${f.url}/api/export?projectId=${f.a}&format=json`)).json();
  const copied = await f.action({ type: 'project.import', project: backup });
  const imported = Object.values(copied.state.assistant.threads).flat().find(turn => turn.projectId === copied.result.projectId);
  assert.equal(imported.write.text, generated.turn.reply);
  assert.equal(imported.write.destination.projectId, copied.result.projectId);
  assert.equal(imported.readOnly, true);
  assert.equal((await f.request('/api/assistant/write', { turnId: imported.id, target: 'script.append' })).status, 400);
});

test('global execute project creation cannot steal the page after an author switches', async t => {
  const f = await fixture(t);
  await f.activate({ page: 'projects' });
  f.output(proposal([{ type: 'project.create', title: '新创意' }]));
  const generated = await f.chat({ page: 'projects' });
  assert.equal(generated.status, 200, generated.error);
  await f.activate({ page: 'tasks' });
  const applied = await f.request('/api/assistant/apply', { turnId: generated.turn.id });
  assert.equal(applied.status, 200, applied.error);
  assert.equal(applied.state.workspace.screen, 'tasks');
  assert.ok(applied.state.projects.some(p => p.title === '新创意'));
});

test('execute shared imports on any project page reject a changed captured shared source', async t => {
  const f = await fixture(t);
  const id = (await f.action({ type: 'shared.add', material: { title: '原始采访', body: '捕获的口述' } })).result.id;
  f.output(proposal([{ type: 'shared.import', projectId: f.a, materialId: id }]));
  const generated = await f.chat();
  assert.equal(generated.status, 200, generated.error);
  await f.action({ type: 'shared.update', materialId: id, patch: { body: '生成期间已更改口述' } });
  const before = await f.store.read();
  assert.equal((await f.request('/api/assistant/apply', { turnId: generated.turn.id })).code, 'STALE_PROPOSAL');
  assert.deepEqual(await f.store.read(), before);
});

test('global execute can create a populated new script without guessing IDs and manage cannot', async t => {
  const f = await fixture(t);
  await f.activate({ page: 'projects' });
  f.output(proposal([{ type: 'project.create', title: '新剧本', text: '她站在陌生的站台。' }]));
  const generated = await f.chat({ page: 'projects' });
  assert.equal(generated.status, 200, generated.error);
  await f.activate({ page: 'tasks' });
  const applied = await f.request('/api/assistant/apply', { turnId: generated.turn.id });
  assert.equal(applied.status, 200, applied.error);
  const project = applied.state.projects.find(p => p.title === '新剧本');
  assert.equal(project.scenes[0].body, '她站在陌生的站台。');
  assert.equal(applied.state.workspace.screen, 'tasks');
  assert.equal((await f.chat({ page: 'projects' }, { mode: 'manage' })).status, 400);
});

test('legacy rewrite adoption hides reply write targets and refuses alternate write route', async t => {
  const f = await fixture(t);
  const generated = await f.chat(f.context, { mode: 'rewrite' });
  const adopted = await f.action({ type: 'ai.apply', projectId: f.a, suggestionId: generated.turn.suggestionId });
  assert.equal(adopted.status, 200, adopted.error);
  const turn = (await f.request('/api/assistant')).assistant.threads[generated.turn.contextKey][0];
  assert.deepEqual(turn.writeTargets, []);
  assert.equal((await f.request('/api/assistant/write', { turnId: generated.turn.id, target: 'script.append' })).code, 'ALREADY_APPLIED');
});

test('writing an explicitly edited rewrite consumes its linked legacy suggestion even when body stays identical', async t => {
  const f = await fixture(t);
  const generated = await f.chat(f.context, { mode: 'rewrite' });
  const written = await f.request('/api/assistant/write', { turnId: generated.turn.id, target: 'script.replace', text: '雨停了。她还在等。' });
  assert.equal(written.status, 200, written.error);
  const legacy = await f.action({ type: 'ai.apply', projectId: f.a, suggestionId: generated.turn.suggestionId });
  assert.equal(legacy.code, 'ALREADY_APPLIED');
  assert.equal(f.project(await f.store.read()).scenes[0].body, '雨停了。她还在等。');
});

test('execute refuses creative changes to archived shared/project/scene content but permits separate status-only restores', async t => {
  const f = await fixture(t);
  const sharedId = (await f.action({ type: 'shared.add', material: { title: '归档共享', body: '原共享正文', status: 'archived' } })).result.id;
  f.output(proposal([{ type: 'shared.update', materialId: sharedId, patch: { body: '不能改归档共享' } }]));
  assert.equal((await f.chat({ page: 'shared' })).status, 400);
  f.output(proposal([{ type: 'shared.update', materialId: sharedId, patch: { status: 'adopted' } }]));
  const restoreShared = await f.chat({ page: 'shared' });
  assert.equal(restoreShared.status, 200, restoreShared.error);
  assert.equal((await f.request('/api/assistant/apply', { turnId: restoreShared.turn.id })).status, 200);
  await f.action({ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { archived: true } });
  f.output(proposal([{ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { summary: '不能改归档分场' } }]));
  assert.equal((await f.chat()).status, 400);
  await f.action({ type: 'project.update', projectId: f.a, patch: { status: 'archived' } });
  for (const patch of [{ synopsis: '不能改归档梗概' }, { brief: { theme: '不能改归档主题' } }, { status: 'active', synopsis: '不能夹带正文' }]) {
    f.output(proposal([{ type: 'project.update', projectId: f.a, patch }]));
    assert.equal((await f.chat()).status, 400);
  }
  f.output(proposal([{ type: 'project.update', projectId: f.a, patch: { status: 'active' } }]));
  const restore = await f.chat();
  assert.equal(restore.status, 200, restore.error);
  assert.equal((await f.request('/api/assistant/apply', { turnId: restore.turn.id })).status, 200);
});

test('execute revalidates each simulated step so an archive followed by a creative rewrite rejects the whole batch', async t => {
  const f = await fixture(t);
  const materialId = (await f.action({ type: 'material.upsert', projectId: f.a, material: { title: '活跃素材', body: '原文' } })).result.id;
  const sharedId = (await f.action({ type: 'shared.add', material: { title: '活跃共享', body: '共享原文' } })).result.id;
  const batches = [
    { context: f.context, actions: [{ type: 'material.upsert', projectId: f.a, material: { id: materialId, status: 'archived' } }, { type: 'material.upsert', projectId: f.a, material: { id: materialId, body: '不该保存' } }] },
    { context: f.context, actions: [{ type: 'project.update', projectId: f.a, patch: { status: 'archived' } }, { type: 'project.update', projectId: f.a, patch: { synopsis: '不该保存' } }] },
    { context: { page: 'shared' }, actions: [{ type: 'shared.update', materialId: sharedId, patch: { status: 'archived' } }, { type: 'shared.update', materialId: sharedId, patch: { body: '不该保存' } }] },
  ];
  const before = await f.store.read();
  for (const item of batches) {
    f.output(proposal(item.actions));
    assert.equal((await f.chat(item.context)).status, 400);
    assert.deepEqual(await f.store.read(), before);
  }
});

test('imported executed history retains actual readable outcomes and remapped recovery versions without executable authority', async t => {
  const f = await fixture(t);
  f.output(proposal([{ type: 'scene.write', projectId: f.a, sceneId: f.s, placement: 'append', text: '执行的真实正文' }, { type: 'ui.navigate', page: 'scenes', projectId: f.a }]));
  const generated = await f.chat();
  const applied = await f.request('/api/assistant/apply', { turnId: generated.turn.id, allowNavigation: false });
  assert.equal(applied.status, 200, applied.error);
  const backup = await (await fetch(`${f.url}/api/export?projectId=${f.a}&format=json`)).json();
  const copied = await f.action({ type: 'project.import', project: backup });
  const copiedId = copied.result.projectId;
  const imported = Object.values(copied.state.assistant.threads).flat().find(turn => turn.projectId === copiedId);
  assert.equal(imported.appliedOutcome.appliedWrites[0].action.text, '执行的真实正文');
  assert.equal(imported.appliedOutcome.appliedWrites[0].action.projectId, copiedId);
  assert.equal(imported.appliedOutcome.skippedNavigation[0].projectId, copiedId);
  assert.deepEqual(imported.preEditVersionIds, applied.turn.preEditVersionIds.map(item => ({ ...item, projectId: copiedId })));
  assert.deepEqual(imported.appliedOutcome.preEditVersionIds, imported.preEditVersionIds);
  assert.equal(imported.readOnly, true);
  assert.deepEqual(imported.actions, []);
  assert.deepEqual(imported.writeTargets, []);
  assert.equal((await f.request('/api/assistant/apply', { turnId: imported.id })).status, 400);
});

test('explicit selection scope without a captured selection refuses body writes rather than replacing the whole scene', async t => {
  const f = await fixture(t);
  const before = await f.store.read();
  for (const placement of ['replace', 'append']) {
    f.output(proposal([{ type: 'scene.write', projectId: f.a, sceneId: f.s, placement, text: '选区绝不能丢失后扩大写入' }]));
    const generated = await f.chat(f.context, { scope: 'selection' });
    assert.equal(generated.status, 400);
    assert.deepEqual(await f.store.read(), before);
  }
  f.output(proposal([{ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { title: '允许的资料更新' } }]));
  assert.equal((await f.chat(f.context, { scope: 'selection' })).status, 200);
  const selected = { ...f.context, selection: { start: 4, end: 9, text: '她还在等。' } };
  f.output(proposal([{ type: 'scene.write', projectId: f.a, sceneId: f.s, placement: 'replace', text: '不能越过所选范围' }]));
  assert.equal((await f.chat(selected, { scope: 'selection' })).status, 400);
});
