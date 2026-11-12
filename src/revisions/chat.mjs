import {assistantRequests} from '../assistant/requestGuard.mjs';
import {changeAvailable,noteCurrent} from './controller.mjs';

export const DEFAULT_REVISION_QUESTION='请根据这些段落意见统一修改。';
export const assistantRevisionBatches=project=>(project?.revisionBatches||[]).filter(batch=>Object.hasOwn(batch,'chatInstruction'));
export function queuedRevisionNotes(project,editors={}){
  // A batch can only suppress queued notes while its entire remaining write is usable.
  const usable=assistantRevisionBatches(project).filter(batch=>!batch.readOnly&&batch.changes.every(change=>change.status==='applied'||changeAvailable(project,batch,change,editors)));
  const captured=new Set(usable.flatMap(batch=>batch.changes.map(change=>JSON.stringify([change.noteId,change.noteVersion]))));
  return (project?.revisionNotes||[]).filter(note=>note.status==='open'&&!captured.has(JSON.stringify([note.id,note.version])));
}
export function revisionQueueIssue(project,notes,editors={},body){
  if(project?.status==='archived'||project?.trashedAt)return '请先恢复作品，再发送段落意见。';
  if(notes.some(note=>Object.hasOwn(editors,note.id)))return '请先保存或取消正在编辑的意见。';
  if(notes.some(note=>{const scene=project?.scenes.find(scene=>scene.id===note.sceneId);return !scene||!noteCurrent(project,note,body?.(project,scene));}))return '部分标注原文已变化，请展开意见重新定位或移除后发送。';
  return '';
}

// This executor is mounted once; only explicit send/retry calls perform writes.
export function createRevisionChatSender({controller,getProject,completeDraft,guard=assistantRequests}){
  let snapshot={pending:{},errors:{},batchErrors:{}};const listeners=new Set();
  const emit=patch=>{snapshot={...snapshot,...patch};for(const listener of listeners)listener();};
  const fail=message=>{throw new Error(message);};
  const apply=async(projectId,batch)=>{
    if(batch.readOnly)fail('导入记录仅供查看，请重新发送段落意见。');
    const changes=batch.changes.filter(change=>change.status!=='applied');
    if(!changes.length)fail('这些修改已写入或不可用。');
    if(changes.some(change=>!changeAvailable(getProject(projectId),batch,change,controller.project(projectId).editors)))fail('原文、意见或预览已变化，尚未写入；请重新定位或移除失效意见。');
    const data=await controller.apply(projectId,batch.id,changes.map(change=>change.id));
    if(!data)fail('本作品正在处理其他意见，请稍后重试写入。');
    return data;
  };
  const run=async(projectId,pending,operation)=>{
    const token=guard.reserve(projectId);if(!token)return null;
    emit({pending:{...snapshot.pending,[projectId]:pending},errors:{...snapshot.errors,[projectId]:''}});
    let batchId=pending.batchId;
    try{return await operation(id=>{batchId=id;});}
    catch(error){emit({errors:{...snapshot.errors,[projectId]:error.message},...(batchId?{batchErrors:{...snapshot.batchErrors,[batchId]:error.message}}:{})});throw error;}
    finally{guard.release(projectId,token);const next={...snapshot.pending};delete next[projectId];emit({pending:next});}
  };
  return {
    snapshot:()=>snapshot,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    send(input){
      const capture=structuredClone(input),{projectId,notes,instruction}=capture;
      return run(projectId,{instruction,notes,startedAt:new Date().toISOString()},async recordBatch=>{
        const data=await controller.generate(projectId,notes.map(note=>note.id),{chatInstruction:instruction});
        if(!data)fail('本作品正在处理其他意见，请稍后发送。');
        const batch=data.batch;if(!batch||!Object.hasOwn(batch,'chatInstruction'))fail('完整退出并重新打开 Harness 后加载新版段落协作功能。');
        recordBatch(batch.id);
        if(batch.readOnly||batch.changes.length!==notes.length||notes.some(note=>!batch.changes.some(change=>change.noteId===note.id&&change.noteVersion===note.version&&change.status==='pending')))fail('原文或意见在生成期间发生变化，修改已保留但尚未写入。请重新定位或移除失效意见。');
        completeDraft(capture);
        return {batch,result:await apply(projectId,batch)};
      });
    },
    retry(projectId,batchId){return run(projectId,{batchId},async()=>{
      const batch=assistantRevisionBatches(getProject(projectId)).find(batch=>batch.id===batchId);
      if(!batch)fail('这条修改记录已不存在。');
      const result=await apply(projectId,batch);emit({batchErrors:{...snapshot.batchErrors,[batchId]:''}});return result;
    });},
  };
}
