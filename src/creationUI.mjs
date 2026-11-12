import {creationCopy,projectFormat,roleForPage,workspaceFormat} from '../shared/creation.mjs';
export {creationCopy,projectFormat,workspaceFormat};
export const NOVEL_RELOAD='完整退出并重新打开 Harness 后加载小说创作功能';
export function requireCreationFormat(format,capabilities){if(format==='novel'&&!capabilities?.creationFormats?.includes('novel'))throw new Error(NOVEL_RELOAD);}
export function projectsForMode(state){return (state?.projects||[]).filter(project=>projectFormat(project)===workspaceFormat(state));}
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
    enter:()=>transition.run(async()=>{await prepare();return mutate({type:'workspace.update',patch:{screen:'entry'}});}),
    choose:format=>transition.run(async()=>{requireCreationFormat(format,getCapabilities());await prepare();return mutate({type:'workspace.update',patch:{screen:'overview',...(getCapabilities()?.creationFormats?.includes('novel')?{creationMode:format}:{})}});}),
    open:(id,tab,sceneId)=>transition.run(async()=>{
      const project=getState()?.projects.find(p=>p.id===id);if(!project)throw new Error('作品当前不可用。');requireCreationFormat(projectFormat(project),getCapabilities());await flush();
      if(tab||sceneId)await mutate({type:'view.save',projectId:id,view:{...(tab?{tab}:{}),...(sceneId?{...getView(id,sceneId),sceneId}:{})}});
      return mutate({type:'workspace.update',patch:{screen:'project',activeProjectId:id,openProjectIds:[...new Set([...(getState().workspace.openProjectIds||[]),id])]}});
    }),
  };
}
export function eligibleSharedTarget(state,preferredId){const projects=projectsForMode(state).filter(project=>project.status!=='archived');return projects.find(project=>project.id===preferredId)||projects.find(project=>project.status==='active')||projects[0];}
export function sharedImportAction(state,projectId,materialId){const eligible=projectsForMode(state).filter(project=>project.status!=='archived');if(!eligible.length)throw new Error('请先创建或恢复当前创作方式的作品。');if(!eligible.some(project=>project.id===projectId))throw new Error('目标作品已归档或不再属于当前创作方式，请重新选择。');return {type:'shared.import',projectId,materialId};}
export function pageName(page,format){return creationCopy(format).tabs[page]||({overview:'工作总览',projects:'全部项目',tasks:'我的待办',shared:'共享素材',entry:'创作入口'})[page]||page;}
export const NOVEL_FIELDS=[{name:'title',label:'章节名',required:true,autoFocus:true},{name:'act',label:'所属卷',placeholder:'第一卷、第二卷…'},{name:'summary',label:'概要',rows:3},{name:'intent',label:'此章目标',rows:2},{name:'outcome',label:'章末变化',rows:2}];
export function rolesForMode(roles,format){return (roles||[]).filter(role=>role.id.startsWith('novel-')===(format==='novel'));}
export function skillsForMode(skills,format,enabled=[]){return (skills||[]).filter(skill=>enabled.includes(skill.id)||!skill.builtin||(format==='novel'?skill.id.startsWith('novel-')||['project-planning','material-curation'].includes(skill.id):!skill.id.startsWith('novel-')));}
export function unitFields(project,screenplayFields){return projectFormat(project)==='novel'?[...NOVEL_FIELDS,{name:'cast',label:'人物',multiple:true,options:Object.fromEntries((project.characters||[]).map(c=>[c.id,c.name+(c.status==='archived'?'（已废弃）':'')]))}]:screenplayFields;}
export function formFieldValues(data,fields){const values=Object.fromEntries(data);for(const field of fields)if(field.multiple)values[field.name]=data.getAll(field.name);return values;}
