import {creationCopy,projectFormat,roleForPage,workspaceFormat} from '../shared/creation.mjs';
import {modeProjects,isProjectTrashed} from '../shared/projects.mjs';
import {isEpisodic,projectEpisodes,sceneEpisodeId,episodeScenes} from '../shared/episodes.mjs';
export {creationCopy,projectFormat,workspaceFormat};
export const NOVEL_RELOAD='完整退出并重新打开 Harness 后加载小说创作功能';
export function requireCreationFormat(format,capabilities){if(format==='novel'&&!capabilities?.creationFormats?.includes('novel'))throw new Error(NOVEL_RELOAD);}
export function projectsForMode(state,options){return modeProjects(state,workspaceFormat(state),options);}
export const EPISODES_RELOAD='完整退出并重新打开 Harness 后加载分集功能';
export const TRASH_RELOAD='完整退出并重新打开 Harness 后加载废纸篓功能';
export function currentEpisodeId(project){if(!isEpisodic(project))return '';const episodes=projectEpisodes(project);return episodes.find(e=>e.id===project.view?.episodeId)?.id||sceneEpisodeId(project,project.scenes?.find(s=>s.id===project.view?.sceneId))||episodes[0]?.id||'';}
export function episodeField(project){return {name:'episodeId',label:'所属集',options:Object.fromEntries(projectEpisodes(project).map(e=>[e.id,e.title]))};}
export function sceneReorderAction(project,from,to,capabilities){const episodic=isEpisodic(project),episodeId=currentEpisodeId(project);if(episodic&&!capabilities?.episodes)throw new Error(EPISODES_RELOAD);const ids=(episodic?episodeScenes(project,episodeId,{includeArchived:true}):project.scenes).map(s=>s.id),i=ids.indexOf(from),j=ids.indexOf(to);if(i<0||j<0||i===j)return null;ids.splice(j,0,ids.splice(i,1)[0]);return {type:'scene.reorder',projectId:project.id,...(episodic?{episodeId}:{}),sceneIds:ids};}
export function newProjectAction(fields,format,capabilities){requireCreationFormat(format,capabilities);return {type:'project.create',...fields,...(format==='novel'?{format:'novel'}:{})};}
export function importProjectAction(value,capabilities){const project=value?.project||value;requireCreationFormat(projectFormat(project),capabilities);return {type:'project.import',project};}
export function roleForContext(context){return roleForPage(context.page,context.creationMode);}
export function closeProjectPatch(state,id){
  const ids=(state.workspace.openProjectIds||[]).filter(key=>key!==id),patch={openProjectIds:ids};
  if(state.workspace.activeProjectId===id){const visible=new Set(projectsForMode(state).map(p=>p.id)),active=ids.filter(key=>visible.has(key)).at(-1);Object.assign(patch,{activeProjectId:active||null,screen:active?'project':'overview'});}
  return patch;
}
export function createNavigationGuard(onBusy=()=>{}){
  let busy=false;
  return {isBusy:()=>busy,async run(work){if(busy)throw new Error('正在切换创作页面，请稍候。');busy=true;onBusy(true);try{return await work();}finally{busy=false;onBusy(false);}}};
}
export function createWorkspaceNavigation({getState,getCapabilities,flush,mutate,dialogs=()=>false,getView=()=>({}),guard,onBusy}){
  const transition=guard||createNavigationGuard(onBusy);
  const checkDialogs=()=>{if(dialogs())throw new Error('请先保存或取消当前编辑窗口，再切换创作入口。');};
  const prepare=async()=>{checkDialogs();await flush();checkDialogs();};
  return {
    isBusy:transition.isBusy,
    show:screen=>transition.run(async()=>{await prepare();return mutate({type:'workspace.update',patch:{screen}});}),
    enter:()=>transition.run(async()=>{await prepare();return mutate({type:'workspace.update',patch:{screen:'entry'}});}),
    choose:format=>transition.run(async()=>{requireCreationFormat(format,getCapabilities());await prepare();return mutate({type:'workspace.update',patch:{screen:'overview',...(getCapabilities()?.creationFormats?.includes('novel')?{creationMode:format}:{})}});}),
    open:(id,tab,sceneId,episodeId)=>transition.run(async()=>{
      const project=getState()?.projects.find(p=>p.id===id);if(!project||isProjectTrashed(project))throw new Error('作品已移入废纸篓，请先恢复作品。');requireCreationFormat(projectFormat(project),getCapabilities());await prepare();
      const episodic=isEpisodic(project)&&getCapabilities()?.episodes,ownedScene=project.scenes.find(s=>s.id===sceneId),selectedEpisode=episodic?(ownedScene?sceneEpisodeId(project,ownedScene):episodeId||undefined):undefined;
      if(selectedEpisode&&!projectEpisodes(project).some(e=>e.id===selectedEpisode))throw new Error('这集不属于当前作品。');
      if(tab||sceneId||selectedEpisode)await mutate({type:'view.save',projectId:id,view:{...(tab?{tab}:{}),...(sceneId?{...getView(id,sceneId),sceneId}:{}),...(selectedEpisode?{episodeId:selectedEpisode}:{})}});
      return mutate({type:'workspace.update',patch:{screen:'project',activeProjectId:id,openProjectIds:[...new Set([...(getState().workspace.openProjectIds||[]),id])]}});
    }),
  };
}
export function eligibleSharedTarget(state,preferredId){const projects=projectsForMode(state).filter(project=>project.status!=='archived');return projects.find(project=>project.id===preferredId)||projects.find(project=>project.status==='active')||projects[0];}
export function sharedImportAction(state,projectId,materialId){const eligible=projectsForMode(state).filter(project=>project.status!=='archived');if(!eligible.length)throw new Error('请先创建或恢复当前创作方式的作品。');if(!eligible.some(project=>project.id===projectId))throw new Error('目标作品已归档或不再属于当前创作方式，请重新选择。');return {type:'shared.import',projectId,materialId};}
export function pageName(page,format){return creationCopy(format).tabs[page]||({overview:'工作总览',projects:'全部项目',tasks:'我的待办',shared:'共享素材',trash:'废纸篓',entry:'创作入口'})[page]||page;}
export const NOVEL_FIELDS=[{name:'title',label:'章节名',required:true,autoFocus:true},{name:'act',label:'所属卷',placeholder:'第一卷、第二卷…'},{name:'summary',label:'概要',rows:3},{name:'intent',label:'此章目标',rows:2},{name:'outcome',label:'章末变化',rows:2}];
export function rolesForMode(roles,format){return (roles||[]).filter(role=>role.id.startsWith('novel-')===(format==='novel'));}
export function skillsForMode(skills,format,enabled=[]){return (skills||[]).filter(skill=>enabled.includes(skill.id)||!skill.builtin||(format==='novel'?skill.id.startsWith('novel-')||['project-planning','material-curation'].includes(skill.id):!skill.id.startsWith('novel-')));}
export function unitFields(project,screenplayFields){return projectFormat(project)==='novel'?[...NOVEL_FIELDS,{name:'cast',label:'人物',multiple:true,options:Object.fromEntries((project.characters||[]).map(c=>[c.id,c.name+(c.status==='archived'?'（已废弃）':'')]))}]:screenplayFields;}
export function formFieldValues(data,fields){const values=Object.fromEntries(data);for(const field of fields)if(field.multiple)values[field.name]=data.getAll(field.name);return values;}
export function createProjectLifecycle({getState,getCapabilities,flush,mutate,dialogs=()=>({editingTargets:[]}),guard}){
  const transition=guard||createNavigationGuard();
  const requireReady=()=>{if(!getCapabilities()?.projectTrash)throw new Error(TRASH_RELOAD);};
  const preflight=id=>{if(dialogs().editingTargets.some(target=>target.projectIds.includes(id)))throw new Error('本作品有尚未关闭的编辑窗口，请先保存或取消编辑。');};
  return {
    trash:id=>transition.run(async()=>{requireReady();const p=getState()?.projects.find(p=>p.id===id);if(!p||p.trashedAt)throw new Error('作品当前不可用。');preflight(id);await flush();preflight(id);if(!getState()?.projects.some(p=>p.id===id&&!p.trashedAt))throw new Error('作品状态已变化，请重新选择。');return mutate({type:'project.trash',projectId:id});}),
    restore:id=>transition.run(async()=>{requireReady();if(!getState()?.projects.some(p=>p.id===id&&p.trashedAt))throw new Error('作品已恢复或当前不可用。');await flush();return mutate({type:'project.restore',projectId:id});}),
  };
}
