import {assistantRequests} from '../assistant/requestGuard.mjs';
import {inspectAssistantDialogs} from '../assistant/execution.mjs';
import {CRAFT_MODES} from '../../shared/doctor.mjs';

const defaults={mode:'general',scope:'scene',platform:'',rhythm:'自动判断',targetDuration:''};
const clone=value=>structuredClone(value);
const fail=message=>{throw new Error(message);};
export function createDoctorController({workbench,models,request,dialogs=inspectAssistantDialogs,opinionDrafts=()=>({}),guard=assistantRequests}){
 let snapshot={open:null,options:{},reports:{},bibles:{},capabilities:null,pending:{},startedAt:{},errors:{},loading:{}},epochs=new Map();
 const listeners=new Set(),emit=patch=>{snapshot={...snapshot,...patch};for(const listener of listeners)listener();};
 const epoch=id=>{const next=(epochs.get(id)||0)+1;epochs.set(id,next);return next;};
 const project=id=>{const p=workbench().getState()?.projects.find(p=>p.id===id);if(!p||p.trashedAt||p.status==='archived')fail('此作品已归档或不可用，请先恢复。');return p;};
 const preflight=id=>{
  if(workbench().isNavigating?.())fail('正在切换页面，请稍候重试。');
  project(id);
  if(dialogs().editingTargets.some(target=>target.projectIds.includes(id)))fail('本作品有尚未关闭的编辑窗口，请先保存或取消手动编辑。');
  const drafts=opinionDrafts(id);if(Object.keys(drafts.composers||{}).length||Object.keys(drafts.editors||{}).length)fail('请先保存或取消尚未完成的段落意见，再诊断或加入意见。');
 };
 const locked=async(id,operation)=>{preflight(id);const token=workbench().acquireEditingLock({projectIds:[id],shared:false});try{await workbench().flush({adoptionToken:token});preflight(id);return await operation();}finally{workbench().releaseEditingLock(token);}};
 const accept=data=>{if(data.state)workbench().accept(data.state);return data;};
 const run=async(id,kind,operation)=>{
  if(snapshot.pending[id])return null;
  const token=guard.reserve(id);if(!token)fail('本作品正在处理助手请求，请稍候。');
  epoch(id);emit({pending:{...snapshot.pending,[id]:kind},startedAt:{...snapshot.startedAt,[id]:Date.now()},errors:{...snapshot.errors,[id]:''},loading:{...snapshot.loading,[id]:false}});
  try{return await operation();}catch(error){emit({errors:{...snapshot.errors,[id]:error.status===404?'完整退出并重新打开 Harness 后加载医生功能。':error.message}});throw error;}
  finally{guard.release(id,token);const pending={...snapshot.pending};delete pending[id];emit({pending});}
 };
 const controller={
  snapshot:()=>snapshot,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  open(id,context={}){preflight(id);emit({open:{projectId:id,...clone(context)},options:{...snapshot.options,[id]:{...defaults,...snapshot.options[id],scope:context.sceneId?'scene':'project'}}});},
  close(){if(snapshot.open&&snapshot.pending[snapshot.open.projectId])return false;emit({open:null});return true;},
  change(id,patch){emit({options:{...snapshot.options,[id]:{...defaults,...snapshot.options[id],...patch}}});},
  async refresh(id){
   if(snapshot.pending[id])return;const generation=epoch(id);emit({loading:{...snapshot.loading,[id]:true}});
   try{const data=await request(`/doctor?projectId=${encodeURIComponent(id)}`);if(epochs.get(id)===generation)emit({reports:{...snapshot.reports,[id]:data.reports},bibles:{...snapshot.bibles,[id]:data.bible||null},capabilities:data.capabilities||null,errors:{...snapshot.errors,[id]:''}});}
   catch(error){if(epochs.get(id)===generation)emit({errors:{...snapshot.errors,[id]:error.status===404?'完整退出并重新打开 Harness 后加载医生功能。':error.message}});}
   finally{if(epochs.get(id)===generation)emit({loading:{...snapshot.loading,[id]:false}});}
  },
  diagnose(id){
   const options=clone({...defaults,...snapshot.options[id]}),context=clone(snapshot.open),catalog=models().catalog,targetModel=catalog?.mode==='host'?clone(catalog.effective):undefined;
   return run(id,'diagnose',async()=>{
    preflight(id);if(context?.projectId!==id)fail('请重新打开这部作品的医生窗口。');
    if(options.mode==='continuity'&&snapshot.capabilities?.continuity!==true)fail('完整退出并重新打开 Harness 后加载故事档案与一致性诊断。');
    if(CRAFT_MODES.includes(options.mode)&&snapshot.capabilities?.craftChecks!==true)fail('完整退出并重新打开 Harness 后加载人物动机、伏笔回收与悬念信息释放专项检查。');
    if(models().loading||models().error||!catalog?.connected||catalog.mode==='host'&&!targetModel)fail(models().error||catalog?.label||'请先连接可用模型。');
    const payload={projectId:id,...options,...(options.scope==='scene'?{sceneId:context.sceneId}:{}),...(options.scope==='episode'?{episodeId:context.episodeId}:{}),...(targetModel?{modelSelection:targetModel}:{})};
    // Flush under a short source lock. Read-only generation then permits writing;
    // the server compares the full captured source again before any handoff.
    await locked(id,async()=>{});
    const data=accept(await request('/doctor',payload));epoch(id);
    emit({reports:{...snapshot.reports,[id]:[...(snapshot.reports[id]||[]).filter(r=>r.id!==data.report.id),data.report]},...(data.bible?{bibles:{...snapshot.bibles,[id]:data.bible},capabilities:data.capabilities||snapshot.capabilities}:{}),loading:{...snapshot.loading,[id]:false}});return data;
   });
  },
  handoff(id,reportId,issueId){return run(id,'handoff',async()=>{
   const report=(snapshot.reports[id]||[]).find(r=>r.id===reportId),issue=report?.issues.find(i=>i.id===issueId);
   if(!report||!issue)fail('这条诊断问题已不存在，请刷新报告。');if(issue.noteId)fail('此问题已经加入助手意见。');
   if(issue.certainty==='needs-context')fail('请先补充或确认设定，再重新诊断；待确认问题不能直接进入改稿。');
   if(report.readOnly||report.status!=='current'||!issue.evidence)fail('此报告已过期、只读或没有精确原文，请重新诊断。');
   let data;try{data=await locked(id,async()=>accept(await request('/doctor/handoff',{projectId:id,reportId,issueId})));}
   catch(error){if(error.code==='STALE_DOCTOR_REPORT'||error.code==='READ_ONLY_DOCTOR_REPORT')emit({reports:{...snapshot.reports,[id]:(snapshot.reports[id]||[]).map(r=>r.id===reportId?{...r,...(error.code==='STALE_DOCTOR_REPORT'?{status:'stale'}:{readOnly:true})}:r)}});throw error;}
   epoch(id);
   emit({reports:{...snapshot.reports,[id]:(snapshot.reports[id]||[]).map(r=>r.id===reportId?{...r,issues:r.issues.map(i=>i.id===issueId?{...i,noteId:data.note.id}:i)}:r)}});
   workbench().toast('已加入助手意见，可继续收集后统一发送。');return data;
  });},
 };
 return controller;
}
