const VIEW_ACTIONS=new Set(['workspace.update','view.save','version.create']);
export function createEditingGate(){
  const locks=new Map();
  const conflicts=(target,other)=>target.shared&&other.shared||target.projectIds.some(id=>other.projectIds.includes(id));
  return {
    acquire(target){if([...locks.values()].some(other=>conflicts(target,other)))throw new Error('这项内容正在采用其他修改，请稍候。');const token=Symbol('adoption');locks.set(token,target);return token;},
    release(token){locks.delete(token);},
    isProjectLocked(id){return [...locks.values()].some(target=>target.projectIds.includes(id));},
    isSharedLocked(){return [...locks.values()].some(target=>target.shared);},
    allows(action,token){if(VIEW_ACTIONS.has(action.type))return true;return ![...locks].some(([owner,target])=>owner!==token&&(target.projectIds.includes(action.projectId)||target.shared&&['shared.add','shared.update'].includes(action.type)));},
  };
}
export function adoptionTargets(turn,projectId){
  const actions=(turn.actions||[]).map(entry=>entry.action).filter(action=>action.type!=='ui.navigate'),projectIds=[...new Set([turn.projectId||projectId,...actions.map(action=>action.projectId)].filter(Boolean))];
  return {projectIds,shared:actions.some(action=>['shared.add','shared.update'].includes(action.type))};
}
