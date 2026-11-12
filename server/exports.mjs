import { DomainError, clone, getProject } from './domain.mjs';
import { PROJECT_IMPORT_LIMIT } from './limits.mjs';
import { projectAssistantBackup } from './assistant.mjs';
import { projectFormat } from '../shared/creation.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const visibleScenes = project => project.scenes.filter(scene => !scene.archived);
function heading(scene) { return `${scene.interior === '外景' ? 'EXT.' : 'INT.'} ${scene.location || scene.title} - ${scene.time || '日'}`; }
function exportProject(state, projectId, versionId) {
  const project = getProject(state, projectId);
  if (!versionId) {
    const assistant = projectAssistantBackup(state, project.id);
    if (!assistant) return { ...project, format: projectFormat(project) };
    const linkedSuggestions = new Set(assistant.turns.filter(turn => turn.suggestionId).map(turn => turn.suggestionId));
    // Backfill the marker in exported older assistant histories without writing
    // to live state. Import also recognizes the older unmarked turn link.
    return { ...project, format: projectFormat(project), aiHistory: project.aiHistory.map(item => linkedSuggestions.has(item.id) ? { ...item, origin: 'assistant' } : item), assistant };
  }
  const version = project.versions.find(item => item.id === versionId);
  if (!version) throw new DomainError('找不到此项目的版本', 404, 'VERSION_NOT_FOUND');
  // A version export contains its own snapshot, never current scenes/history.
  return { id: project.id, ...clone(version.snapshot), format: projectFormat(project), stage: project.stage, status: project.status, pinned: false, deadline: '', tasks: [], aiHistory: [], versions: [], createdAt: version.createdAt, updatedAt: version.createdAt, exportedVersion: { id: version.id, name: version.name, createdAt: version.createdAt } };
}
function fountain(project) {
  let act = '';
  const scenes = visibleScenes(project).map((scene, index) => {
    const section = scene.act && scene.act !== act ? `# ${scene.act}\n\n` : '';
    act = scene.act;
    return `${section}${heading(scene)}\n\n[[第 ${index + 1} 场 · ${scene.title}]]\n\n${scene.body}`;
  });
  return `Title: ${project.title.replace(/[\r\n]/g, ' ')}\nCredit: 编剧工作台导出\n${project.exportedVersion ? `Draft date: ${project.exportedVersion.name.replace(/[\r\n]/g, ' ')}\n` : ''}\n${scenes.join('\n\n\n')}\n`;
}
function printableHtml(project) {
  if (projectFormat(project) === 'novel') return novelHtml(project);
  const scenes = visibleScenes(project).map((scene, index) => `<section class="scene"><h2>${escapeHtml(`${index + 1}. ${scene.title}`)}</h2><p class="slug">${escapeHtml(heading(scene))}</p><div class="prose">${escapeHtml(scene.body)}</div></section>`).join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(project.title)}</title><style>@page{size:A4;margin:25mm}*{box-sizing:border-box}body{margin:40px auto;max-width:760px;padding:32px;color:#181818;background:#f5f3ee;font:16px/1.9 "Songti SC","SimSun",serif}article{background:white;padding:48px;box-shadow:0 2px 20px #0001}h1{text-align:center;font-size:30px;line-height:1.5;margin:18px 0 10px}.meta{text-align:center;font-size:13px;color:#666;margin-bottom:70px}h2{font-size:18px;break-after:avoid;margin:36px 0 8px}.slug{font-weight:bold;font-family:monospace;break-after:avoid}.prose{white-space:pre-wrap;overflow-wrap:anywhere}.scene{margin-bottom:36px}@media print{body{margin:0;padding:0;max-width:none;background:white;font-size:12pt}article{padding:0;box-shadow:none}.scene{break-inside:auto}h1{margin-top:55mm}.meta{break-after:page;margin-bottom:0}h2,.slug{break-after:avoid}p{orphans:3;widows:3}}</style></head><body><article><h1>${escapeHtml(project.title)}</h1><p class="meta">${escapeHtml(project.kind)}${project.exportedVersion ? ` · ${escapeHtml(project.exportedVersion.name)}` : ''}<br>编剧工作台 · 剧本导出</p>${scenes}</article></body></html>`;
}
function novelText(project, markdown = false) {
  let group = '';
  const chapters = visibleScenes(project).map((scene, index) => {
    const section = scene.act && scene.act !== group ? `${markdown ? '## ' : ''}${scene.act}\n\n` : '';
    group = scene.act;
    return `${section}${markdown ? '### ' : ''}第${index + 1}章 ${scene.title}\n\n${scene.body}`;
  });
  return `${markdown ? '# ' : ''}${project.title}\n\n${chapters.join('\n\n')}\n`;
}
function novelHtml(project) {
  let group = '';
  const chapters = visibleScenes(project).map((scene, index) => {
    const volume = scene.act && scene.act !== group ? `<h2>${escapeHtml(scene.act)}</h2>` : '';
    group = scene.act;
    return `${volume}<section><h3>${escapeHtml(`第${index + 1}章 ${scene.title}`)}</h3><div class="prose">${escapeHtml(scene.body)}</div></section>`;
  }).join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(project.title)}</title><style>@page{size:A4;margin:25mm}body{margin:40px auto;max-width:760px;padding:32px;font:16px/1.9 "Songti SC","SimSun",serif;color:#181818}h1{text-align:center}h2,h3{break-after:avoid}.meta{text-align:center;color:#666}.prose{white-space:pre-wrap;overflow-wrap:anywhere}section{margin-bottom:36px}@media print{body{margin:0;padding:0;max-width:none}}</style></head><body><article><h1>${escapeHtml(project.title)}</h1><p class="meta">${escapeHtml(project.kind)}${project.exportedVersion ? ` · ${escapeHtml(project.exportedVersion.name)}` : ''}<br>小说工作台 · 小说导出</p>${chapters}</article></body></html>`;
}
async function docxBytes(project) {
  const { Document, Packer, Paragraph, TextRun, AlignmentType } = await import('docx');
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1800, after: 360 }, children: [new TextRun({ text: project.title, bold: true, size: 40, font: '宋体' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, pageBreakBefore: false, spacing: { after: 1400 }, children: [new TextRun({ text: `${project.kind}${project.exportedVersion ? ` · ${project.exportedVersion.name}` : ''}`, size: 22, font: '宋体' })] }),
  ];
  const novel = projectFormat(project) === 'novel'; let group = '';
  visibleScenes(project).forEach((scene, index) => {
    if (novel && scene.act && scene.act !== group) children.push(new Paragraph({ keepNext: true, children: [new TextRun({ text: scene.act, bold: true, size: 28, font: '宋体' })] }));
    group = scene.act;
    children.push(new Paragraph({ pageBreakBefore: index === 0, keepNext: true, spacing: { before: 320, after: 160 }, children: [new TextRun({ text: novel ? `第${index + 1}章 ${scene.title}` : `${index + 1}. ${scene.title}`, bold: true, size: 26, font: '宋体' })] }));
    if (!novel) children.push(new Paragraph({ keepNext: true, spacing: { after: 200 }, children: [new TextRun({ text: heading(scene), bold: true, size: 22, font: '宋体' })] }));
    scene.body.split(/\r?\n/).forEach(line => children.push(new Paragraph({ spacing: { after: 100, line: 340 }, children: [new TextRun({ text: line, size: 24, font: '宋体' })] })));
  });
  const document = new Document({ creator: novel ? '小说工作台' : '编剧工作台', title: project.title, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }] });
  return Packer.toBuffer(document);
}
export async function exportDocument(state, { projectId, format, versionId }) {
  if (!['fountain', 'json', 'html', 'docx', 'markdown', 'txt'].includes(format)) throw new DomainError('请选择 Fountain、Markdown、TXT、JSON、HTML 或 DOCX 格式');
  const project = exportProject(state, projectId, versionId);
  if (format === 'fountain' && projectFormat(project) === 'novel') throw new DomainError('小说不支持 Fountain，请选择 Markdown、TXT、HTML、DOCX 或 JSON');
  if (['markdown', 'txt'].includes(format) && projectFormat(project) !== 'novel') throw new DomainError('Markdown 和 TXT 导出用于小说项目');
  if (format === 'json' && Buffer.byteLength(JSON.stringify({ action: { type: 'project.import', project } }), 'utf8') > PROJECT_IMPORT_LIMIT) {
    throw new DomainError('完整项目 JSON 超过可重新导入的 64 MiB 上限。历史仍保存在本机；请选择具体版本导出 JSON，或直接备份数据目录中的 state.json 完整文件。', 413, 'PROJECT_BACKUP_TOO_LARGE');
  }
  const types = { markdown: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', fountain: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8', html: 'text/html; charset=utf-8', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  const content = format === 'json' ? `${JSON.stringify(project, null, 2)}\n` : format === 'html' ? printableHtml(project) : format === 'fountain' ? fountain(project) : ['markdown', 'txt'].includes(format) ? novelText(project, format === 'markdown') : await docxBytes(project);
  const filename = `${project.title}${project.exportedVersion ? `-${project.exportedVersion.name}` : ''}.${format === 'markdown' ? 'md' : format}`.replace(/[\x00-\x1f\x7f/\\]/g, '_');
  return { bytes: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), contentType: types[format], filename };
}
