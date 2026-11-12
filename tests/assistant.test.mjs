import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.mjs';

async function fixture(t, adapter = async () => ({ text: '先确定人物要付出的代价。', model: 'test' })) {
  const directory = await mkdtemp(join(tmpdir(), 'screenwriter-assistant-'));
  const app = await startServer({ directory, seed: false, port: 0, modelAdapter: adapter });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, data) => {
    const response = await fetch(`${app.url}${path}`, { method: data ? 'POST' : 'GET', headers: data ? { 'content-type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, ...(await response.json()) };
  };
  const action = async action => request('/api/actions', { action });
  const a = (await action({ type: 'project.create', title: '雨站' })).result.projectId;
  const s = (await action({ type: 'scene.add', projectId: a, scene: { title: '站台', body: '雨停了。她还在等。' } })).result.sceneId;
  const b = (await action({ type: 'project.create', title: '另一项目' })).result.projectId;
  await action({ type: 'project.update', projectId: b, patch: { synopsis: '绝密另一项目梗概' } });
  return { ...app, directory, request, action, a, b, s, chat: (context, extra = {}) => request('/api/assistant', { context, mode: 'discuss', instruction: '请建议下一步', ...extra }) };
}
const proposal = actions => ({ text: JSON.stringify({ reply: '请核对后采用。', actions: actions.map(action => ({ label: '建议修改', action })) }), model: 'test' });

test('old state reads defaults without GET writing, and each page resolves its server-owned role', async t => {
  const f = await fixture(t);
  const before = await readFile(join(f.directory, 'state.json'), 'utf8');
  const config = await f.request('/api/assistant');
  assert.equal(config.status, 200);
  assert.equal(config.assistant.roles.length, 12);
  assert.equal(config.assistant.skills.filter(s => s.builtin).length, 13);
  assert.equal(await readFile(join(f.directory, 'state.json'), 'utf8'), before);
  for (const [page, role] of Object.entries({ overview: 'manager', projects: 'manager', tasks: 'manager', shared: 'librarian', brief: 'story', library: 'character', scenes: 'structure', script: 'writer' })) {
    const context = { page, ...(['brief', 'library', 'scenes', 'script'].includes(page) ? { projectId: f.a } : {}), ...(page === 'script' ? { sceneId: f.s } : {}) };
    const result = await f.chat(context);
    assert.equal(result.status, 200, result.error);
    assert.equal(result.turn.roleId, role);
    assert.equal(result.turn.contextKey, JSON.stringify([page, context.projectId || null, context.sceneId || null, null, null]));
  }
});

test('text skill and role overrides persist, enter prompts, reset, and stay separate from credentials', async t => {
  let prompt;
  const f = await fixture(t, async input => { prompt = input; return { text: '好的', model: 'test' }; });
  const markdown = '---\nname: 留白写作\ndescription: 让动作承担情绪\n---\n不要替人物解释情绪。只建议可拍摄动作。';
  const imported = await f.request('/api/assistant/skills', { markdown });
  assert.equal(imported.status, 200);
  assert.equal(imported.skill.name, '留白写作');
  assert.equal(imported.skill.content, markdown);
  const profile = { name: '冷静的编剧', personality: '每次先问人物代价', skillIds: [imported.skill.id] };
  assert.equal((await f.request('/api/assistant/config', { roleId: 'writer', projectId: null, profile })).status, 200);
  await f.request('/api/assistant/config', { roleId: 'writer', projectId: f.a, profile: { ...profile, name: '雨站编剧' } });
  await f.request('/api/settings', { baseUrl: 'https://example.com/v1', model: 'model', apiKey: 'PRIVATE-KEY-DO-NOT-LEAK' });
  await f.chat({ page: 'script', projectId: f.a, sceneId: f.s });
  assert.match(prompt.system, /雨站编剧/);
  assert.match(prompt.system, /每次先问人物代价/);
  assert.match(prompt.system, /只建议可拍摄动作/);
  const config = await f.request('/api/assistant');
  assert.equal(config.assistant.profiles.projects[f.a].writer.name, '雨站编剧');
  assert.ok(!JSON.stringify(config).includes('PRIVATE-KEY'));
  assert.ok(!JSON.stringify(prompt).includes('PRIVATE-KEY'));
  await f.request('/api/assistant/config', { roleId: 'writer', projectId: f.a, profile: null });
  await f.chat({ page: 'script', projectId: f.a, sceneId: f.s });
  assert.match(prompt.system, /冷静的编剧/);
  for (const body of [{ roleId: 'unknown', projectId: null, profile }, { roleId: 'writer', projectId: f.b, profile: { ...profile, skillIds: ['fake'] } }, { roleId: 'writer', projectId: null, profile: { ...profile, id: 'spoof' } }]) assert.equal((await f.request('/api/assistant/config', body)).status, 400);
});

test('follow-up history is exact-context scoped and project pages never leak other project content', async t => {
  const prompts = [];
  const f = await fixture(t, async input => { prompts.push(input); return { text: '第一回合答复', model: 'test' }; });
  const context = { page: 'brief', projectId: f.a };
  await f.chat(context, { instruction: '只有雨站记得的提问' });
  await f.chat(context, { instruction: '继续刚才的问题' });
  assert.match(prompts[1].user, /只有雨站记得的提问/);
  assert.match(prompts[1].user, /第一回合答复/);
  await f.chat({ page: 'scenes', projectId: f.a });
  await f.chat({ page: 'brief', projectId: f.b });
  assert.ok(!prompts[2].user.includes('只有雨站记得的提问'));
  assert.ok(!prompts[3].user.includes('只有雨站记得的提问'));
  assert.ok(!prompts.slice(0, 3).some(p => p.user.includes('绝密另一项目梗概')));
  await f.chat({ page: 'projects' });
  assert.match(prompts[4].user, /绝密另一项目梗概/);
  assert.ok(!prompts[4].user.includes('雨停了。她还在等。'));
});

test('management previews metadata and applies atomically once with a pre-edit version', async t => {
  let response;
  let captured;
  const f = await fixture(t, async input => { captured = input; return response; });
  response = proposal([{ type: 'project.update', projectId: f.a, patch: { brief: { theme: '失去与接受' }, title: '雨站新名' } }]);
  const generated = await f.chat({ page: 'brief', projectId: f.a }, { mode: 'manage' });
  assert.equal(generated.status, 200, generated.error);
  assert.equal(generated.state.projects.find(p => p.id === f.a).title, '雨站');
  assert.match(captured.system, /project\.update/);
  assert.match(captured.system, /projectId/);
  assert.match(captured.system, /patch/);
  const applied = await f.request('/api/assistant/apply', { turnId: generated.turn.id });
  assert.equal(applied.status, 200, applied.error);
  const project = applied.state.projects.find(p => p.id === f.a);
  assert.equal(project.title, '雨站新名');
  assert.equal(project.versions.at(-1).snapshot.title, '雨站');
  assert.equal(applied.turn.applied, true);
  assert.equal((await f.request('/api/assistant/apply', { turnId: generated.turn.id })).code, 'ALREADY_APPLIED');
});

test('proposal stale guard ignores navigation, chat and unrelated project edits but catches its own source edits', async t => {
  let response;
  const f = await fixture(t, async () => response);
  response = proposal([{ type: 'project.update', projectId: f.a, patch: { synopsis: '新的梗概' } }]);
  const generated = await f.chat({ page: 'brief', projectId: f.a }, { mode: 'manage' });
  await f.action({ type: 'workspace.update', patch: { screen: 'tasks' } });
  await f.action({ type: 'view.save', projectId: f.a, view: { tab: 'library' } });
  await f.action({ type: 'project.update', projectId: f.b, patch: { title: '他项目的改名' } });
  await f.chat({ page: 'brief', projectId: f.a });
  assert.equal((await f.request('/api/assistant/apply', { turnId: generated.turn.id })).status, 200);
  const second = await f.chat({ page: 'brief', projectId: f.a }, { mode: 'manage' });
  await f.action({ type: 'project.update', projectId: f.a, patch: { synopsis: '作者亲自改过' } });
  assert.equal((await f.request('/api/assistant/apply', { turnId: second.turn.id })).code, 'STALE_PROPOSAL');
});

test('proposal captures source before model generation and saves to original context after navigation', async t => {
  let finish, began;
  const started = new Promise(resolve => { began = resolve; });
  const f = await fixture(t, async () => { began(); return new Promise(resolve => { finish = resolve; }); });
  const pending = f.chat({ page: 'brief', projectId: f.a }, { mode: 'manage' });
  await started;
  await f.action({ type: 'project.update', projectId: f.a, patch: { title: '生成期间新标题' } });
  await f.action({ type: 'workspace.update', patch: { activeProjectId: f.b, screen: 'project' } });
  finish(proposal([{ type: 'project.update', projectId: f.a, patch: { title: '旧建议标题' } }]));
  const generated = await pending;
  assert.equal(generated.turn.projectId, f.a);
  assert.equal((await f.request('/api/assistant/apply', { turnId: generated.turn.id })).code, 'STALE_PROPOSAL');
  assert.equal((await f.request('/api/assistant')).assistant.threads[generated.turn.contextKey][0].id, generated.turn.id);
});

test('invalid batches, cross-page/project operations and spoofed metadata are rejected before any changes', async t => {
  let response;
  const f = await fixture(t, async () => response);
  const invalid = [
    [{ type: 'project.update', projectId: f.a, patch: { title: '不可部分采用' } }, { type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { title: '越页面' } }],
    [{ type: 'project.update', projectId: f.b, patch: { title: '越项目' } }],
    [{ type: 'project.update', projectId: f.a, patch: { id: f.b } }],
    [{ type: 'project.update', projectId: f.a, patch: { brief: { system: '越权' } } }],
    [{ type: 'project.update', projectId: f.a, patch: { title: '非法' }, createdAt: 'spoof' }],
    [{ type: 'workspace.update', patch: { screen: 'shared' } }],
  ];
  for (const actions of invalid) {
    response = proposal(actions);
    assert.equal((await f.chat({ page: 'brief', projectId: f.a }, { mode: 'manage' })).status, 400);
  }
  assert.equal((await f.store.read()).projects.find(p => p.id === f.a).title, '雨站');
  for (const context of [{ page: 'script', projectId: f.b, sceneId: f.s }, { page: 'bogus' }, { page: 'brief' }, { page: 'tasks', projectId: f.a }, { page: 'brief', projectId: f.a, roleId: 'writer' }]) assert.equal((await f.chat(context)).status >= 400, true);
  assert.equal((await f.chat({ page: 'brief', projectId: f.a }, { roleId: 'writer' })).status, 400);
});

test('page allowlist supports shared status updates, reference import, empty scene creation and task management', async t => {
  let response;
  const f = await fixture(t, async () => response);
  async function adopt(context, actions) {
    response = proposal(actions);
    const generated = await f.chat(context, { mode: 'manage' });
    assert.equal(generated.status, 200, generated.error);
    const result = await f.request('/api/assistant/apply', { turnId: generated.turn.id });
    assert.equal(result.status, 200, result.error);
    return result;
  }
  await adopt({ page: 'shared' }, [{ type: 'shared.add', material: { title: '采访摘录', body: '雨声', status: 'alternative' } }]);
  const materialId = (await f.store.read()).sharedMaterials[0].id;
  await adopt({ page: 'shared' }, [{ type: 'shared.update', materialId, patch: { status: 'adopted', body: '保留口述原意' } }]);
  await adopt({ page: 'library', projectId: f.a }, [{ type: 'shared.import', projectId: f.a, materialId }]);
  await adopt({ page: 'scenes', projectId: f.a }, [{ type: 'scene.add', projectId: f.a, scene: { title: '下一场', body: '' } }]);
  await adopt({ page: 'tasks' }, [{ type: 'task.upsert', projectId: f.a, task: { title: '核对口述', due: '2026-12-01' } }]);
  const state = await f.store.read();
  assert.equal(state.projects.find(p => p.id === f.a).materials[0].body, '保留口述原意');
  response = proposal([{ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { body: '禁止绕过改写' } }]);
  assert.equal((await f.chat({ page: 'script', projectId: f.a, sceneId: f.s }, { mode: 'manage' })).status, 400);
  response = proposal([{ type: 'scene.add', projectId: f.a, scene: { title: '非法', body: '非空正文' } }]);
  assert.equal((await f.chat({ page: 'scenes', projectId: f.a }, { mode: 'manage' })).status, 400);
});

test('plain management replies are honest non-action history and focused alternative references remain page-local', async t => {
  let prompt;
  const f = await fixture(t, async input => { prompt = input; return { text: '请先补充人物的恐惧。', model: 'test' }; });
  const characterId = (await f.action({ type: 'character.upsert', projectId: f.a, character: { name: '备选角色', notes: '仅当前资料页可见', status: 'alternative' } })).result.id;
  const focused = await f.chat({ page: 'library', projectId: f.a, focus: { kind: 'character', id: characterId } }, { mode: 'manage' });
  assert.equal(focused.turn.actions.length, 0);
  assert.match(prompt.user, /仅当前资料页可见/);
  assert.match(prompt.user, /alternative/);
  assert.equal((await f.request('/api/assistant/apply', { turnId: focused.turn.id })).status, 400);
  await f.chat({ page: 'brief', projectId: f.a });
  assert.ok(!prompt.user.includes('仅当前资料页可见'));
});

test('guarded selection rewrite preserves surrounding text and its pre-edit version, and rejects empty/stale scope', async t => {
  const f = await fixture(t, async () => ({ text: '她转身走了。', model: 'test' }));
  const context = { page: 'script', projectId: f.a, sceneId: f.s, selection: { start: 4, end: 9, text: '她还在等。' } };
  assert.equal((await f.chat({ ...context, selection: null }, { mode: 'rewrite', scope: 'selection' })).status, 400);
  assert.equal((await f.chat({ ...context, selection: { start: 4, end: 9, text: '错误文字' } }, { mode: 'rewrite', scope: 'selection' })).status, 400);
  const generated = await f.chat(context, { mode: 'rewrite', scope: 'selection' });
  assert.equal(generated.status, 200, generated.error);
  assert.equal(generated.turn.sourceText, '雨停了。她还在等。');
  assert.ok(generated.turn.suggestionId);
  const applied = await f.request('/api/assistant/apply', { turnId: generated.turn.id });
  const p = applied.state.projects.find(p => p.id === f.a);
  assert.equal(p.scenes[0].body, '雨停了。她转身走了。');
  assert.equal(p.versions.at(-1).snapshot.scenes[0].body, '雨停了。她还在等。');
  assert.equal((await f.request('/api/assistant/apply', { turnId: generated.turn.id })).code, 'ALREADY_APPLIED');
  const stale = await f.chat({ page: 'script', projectId: f.a, sceneId: f.s }, { mode: 'rewrite', scope: 'scene' });
  await f.action({ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { body: '作者新稿' } });
  assert.equal((await f.request('/api/assistant/apply', { turnId: stale.turn.id })).code, 'STALE_SUGGESTION');
});

test('assistant project backup roundtrip retains profiles, skills and chats while imported proposals are inert', async t => {
  let response;
  const f = await fixture(t, async () => response);
  const skill = (await f.request('/api/assistant/skills', { markdown: '# 雨站限定工作法\n保留停顿。' })).skill;
  await f.request('/api/assistant/config', { roleId: 'story', projectId: f.a, profile: { name: '雨站顾问', personality: '温和追问', skillIds: [skill.id] } });
  response = proposal([{ type: 'project.update', projectId: f.a, patch: { title: '不许影响源项目' } }]);
  const generated = await f.chat({ page: 'brief', projectId: f.a }, { mode: 'manage' });
  const backup = await (await fetch(`${f.url}/api/export?projectId=${f.a}&format=json`)).json();
  assert.ok(backup.assistant);
  const copied = await f.action({ type: 'project.import', project: backup });
  const copyId = copied.result.projectId;
  const assistant = (await f.request('/api/assistant')).assistant;
  assert.equal(assistant.profiles.projects[copyId].story.name, '雨站顾问');
  const copiedTurns = Object.values(assistant.threads).flat().filter(turn => turn.projectId === copyId);
  assert.equal(copiedTurns.length, 1);
  assert.notEqual(copiedTurns[0].id, generated.turn.id);
  assert.equal(copiedTurns[0].contextKey, JSON.stringify(['brief', copyId, null, null, null]));
  assert.equal(copiedTurns[0].reply, generated.turn.reply);
  assert.equal(copiedTurns[0].actions.length, 0);
  assert.equal((await f.request('/api/assistant/apply', { turnId: copiedTurns[0].id })).status, 400);
  assert.equal((await f.store.read()).projects.find(p => p.id === f.a).title, '雨站');
  assert.ok(assistant.skills.some(s => s.id === assistant.profiles.projects[copyId].story.skillIds[0] && s.content.includes('保留停顿')));
});

test('legacy AI uses configured writer persona and skills without changing its preview contract', async t => {
  let prompt;
  const f = await fixture(t, async input => { prompt = input; return { text: '旧接口仍然工作', model: 'test' }; });
  await f.request('/api/assistant/config', { roleId: 'writer', projectId: f.a, profile: { name: '严谨编剧', personality: '从动作出发', skillIds: ['dialogue'] } });
  const response = await f.request('/api/ai', { projectId: f.a, sceneId: f.s, mode: 'rewrite', instruction: '调整对白' });
  assert.equal(response.status, 200);
  assert.match(prompt.system, /严谨编剧/);
  assert.match(prompt.system, /从动作出发/);
  assert.match(prompt.system, /对白/);
  assert.equal(response.suggestion.text, '旧接口仍然工作');
});

test('global metadata proposals reject intervening brief edits even though manuscripts are absent from global prompts', async t => {
  let response;
  const f = await fixture(t, async () => response);
  response = proposal([{ type: 'project.update', projectId: f.a, patch: { brief: { theme: '旧主题建议' } } }]);
  const generated = await f.chat({ page: 'projects' }, { mode: 'manage' });
  await f.action({ type: 'project.update', projectId: f.a, patch: { brief: { theme: '作者新主题' } } });
  const applied = await f.request('/api/assistant/apply', { turnId: generated.turn.id });
  assert.equal(applied.code, 'STALE_PROPOSAL');
  assert.equal((await f.store.read()).projects.find(p => p.id === f.a).brief.theme, '作者新主题');
});

test('long scene selection rewrite keeps the complete target with labeled nearby context and full server-side guards', async t => {
  let prompt, calls = 0;
  const f = await fixture(t, async input => { prompt = input; calls++; return { text: '她终于开口。', model: 'test' }; });
  const body = '雨'.repeat(65_000) + '她还在等。' + '声'.repeat(65_000);
  await f.action({ type: 'scene.update', projectId: f.a, sceneId: f.s, patch: { body } });
  const context = { page: 'script', projectId: f.a, sceneId: f.s, selection: { start: 65_000, end: 65_005, text: '她还在等。' } };
  const generated = await f.chat(context, { mode: 'rewrite', scope: 'selection' });
  assert.equal(generated.status, 200, generated.error);
  assert.equal(generated.turn.sourceText, body);
  assert.match(prompt.user, /她还在等。/);
  assert.match(prompt.user, /omittedSceneBody/);
  assert.ok(prompt.user.length < 20_000);
  const tooLarge = await f.chat({ page: 'script', projectId: f.a, sceneId: f.s }, { mode: 'rewrite', scope: 'scene' });
  assert.equal(tooLarge.code, 'ASSISTANT_CONTEXT_TOO_LARGE');
  assert.equal(calls, 1);
  const applied = await f.request('/api/assistant/apply', { turnId: generated.turn.id });
  assert.equal(applied.state.projects.find(p => p.id === f.a).scenes[0].body, '雨'.repeat(65_000) + '她终于开口。' + '声'.repeat(65_000));
});

test('legacy reserved project IDs configure only their own profile dictionary without prototype writes', async t => {
  const f = await fixture(t);
  await f.store.transaction(state => { state.projects.find(p => p.id === f.a).id = '__proto__'; });
  try {
    const saved = await f.request('/api/assistant/config', { roleId: 'writer', projectId: '__proto__', profile: { name: '旧项目编剧', personality: '细心', skillIds: [] } });
    assert.equal(saved.status, 200, saved.error);
    assert.equal(Object.hasOwn(saved.assistant.profiles.projects, '__proto__'), true);
    assert.equal(saved.assistant.profiles.projects.__proto__.writer.name, '旧项目编剧');
    assert.equal(Object.hasOwn(Object.prototype, 'writer'), false);
  } finally { delete Object.prototype.writer; }
});

test('script assistant discusses an empty project and manages tasks while rewrite still requires a scene', async t => {
  let response = { text: '先在分场页建立第一场，再进入正文。', model: 'test' };
  const f = await fixture(t, async () => response);
  const context = { page: 'script', projectId: f.b };
  const discussed = await f.chat(context);
  assert.equal(discussed.status, 200, discussed.error);
  assert.equal(discussed.turn.roleId, 'writer');
  assert.equal(discussed.turn.sceneId, null);
  assert.equal((await f.chat(context, { mode: 'rewrite' })).status, 400);
  response = proposal([{ type: 'task.upsert', projectId: f.b, task: { title: '建立开场' } }]);
  const managed = await f.chat(context, { mode: 'manage' });
  assert.equal(managed.status, 200, managed.error);
  assert.equal((await f.request('/api/assistant/apply', { turnId: managed.turn.id })).status, 200);
});

test('imported assistant rewrite is inert through both apply endpoints, including older linked backups without origin markers', async t => {
  const f = await fixture(t, async () => ({ text: '导入的建议不可执行。', model: 'test' }));
  const generated = await f.chat({ page: 'script', projectId: f.a, sceneId: f.s }, { mode: 'rewrite' });
  assert.equal(generated.status, 200, generated.error);
  const backup = await (await fetch(`${f.url}/api/export?projectId=${f.a}&format=json`)).json();
  for (const oldFormat of [false, true]) {
    const input = structuredClone(backup);
    if (oldFormat) for (const suggestion of input.aiHistory) delete suggestion.origin;
    const copied = await f.action({ type: 'project.import', project: input });
    assert.equal(copied.status, 200, copied.error);
    const copy = copied.state.projects.find(p => p.id === copied.result.projectId);
    const history = Object.values((await f.request('/api/assistant')).assistant.threads).flat().find(turn => turn.projectId === copy.id);
    assert.equal((await f.request('/api/assistant/apply', { turnId: history.id })).status, 400);
    const applied = await f.action({ type: 'ai.apply', projectId: copy.id, suggestionId: copy.aiHistory[0].id });
    assert.equal(applied.status, 400, `legacy adoption must reject ${oldFormat ? 'older linked' : 'marked'} assistant history`);
    assert.equal(applied.code, 'READ_ONLY_SUGGESTION');
    assert.equal((await f.store.read()).projects.find(p => p.id === copy.id).scenes[0].body, '雨停了。她还在等。');
  }
  // The source proposal itself remains adoptable; only imported histories are inert.
  assert.equal((await f.request('/api/assistant/apply', { turnId: generated.turn.id })).status, 200);
});

test('assistant upserts create only when id is absent, rejecting every supplied invalid or unowned nested ID', async t => {
  let response;
  const f = await fixture(t, async () => response);
  const cases = [
    { page: 'tasks', type: 'task.upsert', field: 'task', value: { title: '任务' } },
    { page: 'library', type: 'character.upsert', field: 'character', value: { name: '人物' } },
    { page: 'library', type: 'material.upsert', field: 'material', value: { title: '素材' } },
  ];
  for (const item of cases) {
    const context = { page: item.page, ...(item.page === 'library' ? { projectId: f.a } : {}) };
    for (const id of [null, false, 0, '', '   ', 'not-owned']) {
      response = proposal([{ type: item.type, projectId: f.a, [item.field]: { ...item.value, id } }]);
      const generated = await f.chat(context, { mode: 'manage' });
      assert.equal(generated.status, 400, `${item.type} id=${JSON.stringify(id)} must not become a creation`);
    }
    response = proposal([{ type: item.type, projectId: f.a, [item.field]: item.value }]);
    const generated = await f.chat(context, { mode: 'manage' });
    assert.equal(generated.status, 200, generated.error);
    assert.equal((await f.request('/api/assistant/apply', { turnId: generated.turn.id })).status, 200);
  }
  const project = (await f.store.read()).projects.find(p => p.id === f.a);
  assert.equal(project.tasks.length, 1);
  assert.equal(project.characters.length, 1);
  assert.equal(project.materials.length, 1);
});

test('legacy adoption of an assistant rewrite synchronizes its public turn and rejects either repeat path', async t => {
  const f = await fixture(t, async () => ({ text: '她终于转身。', model: 'test' }));
  const generated = await f.chat({ page: 'script', projectId: f.a, sceneId: f.s }, { mode: 'rewrite' });
  const adopted = await f.action({ type: 'ai.apply', projectId: f.a, suggestionId: generated.turn.suggestionId });
  assert.equal(adopted.status, 200, adopted.error);
  const history = (await f.request('/api/assistant')).assistant.threads[generated.turn.contextKey];
  assert.equal(history.find(turn => turn.id === generated.turn.id).applied, true);
  assert.equal(adopted.state.projects.find(p => p.id === f.a).aiHistory[0].applied, true);
  assert.equal((await f.request('/api/assistant/apply', { turnId: generated.turn.id })).code, 'ALREADY_APPLIED');
  assert.equal((await f.action({ type: 'ai.apply', projectId: f.a, suggestionId: generated.turn.suggestionId })).code, 'ALREADY_APPLIED');
  assert.equal((await f.store.read()).projects.find(p => p.id === f.a).versions.length, 1);
});

test('management follow-ups receive concrete pending proposals and their applied/read-only state in scoped history', async t => {
  const prompts = [];
  let response;
  const f = await fixture(t, async input => { prompts.push(input); return response; });
  const actions = [
    { type: 'task.upsert', projectId: f.a, task: { title: '核对雨站人物动机', due: '2026-11-21' } },
    { type: 'task.upsert', projectId: f.a, task: { title: '整理站台采访资料', due: '2026-11-23' } },
  ];
  response = { text: JSON.stringify({ reply: '我拟了两个任务，请核对。', actions: actions.map((action, index) => ({ label: `任务 ${index + 1}`, action })) }), model: 'test' };
  const context = { page: 'script', projectId: f.a, sceneId: f.s };
  const proposed = await f.chat(context, { mode: 'manage', instruction: '提出两项任务和日期供我核对' });
  const runtime = JSON.parse(prompts[0].user).serverTime;
  assert.ok(runtime && Math.abs(Date.now() - Date.parse(runtime.iso)) < 10_000, 'prompt must contain trusted current server time');
  assert.match(runtime.localDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof runtime.timeZone, 'string');
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: runtime.timeZone }));
  response = { text: '可以调整第一个任务的日期，再重新核对。', model: 'test' };
  await f.chat(context, { instruction: '第二个不要，把第一个日期改成22号' });
  const history = JSON.parse(prompts[1].user).matchingContextHistory;
  assert.deepEqual(history[0].actions, actions.map((action, index) => ({ label: `任务 ${index + 1}`, action })));
  assert.equal(history[0].applied, false);
  assert.equal(history[0].readOnly, false);
  assert.equal((await f.store.read()).projects.find(p => p.id === f.a).tasks.length, 0);
  assert.equal((await f.request('/api/assistant/apply', { turnId: proposed.turn.id })).status, 200);
  await f.chat(context);
  assert.equal(JSON.parse(prompts[2].user).matchingContextHistory[0].applied, true);
  await f.chat({ page: 'script', projectId: f.b });
  assert.deepEqual(JSON.parse(prompts[3].user).matchingContextHistory, []);
  const backup = await (await fetch(`${f.url}/api/export?projectId=${f.a}&format=json`)).json();
  const copied = await f.action({ type: 'project.import', project: backup });
  await f.chat({ ...context, projectId: copied.result.projectId });
  const importedHistory = JSON.parse(prompts[4].user).matchingContextHistory;
  assert.equal(importedHistory[0].readOnly, true);
  assert.equal(importedHistory[0].applied, true);
});
