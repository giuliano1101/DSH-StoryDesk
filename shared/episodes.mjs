import { projectFormat } from './creation.mjs';

// Read-only projections: legacy series remain byte-for-byte unchanged until an
// explicit episode/scene/view write materializes this project-owned first unit.
export function isEpisodic(project) { return projectFormat(project) === 'screenplay' && ['剧集', '电视剧', '迷你剧', '短剧'].includes(project?.kind); }
export function projectEpisodes(project) {
  if (!isEpisodic(project)) return [];
  return project.episodes?.length ? project.episodes : [{ id: `episode_legacy_${project.id}`, title: '第1集', summary: '' }];
}
export function sceneEpisodeId(project, scene) { return isEpisodic(project) ? scene?.episodeId || projectEpisodes(project)[0].id : ''; }
export function episodeScenes(project, episodeId, { includeArchived = false } = {}) { return (project?.scenes || []).filter(scene => (includeArchived || !scene.archived) && (!isEpisodic(project) || sceneEpisodeId(project, scene) === episodeId)); }
export function episodeLabel(project, episodeId) { const episodes = projectEpisodes(project), index = episodes.findIndex(episode => episode.id === episodeId); return index < 0 ? '' : episodes[index].title || `第${index + 1}集`; }
