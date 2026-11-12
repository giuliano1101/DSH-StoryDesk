import {creationCopy,projectFormat} from '../shared/creation.mjs';
const base = () => window.__SCREENWRITER_API_BASE__ || '/api';
export async function request(path, body, options = {}) {
  const res = await fetch(`${base()}${path}`, body === undefined ? options : {
    ...options, method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '暂时无法完成，请重试'), {code: data.code,status:res.status});
  return data;
}
export async function exportFile(projectId, format, versionId) {
  const query = new URLSearchParams({projectId, format, ...(versionId ? {versionId} : {})});
  const res = await fetch(`${base()}/export?${query}`);
  if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || '导出失败'); }
  return {blob: await res.blob(), name: decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('content-disposition') || '')?.[1] || `剧本.${format}`)};
}
export const STAGES = {idea:'故事构思',characters:'人物开发',outline:'分场',draft:'写稿',revision:'改稿',delivery:'待交付'};
export const TABS = {brief:'项目简报',library:'资料与人物',scenes:'分场',script:'正文'};
export const ADOPT = {adopted:'已采用',alternative:'备选',archived:'已废弃'};
export function sceneHeading(s,project) { if((typeof project==='string'?project:projectFormat(project))==='novel')return s.title||'未命名章节'; return `${s.interior || '内景'} · ${s.location || s.title || '未命名场景'} · ${s.time || '日'}`; }
export function dueLabel(date) { return date ? `${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日` : '未设置'; }
export function recentPosition(p) {
  const copy=creationCopy(projectFormat(p));
  const scene = p.scenes.find(s => s.id === p.view?.sceneId && !s.archived);
  return p.view?.tab === 'library' ? copy.tabs.library : p.view?.tab === 'brief' ? copy.tabs.brief : `${p.view?.tab === 'scenes' ? copy.tabs.scenes : '正文'}${scene ? ` · 第${String(p.scenes.indexOf(scene)+1).padStart(2,'0')}${copy.unitCount}` : ''}`;
}
