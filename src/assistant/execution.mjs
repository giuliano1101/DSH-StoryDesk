import {creationCopy} from '../../shared/creation.mjs';
import {assistantContextKey} from '../../shared/assistant-context.mjs';
import {adoptionTargets} from './editingGate.mjs';

export const EXECUTION_RELOAD='完整退出并重新打开 Harness 后加载新版执行能力';
export function assistantMode(draft){return ['execute','discuss','manage','rewrite'].includes(draft?.mode)?draft.mode:'execute';}
export function executionCapabilities(assistant){
  const capabilities=assistant?.capabilities;
  return {execute:capabilities?.execute===true,write:capabilities?.write===true,navigate:capabilities?.navigate===true,...(capabilities?.execute===true&&capabilities?.write===true?{}:{message:EXECUTION_RELOAD})};
}
const WRITE_TARGETS=new Set(['script.append','script.replace','script.selection','brief.synopsis','brief.logline','brief.theme','brief.constraints','character.notes','material.body','material.new','scene.new.summary','scene.new.body','shared.new']);
export function eligibleWriteTargets(turn){
  if(turn.readOnly||turn.applied||turn.write)return [];
  return (turn.writeTargets||[]).filter(item=>WRITE_TARGETS.has(item.target)).map(item=>item.target==='script.selection'?{...item,label:'替换发送时选中的段落'}:item);
}
export function writePreview(turn){
  const targets=eligibleWriteTargets(turn),has=target=>targets.some(item=>item.target===target);
  const target=has('script.selection')?'script.selection':has('script.append')?'script.append':targets.find(item=>item.target!=='script.replace')?.target||'';
  return {target,text:turn.reply||'',title:''};
}
export function isNewWriteTarget(target){return ['material.new','scene.new.summary','scene.new.body','shared.new'].includes(target);}
export function inspectAssistantDialogs(document=globalThis.document){
  const dialogs=[...(document?.querySelectorAll('[role="dialog"]:not([data-assistant-popup])')||[])];
  const editingTargets=dialogs.flatMap(dialog=>{
    if(dialog.dataset?.revisionProjectId)return [{projectIds:[dialog.dataset.revisionProjectId],shared:false,composerSceneId:dialog.dataset.revisionComposer}];
    const content=dialog.closest('.workbench-content');if(!content)return [];
    const {projectId,workspacePage}=content.dataset;
    return [{projectIds:projectId?[projectId]:[],shared:workspacePage==='shared'}];
  });
  return {anyOpen:dialogs.length>0,editingTargets};
}
const conflicts=(target,other)=>target.shared&&other.shared||target.projectIds.some(id=>other.projectIds.includes(id));
const turnContext=turn=>({page:turn.page,projectId:turn.projectId,sceneId:turn.sceneId,focus:turn.focus,...(turn.episodeId?{episodeId:turn.episodeId}:{}),...(turn.creationMode==='novel'?{creationMode:'novel'}:{})});
export function createAssistantExecutor({workbench,liveContext,dialogs=inspectAssistantDialogs,request,accept,onBusy=()=>{}}){
  const active=new Set(),automatic=new Set(),completed=new Set();
  const run=async(turn,write)=>{
    if(turn.readOnly)throw new Error('导入记录为只读，不能执行或写入。');
    if(turn.applied||turn.write)throw new Error('这条回复已经执行或写入，请查看保存结果。');
    if(write&&!eligibleWriteTargets(turn).some(item=>item.target===write.target))throw new Error('请选择这条回复允许的写入位置。');
    if(active.has(turn.id)||completed.has(turn.id))return null;
    active.add(turn.id);onBusy(turn.id,true);let token;
    try{
      const targets=write?{projectIds:turn.projectId?[turn.projectId]:[],shared:false}:adoptionTargets(turn);
      if(write?.target==='shared.new')targets.shared=true;
      const preflight=()=>{if(dialogs().editingTargets.some(target=>conflicts(targets,target)))throw new Error('目标页面有尚未关闭的编辑窗口。请先保存或取消手动编辑，再点击重试执行。');};
      preflight();token=workbench().acquireEditingLock(targets);
      await workbench().flush({adoptionToken:token});
      preflight();
      const payload=write?{turnId:turn.id,target:write.target,...(write.text!==undefined?{text:write.text}:{}),...(isNewWriteTarget(write.target)&&typeof write.title==='string'&&write.title.trim()?{title:write.title}:{})}:{turnId:turn.id,allowNavigation:!dialogs().anyOpen&&assistantContextKey(liveContext())===assistantContextKey(turnContext(turn))};
      const data=await request(write?'/assistant/write':'/assistant/apply',payload);
      completed.add(turn.id);accept(data);return data;
    }finally{if(token!==undefined)workbench().releaseEditingLock(token);active.delete(turn.id);onBusy(turn.id,false);}
  };
  return {
    apply:turn=>run(turn),write:(turn,preview)=>run(turn,preview),
    autoApply(turn){if(turn.mode!=='execute'||!turn.actions?.length||turn.applied||turn.write||turn.readOnly||automatic.has(turn.id))return Promise.resolve(null);automatic.add(turn.id);return run(turn);},
  };
}
export function executionStatus(turn,busy=false){
  if(turn.write)return `已写入 · ${turn.write.destination?.label||'页面内容'}`;
  if(turn.mode!=='execute')return turn.applied?'已采用，修改前版本已保留':'';
  if(busy)return '正在执行并核验保存结果…';
  if(turn.applied){const result=turn.appliedOutcome;return result?`已执行 · 保存 ${result.appliedWrites?.length||0} 项 · 跳转 ${result.appliedNavigation?.length||0} 处${result.skippedNavigation?.length?' · 已保留当前页面':''}`:'已执行，修改前版本已保留';}
  return turn.actions?.length?'尚未执行 · 可查看操作后重试':'未执行 · 请补充需要操作的内容';
}
export function executionDestinations(turn){
  const copy=creationCopy(turn.creationMode);
  return (turn.appliedOutcome?.appliedWrites||[]).flatMap(({action,result,label})=>{
    const projectId=action.projectId;
    switch(action.type){
      case 'project.create':return result?.projectId?[{page:'brief',projectId:result.projectId,label:label||'新作品'}]:[];
      case 'project.trash':return [{page:'trash',label:label||'废纸篓'}];
      case 'project.restore':return [{page:'brief',projectId,label:label||'已恢复作品'}];
      case 'episode.add':case 'episode.update':return [{page:'scenes',projectId,episodeId:result?.episodeId||action.episodeId,label:label||'分集大纲'}];
      case 'episode.reorder':return [{page:'scenes',projectId,label:label||'分集顺序'}];
      case 'project.update':return [{page:'brief',projectId,label:label||copy.tabs.brief}];
      case 'scene.add':return result?.sceneId?[{page:'script',projectId,sceneId:result.sceneId,episodeId:action.episodeId||action.scene?.episodeId,label:label||`新${copy.unit}`}]:[];
      case 'scene.write':case 'scene.update':return [{page:'script',projectId,sceneId:action.sceneId,label:label||copy.unit}];
      case 'character.upsert':case 'material.upsert':{const kind=action.type==='character.upsert'?'character':'material',id=result?.id||action[kind]?.id;return id?[{page:'library',projectId,focus:{kind,id},label:label||(kind==='character'?'人物':'资料')}]:[];}
      case 'shared.import':return result?.id?[{page:'library',projectId,focus:{kind:'material',id:result.id},label:label||'导入资料'}]:[];
      case 'shared.add':case 'shared.update':{const materialId=result?.id||action.materialId;return materialId?[{page:'shared',materialId,label:label||'共享素材'}]:[];}
      default:return [];
    }
  });
}

export function recoveryVersions(turn,state){return (turn.preEditVersionIds||turn.write?.preEditVersionIds||[]).map(reference=>({...reference,projectTitle:state.projects.find(project=>project.id===reference.projectId)?.title||'原作品',...(state.projects.find(project=>project.id===reference.projectId)?.trashedAt?{trashed:true}:{})}));}
