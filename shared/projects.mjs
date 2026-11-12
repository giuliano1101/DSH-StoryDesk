import { projectFormat } from './creation.mjs';
export function isProjectTrashed(project) { return Boolean(project?.trashedAt); }
export function modeProjects(state, format = 'screenplay', { trashed = false } = {}) { return (state?.projects || []).filter(project => projectFormat(project) === format && isProjectTrashed(project) === trashed); }
