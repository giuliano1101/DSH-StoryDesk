import {creationCopy,projectFormat,workspaceFormat} from '../../shared/creation.mjs';
import {isEpisodic,projectEpisodes,episodeScenes,sceneEpisodeId} from '../../shared/episodes.mjs';
import {currentEpisodeId} from '../creationUI.mjs';
import {pageName} from '../creationUI.mjs';
export const ROLE_BY_PAGE={overview:'manager',projects:'manager',tasks:'manager',shared:'librarian',trash:'manager',brief:'story',library:'character',scenes:'structure',script:'writer'};
export const PAGE_NAMES={overview:'工作总览',projects:'全部项目',tasks:'我的待办',shared:'共享素材',trash:'废纸篓',brief:'项目简报',library:'资料与人物',scenes:'分场',script:'正文'};
export const own=(object,key)=>object&&Object.prototype.hasOwnProperty.call(object,key)?object[key]:undefined;
export function validSelection(body,s){return !!s&&Number.isInteger(s.start)&&Number.isInteger(s.end)&&s.start>=0&&s.end>s.start&&s.end<=body.length&&typeof s.text==='string'&&s.text.length>0&&body.slice(s.start,s.end)===s.text;}
export function buildContext(state,focus,selection,getBody=(p,s)=>s.body||'',capabilities={episodes:true}){
  const workspace=state?.workspace||{},p=state?.projects.find(p=>p.id===workspace.activeProjectId);
  const creationMode=workspaceFormat(state),mode=creationMode==='novel'?{creationMode}:{};
  if(workspace.screen!=='project'||!p||p.trashedAt)return {page:workspace.screen==='entry'?'entry':ROLE_BY_PAGE[workspace.screen]?workspace.screen:'overview',...mode};
  const page=ROLE_BY_PAGE[p.view?.tab]?p.view.tab:'brief',context={page,projectId:p.id,...mode};
  if(page==='library'&&focus?.projectId===p.id&&['character','material'].includes(focus.kind)&&(focus.kind==='character'?p.characters:p.materials).some(x=>x.id===focus.id))context.focus={kind:focus.kind,id:focus.id};
  if(['script','scenes'].includes(page)){
    const episodic=isEpisodic(p)&&capabilities?.episodes,episodeId=episodic?currentEpisodeId(p):'',available=episodic?episodeScenes(p,episodeId,{includeArchived:true}):p.scenes;
    if(episodic)context.episodeId=episodeId;
    const selected=available.find(s=>s.id===p.view?.sceneId),s=page==='script'?(selected||available.find(s=>!s.archived)):selected;
    if(s){context.sceneId=s.id;if(page==='script'&&selection?.projectId===p.id&&selection.sceneId===s.id&&validSelection(getBody(p,s),selection.selection))context.selection=selection.selection;}
  }
  return context;
}
export function resolveProfile(assistant,roleId,projectId){return own(own(assistant?.profiles?.projects,projectId),roleId)||own(assistant?.profiles?.global,roleId)||assistant?.roles?.find(r=>r.id===roleId)||{name:'创作助手',personality:'',skillIds:[]};}
export function updateDraft(drafts,key,patch){const previous=own(drafts,key)||{};return {...drafts,[key]:{...previous,...patch,...(Object.hasOwn(patch,'instruction')?{instructionGeneration:(previous.instructionGeneration||0)+1}:{})}};}
export function completeDraft(drafts,key,sent,generation){const draft=own(drafts,key);return draft?.instruction===sent&&(generation===undefined||draft.instructionGeneration===generation)?updateDraft(drafts,key,{instruction:''}):drafts;}
export function mergeAssistantSnapshot(current,incoming){if(!current)return incoming;if(incoming.revision<current.revision||(incoming.revision===current.revision&&incoming.generation<current.generation))return current;return incoming;}
export function legacyHistory(p,sceneId,turns){const linked=new Set(turns.map(t=>t.suggestionId).filter(Boolean));return (p?.aiHistory||[]).filter(x=>x.sceneId===sceneId&&!linked.has(x.id)&&x.origin!=='assistant');}
const FIELD_NAMES={title:'名称',kind:'作品类型',stage:'创作阶段',status:'状态',pinned:'置顶',deadline:'交稿日期',synopsis:'故事梗概',logline:'一句话故事',length:'篇幅 / 时长',audience:'观众',theme:'主题',constraints:'创作要求',name:'姓名',role:'身份与关系',goal:'人物目标',secret:'秘密与背景',voice:'语言习惯',notes:'备注',category:'分类',body:'资料内容',source:'来源',due:'截止日期',done:'完成状态',sceneId:'关联场景',location:'地点',time:'时间',interior:'内 / 外景',act:'分组',cast:'出场人物',summary:'本场设想',intent:'本场目标',outcome:'结束变化',archived:'归档',episodeId:'所属集'};
const VALUES={idea:'故事构思',characters:'人物开发',outline:'分场',draft:'写稿',revision:'改稿',delivery:'待交付',active:'进行中',paused:'暂缓',archived:'已归档',adopted:'已采用',alternative:'备选',research:'参考资料',world:'世界设定'};
export function reviewAction(a,state){
  const p=state.projects.find(p=>p.id===a.projectId),prefix=p?`${p.title} · `:'',s=p?.scenes.find(s=>s.id===a.sceneId),task=p?.tasks.find(t=>t.id===a.task?.id||t.id===a.taskId),character=p?.characters.find(c=>c.id===a.character?.id),material=p?.materials.find(m=>m.id===a.material?.id),shared=state.sharedMaterials.find(m=>m.id===a.materialId);
  const copy=creationCopy(projectFormat(p)),novel=copy.format==='novel',names=novel?{...FIELD_NAMES,...copy.brief,sceneId:'关联章节',act:'所属卷',cast:'人物',summary:'概要',intent:'此章目标',outcome:'章末变化'}:FIELD_NAMES;
  let title=a.type,values={};
  switch(a.type){
    case 'project.create':title=`新建作品：${a.title}`;values={title:a.title,kind:a.kind,deadline:a.deadline};break;
    case 'project.trash':return {title:`移入废纸篓：${p?.title||'作品'}`,fields:[['恢复方式','可在废纸篓中恢复，所有正文和存稿保留']]};
    case 'project.restore':return {title:`恢复作品：${p?.title||'作品'}`,fields:[['保存位置','全部项目']]};
    case 'episode.add':title=`${prefix}新增集`;values=a.episode;break;
    case 'episode.update':title=`${prefix}修改分集：${projectEpisodes(p).find(e=>e.id===a.episodeId)?.title||'当前集'}`;values=a.patch;break;
    case 'episode.reorder':return {title:`${prefix}调整集顺序`,fields:[['集顺序',(a.episodeIds||[]).map(id=>projectEpisodes(p).find(e=>e.id===id)?.title||'未知集').join('、')]]};
    case 'project.update':title=`${prefix}项目资料`;values=a.patch;break;
    case 'task.upsert':title=`${prefix}${task?'修改待办：'+task.title:'添加待办'}`;values=a.task;break;
    case 'task.toggle':title=`${prefix}待办：${task?.title||'已删除任务'}`;values={done:!task?.done};break;
    case 'character.upsert':title=`${prefix}${character?'人物：'+character.name:'添加人物'}`;values=a.character;break;
    case 'material.upsert':title=`${prefix}${material?'资料：'+material.title:'添加资料'}`;values=a.material;break;
    case 'shared.add':title='添加共享素材';values=a.material;break;
    case 'shared.update':title=`共享素材：${shared?.title||'已删除素材'}`;values=a.patch;break;
    case 'shared.import':title=`${prefix}导入共享素材：${shared?.title||'已删除素材'}`;values=shared?{title:shared.title,body:shared.body,source:shared.source}:{};break;
    case 'ui.navigate':return {title:`前往${pageName(a.page,copy.format)}`,fields:[['页面',`${prefix}${s?.title||pageName(a.page,copy.format)}`]]};
    case 'scene.write':return {title:`${prefix}${copy.unit}：${s?.title||`已删除${copy.unit}`}`,fields:[['写入范围',({append:'追加到正文末尾',replace:`替换当前${copy.unit}全部正文`,selection:'发送时选中的段落'})[a.placement]||a.placement],[copy.manuscriptLabel,a.text]]};
    case 'scene.add':title=`${prefix}添加${copy.unit}`;values=a.scene;break;
    case 'scene.update':title=`${prefix}${copy.unit}：${s?.title||`已删除${copy.unit}`}`;values=a.patch;break;
    case 'scene.reorder':title=`${prefix}调整${novel?'章节顺序':'场序'}`;return {title,fields:[[novel?'章节顺序':'场景顺序',a.sceneIds.map((id,i)=>`${i+1}. ${p?.scenes.find(s=>s.id===id)?.title||`已删除${copy.unit}`}`).join('\n')]]};
  }
  const fields=[];
  for(const [key,value] of Object.entries(values||{})){
    if(key==='id'||value===undefined)continue;
    if(key==='brief'){for(const [k,v] of Object.entries(value))fields.push([names[k]||k,v||'留空']);continue;}
    let display=key==='category'?(own({research:'参考资料',world:'世界设定',idea:'灵感'},value)||value):key==='status'&&a.type!=='project.update'&&value==='archived'?'已废弃':key==='cast'?value.map(id=>p?.characters.find(c=>c.id===id)?.name||'已删除人物').join('、')||'无':key==='episodeId'?projectEpisodes(p).find(e=>e.id===value)?.title||'未知集':key==='sceneId'?p?.scenes.find(s=>s.id===value)?.title||'无关联':typeof value==='boolean'?(key==='done'?(value?'已完成':'未完成'):(value?'是':'否')):(['stage','status'].includes(key)?own(key==='stage'&&novel?copy.stages:VALUES,value):undefined)||value||'留空';
    fields.push([a.type==='task.upsert'&&key==='title'?'任务':(novel&&key==='body'&&a.type.startsWith('scene.')?copy.manuscriptLabel:names[key]||key),String(display)]);
  }
  return {title,fields};
}
export function configurationProfile(assistant,roleId,projectId){return assistant?.roles?.some(role=>role.id===roleId)&&own(assistant?.profiles?.global,roleId)?resolveProfile(assistant,roleId,projectId):null;}
export function normalizeDrafts(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const result={};
  for(const [key,draft] of Object.entries(value)){
    let identity;try{identity=JSON.parse(key);}catch{continue;}
    if(!Array.isArray(identity)||!(identity.length===5||identity.length===6&&identity[5]==='novel'||identity.length===7&&['script','scenes'].includes(identity[0])&&typeof identity[1]==='string'&&identity[1].trim()&&(identity[2]===null||typeof identity[2]==='string'&&identity[2].trim())&&identity[3]===null&&identity[4]===null&&identity[5]==='episode'&&typeof identity[6]==='string'&&identity[6].trim())||!own(ROLE_BY_PAGE,identity[0])||!draft||typeof draft!=='object'||Array.isArray(draft))continue;
    const safe={};
    if(typeof draft.instruction==='string'){safe.instruction=draft.instruction.slice(0,24000);safe.instructionGeneration=0;}
    if(['execute','discuss','manage'].includes(draft.mode)||draft.mode==='rewrite'&&identity[0]==='script')safe.mode=draft.mode;
    if(['scene','selection'].includes(draft.scope)&&identity[0]==='script')safe.scope=draft.scope;
    if(Number.isSafeInteger(draft.instructionGeneration)&&draft.instructionGeneration>=0)safe.instructionGeneration=draft.instructionGeneration;
    result[key]=safe;
  }
  return result;
}
