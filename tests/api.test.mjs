import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { startServer } from '../server/index.mjs';
import { createApi } from '../server/api.mjs';
import { applyAction, appendSuggestion, prepareSuggestion } from '../server/domain.mjs';

// Tests must never send a script to credentials inherited from a user's shell.
const aiEnvironmentKeys = ['SCREENWRITER_AI_URL', 'SCREENWRITER_AI_MODEL', 'SCREENWRITER_AI_KEY'];
const inheritedAiEnvironment = Object.fromEntries(aiEnvironmentKeys.map(key => [key, process.env[key]]));
for (const key of aiEnvironmentKeys) delete process.env[key];
after(() => { for (const key of aiEnvironmentKeys) { if (inheritedAiEnvironment[key] === undefined) delete process.env[key]; else process.env[key] = inheritedAiEnvironment[key]; } });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'screenwriter-api-'));
  const app = await startServer({ directory, seed: false, port: 0, ...options });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function request(path, data, method = data ? 'POST' : 'GET') {
    const response = await fetch(`${app.url}${path}`, { method, headers: data ? { 'content-type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
    const json = await response.json();
    return { response, ...json };
  }
  async function action(action) { return request('/api/actions', { action }); }
  return { ...app, request, action, directory };
}
async function draft(f) {
  const created = await f.action({ type: 'project.create', title: '雨站', kind: '短片' });
  const projectId = created.result.projectId;
  const added = await f.action({ type: 'scene.add', projectId, scene: { title: '最后一班车', body: '雨停了。她还在等。' } });
  return { projectId, sceneId: added.result.sceneId };
}

test('unconfigured AI reports an honest actionable error without creating fake history', async t => {
  const f = await fixture(t);
  const ids = await draft(f);
  const result = await f.request('/api/ai', { ...ids, mode: 'rewrite', instruction: '更克制' });
  assert.equal(result.response.status, 503);
  assert.equal(result.code, 'AI_NOT_CONFIGURED');
  const { state, ai } = await f.request('/api/state');
  assert.equal(ai.connected, false);
  assert.equal(state.projects[0].aiHistory.length, 0);
});

test('AI uses scoped adopted context, previews selection changes and applies once with version backup', async t => {
  let prompt;
  const f = await fixture(t, { modelAdapter: async input => { prompt = input; return { text: '她站着，听水滴落。', model: 'test-provider' }; } });
  const ids = await draft(f);
  await f.action({ type: 'character.upsert', projectId: ids.projectId, character: { name: '采用人物', notes: '唯一采用的秘密', status: 'adopted' } });
  await f.action({ type: 'character.upsert', projectId: ids.projectId, character: { name: '未采用人物', notes: '不应传递甲', status: 'alternative' } });
  await f.action({ type: 'material.upsert', projectId: ids.projectId, material: { title: '废弃设定', body: '不应传递乙', status: 'archived' } });
  const selection = { start: 4, end: 9, text: '她还在等。' };
  const result = await f.request('/api/ai', { ...ids, mode: 'rewrite', instruction: '更克制', selection });
  assert.equal(result.response.status, 200);
  assert.equal(result.state.projects[0].scenes[0].body, '雨停了。她还在等。');
  assert.ok(prompt.user.includes('唯一采用的秘密'));
  assert.ok(!prompt.user.includes('不应传递甲') && !prompt.user.includes('不应传递乙'));
  assert.equal(result.suggestion.sourceRevision, 0);
  assert.deepEqual(result.suggestion.selection, selection);
  const applied = await f.action({ type: 'ai.apply', projectId: ids.projectId, suggestionId: result.suggestion.id });
  assert.equal(applied.state.projects[0].scenes[0].body, '雨停了。她站着，听水滴落。');
  assert.equal(applied.state.projects[0].versions[0].snapshot.scenes[0].body, '雨停了。她还在等。');
  assert.equal(applied.state.projects[0].aiHistory[0].applied, true);
  assert.equal((await f.action({ type: 'ai.apply', projectId: ids.projectId, suggestionId: result.suggestion.id })).response.status, 409);
});

test('refuses stale and non-rewrite AI proposals and invalid selection ranges', async t => {
  const f = await fixture(t, { modelAdapter: async () => ({ text: '建议正文', model: 'test-provider' }) });
  const ids = await draft(f);
  const bad = await f.request('/api/ai', { ...ids, mode: 'rewrite', instruction: '改写', selection: { start: 0, end: 2, text: '伪造' } });
  assert.equal(bad.response.status, 400);
  const { suggestion } = await f.request('/api/ai', { ...ids, mode: 'rewrite', instruction: '改写' });
  await f.action({ type: 'scene.update', ...ids, patch: { body: '作者新的正文' } });
  const stale = await f.action({ type: 'ai.apply', projectId: ids.projectId, suggestionId: suggestion.id });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.code, 'STALE_SUGGESTION');
  const discuss = await f.request('/api/ai', { ...ids, mode: 'discuss', instruction: '人物动机合理吗' });
  assert.equal((await f.action({ type: 'ai.apply', projectId: ids.projectId, suggestionId: discuss.suggestion.id })).response.status, 400);
});

test('background AI completion cannot erase edits made while provider is running', async t => {
  let finish;
  let began;
  const started = new Promise(resolve => { began = resolve; });
  const f = await fixture(t, { modelAdapter: async () => { began(); return new Promise(resolve => { finish = resolve; }); } });
  const ids = await draft(f);
  const pending = f.request('/api/ai', { ...ids, mode: 'rewrite', instruction: '改写' });
  await started;
  await f.action({ type: 'scene.update', ...ids, patch: { body: '请求期间的新正文' } });
  await f.action({ type: 'project.update', projectId: ids.projectId, patch: { synopsis: '请求期间的新梗概' } });
  finish({ text: '旧稿建议', model: 'test-provider' });
  const completed = await pending;
  assert.equal(completed.state.projects[0].scenes[0].body, '请求期间的新正文');
  assert.equal(completed.state.projects[0].synopsis, '请求期间的新梗概');
  assert.equal(completed.state.projects[0].aiHistory.length, 1);
  assert.equal((await f.action({ type: 'ai.apply', projectId: ids.projectId, suggestionId: completed.suggestion.id })).code, 'STALE_SUGGESTION');
});

test('real export bytes include named versions, escaped printable HTML and valid DOCX container', async t => {
  const f = await fixture(t);
  const ids = await draft(f);
  await f.action({ type: 'scene.update', ...ids, patch: { body: '<script>旧正文</script>\n江宁\n我留下。' } });
  const version = await f.action({ type: 'version.create', projectId: ids.projectId, name: '给制片人的版本' });
  await f.action({ type: 'scene.update', ...ids, patch: { body: '当前正文' } });
  for (const format of ['fountain', 'json', 'html', 'docx']) {
    const response = await fetch(`${f.url}/api/export?projectId=${ids.projectId}&format=${format}&versionId=${version.result.id}`);
    assert.equal(response.status, 200, format);
    assert.ok(response.headers.get('content-disposition').includes('attachment'));
    const bytes = Buffer.from(await response.arrayBuffer());
    if (format === 'docx') {
      assert.equal(bytes.subarray(0, 2).toString(), 'PK');
      assert.ok(bytes.includes(Buffer.from('word/document.xml')));
      assert.ok(bytes.length > 1000);
    } else {
      const content = bytes.toString();
      assert.ok(content.includes('旧正文'));
      assert.ok(!content.includes('当前正文'));
      if (format === 'html') { assert.ok(content.includes('@media print')); assert.ok(!content.includes('<script>')); }
      if (format === 'json') { assert.equal(JSON.parse(content).scenes[0].id, ids.sceneId); }
    }
  }
});

test('private model settings redact API keys, retain blank keys and reject unsafe API requests', async t => {
  const f = await fixture(t);
  const saved = await f.request('/api/settings', { baseUrl: 'https://api.example.com/v1', model: 'writer-model', apiKey: 'secret-not-for-browser' });
  assert.equal(saved.configured, true);
  assert.ok(!JSON.stringify(saved).includes('secret-not-for-browser'));
  await f.request('/api/settings', { baseUrl: 'https://api.example.com/v1', model: 'writer-model-2', apiKey: '' });
  const settings = JSON.parse(await readFile(join(f.directory, 'settings.json'), 'utf8'));
  assert.equal(settings.apiKey, 'secret-not-for-browser');
  assert.equal((await stat(join(f.directory, 'settings.json'))).mode & 0o077, 0);
  assert.ok(!JSON.stringify(await f.request('/api/state')).includes('secret-not-for-browser'));
  const evil = await fetch(`${f.url}/api/actions`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ action: { type: 'workspace.update', patch: { theme: 'dark' } } }) });
  assert.equal(evil.status, 403);
  const invalid = await fetch(`${f.url}/api/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(invalid.status, 400);
  const huge = await fetch(`${f.url}/api/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ huge: 'x'.repeat(2_200_000) }) });
  assert.equal(huge.status, 413);
});

test('standalone server serves built client assets and rejects non-loopback binding', async t => {
  const clientDirectory = await mkdtemp(join(tmpdir(), 'screenwriter-client-'));
  t.after(() => rm(clientDirectory, { recursive: true, force: true }));
  await writeFile(join(clientDirectory, 'index.html'), '<!doctype html><title>编剧工作台</title>');
  await mkdir(join(clientDirectory, 'assets'));
  await writeFile(join(clientDirectory, 'assets', 'app.js'), 'console.log("ready")');
  const f = await fixture(t, { clientDirectory });
  assert.ok((await (await fetch(f.url)).text()).includes('编剧工作台'));
  assert.match((await fetch(`${f.url}/assets/app.js`)).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${f.url}/api/missing`)).status, 404);
  await assert.rejects(startServer({ host: '0.0.0.0', directory: f.directory }), /本机/);
});

test('configured OpenAI-compatible provider receives a real scoped HTTP request and errors never expose provider secrets', async t => {
  let captured;
  let reject = false;
  const provider = createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    captured = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(parts).toString()) };
    res.writeHead(reject ? 401 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reject ? { error: 'private-provider-key' } : { model: 'real-http-model', choices: [{ message: { content: '她把信折好，终于抬起头。' } }] }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => provider.close(resolve)));
  const f = await fixture(t);
  const ids = await draft(f);
  await f.request('/api/settings', { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, model: 'configured-model', apiKey: 'private-provider-key' });
  const response = await f.request('/api/ai', { ...ids, mode: 'rewrite', instruction: '通过动作表达情绪' });
  assert.equal(response.response.status, 200);
  assert.equal(response.suggestion.model, 'real-http-model');
  assert.equal(captured.url, '/v1/chat/completions');
  assert.equal(captured.authorization, 'Bearer private-provider-key');
  assert.equal(captured.body.model, 'configured-model');
  assert.equal(captured.body.messages[0].role, 'system');
  assert.ok(captured.body.messages[1].content.includes('雨停了。她还在等。'));
  reject = true;
  const denied = await f.request('/api/ai', { ...ids, mode: 'check', instruction: '检查动机' });
  assert.equal(denied.response.status, 502);
  assert.ok(!JSON.stringify(denied).includes('private-provider-key'));
  assert.equal((await f.request('/api/state')).state.projects[0].aiHistory.length, 1);
});

test('a restored identical body still invalidates old proposals and never crosses project context', async t => {
  let prompt;
  const f = await fixture(t, { modelAdapter: async input => { prompt = input; return { text: '建议正文', model: 'test-provider' }; } });
  const ids = await draft(f);
  const second = await f.action({ type: 'project.create', title: '其他项目保密设定', kind: '短片' });
  await f.action({ type: 'project.update', projectId: second.result.projectId, patch: { synopsis: '绝不可跨项目传递' } });
  const version = await f.action({ type: 'version.create', projectId: ids.projectId, name: '原稿' });
  const suggestion = (await f.request('/api/ai', { ...ids, mode: 'rewrite', instruction: '改写' })).suggestion;
  assert.ok(!prompt.user.includes('绝不可跨项目传递'));
  const cross = await f.action({ type: 'ai.apply', projectId: second.result.projectId, suggestionId: suggestion.id });
  assert.equal(cross.response.status, 404);
  await f.action({ type: 'scene.update', ...ids, patch: { body: '临时修改' } });
  await f.action({ type: 'version.restore', projectId: ids.projectId, versionId: version.result.id });
  const stale = await f.action({ type: 'ai.apply', projectId: ids.projectId, suggestionId: suggestion.id });
  assert.equal(stale.code, 'STALE_SUGGESTION');
});

test('JSON backup import retains preview adoption state and binds history to the new project', async t => {
  const f = await fixture(t, { modelAdapter: async () => ({ text: '导入后的建议正文', model: 'test-provider' }) });
  const ids = await draft(f);
  await f.request('/api/ai', { ...ids, mode: 'rewrite', instruction: '克制一些' });
  const backup = await (await fetch(`${f.url}/api/export?projectId=${ids.projectId}&format=json`)).json();
  const imported = await f.action({ type: 'project.import', project: backup });
  const copy = imported.state.projects.find(p => p.id === imported.result.projectId);
  assert.equal(copy.aiHistory[0].applied, false);
  assert.equal(copy.aiHistory[0].projectId, copy.id);
  const applied = await f.action({ type: 'ai.apply', projectId: copy.id, suggestionId: copy.aiHistory[0].id });
  assert.equal(applied.state.projects.find(p => p.id === copy.id).scenes[0].body, '导入后的建议正文');
  assert.equal(applied.state.projects.find(p => p.id === ids.projectId).scenes[0].body, '雨停了。她还在等。');
});

test('AI completion after a version removes its source scene remains inspectable history', async t => {
  let finish;
  let began;
  const started = new Promise(resolve => { began = resolve; });
  const f = await fixture(t, { modelAdapter: async () => { began(); return new Promise(resolve => { finish = resolve; }); } });
  const created = await f.action({ type: 'project.create', title: '先有空稿', kind: '短片' });
  const projectId = created.result.projectId;
  const version = await f.action({ type: 'version.create', projectId, name: '没有场景的版本' });
  const added = await f.action({ type: 'scene.add', projectId, scene: { title: '后来添加的场景', body: '原正文' } });
  const pending = f.request('/api/ai', { projectId, sceneId: added.result.sceneId, mode: 'rewrite', instruction: '改写' });
  await started;
  await f.action({ type: 'version.restore', projectId, versionId: version.result.id });
  finish({ text: '晚到的建议', model: 'test-provider' });
  const completed = await pending;
  assert.equal(completed.response.status, 200);
  assert.equal(completed.state.projects[0].scenes.length, 0);
  assert.equal(completed.state.projects[0].aiHistory[0].text, '晚到的建议');
  const apply = await f.action({ type: 'ai.apply', projectId, suggestionId: completed.suggestion.id });
  assert.equal(apply.code, 'STALE_SUGGESTION');
});

test('environment configuration stays private while an injected host adapter takes precedence', async t => {
  process.env.SCREENWRITER_AI_URL = 'http://127.0.0.1:1/v1';
  process.env.SCREENWRITER_AI_MODEL = 'environment-model';
  process.env.SCREENWRITER_AI_KEY = 'environment-private-key';
  t.after(() => { for (const key of aiEnvironmentKeys) delete process.env[key]; });
  const adapter = async () => ({ text: '宿主直接返回的检查意见', model: 'host-model' });
  adapter.status = () => ({ connected: true, label: '宿主已连接' });
  const f = await fixture(t, { modelAdapter: adapter });
  const ids = await draft(f);
  const settings = await f.request('/api/settings');
  assert.equal(settings.configured, true);
  assert.equal(settings.model, 'environment-model');
  assert.ok(!JSON.stringify(settings).includes('environment-private-key'));
  const result = await f.request('/api/ai', { ...ids, mode: 'check', instruction: '检查节奏' });
  assert.equal(result.response.status, 200);
  assert.equal(result.suggestion.model, 'host-model');
  assert.deepEqual((await f.request('/api/state')).ai, { connected: true, label: '宿主已连接' });
});

test('a JSON backup larger than 2 MiB reimports all Chinese prose and seven version snapshots', async t => {
  const f = await fixture(t);
  const ids = await draft(f);
  const prose = '雨声里，她终于读完那封没有寄出的信。'.repeat(5_000);
  await f.action({ type: 'scene.update', ...ids, patch: { body: prose } });
  for (let index = 0; index < 7; index++) await f.action({ type: 'version.create', projectId: ids.projectId, name: `完整版本 ${index + 1}` });
  const exported = await fetch(`${f.url}/api/export?projectId=${ids.projectId}&format=json`);
  assert.equal(exported.status, 200);
  const backupText = await exported.text();
  assert.ok(Buffer.byteLength(backupText) > 2 * 1024 * 1024);
  const backup = JSON.parse(backupText);
  const imported = await f.action({ type: 'project.import', project: backup });
  assert.equal(imported.response.status, 200);
  const copy = imported.state.projects.find(p => p.id === imported.result.projectId);
  assert.equal(copy.scenes[0].body, prose);
  assert.equal(copy.versions.length, 7);
  assert.ok(copy.versions.every(version => version.snapshot.scenes[0].body === prose));
  assert.deepEqual(copy.versions, backup.versions);
  const excessiveNormalAction = await f.action({ type: 'workspace.update', patch: { theme: 'dark' }, ignored: 'x'.repeat(2 * 1024 * 1024) });
  assert.equal(excessiveNormalAction.response.status, 413);
  assert.equal(excessiveNormalAction.code, 'BODY_TOO_LARGE');
});

test('JSON above the 64 MiB reimport cap returns an actionable error instead of an unusable download', async t => {
  const f = await fixture(t);
  const ids = await draft(f);
  const state = await f.store.read();
  const p = state.projects[0];
  const snapshot = { title: p.title, kind: p.kind, synopsis: p.synopsis, brief: p.brief, characters: [], materials: [], scenes: [{ ...p.scenes[0], body: '稿'.repeat(100_000) }] };
  p.versions = Array.from({ length: 225 }, (_, index) => ({ id: `large-version-${index}`, name: `完整历史 ${index}`, createdAt: p.createdAt, snapshot }));
  const apiServer = createServer(createApi({ store: { read: async () => state } }));
  await new Promise(resolve => apiServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => apiServer.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/export?projectId=${ids.projectId}&format=json`);
  assert.equal(response.status, 413);
  assert.equal(response.headers.get('content-disposition'), null);
  const failure = await response.json();
  assert.equal(failure.code, 'PROJECT_BACKUP_TOO_LARGE');
  assert.match(failure.error, /64 MiB/);
  assert.match(failure.error, /版本|state\.json/);
});

test('exported backups with over 5000 items in every project collection reimport without loss', async t => {
  const f = await fixture(t);
  const ids = await draft(f);
  await f.store.transaction(state => {
    const version = applyAction(state, { type: 'version.create', projectId: ids.projectId, name: '长'.repeat(240) });
    applyAction(state, { type: 'version.restore', projectId: ids.projectId, versionId: version.id });
    // Build through the same domain actions used by HTTP, within one disk commit.
    // Versions precede later growth so this legitimate backup stays below 64 MiB.
    for (let index = 0; index < 5001; index++) applyAction(state, { type: 'version.create', projectId: ids.projectId, name: `历史 ${index}` });
    for (let index = 0; index < 5001; index++) {
      applyAction(state, { type: 'character.upsert', projectId: ids.projectId, character: { name: `人物 ${index}` } });
      applyAction(state, { type: 'material.upsert', projectId: ids.projectId, material: { title: `素材 ${index}`, body: '保留的研究笔记' } });
      applyAction(state, { type: 'scene.add', projectId: ids.projectId, scene: { title: `场景 ${index}`, body: '保留的正文' } });
      applyAction(state, { type: 'task.upsert', projectId: ids.projectId, task: { title: `任务 ${index}`, sceneId: ids.sceneId } });
      const suggestion = prepareSuggestion(state, { ...ids, mode: 'discuss', instruction: `检查动机 ${index}` });
      appendSuggestion(state, suggestion, { text: `保留的讨论 ${index}`, model: 'test-provider' });
    }
  });
  const exported = await fetch(`${f.url}/api/export?projectId=${ids.projectId}&format=json`);
  assert.equal(exported.status, 200);
  const backup = await exported.json();
  const requestBytes = Buffer.byteLength(JSON.stringify({ action: { type: 'project.import', project: backup } }));
  assert.ok(requestBytes < 64 * 1024 * 1024);
  const imported = await f.action({ type: 'project.import', project: backup });
  assert.equal(imported.response.status, 200, imported.error);
  const copy = imported.state.projects.find(p => p.id === imported.result.projectId);
  for (const collection of ['characters', 'materials', 'scenes', 'tasks', 'versions']) {
    assert.ok(copy[collection].length > 5000, collection);
    assert.deepEqual(copy[collection], backup[collection], collection);
  }
  assert.equal(copy.aiHistory.length, 5001);
  assert.deepEqual(copy.aiHistory.map(({ id, projectId, ...entry }) => entry), backup.aiHistory.map(({ id, projectId, ...entry }) => entry));
  assert.ok(copy.aiHistory.every(entry => entry.projectId === copy.id));
  const reversed = copy.scenes.map(scene => scene.id).reverse();
  const reordered = await f.action({ type: 'scene.reorder', projectId: copy.id, sceneIds: reversed });
  assert.equal(reordered.response.status, 200);
  assert.deepEqual(reordered.state.projects.find(p => p.id === copy.id).scenes.map(scene => scene.id), reversed);
});

test('plugin model selection persists privately and standalone credential updates preserve it',async t=>{
  const {hostModel}=await import('../plugin/host.mjs');
  const adapter=hostModel({get:name=>name==='llm'?{listProviders:async()=>[{id:'p',name:'账户'}],listModels:async()=>[{id:'a',name:'甲'},{id:'b',name:'乙'}]}:name==='agentDefaultModel'?{currentSelection:()=>({provider:'p',model:'a'})}:null});
  const f=await fixture(t,{modelAdapter:adapter});
  const saved=await f.request('/api/models',{selection:{provider:'p',model:'b'}});
  assert.equal(saved.response.status,200);assert.deepEqual(saved.selection,{provider:'p',model:'b'});assert.equal(saved.connected,true);
  const settings=JSON.parse(await readFile(join(f.directory,'settings.json'),'utf8'));assert.deepEqual(settings.modelSelection,saved.selection);
  await f.request('/api/settings',{baseUrl:'https://example.com/v1',model:'standalone',apiKey:'private-key'});
  const reloaded=await f.request('/api/models');assert.deepEqual(reloaded.selection,saved.selection);assert.ok(!JSON.stringify(reloaded).includes('private-key'));
  assert.equal((await stat(join(f.directory,'settings.json'))).mode&0o077,0);
  assert.equal((await f.request('/api/state')).state.modelSelection,undefined);
  const followed=await f.request('/api/models',{selection:null});assert.equal(followed.selection,null);assert.deepEqual(followed.effective,{provider:'p',model:'a'});
});

test('assistant and legacy requests capture model routes before later plugin and host default changes',async t=>{
  const {hostModel}=await import('../plugin/host.mjs');
  let selected={provider:'p',model:'a'},prepared=[],release,entered;
  const began=new Promise(resolve=>{entered=resolve;});
  const llm={listProviders:async()=>[{id:'p',name:'账户'}],listModels:async()=>[{id:'a'},{id:'b'}],prepareCall:async options=>{prepared.push(options.model);entered();await new Promise(resolve=>{release=resolve;});return {config:{},async *stream(){yield {type:'text-delta',text:'建议'};}};}};
  const adapter=hostModel({get:name=>name==='llm'?llm:name==='agentDefaultModel'?{currentSelection:()=>selected}:null});
  const f=await fixture(t,{modelAdapter:adapter}),ids=await draft(f);
  const pending=f.request('/api/assistant',{context:{page:'script',...ids},mode:'discuss',instruction:'检查',modelSelection:{provider:'p',model:'b'}});
  await Promise.race([began,pending.then(result=>assert.equal(result.response.status,200))]);await f.request('/api/models',{selection:{provider:'p',model:'a'}});selected={provider:'p',model:'a'};release();
  const completed=await pending;assert.equal(completed.response.status,200);assert.equal(completed.turn.model,'b');assert.deepEqual(prepared,['b']);
  const legacy=f.request('/api/ai',{...ids,mode:'check',instruction:'检查',modelSelection:{provider:'p',model:'b'}});
  while(prepared.length<2)await new Promise(resolve=>setImmediate(resolve));selected={provider:'p',model:'a'};release();assert.equal((await legacy).suggestion.model,'b');
});

test('a removed saved host model is unavailable and both generation APIs refuse without provider calls',async t=>{
  const {hostModel}=await import('../plugin/host.mjs');let models=[{id:'a'},{id:'b'}],calls=0;
  const adapter=hostModel({get:name=>name==='llm'?{listProviders:async()=>[{id:'p',name:'账户'}],listModels:async()=>models,prepareCall:async()=>{calls++;throw new Error('must not call');}}:name==='agentDefaultModel'?{currentSelection:()=>({provider:'p',model:'a'})}:null});
  const f=await fixture(t,{modelAdapter:adapter}),ids=await draft(f);assert.equal((await f.request('/api/models',{selection:{provider:'p',model:'b'}})).response.status,200);models=[{id:'a'}];
  const catalog=await f.request('/api/models');assert.equal(catalog.connected,false);assert.equal(catalog.code,'MODEL_UNAVAILABLE');assert.deepEqual(catalog.selection,{provider:'p',model:'b'});
  assert.equal((await f.request('/api/ai',{...ids,mode:'check',instruction:'检查'})).code,'MODEL_UNAVAILABLE');
  assert.equal((await f.request('/api/assistant',{context:{page:'tasks'},mode:'discuss',instruction:'检查'})).code,'MODEL_UNAVAILABLE');assert.equal(calls,0);
});

test('model endpoints validate choices and reject cross-origin writes without changing private preferences',async t=>{
  const {hostModel}=await import('../plugin/host.mjs');
  const adapter=hostModel({get:name=>name==='llm'?{listProviders:async()=>[{id:'p',name:'账户'}],listModels:async()=>[{id:'a'}]}:name==='agentDefaultModel'?{currentSelection:()=>({provider:'p',model:'a'})}:null});
  const f=await fixture(t,{modelAdapter:adapter});
  for(const selection of [{provider:'p',model:'missing'},{provider:'p',model:'a',apiKey:'forged'},{provider:'p'},false])assert.ok((await f.request('/api/models',{selection})).response.status>=400);
  const denied=await fetch(`${f.url}/api/models`,{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body:JSON.stringify({selection:{provider:'p',model:'a'}})});assert.equal(denied.status,403);
  assert.equal((await f.request('/api/models')).selection,null);
});

test('null AI envelopes remain validation errors when the host supports model selection',async t=>{
  const adapter=Object.assign(async()=>({text:'unused',model:'unused'}),{resolveSelection:async()=>({provider:'p',model:'a'})});
  const f=await fixture(t,{modelAdapter:adapter});
  for(const path of ['/api/assistant','/api/ai']){
    const response=await fetch(`${f.url}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:'null'});
    assert.equal(response.status,400);
  }
});
