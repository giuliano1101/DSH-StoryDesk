import React from 'react';
import {Sparkle} from '@phosphor-icons/react';
import {Button} from '../components';
import {creationCopy} from '../creationUI.mjs';
import {shouldSubmitAssistant} from './layout.mjs';
import {RevisionAttachments} from '../revisions/ChatOpinions';
import {AssistantActivity,ActivitySparkle} from './AssistantActivity';

export function AssistantComposer({a,project,go,revisionChat}){
  const c=a.context,copy=creationCopy(c.creationMode),novel=copy.format==='novel',attachments=!!revisionChat?.notes.length,executionMode=a.draft.mode==='execute',bodyScope=c.page==='script'&&['execute','rewrite'].includes(a.draft.mode),shortcut=/Mac|iPhone|iPad/.test(globalThis.navigator?.platform||'')?'⌘ Enter':'Ctrl Enter';
  const busy=!!a.pending||!!revisionChat?.pending,canSend=attachments?revisionChat.ready:a.sendReady&&!busy&&!!a.draft.instruction.trim()&&!a.invalidRewrite;
  const send=()=>attachments?revisionChat.send():a.submit();
  return <form className="assistant-composer" onSubmit={e=>{e.preventDefault();if(canSend)send();}}>
      {attachments?<><RevisionAttachments project={project} chat={revisionChat}/><p className="revision-chat-guidance">发送后统一修改标注段落，修改前保留版本</p>{revisionChat.issue&&<p className="error">{revisionChat.issue}</p>}{revisionChat.capabilityError&&<p className="error">{revisionChat.capabilityError}</p>}</>:<><div className="segmented assistant-modes" role="group" aria-label="助手工作模式">{[['execute','执行'],['discuss','讨论'],['manage','预览修改'],...(c.page==='script'?[['rewrite','改写正文']]:[])].map(([mode,label])=><button type="button" key={mode} className={a.draft.mode===mode?'selected':''} aria-pressed={a.draft.mode===mode} onClick={()=>a.change({mode})}>{label}</button>)}</div>
      {bodyScope&&<label className="assistant-rewrite-scope">正文操作范围<select aria-label="助手改写范围" value={a.scope} onChange={e=>a.change({scope:e.target.value})}><option value="selection">选中段落{c.selection?` · ${c.selection.text.length} 字`:''}</option><option value="scene">当前{copy.unit}（全文）</option></select></label>}
      {bodyScope&&a.scope==='selection'&&c.selection&&<p className="selection-preview">选中：{c.selection.text.slice(0,90)}{c.selection.text.length>90?'…':''}</p>}
      {a.invalidRewrite&&<p className="error">{a.invalidRewrite}</p>}{a.bodyRangeHint&&<p className="tiny muted">{a.bodyRangeHint}</p>}
      {executionMode&&!a.capabilities.execute&&a.assistant&&<p className="error">{a.capabilities.message}。可先切换到讨论或预览修改。</p>}
      {c.page==='script'&&!c.sceneId&&<p className="tiny muted">可以先讨论故事。<button className="link" type="button" onClick={()=>go(project.id,'scenes')}>{novel?'前往章节大纲创建第一章':'前往分场创建第一场'}</button></p>}
</>}
      <AssistantActivity pending={a.pending||revisionChat?.pending}/>
      <textarea onKeyDown={e=>{if(shouldSubmitAssistant(e,canSend)){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} aria-label="助手问题" rows={3} value={a.draft.instruction} maxLength={24000} onChange={e=>a.change({instruction:e.target.value})} placeholder={attachments?'为这些段落补充整体修改要求（可选）…':executionMode?'描述需要执行的操作，例如补充故事梗概、添加人物或跳转页面…':a.draft.mode==='manage'?'描述希望预览的修改…':'写下问题或想一起推敲的地方…'}/>{(attachments?revisionChat.error:a.error)&&<p className="error" role="alert">{attachments?revisionChat.error:a.error}</p>}
      <div className="assistant-composer-footer"><small><span className="assistant-shortcut">{shortcut} 发送 · Enter 换行</span>{attachments?'可只发送段落意见，也可补充整体要求':a.pendingCount>(a.pending?1:0)?'其他页面的回复仍在生成':executionMode?'将自动执行；修改前保留版本':'修改前会先保存当前内容'}</small><Button primary icon={busy?ActivitySparkle:Sparkle} aria-label="发送助手问题" disabled={!canSend} type="submit">{busy?'处理中…':attachments?'发送':executionMode?'执行':'发送'}</Button></div>
    </form>;
}
