import React,{useState} from 'react';
import {Button} from '../components';
import {noteCurrent} from './controller.mjs';
import {DEFAULT_REVISION_QUESTION} from './chat.mjs';

function sceneTitle(project,note){return project?.scenes.find(scene=>scene.id===note.sceneId)?.title||project?.versions?.flatMap(version=>version.snapshot?.scenes||[]).find(scene=>scene.id===note.sceneId)?.title||note.sceneTitle||'原文';}
function QueuedOpinion({note,project,chat}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),{controller}=chat.revisions,draft=controller.project(project.id).editors?.[note.id],current=noteCurrent(project,note),scene=project.scenes.find(scene=>scene.id===note.sceneId);
  const run=async operation=>{if(busy)return;setBusy(true);setError('');try{await operation();}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <section className="chat-opinion"><strong>{sceneTitle(project,note)}</strong><blockquote>{note.selection.text}</blockquote>{draft?<><textarea aria-label="恢复的修改意见" value={draft.instruction} onChange={e=>controller.setNoteInstruction(project.id,note.id,e.target.value)}/><div className="chat-opinion-actions"><Button small type="button" disabled={busy||chat.busy} onClick={()=>run(()=>controller.saveNote(project.id,note.id))}>保存意见</Button><Button small type="button" disabled={busy||chat.busy} onClick={()=>controller.cancelEdit(project.id,note.id)}>取消编辑</Button></div></>:<p>{note.instruction}</p>}
    {!current&&<p className="error">标注原文已变化，请重新定位或移除。</p>}<div className="chat-opinion-actions"><Button small type="button" disabled={busy||chat.busy} onClick={()=>run(()=>chat.revisions.viewOriginal(project.id,note))}>查看原文</Button>{!current&&<Button small type="button" disabled={busy||chat.busy||!scene||scene.archived} onClick={()=>run(()=>chat.revisions.beginReanchor(project.id,note))}>重新定位</Button>}<Button small type="button" disabled={busy||chat.busy} onClick={()=>run(()=>controller.remove(project.id,note.id))}>移除意见</Button></div>{error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
export function RevisionAttachments({project,chat}){
  return <details className="chat-opinions" key={project.id}><summary>{chat.notes.length} 条段落意见</summary>{chat.notes.map(note=><QueuedOpinion key={note.id} note={note} project={project} chat={chat}/>)}</details>;
}
export function SubmittedOpinions({notes,project}){return <details className="chat-opinions submitted-opinions"><summary>已提交 {notes.length} 条段落意见</summary>{notes.map(note=><section className="chat-opinion" key={note.id}><strong>{sceneTitle(project,note)}</strong><blockquote>{note.selection.text}</blockquote><p>{note.instruction}</p></section>)}</details>;}
export function RevisionChatTurn({batch,project,chat,onRecovery}){
  const applied=batch.changes.filter(change=>change.status==='applied').length,pending=batch.changes.filter(change=>change.status==='pending'),stale=batch.changes.some(change=>change.status==='stale'),error=chat.snapshot.batchErrors[batch.id];
  return <article className="assistant-turn revision-chat-turn" data-batch-id={batch.id}><div className="assistant-question"><small>你</small><p>{batch.chatInstruction||DEFAULT_REVISION_QUESTION}</p><SubmittedOpinions notes={batch.changes} project={project}/></div><div className="assistant-answer"><strong>段落修改</strong><p className={applied?'assistant-outcome assistant-success':'assistant-outcome muted'} role="status">{batch.readOnly?`导入的修改记录，仅供查看${applied?`（历史已写入 ${applied} 条）`:''}。`:applied?`已写入 ${applied} 条段落修改，修改前版本已保留。`:'修改已生成，尚未写入。'}</p>
    {stale&&<p className="error">原文、意见或预览已变化，失效修改尚未写入。请重新定位或移除意见。</p>}{error&&<p className="error" role="alert">{error}</p>}
    {!!pending.length&&<details className="chat-opinions"><summary>查看待写入修改</summary>{pending.map(change=><section key={change.id} className="chat-opinion"><strong>{sceneTitle(project,change)}</strong><small>修改前</small><pre>{change.selection.text}</pre><small>修改后</small><pre>{change.replacement}</pre></section>)}</details>}
    <div className="assistant-turn-footer"><small>{batch.model||'历史记录'}{batch.readOnly?' · 导入只读':''}</small><div className="assistant-turn-actions">{(batch.preEditVersionIds||[]).map(ref=><Button small type="button" key={ref.versionId} onClick={()=>onRecovery?.(ref)}>查看修改前版本</Button>)}{!batch.readOnly&&!!pending.length&&<Button small primary type="button" disabled={chat.busy||stale} onClick={()=>chat.retry(project.id,batch.id)}>重试写入</Button>}</div></div>
  </div></article>;
}
