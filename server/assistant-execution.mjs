import { DomainError, applyAction, getProject, getScene, required, validateSelection } from './domain.mjs';
import { isEpisodic, projectEpisodes, sceneEpisodeId } from '../shared/episodes.mjs';
import { isProjectTrashed } from '../shared/projects.mjs';
import { ownedEpisode } from './domain.mjs';
import { creationCopy, projectFormat, workspaceFormat } from '../shared/creation.mjs';

const projectPages = ['brief', 'library', 'scenes', 'script'];
const workspacePages = ['overview', 'projects', 'tasks', 'shared', 'trash'];
const fail = message => { throw new DomainError(message); };
const own = (value, key) => Object.hasOwn(value, key);

export const executionSchemas = {
  'scene.write': { projectId: 'current project ID', sceneId: 'current script scene ID', placement: 'append|replace|selection; selection never expands to whole scene', text: 'nonempty screenplay text' },
  'ui.navigate': { page: 'overview|projects|tasks|shared|trash|brief|library|scenes|script', projectId: 'existing project ID required only for project pages', sceneId: 'existing scene ID in that project, optional only for script/scenes', episodeId: 'existing episode ID in that project, optional only for episodic script/scenes' },
};
export function validateNavigation(state, action) {
  if (![...projectPages, ...workspacePages].includes(action.page)) fail('导航页面不正确');
  if (projectPages.includes(action.page)) {
    const p = getProject(state, required(action.projectId, '导航项目标识', 200));
    if (own(action, 'episodeId')) { if (!['scenes', 'script'].includes(action.page)) fail('此导航页面不接受集'); ownedEpisode(p, action.episodeId); }
    if (own(action, 'sceneId')) {
      if (!['scenes', 'script'].includes(action.page)) fail('此导航页面不接受场景');
      const scene = getScene(p, required(action.sceneId, '导航场景标识', 200));
      if (action.episodeId && sceneEpisodeId(p, scene) !== action.episodeId) fail('导航场景与所选集不一致');
    }
  } else if (own(action, 'projectId') || own(action, 'sceneId') || own(action, 'episodeId')) fail('全局导航页面不接受项目或场景');
}
export function navigationMatches(state, context) {
  if (workspaceFormat(state) !== (context.creationMode || 'screenplay')) return false;
  if (projectPages.includes(context.page)) {
    const p = state.projects.find(p => p.id === context.projectId);
    return Boolean(p && !isProjectTrashed(p) && (!context.episodeId || (projectEpisodes(p).some(e => e.id === p.view.episodeId) ? p.view.episodeId : projectEpisodes(p)[0]?.id) === context.episodeId) && state.workspace.screen === 'project' && state.workspace.activeProjectId === p.id && p.view.tab === context.page && (!context.sceneId || p.view.sceneId === context.sceneId));
  }
  return state.workspace.screen === context.page;
}
export function applyNavigation(state, action) {
  validateNavigation(state, action);
  if (projectPages.includes(action.page)) {
    const p = getProject(state, action.projectId);
    applyAction(state, { type: 'view.save', projectId: p.id, view: { tab: action.page, ...(action.sceneId ? { sceneId: action.sceneId } : {}), ...(action.episodeId ? { episodeId: action.episodeId } : {}) } });
    applyAction(state, { type: 'workspace.update', patch: { screen: 'project', creationMode: projectFormat(p), activeProjectId: p.id, openProjectIds: [...new Set([...state.workspace.openProjectIds, p.id])] } });
  } else applyAction(state, { type: 'workspace.update', patch: { screen: action.page } });
  return { page: action.page, ...(action.projectId ? { projectId: action.projectId } : {}), ...(action.sceneId ? { sceneId: action.sceneId } : {}), ...(action.episodeId ? { episodeId: action.episodeId } : {}) };
}
export function validateSceneWrite(state, context, action, scope) {
  if (context.page !== 'script' || !context.sceneId || action.projectId !== context.projectId || action.sceneId !== context.sceneId) fail('正文写入只能指向当前正文页的当前场景');
  const p = getProject(state, action.projectId), s = getScene(p, action.sceneId);
  if (p.status === 'archived' || s.archived) fail('请先恢复归档项目或场景，再写入正文');
  if (!['append', 'replace', 'selection'].includes(action.placement)) fail('正文写入位置不正确');
  required(action.text, '写入正文', 1_000_000);
  if (scope === 'selection' && !context.selection) fail('选区范围写入缺少已捕获的非空原文，不能扩大为整场或追加写入');
  if (action.placement === 'replace' && context.selection && scope !== 'scene') fail('已捕获精确选区，不能隐式扩大为整场替换');
  if (action.placement === 'selection') {
    if (!context.selection) fail('请重新选择非空原文，不能退回整场替换');
    validateSelection(context.selection, s.body);
  }
}
export function sceneWriteAction(state, context, action, scope) {
  validateSceneWrite(state, context, action, scope);
  const body = getScene(getProject(state, action.projectId), action.sceneId).body;
  const selection = action.placement === 'selection' ? validateSelection(context.selection, body) : null;
  const next = action.placement === 'append' ? body + (body ? '\n\n' : '') + action.text : selection ? body.slice(0, selection.start) + action.text + body.slice(selection.end) : action.text;
  return { type: 'scene.update', projectId: action.projectId, sceneId: action.sceneId, patch: { body: next } };
}
const target = (target, label) => ({ target, label });
export function replyWriteTargets(state, context) {
  if (context.page === 'trash') return [];
  if (!context.projectId) return [target('shared.new', '存为共享素材')];
  const p = getProject(state, context.projectId);
  const copy = creationCopy(projectFormat(p));
  if (p.status === 'archived') return [];
  if (context.page === 'script') {
    if (!context.sceneId || getScene(p, context.sceneId).archived) return [];
    return [target('script.append', `追加到当前${copy.unit}正文`), ...(context.selection ? [target('script.selection', '替换发送时选中的段落')] : []), target('script.replace', `替换整个当前${copy.unit}正文`)];
  }
  if (context.page === 'brief') return ['synopsis', 'logline', 'theme', 'constraints'].map(field => target(`brief.${field}`, `写入${copy.brief[field]}`));
  if (context.page === 'library') {
    const focused = context.focus && (context.focus.kind === 'character' ? p.characters : p.materials).find(item => item.id === context.focus.id);
    return [...(focused && focused.status !== 'archived' ? [target(context.focus.kind === 'character' ? 'character.notes' : 'material.body', context.focus.kind === 'character' ? '写入当前人物笔记' : '写入当前素材正文')] : []), target('material.new', '存为当前项目新素材')];
  }
  if (context.page === 'scenes') return [target('scene.new.summary', `新建${copy.format === 'novel' ? '章节' : '分场'}并写入梗概`), target('scene.new.body', `新建${copy.format === 'novel' ? '章节' : '分场'}并写入正文`)];
  return [];
}
export function replyWriteAction(state, context, input, savedText) {
  const choice = replyWriteTargets(state, context).find(item => item.target === input.target);
  if (!choice) fail('写入目标不属于此回复的原始页面，或原目标已归档/选区不存在');
  const value = own(input, 'text') ? input.text : savedText;
  required(value, '写入文本', 1_000_000);
  const isNew = ['material.new', 'scene.new.summary', 'scene.new.body', 'shared.new'].includes(input.target);
  if (own(input, 'title') && !isNew) fail('此写入目标不接受新建标题');
  const title = isNew ? own(input, 'title') ? required(input.title, '新建名称') : '助手写入' : undefined;
  const p = context.projectId ? getProject(state, context.projectId) : null;
  let action, destination = { page: context.page, ...(p ? { projectId: p.id } : {}), ...(context.episodeId ? { episodeId: context.episodeId } : {}), label: choice.label };
  if (input.target.startsWith('script.')) {
    const placement = input.target.split('.')[1];
    action = sceneWriteAction(state, context, { projectId: p.id, sceneId: context.sceneId, placement: placement === 'selection' ? 'selection' : placement === 'append' ? 'append' : 'replace', text: value }, 'scene');
    destination = { ...destination, sceneId: context.sceneId, field: 'body' };
  } else if (input.target.startsWith('brief.')) {
    const field = input.target.split('.')[1];
    action = { type: 'project.update', projectId: p.id, patch: field === 'synopsis' ? { synopsis: value } : { brief: { [field]: value } } };
    destination.field = field;
  } else if (input.target === 'character.notes' || input.target === 'material.body') {
    const character = input.target === 'character.notes';
    action = { type: character ? 'character.upsert' : 'material.upsert', projectId: p.id, [character ? 'character' : 'material']: { id: context.focus.id, [character ? 'notes' : 'body']: value } };
    destination = { ...destination, focus: { ...context.focus }, field: character ? 'notes' : 'body' };
  } else if (input.target.startsWith('scene.new.')) {
    const field = input.target.endsWith('.summary') ? 'summary' : 'body';
    action = { type: 'scene.add', projectId: p.id, scene: { title, [field]: value, ...(context.episodeId ? { episodeId: context.episodeId } : {}) } };
    destination = { ...destination, page: field === 'body' ? 'script' : 'scenes', field };
  } else {
    action = { type: input.target === 'shared.new' ? 'shared.add' : 'material.upsert', ...(p ? { projectId: p.id } : {}), material: { title, body: value, source: '助手回复', status: 'alternative' } };
    destination.page = p ? 'library' : 'shared';
  }
  return { action, destination, text: value };
}
