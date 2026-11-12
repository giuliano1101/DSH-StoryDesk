import { randomUUID } from 'node:crypto';
import { exampleProjects } from './examples.mjs';
import { PROJECT_IMPORT_LIMIT } from './limits.mjs';
import { importProjectAssistantBackup } from './assistant.mjs';
import { importRevisionHistory } from './revisions.mjs';
import { creationCopy, projectFormat } from '../shared/creation.mjs';

export class DomainError extends Error {
  constructor(message, status = 400, code = 'VALIDATION_ERROR') { super(message); this.status = status; this.code = code; }
}
export const clone = value => structuredClone(value);
const uid = prefix => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
const has = (value, key) => Object.hasOwn(value, key);
function fail(message, status, code) { throw new DomainError(message, status, code); }
export function object(value, label = '内容') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式不正确`);
  return value;
}
export function text(value, label, maximum = 100_000) {
  if (typeof value !== 'string' || value.length > maximum) fail(`${label}须为不超过 ${maximum} 字的文本`);
  return value;
}
export function required(value, label, maximum = 240) {
  const result = text(value, label, maximum).trim();
  if (!result) fail(`请填写${label}`);
  return result;
}
function oneOf(value, allowed, label) { if (!allowed.includes(value)) fail(`${label}不正确`); return value; }
function bool(value, label) { if (typeof value !== 'boolean') fail(`${label}须为是或否`); return value; }
function date(value = '', label = '日期') {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(`${label}格式不正确`);
  return value;
}
// Project collection counts are bounded by the API's total import byte limit,
// not a lower item count that normal editing could grow past.
function array(value, label, maximum = Infinity) { if (!Array.isArray(value) || value.length > maximum) fail(`${label}列表过长或格式不正确`); return value; }
function unique(values, label) { if (new Set(values).size !== values.length) fail(`${label}存在重复`); return values; }
function fields(input, keys, label, maximum) {
  object(input, label);
  return Object.fromEntries(keys.filter(key => has(input, key)).map(key => [key, text(input[key], label, maximum)]));
}
function brief(input = {}, previous = {}) {
  return { logline: '', length: '', audience: '', theme: '', constraints: '', ...previous, ...fields(input, ['logline', 'length', 'audience', 'theme', 'constraints'], '项目设定') };
}
function projectPatch(input) {
  const patch = fields(input, ['kind', 'synopsis'], '项目资料');
  if (has(input, 'title')) patch.title = required(input.title, '项目名称');
  if (has(input, 'deadline')) patch.deadline = date(input.deadline);
  if (has(input, 'stage')) patch.stage = oneOf(input.stage, ['idea', 'characters', 'outline', 'draft', 'revision', 'delivery'], '创作阶段');
  if (has(input, 'status')) patch.status = oneOf(input.status, ['active', 'paused', 'archived'], '项目状态');
  if (has(input, 'pinned')) patch.pinned = bool(input.pinned, '置顶');
  return patch;
}
export function newProject(input = {}) {
  const format = has(input, 'format') ? oneOf(input.format, ['screenplay', 'novel'], '创作格式') : 'screenplay';
  const copy = creationCopy(format);
  return { id: uid('project'), format, title: copy.projectName, kind: copy.defaultKind, stage: 'idea', status: 'active', pinned: false, deadline: '', synopsis: '', brief: brief(), characters: [], materials: [], scenes: [], tasks: [], versions: [], aiHistory: [], view: { tab: 'script', sceneId: '', cursor: 0, scrollTop: 0, inspector: 'ai' }, createdAt: now(), updatedAt: now(), ...projectPatch(input) };
}
function referencePatch(input, keys) {
  const patch = fields(input, keys, '参考资料', 500_000);
  if (has(input, 'status')) patch.status = oneOf(input.status, ['adopted', 'alternative', 'archived'], '素材状态');
  return patch;
}
const characterPatch = input => referencePatch(input, ['name', 'role', 'goal', 'secret', 'voice', 'notes']);
const materialPatch = input => referencePatch(input, ['title', 'category', 'body', 'source']);
export function newCharacter(input = {}) { return { id: uid('character'), name: '', role: '', goal: '', secret: '', voice: '', notes: '', status: 'adopted', ...characterPatch(input) }; }
export function newMaterial(input = {}) { return { id: uid('material'), title: '', category: '灵感', body: '', source: '', status: 'adopted', ...materialPatch(input) }; }
function scenePatch(input, project) {
  const patch = fields(input, ['title', 'location', 'time', 'act', 'summary', 'intent', 'outcome'], '场景资料');
  if (has(input, 'body')) patch.body = text(input.body, '正文', 1_000_000);
  if (has(input, 'interior')) patch.interior = oneOf(input.interior, ['内景', '外景'], '内外景');
  if (has(input, 'archived')) patch.archived = bool(input.archived, '场景归档');
  if (has(input, 'cast')) {
    patch.cast = unique(array(input.cast, '出场人物', 500), '出场人物');
    if (patch.cast.some(id => typeof id !== 'string' || !project.characters.some(c => c.id === id))) fail('出场人物不属于此项目');
  }
  return patch;
}
export function newScene(input = {}, project) { const copy = creationCopy(projectFormat(project)); return { id: uid('scene'), title: copy.unitName, location: '', time: projectFormat(project) === 'novel' ? '' : '日', interior: '内景', act: copy.groupName, cast: [], summary: '', intent: '', outcome: '', body: '', revision: 0, archived: false, ...scenePatch(input, project) }; }
function taskPatch(input, project) {
  object(input, '任务');
  const patch = {};
  if (has(input, 'title')) patch.title = required(input.title, '任务名称', 1_000);
  if (has(input, 'sceneId')) { patch.sceneId = text(input.sceneId ?? '', '任务场景', 200); if (patch.sceneId && !project.scenes.some(s => s.id === patch.sceneId)) fail('任务场景不属于此项目'); }
  if (has(input, 'due')) patch.due = date(input.due, '任务日期');
  if (has(input, 'done')) patch.done = bool(input.done, '任务完成状态');
  return patch;
}
export function getProject(state, id) { const p = state.projects.find(item => item.id === id); if (!p) fail('找不到此项目', 404, 'PROJECT_NOT_FOUND'); return p; }
export function getScene(project, id) { const s = project.scenes.find(item => item.id === id); if (!s) fail('找不到此项目的场景', 404, 'SCENE_NOT_FOUND'); return s; }
export function snapshot(project) { const { title, kind, synopsis, brief, characters, materials, scenes } = project; return clone({ format: projectFormat(project), title, kind, synopsis, brief, characters, materials, scenes }); }
export function addVersion(project, name) { const v = { id: uid('version'), name, createdAt: now(), snapshot: snapshot(project) }; project.versions.push(v); return v; }
function importedId(input, generated, label) { return input.id === undefined ? generated : required(input.id, `${label}标识`, 200); }
function validTimestamp(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('时间格式不正确'); return new Date(value).toISOString(); }
function importSnapshot(input, ownerFormat) {
  object(input, '备份');
  if (ownerFormat && has(input, 'format') && input.format !== ownerFormat) fail('版本备份创作格式与所属项目不一致');
  const p = newProject(ownerFormat ? { ...input, format: ownerFormat } : input);
  p.brief = brief(input.brief ?? {});
  p.characters = array(input.characters ?? [], '人物').map(item => { object(item); const c = newCharacter(item); c.id = importedId(item, c.id, '人物'); return c; });
  unique(p.characters.map(c => c.id), '人物标识');
  p.materials = array(input.materials ?? [], '素材').map(item => { object(item); const m = newMaterial(item); m.id = importedId(item, m.id, '素材'); return m; });
  unique(p.materials.map(m => m.id), '素材标识');
  p.scenes = array(input.scenes ?? [], '场景').map(item => {
    object(item); const s = newScene(item, p); s.id = importedId(item, s.id, '场景');
    if (has(item, 'revision') && (!Number.isSafeInteger(item.revision) || item.revision < 0)) fail('场景修订号不正确');
    s.revision = item.revision ?? 0; return s;
  });
  unique(p.scenes.map(s => s.id), '场景标识');
  return p;
}
function importProject(input) {
  const p = importSnapshot(input);
  p.tasks = array(input.tasks ?? [], '任务').map(item => { object(item); const task = { id: uid('task'), title: '未命名任务', sceneId: '', due: '', done: false, ...taskPatch(item, p) }; task.id = importedId(item, task.id, '任务'); return task; });
  unique(p.tasks.map(item => item.id), '任务标识');
  p.versions = array(input.versions ?? [], '版本').map(item => {
    object(item, '版本');
    // Restore/AI snapshot labels may extend an author's 240-character name.
    // Preserve generated labels exactly; the whole backup is already byte-bounded.
    required(item.name, '版本名称', PROJECT_IMPORT_LIMIT);
    return { id: importedId(item, uid('version'), '版本'), name: item.name, createdAt: validTimestamp(item.createdAt), snapshot: snapshot(importSnapshot(item.snapshot, projectFormat(p))) };
  });
  unique(p.versions.map(item => item.id), '版本标识');
  importRevisionHistory(input, p);
  // Remap project ownership while preserving adoption state; every apply still
  // validates the imported source revision, body, and selection against the copy.
  // Older assistant backups predate the origin marker. Their server-created
  // turn links identify the same suggestions and must remain inert on import,
  // including adoption through the legacy ai.apply endpoint.
  const assistantSuggestionIds = new Set((Array.isArray(input.assistant?.turns) ? input.assistant.turns : []).filter(turn => turn && typeof turn.suggestionId === 'string').map(turn => turn.suggestionId));
  p.aiHistory = array(input.aiHistory ?? [], 'AI 历史').map(item => {
    object(item, 'AI 历史');
    const assistantOrigin = item.origin === 'assistant' || assistantSuggestionIds.has(item.id);
    return { id: uid('suggestion'), projectId: p.id, sceneId: text(item.sceneId ?? '', '场景标识', 200), sourceRevision: Number.isSafeInteger(item.sourceRevision) && item.sourceRevision >= 0 ? item.sourceRevision : 0, sourceText: text(item.sourceText ?? '', '原正文', 1_000_000), selection: item.selection ? validateSelection(item.selection, item.sourceText ?? '') : null, mode: oneOf(item.mode, ['discuss', 'check', 'rewrite'], 'AI 模式'), prompt: text(item.prompt ?? '', '历史指令', 10_000), text: text(item.text ?? '', '历史建议', 1_000_000), model: text(item.model ?? '', '模型名称', 200), createdAt: validTimestamp(item.createdAt), applied: bool(item.applied ?? false, '建议采用状态'), ...(assistantOrigin ? { origin: 'assistant', readOnly: true } : {}) };
  });
  if (input.view) saveView(p, input.view);
  if (input.createdAt) p.createdAt = validTimestamp(input.createdAt);
  return p;
}
function saveView(p, input) {
  const patch = fields(input, ['tab', 'inspector'], '视图', 100);
  if (has(input, 'sceneId')) { patch.sceneId = text(input.sceneId ?? '', '场景标识', 200); if (patch.sceneId && !p.scenes.some(s => s.id === patch.sceneId)) fail('视图场景不属于此项目'); }
  if (has(input, 'scrollTop')) { if (!Number.isFinite(input.scrollTop) || input.scrollTop < 0) fail('滚动位置不正确'); patch.scrollTop = input.scrollTop; }
  if (has(input, 'cursor')) {
    if (typeof input.cursor === 'number') {
      if (!Number.isSafeInteger(input.cursor) || input.cursor < 0) fail('光标位置不正确');
      patch.cursor = input.cursor;
    } else {
      const cursor = object(input.cursor, '光标');
      if (!Number.isSafeInteger(cursor.start) || !Number.isSafeInteger(cursor.end) || cursor.start < 0 || cursor.end < cursor.start) fail('光标位置不正确');
      patch.cursor = { start: cursor.start, end: cursor.end };
    }
  }
  Object.assign(p.view, patch);
}
export function validateSelection(selection, body) {
  if (selection === undefined || selection === null) return null;
  object(selection, '选区'); const { start, end } = selection;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > body.length || body.slice(start, end) !== selection.text) fail('选区与当前正文不一致，请重新选择', 400, 'INVALID_SELECTION');
  return { start, end, text: selection.text };
}
export function prepareSuggestion(state, input) {
  object(input, 'AI 请求'); const p = getProject(state, input.projectId); const s = getScene(p, input.sceneId);
  if (s.archived) fail('请先恢复归档场景');
  return { id: uid('suggestion'), projectId: p.id, sceneId: s.id, sourceRevision: s.revision, sourceText: s.body, selection: validateSelection(input.selection, s.body), mode: oneOf(input.mode, ['discuss', 'check', 'rewrite'], 'AI 模式'), prompt: required(input.instruction, 'AI 指令', 10_000), text: '', model: '', createdAt: now(), applied: false };
}
export function appendSuggestion(state, suggestion, output) {
  const p = getProject(state, suggestion.projectId);
  const result = { ...suggestion, text: required(output?.text, '模型回复', 1_000_000), model: text(output?.model ?? '已连接模型', '模型名称', 200), createdAt: now() };
  p.aiHistory.push(result); return clone(result);
}
export function applyAction(state, action) {
  object(action, '操作'); text(action.type, '操作类型', 100);
  if (action.type === 'project.create' || action.type === 'project.import') {
    const p = action.type === 'project.import' ? importProject(action.project) : newProject(Object.fromEntries(['title', 'kind', 'deadline', 'format'].filter(key => has(action, key)).map(key => [key, action[key]])));
    if (action.type === 'project.create' && action.text !== undefined && text(action.text, '初始正文', 1_000_000)) { const s = newScene({ ...(projectFormat(p) === 'novel' ? {} : { title: '导入正文' }), body: action.text }, p); p.scenes.push(s); p.view.sceneId = s.id; }
    state.projects.push(p); state.workspace.activeProjectId = p.id; state.workspace.openProjectIds.push(p.id); state.workspace.screen = 'project'; state.workspace.creationMode = projectFormat(p);
    if (action.type === 'project.import') importProjectAssistantBackup(state, action.project.assistant, p.id);
    return { projectId: p.id };
  }
  if (action.type === 'workspace.update') {
    const input = object(action.patch, '工作区'); const patch = {};
    if (has(input, 'screen')) patch.screen = oneOf(input.screen, ['entry', 'overview', 'projects', 'project', 'library', 'tasks', 'shared', 'settings'], '工作区页面');
    if (has(input, 'theme')) patch.theme = oneOf(input.theme, ['light', 'dark'], '主题');
    if (has(input, 'overviewMode')) patch.overviewMode = oneOf(input.overviewMode, ['grid', 'list'], '概览模式');
    if (has(input, 'creationMode')) patch.creationMode = oneOf(input.creationMode, ['screenplay', 'novel'], '创作模式');
    if (has(input, 'activeProjectId')) { patch.activeProjectId = text(input.activeProjectId ?? '', '项目标识', 200); if (patch.activeProjectId) getProject(state, patch.activeProjectId); }
    if (has(input, 'openProjectIds')) { patch.openProjectIds = unique(array(input.openProjectIds, '已打开项目', 200), '已打开项目'); patch.openProjectIds.forEach(id => getProject(state, id)); }
    const next = { ...state.workspace, ...patch };
    if (next.screen === 'project' && next.activeProjectId) patch.creationMode = projectFormat(getProject(state, next.activeProjectId));
    Object.assign(state.workspace, patch); return;
  }
  if (action.type === 'shared.add') { const m = newMaterial(action.material); if (!m.title.trim()) fail('请填写素材名称'); state.sharedMaterials.push(m); return { id: m.id }; }
  if (action.type === 'shared.update') {
    const material = state.sharedMaterials.find(item => item.id === action.materialId);
    if (!material) fail('找不到共享素材', 404);
    const patch = materialPatch(object(action.patch, '共享素材修改'));
    if (has(patch, 'title') && !patch.title.trim()) fail('请填写素材名称');
    Object.assign(material, patch); return { id: material.id };
  }
  if (!['project.update', 'scene.add', 'scene.update', 'scene.reorder', 'character.upsert', 'material.upsert', 'shared.import', 'task.upsert', 'task.toggle', 'view.save', 'version.create', 'version.restore', 'ai.apply'].includes(action.type)) fail('不支持此操作', 400, 'UNKNOWN_ACTION');
  const p = getProject(state, action.projectId); let result;
  switch (action.type) {
    case 'project.update': if (has(object(action.patch, '项目修改'), 'format')) fail('项目创作格式不可修改'); Object.assign(p, projectPatch(action.patch)); if (has(action.patch, 'brief')) p.brief = brief(action.patch.brief, p.brief); break;
    case 'scene.add': { const s = newScene(action.scene ?? {}, p); p.scenes.push(s); if (!p.view.sceneId) p.view.sceneId = s.id; result = { sceneId: s.id }; break; }
    case 'scene.update': { const s = getScene(p, action.sceneId); const patch = scenePatch(action.patch, p); if (has(patch, 'body') && patch.body !== s.body) s.revision += 1; Object.assign(s, patch); break; }
    case 'scene.reorder': { const ids = array(action.sceneIds, '场景顺序'); if (ids.length !== p.scenes.length || new Set(ids).size !== ids.length || ids.some(id => !p.scenes.some(s => s.id === id))) fail('场景顺序必须完整且不可重复'); const byId = new Map(p.scenes.map(s => [s.id, s])); p.scenes = ids.map(id => byId.get(id)); break; }
    case 'character.upsert':
    case 'material.upsert': {
      const isCharacter = action.type === 'character.upsert'; const input = object(isCharacter ? action.character : action.material, '参考资料'); const items = isCharacter ? p.characters : p.materials; let item;
      if (input.id) { item = items.find(i => i.id === input.id); if (!item) fail(isCharacter ? '找不到此项目的人物' : '找不到此项目的素材', 404); Object.assign(item, isCharacter ? characterPatch(input) : materialPatch(input)); }
      else { item = isCharacter ? newCharacter(input) : newMaterial(input); items.push(item); }
      if (!(isCharacter ? item.name : item.title).trim()) fail(isCharacter ? '请填写人物名称' : '请填写素材名称'); result = { id: item.id }; break;
    }
    case 'shared.import': { const source = state.sharedMaterials.find(m => m.id === action.materialId); if (!source) fail('找不到共享素材', 404); const m = { ...clone(source), id: uid('material'), source: source.source || `共享素材库：${source.title}` }; p.materials.push(m); result = { id: m.id }; break; }
    case 'task.upsert': { const input = object(action.task, '任务'); let task; if (input.id) { task = p.tasks.find(i => i.id === input.id); if (!task) fail('找不到此项目的任务', 404); Object.assign(task, taskPatch(input, p)); } else { task = { id: uid('task'), title: '', sceneId: '', due: '', done: false, ...taskPatch(input, p) }; if (!task.title) fail('请填写任务名称'); p.tasks.push(task); } result = { id: task.id }; break; }
    case 'task.toggle': { const task = p.tasks.find(i => i.id === action.taskId); if (!task) fail('找不到此项目的任务', 404); task.done = !task.done; break; }
    case 'view.save': saveView(p, action.view); return;
    case 'version.create': result = { id: addVersion(p, required(action.name, '版本名称')).id }; break;
    case 'version.restore': {
      const version = p.versions.find(v => v.id === action.versionId); if (!version) fail('找不到此项目的版本', 404);
      const revisions = new Map();
      for (const s of [...p.scenes, ...p.versions.flatMap(v => v.snapshot.scenes)]) revisions.set(s.id, Math.max(revisions.get(s.id) ?? -1, s.revision));
      for (const suggestion of p.aiHistory) revisions.set(suggestion.sceneId, Math.max(revisions.get(suggestion.sceneId) ?? -1, suggestion.sourceRevision));
      const format = projectFormat(p);
      if (has(version.snapshot, 'format') && version.snapshot.format !== format) fail('版本创作格式与所属项目不一致');
      addVersion(p, `恢复前 · ${version.name}`); Object.assign(p, clone(version.snapshot), { format });
      p.scenes.forEach(s => { s.revision = (revisions.get(s.id) ?? s.revision) + 1; });
      p.tasks.forEach(task => { if (!p.scenes.some(s => s.id === task.sceneId)) task.sceneId = ''; });
      if (!p.scenes.some(s => s.id === p.view.sceneId)) p.view.sceneId = p.scenes[0]?.id ?? '';
      result = { id: addVersion(p, `已恢复 · ${version.name}`).id }; break;
    }
    case 'ai.apply': {
      const suggestion = p.aiHistory.find(item => item.id === action.suggestionId); if (!suggestion) fail('找不到此项目的 AI 建议', 404);
      if (suggestion.readOnly) fail('导入的助手建议仅供阅读，请基于当前内容重新生成', 400, 'READ_ONLY_SUGGESTION');
      const writtenTurn = Object.values(state.assistant?.threads || {}).flat().some(turn => turn.projectId === p.id && turn.suggestionId === suggestion.id && turn.write);
      if (suggestion.applied || writtenTurn) fail('此建议已处理，不能重复采用', 409, 'ALREADY_APPLIED');
      if (suggestion.mode !== 'rewrite') fail('讨论和检查结果不可直接替换正文');
      const s = p.scenes.find(scene => scene.id === suggestion.sceneId);
      if (!s || s.archived || s.revision !== suggestion.sourceRevision || s.body !== suggestion.sourceText) fail('原文已有修改，请基于当前正文重新生成建议', 409, 'STALE_SUGGESTION');
      const selection = validateSelection(suggestion.selection, s.body); addVersion(p, `采用 AI 前 · ${s.title}`);
      s.body = selection ? s.body.slice(0, selection.start) + suggestion.text + s.body.slice(selection.end) : suggestion.text; s.revision += 1; suggestion.applied = true;
      // Both APIs adopt the same authoritative suggestion. Keep the assistant
      // preview synchronized when an older client adopts through ai.apply.
      for (const turns of Object.values(state.assistant?.threads || {})) for (const turn of turns) {
        if (turn.projectId === p.id && turn.suggestionId === suggestion.id) turn.applied = true;
      }
      result = { sceneId: s.id }; break;
    }
  }
  p.updatedAt = now(); return result;
}
export function createInitialState(seed = true) {
  const state = { schemaVersion: 1, revision: 0, projects: [], sharedMaterials: [], workspace: { screen: 'overview', activeProjectId: '', openProjectIds: [], theme: 'light', overviewMode: 'grid' } };
  if (seed === false || seed === null) return state;
  if (Array.isArray(seed)) { state.projects = seed.map(importProject); return state; }
  if (seed && typeof seed === 'object') { if (seed.schemaVersion !== 1 || !Array.isArray(seed.projects)) fail('初始数据格式不正确'); return clone(seed); }
  state.projects = exampleProjects({ newProject, newCharacter, newMaterial, newScene, addVersion }); return state;
}
