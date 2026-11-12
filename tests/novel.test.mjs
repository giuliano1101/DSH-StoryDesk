import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { applyAction, createInitialState, newProject, snapshot, prepareSuggestion } from '../server/domain.mjs';
import { appendAssistantTurn, applyAssistantTurn, buildAssistantPrompts, configureAssistant, getAssistant, importAssistantSkill, prepareAssistantRequest } from '../server/assistant.mjs';
import { assistantContextKey } from '../shared/assistant-context.mjs';
import { buildPrompts } from '../server/ai.mjs';
import { buildRevisionPrompts, prepareRevisions, reviseNote } from '../server/revisions.mjs';
import { exportDocument } from '../server/exports.mjs';
import { createStore, startServer } from '../server/index.mjs';
import { creationCopy, projectFormat, roleForPage, workspaceFormat } from '../shared/creation.mjs';

function setup() {
  const state = createInitialState(false);
  const screenplay = applyAction(state, { type: 'project.create', title: '影视专属秘密' }).projectId;
  const novel = applyAction(state, { type: 'project.create', format: 'novel', title: '小说专属秘密' }).projectId;
  const scene = applyAction(state, { type: 'scene.add', projectId: novel, scene: { body: '我记得那阵雨。\n\n我不敢回头。', location: '不能导出的地点', time: '不能导出的时间' } }).sceneId;
  return { state, screenplay, novel, scene, project: state.projects.find(p => p.id === novel) };
}
const proposal = actions => ({ text: JSON.stringify({ reply: '待执行', actions: actions.map(action => ({ label: '修改', action })) }), model: 'test' });
function request(state, context, mode = 'discuss') { return prepareAssistantRequest(state, { context, mode, instruction: '保留第一人称与过去时' }); }

test('browser-safe creation vocabulary normalizes legacy reads and only known pages resolve roles', () => {
  for (const project of [undefined, {}, { format: 'unknown' }, { format: null }]) assert.equal(projectFormat(project), 'screenplay');
  assert.equal(projectFormat({ format: 'novel' }), 'novel');
  const f = setup();
  assert.equal(workspaceFormat(f.state), 'novel');
  f.state.workspace.creationMode = 'screenplay'; assert.equal(workspaceFormat(f.state), 'novel');
  f.state.workspace.screen = 'projects'; assert.equal(workspaceFormat(f.state), 'screenplay');
  assert.deepEqual(creationCopy('novel').tabs, { brief: '作品设定', library: '人物与世界观', scenes: '章节大纲', script: '正文' });
  assert.deepEqual(creationCopy().stages, { idea: '故事构思', characters: '人物开发', outline: '分场', draft: '写稿', revision: '改稿', delivery: '待交付' });
  assert.equal(roleForPage('script', 'novel'), 'novel-writer');
  assert.equal(roleForPage('constructor', 'novel'), undefined);
});

test('project format is strict on creation, immutable, and novels get chapter defaults', () => {
  const f = setup();
  assert.equal(f.project.format, 'novel');
  assert.equal(newProject().format, 'screenplay');
  assert.equal(newProject({ format: 'novel' }).title, '未命名小说');
  assert.equal(f.project.kind, '长篇小说');
  assert.equal(f.project.scenes[0].title, '未命名章节');
  assert.equal(f.project.scenes[0].act, '第一卷');
  for (const format of ['poem', null, 1, '']) assert.throws(() => applyAction(f.state, { type: 'project.create', format }), /格式/);
  assert.throws(() => applyAction(f.state, { type: 'project.update', projectId: f.novel, patch: { format: 'screenplay' } }), /格式/);
  assert.throws(() => applyAction(f.state, { type: 'workspace.update', patch: { creationMode: 'poem' } }), /模式|格式/);
  applyAction(f.state, { type: 'workspace.update', patch: { creationMode: 'novel', screen: 'projects' } });
  applyAction(f.state, { type: 'workspace.update', patch: { screen: 'project', activeProjectId: f.screenplay } });
  assert.equal(f.state.workspace.creationMode, 'screenplay');
  applyAction(f.state, { type: 'workspace.update', patch: { screen: 'entry' } });
  assert.equal(f.state.workspace.screen, 'entry');
});

test('snapshots, full/named backups, imports and legacy restores retain their owning format', async () => {
  const f = setup();
  assert.equal(snapshot(f.project).format, 'novel');
  const versionId = applyAction(f.state, { type: 'version.create', projectId: f.novel, name: '第一稿' }).id;
  for (const version of [undefined, versionId]) {
    const backup = JSON.parse((await exportDocument(f.state, { projectId: f.novel, format: 'json', versionId: version })).bytes);
    assert.equal(backup.format, 'novel');
    const id = applyAction(f.state, { type: 'project.import', project: backup }).projectId;
    assert.equal(f.state.projects.find(p => p.id === id).format, 'novel');
  }
  delete f.project.versions[0].snapshot.format;
  applyAction(f.state, { type: 'version.restore', projectId: f.novel, versionId });
  assert.equal(f.project.format, 'novel');
  const backup = structuredClone(f.project);
  backup.versions[0].snapshot.format = 'screenplay';
  assert.throws(() => applyAction(f.state, { type: 'project.import', project: backup }), /格式/);
  delete backup.versions[0].snapshot.format;
  const id = applyAction(f.state, { type: 'project.import', project: backup }).projectId;
  assert.ok(f.state.projects.find(p => p.id === id).versions.every(v => v.snapshot.format === 'novel'));
});

test('novel assistants, settings and text Skills are independently resolved on every page', () => {
  const f = setup(), assistant = getAssistant(f.state);
  assert.equal(assistant.roles.length, 12);
  assert.equal(assistant.skills.filter(s => s.builtin).length, 13);
  for (const [page, role] of Object.entries({ overview: 'manager', projects: 'manager', tasks: 'manager', shared: 'librarian', brief: 'story', library: 'character', scenes: 'structure', script: 'writer' })) {
    const context = { page, ...(['brief', 'library', 'scenes', 'script'].includes(page) ? { projectId: f.novel } : { creationMode: 'novel' }), ...(page === 'script' ? { sceneId: f.scene } : {}) };
    assert.equal(request(f.state, context).roleId, `novel-${role}`);
  }
  const skill = importAssistantSkill(f.state, { markdown: '# 小说私有风格\n保留叙述距离。' });
  configureAssistant(f.state, { roleId: 'writer', projectId: null, profile: { name: '影视专用', personality: '影视人格', skillIds: ['screenwriting'] } });
  configureAssistant(f.state, { roleId: 'novel-writer', projectId: null, profile: { name: '小说全局', personality: '小说人格', skillIds: [skill.id] } });
  configureAssistant(f.state, { roleId: 'novel-writer', projectId: f.novel, profile: { name: '小说项目', personality: '项目内心', skillIds: [skill.id] } });
  const prompts = buildAssistantPrompts(f.state, request(f.state, { page: 'script', projectId: f.novel, sceneId: f.scene }));
  assert.match(prompts.system, /小说项目|项目内心|保留叙述距离/);
  assert.doesNotMatch(prompts.system, /影视人格|可拍摄/);
  const turn = appendAssistantTurn(f.state, request(f.state, { page: 'script', projectId: f.novel, sceneId: f.scene }), { text: '建议', model: 'test' });
  assert.equal(turn.writeTargets.find(t => t.target === 'script.append').label, '追加到当前章节正文');
  const outline = appendAssistantTurn(f.state, request(f.state, { page: 'scenes', projectId: f.novel }), { text: '建议', model: 'test' });
  assert.equal(outline.writeTargets[0].label, '新建章节并写入梗概');
  configureAssistant(f.state, { roleId: 'novel-writer', projectId: f.novel, profile: null });
  assert.match(buildAssistantPrompts(f.state, request(f.state, { page: 'script', projectId: f.novel, sceneId: f.scene })).system, /小说全局/);
});

test('global mode contexts isolate history, prompt data, fingerprints, action authority and project creation', () => {
  const f = setup();
  applyAction(f.state, { type: 'workspace.update', patch: { creationMode: 'novel', screen: 'projects' } });
  assert.equal(request(f.state, { page: 'projects' }).roleId, 'manager');
  const context = { page: 'projects', creationMode: 'novel' }, prepared = request(f.state, context, 'execute');
  assert.equal(prepared.contextKey, JSON.stringify(['projects', null, null, null, null, 'novel']));
  assert.equal(assistantContextKey({ page: 'projects' }), JSON.stringify(['projects', null, null, null, null]));
  const data = JSON.parse(buildAssistantPrompts(f.state, prepared).user);
  assert.deepEqual(data.projectIndex.map(p => p.id), [f.novel]);
  assert.doesNotMatch(JSON.stringify(data), /影视专属秘密/);
  const turn = appendAssistantTurn(f.state, request(f.state, context), { text: '小说历史独有', model: 'test' });
  assert.equal(turn.creationMode, 'novel');
  assert.doesNotMatch(buildAssistantPrompts(f.state, request(f.state, { page: 'projects' })).user, /小说历史独有/);
  assert.throws(() => appendAssistantTurn(f.state, prepared, proposal([{ type: 'project.update', projectId: f.screenplay, patch: { title: '越界' } }])), /格式|模式/);
  assert.throws(() => appendAssistantTurn(f.state, prepared, proposal([{ type: 'project.create', title: '越界', format: 'screenplay' }])), /格式|模式/);
  const generated = appendAssistantTurn(f.state, prepared, proposal([{ type: 'project.create', title: '新小说', text: '新的叙述。' }]));
  applyAction(f.state, { type: 'project.update', projectId: f.screenplay, patch: { title: '另种格式的修改' } });
  applyAssistantTurn(f.state, { turnId: generated.id });
  const created = f.state.projects.find(p => p.title === '新小说');
  assert.equal(created.format, 'novel');
  assert.equal(created.scenes[0].title, '未命名章节');
  assert.throws(() => request(f.state, { page: 'brief', projectId: f.novel, creationMode: 'screenplay' }), /格式|模式/);
  assert.throws(() => request(f.state, { page: 'projects', creationMode: 'bad' }), /格式|模式/);
});

test('switching global creation mode suppresses stale automatic navigation and project navigation derives target mode', () => {
  const f = setup();
  applyAction(f.state, { type: 'workspace.update', patch: { screen: 'projects', creationMode: 'novel' } });
  const prepared = request(f.state, { page: 'projects', creationMode: 'novel' }, 'execute');
  const generated = appendAssistantTurn(f.state, prepared, proposal([{ type: 'ui.navigate', page: 'script', projectId: f.novel, sceneId: f.scene }]));
  applyAction(f.state, { type: 'workspace.update', patch: { creationMode: 'screenplay' } });
  const outcome = applyAssistantTurn(f.state, { turnId: generated.id }).result;
  assert.equal(outcome.skippedNavigation[0].reason, 'origin_context_changed');
  const next = appendAssistantTurn(f.state, request(f.state, { page: 'projects' }, 'execute'), proposal([{ type: 'ui.navigate', page: 'brief', projectId: f.novel }]));
  applyAssistantTurn(f.state, { turnId: next.id });
  assert.equal(f.state.workspace.creationMode, 'novel');
});

test('legacy rewrite and paragraph review use novel persona and preserve POV, tense and narrative prose', () => {
  const f = setup();
  const suggestion = prepareSuggestion(f.state, { projectId: f.novel, sceneId: f.scene, mode: 'rewrite', instruction: '保留叙述声音' });
  const legacy = buildPrompts(f.state, suggestion);
  reviseNote(f.state, { projectId: f.novel, sceneId: f.scene, operation: 'add', instruction: '让内心更矛盾', selection: { start: 0, end: 7, text: '我记得那阵雨。' } });
  const paragraph = buildRevisionPrompts(f.state, prepareRevisions(f.state, { projectId: f.novel, noteIds: [f.project.revisionNotes[0].id] }));
  for (const prompt of [legacy, paragraph, buildAssistantPrompts(f.state, request(f.state, { page: 'script', projectId: f.novel, sceneId: f.scene }, 'rewrite'))]) {
    assert.match(prompt.system, /小说写作搭档/);
    assert.match(prompt.system, /POV|视角/);
    assert.match(prompt.system, /时态/);
    assert.match(prompt.system, /内心|内在/);
    assert.doesNotMatch(prompt.system, /可拍摄|中文影视|将抽象情绪和内心解释转化/);
  }
  assert.doesNotMatch(legacy.user, /不能导出的地点|不能导出的时间/);
  const execute = buildAssistantPrompts(f.state, request(f.state, { page: 'script', projectId: f.novel, sceneId: f.scene }, 'execute'));
  assert.doesNotMatch(execute.system, /screenplay text|当前正文场景|整场/);
  assert.match(execute.system, /scene.write 只可写当前正文章节/);
  assert.match(execute.system, /明确允许整章替换/);
  assert.doesNotMatch(execute.system, /\$\{/);
  assert.doesNotMatch(execute.user, /不能导出的地点|不能导出的时间|"interior"/);
  const screenplayPrompt = buildAssistantPrompts(f.state, request(f.state, { page: 'brief', projectId: f.screenplay }, 'execute'));
  const schema = JSON.parse(screenplayPrompt.system.split('当前页可用操作 schema：\n')[1]);
  assert.equal(schema['scene.update'].patch.interior, '内景|外景?');
});

test('novel project backup remaps novel history, imported Skills and overrides without executable authority', async () => {
  const f = setup();
  const skill = importAssistantSkill(f.state, { markdown: '# 独立小说 Skill\n遵守第一人称。' });
  configureAssistant(f.state, { roleId: 'novel-writer', projectId: f.novel, profile: { name: '私有小说编辑', personality: '贴近叙述者', skillIds: [skill.id] } });
  const turn = appendAssistantTurn(f.state, request(f.state, { page: 'script', projectId: f.novel, sceneId: f.scene }, 'rewrite'), { text: '我依然记得。', model: 'test' });
  const backup = JSON.parse((await exportDocument(f.state, { projectId: f.novel, format: 'json' })).bytes);
  const copiedId = applyAction(f.state, { type: 'project.import', project: backup }).projectId;
  const assistant = getAssistant(f.state), imported = Object.values(assistant.threads).flat().find(t => t.projectId === copiedId);
  assert.equal(imported.creationMode, 'novel'); assert.equal(imported.roleId, 'novel-writer'); assert.equal(imported.readOnly, true);
  assert.equal(imported.contextKey, assistantContextKey({ page: 'script', projectId: copiedId, sceneId: f.scene, creationMode: 'novel' }));
  assert.deepEqual(imported.actions, []); assert.deepEqual(imported.writeTargets, []);
  assert.equal(assistant.profiles.projects[copiedId]['novel-writer'].name, '私有小说编辑');
  assert.match(buildAssistantPrompts(f.state, request(f.state, { page: 'script', projectId: copiedId, sceneId: f.scene })).system, /遵守第一人称/);
  assert.throws(() => applyAssistantTurn(f.state, { turnId: imported.id }), /仅供阅读/);
  assert.equal(turn.creationMode, 'novel');
});

test('novels export prose chapters in Markdown, txt, HTML and valid Word; screenplay Fountain stays available', async t => {
  const f = setup();
  for (const format of ['markdown', 'txt', 'html']) {
    const output = await exportDocument(f.state, { projectId: f.novel, format });
    const source = output.bytes.toString();
    assert.match(source, /未命名章节/);
    assert.match(source, /我记得那阵雨。/);
    assert.doesNotMatch(source, /INT\.|EXT\.|不能导出的地点|不能导出的时间|内景|外景|剧本导出/);
    assert.ok(output.filename.endsWith(format === 'markdown' ? '.md' : `.${format}`));
  }
  const directory = await mkdtemp(join(tmpdir(), 'novel-word-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const word = await exportDocument(f.state, { projectId: f.novel, format: 'docx' });
  const { writeFile } = await import('node:fs/promises'); await writeFile(join(directory, 'novel.docx'), word.bytes);
  const xml = execFileSync('/usr/bin/unzip', ['-p', join(directory, 'novel.docx'), 'word/document.xml'], { encoding: 'utf8' });
  assert.match(xml, /我记得那阵雨。/); assert.match(xml, /未命名章节/);
  assert.doesNotMatch(xml, /INT\.|EXT\.|不能导出的地点|不能导出的时间/);
  await assert.rejects(exportDocument(f.state, { projectId: f.novel, format: 'fountain' }), /小说.*Fountain|Fountain.*小说/);
  applyAction(f.state, { type: 'scene.add', projectId: f.screenplay, scene: { title: '站台' } });
  assert.match((await exportDocument(f.state, { projectId: f.screenplay, format: 'fountain' })).bytes.toString(), /INT\./);
});

test('state capabilities and legacy read normalization do not write or call a model', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'novel-legacy-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const legacy = createInitialState(false); legacy.projects.push(newProject({ title: '旧项目' })); delete legacy.projects[0].format;
  const store = await createStore({ directory, seed: legacy });
  const before = await readFile(join(directory, 'state.json'), 'utf8');
  let calls = 0; const app = await startServer({ directory, port: 0, modelAdapter: async () => { calls++; throw Error('no'); } }); t.after(() => app.close());
  const result = await (await fetch(`${app.url}/api/state`)).json();
  assert.deepEqual(result.capabilities, { creationFormats: ['screenplay', 'novel'] });
  assert.equal(Object.hasOwn(result.state.projects[0], 'format'), false);
  assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), before);
  assert.equal(calls, 0); assert.equal((await store.read()).projects.length, 1);
});

test('novel HTTP assistant, legacy and paragraph routes retain captured live model selection and protected apply', async t => {
  const f = setup(), calls = [];
  const directory = await mkdtemp(join(tmpdir(), 'novel-model-'));
  let current = { provider: 'live-host', model: 'submitted' }, entered, release;
  const adapter = async input => {
    calls.push(input);
    if (input.system.includes('"changes"')) return { text: JSON.stringify({ changes: JSON.parse(input.user).notes.map(n => ({ noteId: n.noteId, text: '我仍记得雨落在掌心。' })) }), model: 'ignored adapter label' };
    return { text: '我仍然记得。', model: `${input.modelSelection.provider} / ${input.modelSelection.model}` };
  };
  adapter.defaultSelection = () => ({ ...current });
  adapter.resolveSelection = async value => { entered?.(); if (release) await release; return { ...value }; };
  const app = await startServer({ directory, seed: f.state, port: 0, modelAdapter: adapter });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const post = async (path, data) => {
    const response = await fetch(`${app.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    return { status: response.status, ...(await response.json()) };
  };
  const note = await post('/api/revisions/notes', { projectId: f.novel, operation: 'add', sceneId: f.scene, selection: { start: 0, end: 7, text: '我记得那阵雨。' }, instruction: '保留过去时和第一人称' });
  assert.equal(note.status, 200);
  const routes = [
    ['/api/assistant', { context: { page: 'script', projectId: f.novel, sceneId: f.scene, creationMode: 'novel' }, mode: 'rewrite', instruction: '保留声音' }],
    ['/api/ai', { projectId: f.novel, sceneId: f.scene, mode: 'rewrite', instruction: '保留声音' }],
    ['/api/revisions/generate', { projectId: f.novel, noteIds: [note.note.id] }],
  ];
  const replies = [];
  for (const [path, input] of routes) {
    current = { provider: 'live-host', model: 'submitted' };
    let resume; release = new Promise(resolve => { resume = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const pending = post(path, input); await started;
    current = { provider: 'live-host', model: 'later-default' }; resume();
    const reply = await pending; assert.equal(reply.status, 200, reply.error); replies.push(reply);
    assert.deepEqual(calls.at(-1).modelSelection, { provider: 'live-host', model: 'submitted' });
    assert.match(calls.at(-1).system, /小说写作搭档/); assert.doesNotMatch(calls.at(-1).system, /可拍摄/);
    assert.ok(calls.at(-1).signal instanceof AbortSignal);
  }
  assert.equal(replies[0].turn.roleId, 'novel-writer'); assert.equal(replies[0].turn.creationMode, 'novel');
  assert.equal(replies[2].batch.model, 'live-host / submitted');
  const original = (await app.store.read()).projects.find(p => p.id === f.novel);
  assert.equal(original.scenes[0].body, f.project.scenes[0].body);
  const adopted = await post('/api/revisions/apply', { projectId: f.novel, batchId: replies[2].batch.id, changeIds: replies[2].batch.changes.map(c => c.id) });
  assert.equal(adopted.status, 200, adopted.error);
  const project = adopted.state.projects.find(p => p.id === f.novel);
  assert.equal(project.scenes[0].body, '我仍记得雨落在掌心。\n\n我不敢回头。');
  assert.equal(project.versions.at(-1).snapshot.format, 'novel');
  const staleLegacy = await post('/api/actions', { action: { type: 'ai.apply', projectId: f.novel, suggestionId: replies[1].suggestion.id } });
  assert.equal(staleLegacy.code, 'STALE_SUGGESTION');
});
