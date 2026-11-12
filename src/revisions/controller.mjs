import {creationCopy,projectFormat} from '../../shared/creation.mjs';
import {inspectAssistantDialogs} from '../assistant/execution.mjs';

export const REVISIONS_RELOAD='完整退出并重新打开 Harness 后加载新版批注功能';
export const RECOVERY_KEY='screenwriter-revision-drafts-v1';
const own=(object,key)=>object&&Object.hasOwn(object,key)?object[key]:undefined;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const emptyProject=()=>({composers:{},editors:{},checkedNotes:[],checkedChanges:{},reanchorId:'',batchId:'',sceneFilter:'all',statusFilter:'open',open:false});
export function exactSelection(body,selection){return Boolean(selection&&Number.isInteger(selection.start)&&Number.isInteger(selection.end)&&selection.start>=0&&selection.end>selection.start&&typeof selection.text==='string'&&selection.text.trim()&&selection.end<=body.length&&body.slice(selection.start,selection.end)===selection.text);}
export function noteCurrent(project,note,body){const scene=project?.scenes.find(scene=>scene.id===note.sceneId);return Boolean(scene&&!scene.archived&&scene.revision===note.sourceRevision&&exactSelection(body??scene.body??'',note.selection));}
export function changeAvailable(project,batch,change,editors={}){const note=project?.revisionNotes?.find(note=>note.id===change.noteId);return Boolean(!project?.archived&&project?.status!=='archived'&&!batch.readOnly&&change.status==='pending'&&note?.status==='open'&&note.version===change.noteVersion&&!own(editors,note.id)&&noteCurrent(project,change));}
function recover(storage){
  let raw;try{raw=JSON.parse(storage?.getItem(RECOVERY_KEY)||'{}');}catch{return {};}
  if(!object(raw))return {};
  return Object.fromEntries(Object.entries(raw).filter(([,value])=>object(value)).map(([id,value])=>{
    const next=emptyProject();
    for(const field of ['composers','editors'])if(object(value[field]))next[field]=Object.fromEntries(Object.entries(value[field]).filter(([,draft])=>{
      if(!object(draft)||typeof draft.instruction!=='string')return false;
      const selection=draft.selection;
      return field==='editors'||object(selection)&&Number.isInteger(selection.start)&&Number.isInteger(selection.end)&&selection.start>=0&&selection.end>selection.start&&typeof selection.text==='string'&&selection.text.length===selection.end-selection.start;
    }).map(([key,draft])=>[key,{instruction:draft.instruction,generation:Number.isSafeInteger(draft.generation)?draft.generation:0,...(field==='composers'?{selection:clone(draft.selection)}:{})}]));
    next.checkedNotes=Array.isArray(value.checkedNotes)?value.checkedNotes.filter(id=>typeof id==='string'):[];
    next.checkedChanges=object(value.checkedChanges)?Object.fromEntries(Object.entries(value.checkedChanges).filter(([,ids])=>Array.isArray(ids)).map(([key,ids])=>[key,ids.filter(id=>typeof id==='string')])):{};
    for(const field of ['reanchorId','batchId','sceneFilter','statusFilter'])if(typeof value[field]==='string')next[field]=value[field];
    next.open=value.open===true;return [id,next];
  }));
}
export function createRevisionsController({workbench,models=()=>({}),request,storage=globalThis.localStorage,dialogs=inspectAssistantDialogs}){
  let snapshot={local:recover(storage),pending:{},errors:{},receipts:{},capabilities:null,capabilityError:'',capabilityLoading:false,storageError:''},capabilityGeneration=0;
  const listeners=new Set(),active=new Set(),completed=new Set();
  let draftGeneration=Math.max(0,...Object.values(snapshot.local).flatMap(project=>[...Object.values(project.composers),...Object.values(project.editors)].map(draft=>draft.generation)));
  const emit=patch=>{snapshot={...snapshot,...patch};for(const listener of listeners)listener();};
  const project=id=>own(snapshot.local,id)||emptyProject();
  const persist=(id,change)=>{const local={...snapshot.local,[id]:{...project(id),...change}};let storageError='';try{storage?.setItem(RECOVERY_KEY,JSON.stringify(local));}catch{storageError='本机暂时无法保存意见草稿，请保留此页面并稍后重试。';}emit({local,storageError});};
  const findProject=id=>{const p=workbench().getState()?.projects.find(p=>p.id===id);if(!p||p.status==='archived')throw new Error('此作品已归档或不可用，请先恢复作品。');return p;};
  const findNote=(id,noteId)=>{const p=findProject(id),note=p.revisionNotes?.find(note=>note.id===noteId);if(!note)throw new Error('这条意见已不存在。');return note;};
  const capability=kind=>{if(!snapshot.capabilities?.[kind])throw new Error(snapshot.capabilityError||'正在读取批注功能，请稍后重试。');};
  const preflight=id=>{if(dialogs().editingTargets.some(target=>target.projectIds.includes(id)))throw new Error('本作品有尚未关闭的编辑窗口。请先保存或取消手动编辑，再重试。');};
  const errorMessage=error=>error.code==='NOT_FOUND'?REVISIONS_RELOAD:error.message||'暂时无法完成，请重试。';
  const run=async(id,kind,operation)=>{
    if(active.has(id))return null;
    active.add(id);emit({pending:{...snapshot.pending,[id]:kind},errors:{...snapshot.errors,[id]:''}});
    try{return await operation();}catch(error){emit({errors:{...snapshot.errors,[id]:errorMessage(error)}});throw error;}finally{active.delete(id);const pending={...snapshot.pending};delete pending[id];emit({pending});}
  };
  const locked=async(id,callback)=>{preflight(id);const token=workbench().acquireEditingLock({projectIds:[id],shared:false});try{await workbench().flush({adoptionToken:token});preflight(id);return await callback();}finally{workbench().releaseEditingLock(token);}};
  const accept=data=>{if(data.state)workbench().accept(data.state);return data;};
  const mutate=(id,payload,onSaved)=>run(id,'save',async()=>{capability('notes');findProject(id);return locked(id,async()=>{const data=accept(await request('/revisions/notes',{projectId:id,...payload}));onSaved?.(data);return data;});});
  const controller={
    snapshot:()=>snapshot,project,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    setView:persist,
    async refreshCapabilities(){const generation=++capabilityGeneration;emit({capabilityLoading:true});try{const data=await request('/revisions');if(generation===capabilityGeneration){if(!data.capabilities?.notes)throw new Error(REVISIONS_RELOAD);emit({capabilities:data.capabilities,capabilityError:''});}}catch(error){if(generation===capabilityGeneration)emit({capabilities:null,capabilityError:error.status===404?REVISIONS_RELOAD:errorMessage(error)});}finally{if(generation===capabilityGeneration)emit({capabilityLoading:false});}},
    capture(id,sceneId,selection){const p=findProject(id),scene=p.scenes.find(scene=>scene.id===sceneId&&!scene.archived);if(!scene||!exactSelection(workbench().body(p,scene),selection))throw new Error('请先在正文中选中需要批注的完整段落。');const existing=own(project(id).composers,sceneId);if(existing){if(JSON.stringify(existing.selection)!==JSON.stringify(selection))throw new Error(projectFormat(p)==='novel'?'本章还有未保存的意见，请先保存或取消。':'本场还有未保存的意见，请先保存或取消。');persist(id,{open:true});return;}persist(id,{open:true,composers:{...project(id).composers,[sceneId]:{selection:clone(selection),instruction:'',generation:++draftGeneration}}});},
    setComposerInstruction(id,sceneId,instruction){const draft=own(project(id).composers,sceneId);if(draft)persist(id,{composers:{...project(id).composers,[sceneId]:{...draft,instruction,generation:++draftGeneration}}});},
    cancelComposer(id,sceneId){const composers={...project(id).composers};delete composers[sceneId];persist(id,{composers});},
    saveComposer(id,sceneId){const draft=clone(own(project(id).composers,sceneId));if(!draft?.instruction.trim())return Promise.reject(new Error('请写下这段的修改意见。'));return mutate(id,{operation:'add',sceneId,selection:draft.selection,instruction:draft.instruction},()=>{if(own(project(id).composers,sceneId)?.generation===draft.generation)controller.cancelComposer(id,sceneId);});},
    startEdit(id,noteId){const note=findNote(id,noteId);if(note.status!=='open')throw new Error('已采用的意见仅供查看。');if(!own(project(id).editors,noteId))persist(id,{editors:{...project(id).editors,[noteId]:{instruction:note.instruction,generation:++draftGeneration}}});},
    setNoteInstruction(id,noteId,instruction){const draft=own(project(id).editors,noteId);if(draft)persist(id,{editors:{...project(id).editors,[noteId]:{instruction,generation:++draftGeneration}}});},
    cancelEdit(id,noteId){const editors={...project(id).editors};delete editors[noteId];persist(id,{editors});},
    saveNote(id,noteId){const draft=clone(own(project(id).editors,noteId));if(!draft?.instruction.trim())return Promise.reject(new Error('请写下这段的修改意见。'));return mutate(id,{operation:'update',noteId,instruction:draft.instruction},()=>{if(own(project(id).editors,noteId)?.generation===draft.generation)controller.cancelEdit(id,noteId);});},
    remove(id,noteId){return mutate(id,{operation:'remove',noteId},()=>{controller.cancelEdit(id,noteId);persist(id,{checkedNotes:project(id).checkedNotes.filter(note=>note!==noteId),...(project(id).reanchorId===noteId?{reanchorId:''}:{})});});},
    beginReanchor(id,noteId){const note=findNote(id,noteId);if(note.status!=='open')throw new Error('已采用的意见仅供查看。');persist(id,{reanchorId:noteId,open:false});},
    reanchor(id,noteId,sceneId,selection){const note=findNote(id,noteId),p=findProject(id),unit=creationCopy(projectFormat(p)).unit;if(note.sceneId!==sceneId)return Promise.reject(new Error(`请回到这条意见的原${unit}重新选中段落。`));const scene=p.scenes.find(scene=>scene.id===sceneId&&!scene.archived);if(!scene||!exactSelection(workbench().body(p,scene),selection))return Promise.reject(new Error(`请先在原${unit}选中当前段落。`));return mutate(id,{operation:'reanchor',noteId,selection:clone(selection)},()=>{if(project(id).reanchorId===noteId)persist(id,{reanchorId:'',open:true});});},
    generate(id,noteIds){const capturedIds=[...noteIds],catalog=models().catalog,targetModel=catalog?.mode==='host'?clone(catalog.effective):undefined;return run(id,'generate',async()=>{
      capability('generate');if(models().loading||models().error||!catalog?.connected||catalog.mode==='host'&&!targetModel)throw new Error(models().error||catalog?.label||'请先连接可用模型。');if(!capturedIds.length)throw new Error('请勾选需要一起处理的意见。');
      const p=findProject(id);for(const noteId of capturedIds){const note=findNote(id,noteId),scene=p.scenes.find(scene=>scene.id===note.sceneId);if(note.status!=='open'||!noteCurrent(p,note,scene?workbench().body(p,scene):''))throw new Error('勾选的意见原文已变化，请重新选中段落后生成。');if(own(project(id).editors,noteId))throw new Error('请先保存或取消正在编辑的意见，再生成。');}
      preflight(id);await workbench().flush();preflight(id);
      const data=accept(await request('/revisions/generate',{projectId:id,noteIds:capturedIds,...(targetModel?{modelSelection:targetModel}:{})}));
      if(data.batch)persist(id,{batchId:data.batch.id,checkedChanges:{...project(id).checkedChanges,[data.batch.id]:data.batch.changes.filter(change=>change.status==='pending').map(change=>change.id)}});return data;
    });},
    apply(id,batchId,changeIds){const capturedIds=[...changeIds];return run(id,'apply',async()=>{
      capability('apply');const p=findProject(id),batch=p.revisionBatches?.find(batch=>batch.id===batchId);if(!batch||batch.readOnly)throw new Error('导入的预览仅供阅读，请根据意见重新生成。');
      if(!capturedIds.length)throw new Error('请勾选要采用的修改。');
      const validate=()=>{for(const changeId of capturedIds){const change=batch.changes.find(change=>change.id===changeId);if(!change||change.status!=='pending'||completed.has(JSON.stringify([id,batchId,changeId])))throw new Error('这条修改已采用或不可用，请查看最新预览。');if(own(project(id).editors,change.noteId))throw new Error('这条意见正在手动编辑，请先保存或取消意见，再采用预览。');}};validate();
      return locked(id,async()=>{validate();const data=accept(await request('/revisions/apply',{projectId:id,batchId,changeIds:capturedIds}));for(const changeId of data.result?.appliedChangeIds||[])completed.add(JSON.stringify([id,batchId,changeId]));
        const applied=data.result?.appliedChangeIds||[];persist(id,{checkedNotes:project(id).checkedNotes.filter(noteId=>!batch.changes.some(change=>change.noteId===noteId&&applied.includes(change.id))),checkedChanges:{...project(id).checkedChanges,[batchId]:(project(id).checkedChanges[batchId]||[]).filter(changeId=>!applied.includes(changeId))}});emit({receipts:{...snapshot.receipts,[id]:{...data.result,batchId}}});workbench().toast(`已采用 ${applied.length} 条修改${data.result?.preEditVersionIds?.length?'，修改前版本已保留':''}`);return data;});
    });},
  };
  return controller;
}
