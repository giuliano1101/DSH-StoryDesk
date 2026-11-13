import {useRef,useSyncExternalStore} from 'react';
import {assistantRevisionBatches,createRevisionChatSender,queuedRevisionNotes,revisionQueueIssue} from './chat.mjs';

export function useRevisionChat(w,a,revisions){
  const live=useRef({w,a,revisions}),sender=useRef(null);live.current={w,a,revisions};
  if(!sender.current)sender.current=createRevisionChatSender({controller:revisions.controller,getProject:id=>live.current.w.getState()?.projects.find(project=>project.id===id),completeDraft:capture=>live.current.a.completeInstruction(capture)});
  const snapshot=useSyncExternalStore(sender.current.subscribe,sender.current.snapshot,sender.current.snapshot),project=a.context.page==='script'?w.state?.projects.find(project=>project.id===a.context.projectId):null,notes=queuedRevisionNotes(project,project?revisions.controller.project(project.id).editors:{}),batches=assistantRevisionBatches(project),pending=snapshot.pending[project?.id],busy=!!pending||!!revisions.snapshot.pending[project?.id],issue=notes.length?revisionQueueIssue(project,notes,revisions.controller.project(project.id).editors,w.body):'';
  const ready=a.readiness.ready&&!!revisions.snapshot.capabilities?.chat&&!!revisions.snapshot.capabilities?.apply&&!busy&&!a.projectBusy&&!issue;
  const send=()=>{if(!project||!notes.length||!ready)return;a.clearError();return sender.current.send({projectId:project.id,notes,instruction:a.draft.instruction,key:a.key,instructionGeneration:a.draft.instructionGeneration??0}).catch(()=>null);};
  return {notes,batches,pending,busy,ready,issue,snapshot,revisions,error:snapshot.errors[project?.id]||'',capabilityError:notes.length&&!revisions.snapshot.capabilities?.chat?(revisions.snapshot.capabilityError||'完整退出并重新打开 Harness 后加载新版段落协作功能。'):'',send,retry:(projectId,batchId)=>sender.current.retry(projectId,batchId).catch(()=>null)};
}
