import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';

async function fixture(t, seed = false) {
  const directory = await mkdtemp(join(tmpdir(), 'screenwriter-domain-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: await createStore({ directory, seed }) };
}
async function project(store, title = '测试剧本') {
  const { result } = await store.dispatch({ type: 'project.create', title, kind: '短片', deadline: '' });
  return result.projectId;
}
async function scene(store, projectId, body = '她没有回答。') {
  const { result } = await store.dispatch({ type: 'scene.add', projectId, scene: { title: '雨夜', body } });
  return result.sceneId;
}

test('creates isolated projects and persists independent drafts on reload', async t => {
  const { store, directory } = await fixture(t);
  const a = await project(store, '甲');
  const b = await project(store, '乙');
  const aid = await scene(store, a, '甲的正文');
  const bid = await scene(store, b, '乙的正文');
  await store.dispatch({ type: 'scene.update', projectId: a, sceneId: aid, patch: { body: '甲已修改', revision: 999, id: bid } });
  await assert.rejects(store.dispatch({ type: 'scene.update', projectId: a, sceneId: bid, patch: { body: '越界' } }), /场景/);
  const reloaded = await createStore({ directory, seed: true });
  const state = await reloaded.read();
  assert.equal(state.projects.length, 2);
  assert.equal(state.projects.find(p => p.id === a).scenes[0].body, '甲已修改');
  assert.equal(state.projects.find(p => p.id === a).scenes[0].id, aid);
  assert.equal(state.projects.find(p => p.id === a).scenes[0].revision, 1);
  assert.equal(state.projects.find(p => p.id === b).scenes[0].body, '乙的正文');
  assert.equal((await stat(join(directory, 'state.json'))).mode & 0o077, 0);
});

test('scene reorder requires an exact permutation and preserves identity and prose', async t => {
  const { store } = await fixture(t);
  const id = await project(store);
  const a = await scene(store, id, '第一场');
  const b = await scene(store, id, '第二场');
  await store.dispatch({ type: 'scene.reorder', projectId: id, sceneIds: [b, a] });
  assert.deepEqual((await store.read()).projects[0].scenes.map(s => [s.id, s.body]), [[b, '第二场'], [a, '第一场']]);
  await assert.rejects(store.dispatch({ type: 'scene.reorder', projectId: id, sceneIds: [a, a] }), /顺序/);
  await store.dispatch({ type: 'scene.update', projectId: id, sceneId: a, patch: { archived: true } });
  assert.equal((await store.read()).projects[0].scenes.find(s => s.id === a).body, '第一场');
});

test('view changes merge without overwriting creative work or creative updatedAt', async t => {
  const { store } = await fixture(t);
  const id = await project(store);
  const sid = await scene(store, id);
  const before = (await store.read()).projects[0];
  await store.dispatch({ type: 'view.save', projectId: id, view: { tab: 'draft', sceneId: sid, cursor: { start: 2, end: 2 }, scrollTop: 40, body: '错误覆盖' } });
  await store.dispatch({ type: 'view.save', projectId: id, view: { inspector: 'ai' } });
  const after = (await store.read()).projects[0];
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(after.scenes[0].body, before.scenes[0].body);
  assert.equal(after.view.sceneId, sid);
  assert.equal(after.view.scrollTop, 40);
  assert.equal(after.view.inspector, 'ai');
});

test('restoring a named version retains all history and snapshots pre-restore work', async t => {
  const { store } = await fixture(t);
  const id = await project(store, '初稿');
  const sid = await scene(store, id, '旧正文');
  const { result } = await store.dispatch({ type: 'version.create', projectId: id, name: '第一稿' });
  await store.dispatch({ type: 'scene.update', projectId: id, sceneId: sid, patch: { body: '最新正文' } });
  await store.dispatch({ type: 'project.update', projectId: id, patch: { title: '新标题' } });
  await store.dispatch({ type: 'version.restore', projectId: id, versionId: result.id });
  const p = (await store.read()).projects[0];
  assert.equal(p.title, '初稿');
  assert.equal(p.scenes[0].id, sid);
  assert.equal(p.scenes[0].body, '旧正文');
  assert.equal(p.versions.length, 3);
  assert.equal(p.versions[1].snapshot.scenes[0].body, '最新正文');
  assert.equal(p.versions[2].snapshot.scenes[0].body, '旧正文');
  assert.ok(p.versions.every(v => !('versions' in v.snapshot)));
  assert.ok(p.scenes[0].revision > 1);
});

test('reference and task mutations validate project ownership and retain archived source content', async t => {
  const { store } = await fixture(t);
  const id = await project(store);
  const other = await project(store, '其他');
  const sid = await scene(store, id);
  const { result: c } = await store.dispatch({ type: 'character.upsert', projectId: id, character: { name: '江宁', status: 'adopted' } });
  await store.dispatch({ type: 'scene.update', projectId: id, sceneId: sid, patch: { cast: [c.id] } });
  await assert.rejects(store.dispatch({ type: 'scene.add', projectId: other, scene: { cast: [c.id] } }), /人物/);
  const { result: m } = await store.dispatch({ type: 'shared.add', material: { title: '采访', body: '当年大雨', source: '口述', status: 'adopted' } });
  await store.dispatch({ type: 'shared.import', projectId: id, materialId: m.id });
  await store.dispatch({ type: 'material.upsert', projectId: id, material: { ...(await store.read()).projects[0].materials[0], status: 'archived' } });
  const state = await store.read();
  assert.equal(state.sharedMaterials[0].body, '当年大雨');
  assert.equal(state.projects[0].materials[0].source, '口述');
  assert.notEqual(state.projects[0].materials[0].id, m.id);
  await assert.rejects(store.dispatch({ type: 'task.upsert', projectId: other, task: { title: '校对', sceneId: sid } }), /场景/);
  const { result: task } = await store.dispatch({ type: 'task.upsert', projectId: id, task: { title: '校对', sceneId: sid, due: '2026-12-01' } });
  await store.dispatch({ type: 'task.toggle', projectId: id, taskId: task.id });
  assert.equal((await store.read()).projects[0].tasks[0].done, true);
});

test('serial mutations never lose concurrent body, brief, and workspace changes', async t => {
  const { store } = await fixture(t);
  const id = await project(store);
  const sid = await scene(store, id);
  await Promise.all([
    store.dispatch({ type: 'scene.update', projectId: id, sceneId: sid, patch: { body: '并发正文' } }),
    store.dispatch({ type: 'project.update', projectId: id, patch: { brief: { theme: '告别' } } }),
    store.dispatch({ type: 'workspace.update', patch: { theme: 'dark' } }),
  ]);
  const state = await store.read();
  assert.equal(state.projects[0].scenes[0].body, '并发正文');
  assert.equal(state.projects[0].brief.theme, '告别');
  assert.equal(state.projects[0].brief.logline, '');
  assert.equal(state.workspace.theme, 'dark');
});

test('validates dates, kinds, action types and rejects unsafe imported structures', async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.dispatch({ type: 'project.create', title: '坏日期', deadline: '2026-02-31' }), /日期/);
  const id = await project(store);
  await assert.rejects(store.dispatch({ type: 'project.update', projectId: id, patch: { status: 'deleted' } }), /状态/);
  await assert.rejects(store.dispatch({ type: 'unknown' }), /操作/);
  await assert.rejects(store.dispatch({ type: 'project.import', project: { title: '坏备份', scenes: [{ id: 'same' }, { id: 'same' }] } }), /重复/);
  const p = (await store.read()).projects[0];
  const { result } = await store.dispatch({ type: 'project.import', project: p });
  assert.notEqual(result.projectId, id);
  assert.equal((await store.read()).projects.length, 2);
});

test('default state includes three clearly labeled realistic examples and is clone-safe', async t => {
  const { store } = await fixture(t, true);
  const state = await store.read();
  assert.equal(state.projects.length, 3);
  assert.ok(state.projects.every(p => p.sample && p.synopsis.includes('示例') && p.scenes.length && p.characters.length));
  state.projects[0].scenes[0].body = '外部突变';
  assert.notEqual((await store.read()).projects[0].scenes[0].body, '外部突变');
});

test('persists the editor scalar cursor without touching draft revision', async t => {
  const { store } = await fixture(t);
  const id = await project(store);
  const sid = await scene(store, id, '正文');
  await store.dispatch({ type: 'view.save', projectId: id, view: { sceneId: sid, cursor: 2, scrollTop: 88 } });
  assert.equal((await store.read()).projects[0].view.cursor, 2);
  assert.equal((await store.read()).projects[0].scenes[0].revision, 0);
});

test('multiple store instances serialize updates to the same data directory', async t => {
  const { store, directory } = await fixture(t);
  const id = await project(store);
  const sid = await scene(store, id, '初稿');
  const second = await createStore({ directory });
  await Promise.all([
    store.dispatch({ type: 'scene.update', projectId: id, sceneId: sid, patch: { body: '跨实例正文' } }),
    second.dispatch({ type: 'project.update', projectId: id, patch: { synopsis: '跨实例梗概' } }),
  ]);
  assert.equal((await second.read()).projects[0].scenes[0].body, '跨实例正文');
  assert.equal((await store.read()).projects[0].synopsis, '跨实例梗概');
});
