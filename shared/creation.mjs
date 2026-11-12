// Browser-safe vocabulary and read normalization. Mutations validate separately.
export function projectFormat(project) { return project?.format === 'novel' ? 'novel' : 'screenplay'; }
export function workspaceFormat(state) {
  const workspace = state?.workspace;
  if (workspace?.screen === 'project') {
    const project = state.projects?.find(project => project.id === workspace.activeProjectId);
    if (project) return projectFormat(project);
  }
  return workspace?.creationMode === 'novel' ? 'novel' : 'screenplay';
}
const copies = {
  screenplay: {
    format: 'screenplay', workspaceTitle: '编剧工作台', entryLabel: '剧本创作', projectNoun: '剧本', projectName: '未命名剧本', defaultKind: '短片', unit: '场景', unitName: '未命名场景', unitCount: '场', group: '幕', groupName: '第一幕', manuscriptLabel: '剧本正文',
    tabs: { brief: '项目简报', library: '资料与人物', scenes: '分场', script: '正文' },
    stages: { idea: '故事构思', characters: '人物开发', outline: '分场', draft: '写稿', revision: '改稿', delivery: '待交付' },
    brief: { logline: '一句话故事', length: '时长', audience: '目标观众', theme: '主题', constraints: '创作约束', synopsis: '故事梗概' },
  },
  novel: {
    format: 'novel', workspaceTitle: '小说工作台', entryLabel: '小说创作', projectNoun: '小说', projectName: '未命名小说', defaultKind: '长篇小说', unit: '章节', unitName: '未命名章节', unitCount: '章', group: '卷', groupName: '第一卷', manuscriptLabel: '小说正文',
    tabs: { brief: '作品设定', library: '人物与世界观', scenes: '章节大纲', script: '正文' },
    stages: { idea: '灵感构思', characters: '人物塑造', outline: '章节大纲', draft: '小说初稿', revision: '修订打磨', delivery: '完稿导出' },
    brief: { logline: '故事前提', length: '目标字数', audience: '目标读者', theme: '主题', constraints: '视角与文风约束', synopsis: '故事梗概' },
  },
};
for (const copy of Object.values(copies)) { Object.freeze(copy.tabs); Object.freeze(copy.stages); Object.freeze(copy.brief); Object.freeze(copy); }
export function creationCopy(format) { return copies[format === 'novel' ? 'novel' : 'screenplay']; }
const roles = { overview: 'manager', projects: 'manager', trash: 'manager', tasks: 'manager', shared: 'librarian', brief: 'story', library: 'character', scenes: 'structure', script: 'writer' };
export function roleForPage(page, format) { return Object.hasOwn(roles, page) ? `${format === 'novel' ? 'novel-' : ''}${roles[page]}` : undefined; }
