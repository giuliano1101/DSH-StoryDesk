import { createHash } from 'node:crypto';
import { projectFormat } from '../shared/creation.mjs';
import { isEpisodic, projectEpisodes, episodeScenes, sceneEpisodeId } from '../shared/episodes.mjs';

const KINDS = ['project', 'character', 'world', 'reference', 'idea', 'episode', 'outline'];
const COUNTS = { outlineScenes:'outline', episodes:'episode', characters:'character', worldMaterials:'world', researchMaterials:'reference' };
const LABELS = { title:'作品名称',kind:'作品类型',logline:'故事前提',synopsis:'故事梗概',theme:'主题',constraints:'创作约束 / 视角与文风',pov:'叙述视角',pointOfView:'叙述视角',length:'篇幅 / 时长',audience:'观众 / 读者',tone:'基调',genre:'类型',name:'姓名',role:'身份与关系',goal:'人物目标',secret:'秘密与背景',voice:'语言习惯',notes:'备注',category:'分类',body:'资料内容',source:'资料来源',summary:'概要',intent:'目标',outcome:'结束变化',act:'幕 / 卷',location:'地点',time:'时间',interior:'内外景',episodeTitle:'所属集名称',episodeSummary:'所属集梗概' };
const OUTLINE_FIELDS = ['title','summary','intent','outcome','act','location','time','interior','episodeTitle','episodeSummary'];
const PROJECT_FIELDS = ['kind','logline','synopsis','theme','constraints','pov','pointOfView','length','audience','tone','genre'];
const present = value => typeof value === 'string' && value.trim().length > 0;
const sourceId = value => typeof value === 'string' && value.length ? encodeURIComponent(value) : 'unsaved';
const digest = core => createHash('sha256').update(JSON.stringify(core)).digest('hex');
const coreOf = snapshot => ({ schemaVersion:snapshot.schemaVersion,title:snapshot.title,format:snapshot.format,entries:snapshot.entries,coverage:snapshot.coverage });
const fail = message => { const error = new Error(`故事档案${message}`); error.status = 400; error.code = 'VALIDATION_ERROR'; throw error; };
function fieldsText(item, fields) {
  return fields.filter(key => present(item?.[key])).map(key => `${LABELS[key] || key}：\n${item[key]}`).join('\n\n');
}
function coverageFor(title, entries) {
  const counts = Object.fromEntries(Object.entries(COUNTS).map(([key,kind]) => [key,entries.filter(entry => entry.kind === kind).length]));
  const hasField = field => entries.some(entry => entry.kind === 'project' && (entry.id.endsWith(`:${field}`)) && present(entry.text));
  const missing = [...(!present(title) ? ['title'] : []),...['logline','synopsis','theme','constraints'].filter(field => !hasField(field)),...['characters','worldMaterials','outlineScenes'].filter(key => !counts[key])];
  if (entries.some(entry => entry.kind === 'outline' && !['summary','intent','outcome'].some(field => present(outlineFields(entry)[field])))) missing.push('outlineDetails');
  return {...counts,missing};
}
function ownedItems(project, items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter(item => item && typeof item === 'object' && typeof item.id === 'string' && item.id && (!item.projectId || item.projectId === project.id) && !seen.has(item.id) && seen.add(item.id));
}

// A deterministic read projection of the saved project. It never infers facts,
// persists a second editable source, or includes manuscript bodies.
export function captureStoryBible(project = {}) {
  const entries = [], title = typeof project.title === 'string' ? project.title : '';
  const projectId = sourceId(project.id);
  for (const field of PROJECT_FIELDS) if (present(project[field])) entries.push({id:`project:${projectId}:${field}`,kind:'project',title:LABELS[field] || field,text:project[field]});
  if (typeof project.brief === 'string' && present(project.brief)) entries.push({id:`project:${projectId}:brief`,kind:'project',title:'项目简报',text:project.brief});
  else if (project.brief && typeof project.brief === 'object') for (const field of Object.keys(project.brief).sort()) {
    if (present(project.brief[field])) entries.push({id:`project:${projectId}:brief:${sourceId(field)}`,kind:'project',title:LABELS[field] || field,text:project.brief[field]});
  }
  for (const character of ownedItems(project,project.characters).filter(item => item.status === 'adopted')) entries.push({id:`character:${sourceId(character.id)}`,kind:'character',title:character.name || '未命名人物',text:fieldsText(character,['name','role','goal','secret','voice','notes'])});
  for (const material of ownedItems(project,project.materials).filter(item => item.status === 'adopted')) {
    const kind = ['world','世界设定','世界观'].includes(material.category) ? 'world' : ['idea','灵感','创作笔记','备选情节'].includes(material.category) ? 'idea' : 'reference';
    entries.push({id:`material:${sourceId(material.id)}`,kind,title:material.title || '未命名资料',text:fieldsText(material,['title','category','body','source'])});
  }
  const episodes = ownedItems(project,projectEpisodes(project));
  for (const episode of episodes) entries.push({id:`episode:${sourceId(episode.id)}`,kind:'episode',title:episode.title || '未命名集',text:fieldsText(episode,['title','summary'])});
  const activeScenes = ownedItems(project,project.scenes).filter(item => !item.archived);
  const outlineProject = {...project,scenes:activeScenes};
  const orderedScenes = isEpisodic(project) ? episodes.flatMap(episode => episodeScenes(outlineProject,episode.id)) : activeScenes;
  for (const scene of orderedScenes) {
    const episodeId = sceneEpisodeId(project,scene), episode = episodes.find(item => item.id === episodeId);
    const context = {...scene,...(episode ? {episodeTitle:episode.title,episodeSummary:episode.summary} : {})};
    entries.push({id:`outline:${sourceId(scene.id)}`,kind:'outline',title:scene.title || (projectFormat(project) === 'novel' ? '未命名章节' : '未命名场景'),text:JSON.stringify(Object.fromEntries(OUTLINE_FIELDS.filter(field => typeof context[field] === 'string').map(field => [field,context[field]])),null,2),sceneId:scene.id,...(episode ? {episodeId:episode.id} : {})});
  }
  const core = {schemaVersion:1,title,format:projectFormat(project),entries,coverage:coverageFor(title,entries)};
  return {...core,fingerprint:digest(core)};
}

const object = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) fail(`${label}字段不正确`);
};
const string = (value,label,max = 5_000_000) => { if (typeof value !== 'string' || value.length > max) fail(`${label}须为文本`); };
const identifier = (value,label) => { string(value,label,2000); if (!value.length || /[\u0000-\u001f]/.test(value)) fail(`${label}不正确`); };

function outlineFields(entry) {
  let fields;try { fields = JSON.parse(entry.text); } catch { fail('大纲来源文本格式不正确'); }
  object(fields,OUTLINE_FIELDS,'大纲来源');
  for (const value of Object.values(fields)) string(value,'大纲字段');
  const canonical = Object.fromEntries(OUTLINE_FIELDS.filter(field => Object.hasOwn(fields,field)).map(field => [field,fields[field]]));
  if (JSON.stringify(canonical,null,2) !== entry.text) fail('大纲来源文本不是规范快照');
  return fields;
}

// Archives may refer to retired characters/materials. Scene evidence must still
// belong to an existing scene or an owned version, supplied by the caller.
export function validateStoryBible(snapshot, ownedSceneIds) {
  object(snapshot,['schemaVersion','title','format','entries','fingerprint','coverage'],'快照');
  if (snapshot.schemaVersion !== 1 || !['screenplay','novel'].includes(snapshot.format)) fail('版本或创作格式不正确');
  string(snapshot.title,'作品名称');
  if (!(ownedSceneIds instanceof Set) || !Array.isArray(snapshot.entries) || snapshot.entries.length > 100000) fail('条目或正文归属不正确');
  const ids = new Set(), scenes = new Set(), episodes = new Set();
  for (const entry of snapshot.entries) {
    object(entry,['id','kind','title','text','sceneId','episodeId'],'条目');identifier(entry.id,'来源标识');string(entry.title,'来源标题');string(entry.text,'来源文本');
    if (!KINDS.includes(entry.kind) || ids.has(entry.id)) fail('条目类别或标识不正确');ids.add(entry.id);
    const prefix = ['world','reference','idea'].includes(entry.kind) ? 'material' : entry.kind;
    if (!entry.id.startsWith(`${prefix}:`) || entry.id.length === prefix.length + 1) fail('来源标识类别不一致');
    if (entry.kind === 'episode') { if (!/^episode:[^:]+$/.test(entry.id)) fail('集来源标识不正确');episodes.add(entry.id.slice(8)); }
    if (entry.kind === 'outline') {
      outlineFields(entry);
      identifier(entry.sceneId,'正文标识');
      if (!ownedSceneIds.has(entry.sceneId) || scenes.has(entry.sceneId) || entry.id !== `outline:${sourceId(entry.sceneId)}`) fail('正文来源不属于此项目或重复');scenes.add(entry.sceneId);
      if (entry.episodeId !== undefined) { identifier(entry.episodeId,'集标识'); if (snapshot.format === 'novel') fail('小说章节不应带有剧集归属'); }
    } else if (entry.sceneId !== undefined || entry.episodeId !== undefined) fail('非大纲条目不能带有正文或集归属');
  }
  for (const entry of snapshot.entries) if (entry.episodeId !== undefined && !episodes.has(sourceId(entry.episodeId))) fail('大纲所属集缺失');
  object(snapshot.coverage,[...Object.keys(COUNTS),'missing'],'覆盖范围');
  for (const key of Object.keys(COUNTS)) if (!Number.isSafeInteger(snapshot.coverage[key]) || snapshot.coverage[key] < 0) fail('覆盖计数不正确');
  if (!Array.isArray(snapshot.coverage.missing) || snapshot.coverage.missing.some(value => typeof value !== 'string')) fail('缺失资料说明不正确');
  const expected = coverageFor(snapshot.title,snapshot.entries);
  if (JSON.stringify(snapshot.coverage.missing) !== JSON.stringify(expected.missing) || Object.keys(COUNTS).some(key => snapshot.coverage[key] !== expected[key])) fail('覆盖范围与实际来源不一致');
  if (typeof snapshot.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.fingerprint) || snapshot.fingerprint !== digest(coreOf(snapshot))) fail('快照指纹不正确');
  return structuredClone(snapshot);
}

function fence(value) {
  const runs = value.match(/`+/g) || [];
  const delimiter = '`'.repeat(runs.reduce((length,run) => Math.max(length,run.length + 1),3));
  return `${delimiter}text\n${value}\n${delimiter}`;
}
function filename(title) {
  const suffix = '-故事档案.md';
  let safe = title.normalize('NFC').trim().replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,'_').replace(/^[.\s]+|[.\s]+$/g,'') || '未命名作品';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(safe.split('.')[0].trim())) safe = `_${safe}`;
  const budget = 240 - Buffer.byteLength(suffix,'utf8');
  let base = '', bytes = 0;
  for (const codepoint of safe) {
    const size = Buffer.byteLength(codepoint,'utf8');
    if (bytes + size > budget) break;
    base += codepoint; bytes += size;
  }
  return `${base}${suffix}`;
}
export function storyBibleReferenceText(entry) {
  return entry.kind === 'outline' ? fieldsText(outlineFields(entry),OUTLINE_FIELDS) : entry.text;
}
export function storyBibleDocument(snapshot) {
  const validated = validateStoryBible(snapshot,new Set(snapshot?.entries?.filter(entry => entry.kind === 'outline').map(entry => entry.sceneId) || []));
  const distinction = {project:'作者保存的创作目标 / 计划',character:'已采用人物设定',world:'已采用世界设定',reference:'参考资料，不能自动视为故事事实或世界设定',idea:'灵感 / 计划，不能自动视为既成事实',episode:'全作品分集计划',outline:'全作品场景 / 章节大纲计划，不能视为已写成正文'};
  const lines = ['# 故事档案（由保存内容只读派生）','',fence(validated.title),'','此文档不是第二份可编辑事实源。已采用设定、参考资料与大纲计划按来源分列；没有资料的部分保持未知，不自动补造。','',`快照指纹：${validated.fingerprint}`,'', '## 覆盖范围','',fence(JSON.stringify(validated.coverage,null,2))];
  for (const entry of validated.entries) lines.push('',`## ${distinction[entry.kind]}`,'',fence(`来源 ID：${entry.id}\n标题：${entry.title}${entry.sceneId ? `\n正文来源 ID：${entry.sceneId}` : ''}${entry.episodeId ? `\n集来源 ID：${entry.episodeId}` : ''}`),'',fence(storyBibleReferenceText(entry)));
  return {...validated,filename:filename(validated.title),markdown:lines.join('\n') + '\n'};
}
