import {creationCopy,pageName} from '../creationUI.mjs';
import React,{useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Sparkle,Gear,X,Copy,Check} from '@phosphor-icons/react';
import {Button,Field,IconButton,Modal} from '../components';
import {legacyHistory,own,resolveProfile,reviewAction,configurationProfile} from './helpers.mjs';
import {eligibleWriteTargets,executionDestinations,executionStatus,isNewWriteTarget,recoveryVersions,writePreview} from './execution.mjs';
import {AssistantComposer} from './AssistantComposer';
import {RevisionChatTurn,SubmittedOpinions} from '../revisions/ChatOpinions';
import {DEFAULT_REVISION_QUESTION} from '../revisions/chat.mjs';
import {availableOperations} from './operations.mjs';
import {createDialogGuard} from './dialogGuard.mjs';
import {AssistantSettings} from './AssistantSettings';
const STARTERS={overview:['帮我梳理各项目下一步要做什么','为即将交稿的项目添加待办，日期留空'],projects:['梳理各项目的阶段与交稿安排','新建一个短片项目，先和我确认故事方向'],tasks:['为当前项目添加核对人物动机的待办，日期留空','检查待办的先后顺序与遗漏'],shared:['整理共享素材，指出哪些适合继续补充','为共享资料提出清楚的分类建议'],brief:['这个故事的核心冲突和代价够具体吗？','帮我检查一句话故事与主题是否一致'],library:['分析当前人物的目标、阻碍与变化','当前资料与已采用的设定有什么矛盾？'],scenes:['检查场与场之间的因果推进','哪一场缺少结束时的变化？'],script:['检查本场人物动机与潜台词','用动作表达情绪，保留这场戏的结果']};
const NOVEL_STARTERS={overview:['梳理各部小说的完稿目标与下一步','根据各项目的章节进度安排写作待办'],projects:['梳理小说的题材、阶段与交稿安排','新建一个小说项目，先和我确认故事前提'],tasks:['添加核对人物内在动机的待办，日期留空','检查章节写作任务的先后顺序与遗漏'],shared:['整理世界设定与参考资料，保留来源','检查设定规则与资料分类是否清楚'],brief:['这个故事前提给读者的承诺清楚吗？','检查目标读者、主题与叙述视角是否一致'],library:['分析当前人物的内心矛盾、记忆与声音','检查世界规则和已采用资料的连续性'],scenes:['检查章节节奏、伏笔与信息分配','哪一章的章末变化缺少继续阅读的牵引？'],script:['检查人物内心、叙述视角与知情边界','保持 POV 与文风，深化这章的感官细节和内心转折']};
function Turn({turn,w,a,legacy=false,onWrite,onDestination,onRecovery}){
  const vocabulary=creationCopy(turn.creationMode);
  const copy=async()=>{try{await navigator.clipboard.writeText(turn.reply);w.toast('回复已复制');}catch{w.toast('复制暂时不可用，可直接选取回复文字。');}};
  const destinations=executionDestinations(turn);
  const adoptable=turn.mode==='rewrite'||turn.actions?.length>0,busy=a.applying[turn.id],status=executionStatus(turn,busy),targets=eligibleWriteTargets(turn),versions=recoveryVersions(turn,w.state);
  return <article className="assistant-turn" data-turn-id={turn.id}>
    <div className="assistant-question"><small>你</small><p>{turn.instruction}</p></div>
    <div className="assistant-answer"><div className="section-heading"><strong>{turn.roleName||(vocabulary.format==='novel'?'小说写作搭档':'编剧搭档')}</strong><IconButton icon={Copy} label="复制助手回复" onClick={copy}/></div>
      {turn.mode==='rewrite'&&<details className="assistant-original"><summary>查看改写前原文{turn.selection?' · 选中段落':` · 当前${vocabulary.unit}`}</summary><pre>{turn.selection?.text??turn.sourceText}</pre></details>}
      {turn.mode==='execute'&&<p className="tiny muted">助手说明 · 以页面下方的实际执行结果为准</p>}<pre>{turn.reply}</pre>
      {!!turn.actions?.length&&<div className="assistant-proposals"><p className="tiny muted">{turn.readOnly?'导入的操作记录':turn.mode==='execute'?(turn.applied?'请求的操作':'待执行的操作'):turn.applied?'已采用的修改':'待采用的修改'} · {turn.actions.length} 项</p>{turn.actions.map(({label,action},i)=>{const review=reviewAction(action,w.state);return <section className="assistant-action-card" key={i}><h4>{review.title}</h4>{label&&<p className="tiny muted">{label}</p>}<dl>{review.fields.map(([name,value],j)=><div key={j}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></section>;})}</div>}
      {status&&<p className={`assistant-outcome ${turn.applied||turn.write?'assistant-success':'muted'}`} role="status">{status}</p>}
      {turn.write&&<div className="assistant-written"><details><summary>查看实际写入文字</summary><pre>{turn.write.text}</pre></details><Button small onClick={()=>onDestination(turn.write.destination)}>查看写入位置</Button></div>}
      {!!turn.appliedOutcome?.skippedNavigation?.length&&<p className="tiny muted">执行期间页面已切换或有窗口打开，跳转已跳过；保存结果仍保留在原项目。</p>}
      {a.turnErrors[turn.id]&&<p className="error" role="alert">{a.turnErrors[turn.id]}</p>}
      <div className="assistant-turn-footer"><small>{turn.model||'历史记录'}{turn.readOnly?' · 导入记录，仅供查看':''}</small><div className="assistant-turn-actions">
        {destinations.map((destination,i)=><Button small key={i} onClick={()=>onDestination(destination)}>查看{destination.label}</Button>)}
        {versions.map(version=><Button small key={`${version.projectId}:${version.versionId}`} onClick={()=>onRecovery(version)}>{version.trashed?'先恢复《'+version.projectTitle+'》再查看版本':'查看《'+version.projectTitle+'》修改前版本'}</Button>)}
        {!!targets.length&&a.capabilities.write&&<Button small disabled={busy} onClick={()=>onWrite(turn)}>写入页面</Button>}
        {adoptable&&!turn.readOnly&&!turn.write&&<Button small primary={!turn.applied} disabled={turn.applied||busy||turn.mode==='execute'&&!a.capabilities.execute} icon={turn.applied?Check:undefined} onClick={()=>a.apply(turn,legacy)}>{turn.applied?(turn.mode==='execute'?'已执行':'已采用'):busy?(turn.mode==='execute'?'正在执行…':'正在采用…'):turn.mode==='execute'?'重试执行':turn.mode==='rewrite'?'采用改写':'采用这组修改'}</Button>}
      </div></div>
    </div>
  </article>;
}
function WritePreview({turn,a,onClose}){
  const [preview,setPreview]=useState(()=>writePreview(turn)),[busy,setBusy]=useState(false),[error,setError]=useState(''),guard=useRef(null),closeRef=useRef(onClose);
  if(!guard.current)guard.current=createDialogGuard();closeRef.current=onClose;
  useLayoutEffect(()=>{guard.current.mount();return()=>guard.current.unmount();},[]);
  const close=useCallback(()=>guard.current.dismiss(()=>closeRef.current()),[]),targets=eligibleWriteTargets(turn);
  const save=async e=>{
    e.preventDefault();if(!preview.target||!preview.text.trim()||!guard.current.begin())return;
    const checkpoint=guard.current.checkpoint();setBusy(true);setError('');
    try{const data=await a.write(turn,preview);if(!guard.current.isCurrent(checkpoint))return;if(data)closeRef.current();else setError('这条回复正在执行，请稍候。');}
    catch(e){if(guard.current.isCurrent(checkpoint))setError(e.message);}
    finally{if(guard.current.finish(checkpoint))setBusy(false);}
  };
  return <Modal title="写入页面" onClose={close} wide><form className="assistant-write form" onSubmit={save}><p className="muted">将这条回复保存到发送时所在的页面。可先编辑文字；保存后会保留修改前版本。</p><fieldset disabled={busy}>
    <Field label="写入位置"><select aria-label="助手回复写入位置" value={preview.target} onChange={e=>setPreview(x=>({...x,target:e.target.value}))}>{!preview.target&&<option value="" disabled>请选择写入位置</option>}{targets.map(item=><option key={item.target} value={item.target}>{item.label}</option>)}</select></Field>
    {preview.target==='script.replace'&&<p className="error">将替换发送时当前{creationCopy(turn.creationMode).unit}的全部正文。</p>}
    {preview.target==='script.selection'&&<details className="assistant-original"><summary>替换发送时选中的段落</summary><pre>{turn.selection?.text}</pre></details>}
    {isNewWriteTarget(preview.target)&&<Field label="新条目标题（可选）"><input aria-label="助手写入标题" value={preview.title} maxLength={200} placeholder="助手写入" onChange={e=>setPreview(x=>({...x,title:e.target.value}))}/></Field>}
    <Field label="将要写入的文字"><textarea aria-label="助手写入文字预览" rows={12} value={preview.text} maxLength={200000} onChange={e=>setPreview(x=>({...x,text:e.target.value}))}/></Field>
  </fieldset>{error&&<p className="error" role="alert">{error}</p>}{busy&&<p className="muted" role="status">正在保存并核验写入结果，请稍候…</p>}<footer><Button type="button" disabled={busy} onClick={close}>取消</Button><Button primary disabled={busy||!preview.target||!preview.text.trim()}>{busy?'写入中…':'确认写入'}</Button></footer></form></Modal>;
}
export function AssistantPanel({a,w,open,dedicated,onClose,settings,go,onDestination,onRecovery,revisionChat}){
  const [config,setConfig]=useState(false),[writeTurn,setWriteTurn]=useState(null),dialogRef=useRef(false),ref=useRef(null),end=useRef(null),c=a.context,project=w.state?.projects.find(p=>p.id===c.projectId),scene=project?.scenes.find(s=>s.id===c.sceneId),focused=c.focus&&(c.focus.kind==='character'?project?.characters:project?.materials)?.find(x=>x.id===c.focus.id),profile=resolveProfile(a.assistant,a.roleId,c.projectId),turns=own(a.assistant?.threads,a.key)||[],allTurns=Object.values(a.assistant?.threads||{}).flat(),old=legacyHistory(project,c.sceneId,allTurns);
  const batches=revisionChat?.batches||[],attachments=!!revisionChat?.notes.length,history=[...turns.map(turn=>({kind:'turn',value:turn})),...batches.map(batch=>({kind:'batch',value:batch}))].sort((a,b)=>(Date.parse(a.value.createdAt)||0)-(Date.parse(b.value.createdAt)||0));
  dialogRef.current=config||!!writeTurn;
  useEffect(()=>{if(open)a.models.refresh();},[open,a.models.refresh]);
  useEffect(()=>{if(!open)return;const previous=document.activeElement,node=ref.current;node?.focus({preventScroll:true});const onKey=e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!dialogRef.current){e.preventDefault();e.stopPropagation();onClose();}};window.addEventListener('keydown',onKey);return()=>{window.removeEventListener('keydown',onKey);if(!dialogRef.current)previous?.focus?.({preventScroll:true});};},[open]);
  useEffect(()=>{if(open)end.current?.scrollIntoView({block:'nearest'});},[open,a.key,turns.length,batches.length,!!a.pending,!!revisionChat?.pending]);
  const copy=creationCopy(c.creationMode),novel=copy.format==='novel',operations=availableOperations(a.assistant?.operations,c,project,a.draft.mode);
  const turnProps={w,a,onWrite:setWriteTurn,onDestination,onRecovery},executionMode=a.draft.mode==='execute';
  return <>{open&&<aside id="page-assistant" className={`page-assistant ${dedicated?'assistant-dedicated':''}`} aria-label="当前页面助手" role="dialog" aria-modal="false" data-assistant-popup="true" ref={ref} tabIndex={-1}>
    <header className="assistant-header"><span className="assistant-mark"><Sparkle size={19}/></span><div><h2>{profile.name}</h2><p>{pageName(c.page,c.creationMode)} · {project?project.title:'工作空间'}</p></div><IconButton icon={Gear} label="角色与技能" disabled={!configurationProfile(a.assistant,a.roleId,c.projectId)} onClick={()=>{if(configurationProfile(a.assistant,a.roleId,c.projectId))setConfig(true);}}/><IconButton icon={X} label="收起页面助手" onClick={onClose}/></header>
    <div className="assistant-connection"><span className={`status-dot ${a.sendReady?'connected':''}`}/><span role="status">{!attachments&&executionMode&&!a.capabilities.execute&&a.assistant?a.capabilities.message:a.readiness.label}</span>{a.models.catalog?.mode==='host'?<button onClick={a.models.refresh} disabled={a.models.loading}>刷新</button>:<button onClick={settings}>连接设置</button>}</div>
    {a.models.catalog?.mode==='host'&&<div className="assistant-model"><label htmlFor="assistant-model-picker">助手模型</label><select id="assistant-model-picker" aria-label="助手模型" disabled={a.models.saving} value={JSON.stringify(a.models.catalog.selection)} onFocus={a.models.refresh} onChange={e=>a.models.choose(JSON.parse(e.target.value))}><option value="null">跟随 Harness 默认{a.models.catalog.default?` · ${a.models.catalog.providers.find(p=>p.id===a.models.catalog.default.provider)?.models.find(m=>m.id===a.models.catalog.default.model)?.name||a.models.catalog.default.model}`:''}</option>{a.models.catalog.selection&&!a.models.catalog.providers.some(p=>p.id===a.models.catalog.selection.provider&&p.models.some(m=>m.id===a.models.catalog.selection.model))&&<option value={JSON.stringify(a.models.catalog.selection)}>所选模型已不可用</option>}{a.models.catalog.providers.map(p=><optgroup key={p.id} label={p.name}>{p.models.map(m=><option key={m.id} value={JSON.stringify({provider:p.id,model:m.id})}>{m.name}</option>)}</optgroup>)}</select>{a.models.catalog.partial&&<p>部分账户暂时无法读取，其余模型仍可选择。</p>}</div>}
    <div className="assistant-scope"><p>{focused?`当前${c.focus.kind==='character'?'人物':'资料'}：${focused.name||focused.title}`:scene?`当前${copy.unit}：${scene.title}${scene.archived?'（已归档，只读）':''}`:project?`使用本作品的${copy.tabs.brief}、${copy.tabs.scenes}与已采用资料`:'使用工作空间中本页面可见的项目与资料'}</p><div className="assistant-skill-chips">{(profile.skillIds||[]).map(id=>{const skill=a.assistant?.skills.find(s=>s.id===id);return skill&&<span key={id} title={skill.description}>{skill.name}</span>;})}</div></div>
    {!attachments&&<details className="assistant-capabilities"><summary>可以做什么</summary>{operations===null?<p>完整退出并重新打开 Harness 后加载页面操作目录。</p>:<><p>{a.draft.mode==='discuss'?'讨论只生成文字；点击写入页面后才会保存。':a.draft.mode==='manage'?'先生成操作预览，审阅并采用后保存。':a.draft.mode==='rewrite'?'先生成正文改写，采用后才会保存。':'执行会保存当前页面允许的操作，并报告实际结果。'}</p>{operations.length?<ul>{operations.map(item=><li key={item.type}><strong>{item.title}</strong>{item.description&&<span>{item.description}</span>}</li>)}</ul>:!['discuss','rewrite'].includes(a.draft.mode)&&<p>此页面当前没有可执行的操作。</p>}</>}</details>}
    <div className="assistant-conversation" aria-live="polite">
      {a.loadError?<div className="assistant-empty"><p className="error">{a.loadError}</p><Button onClick={a.refresh}>重新加载助手</Button></div>:!a.assistant?<p className="quiet-empty">正在加载助手…</p>:!history.length&&!attachments&&!a.pending&&!revisionChat?.pending?<div className="assistant-empty"><Sparkle size={25} weight="thin"/><h3>一起推进{project?'这部作品':'今天的创作'}</h3><p>{a.capabilities.execute?'执行模式会自动保存允许的操作并报告实际结果。讨论回复可点击“写入页面”；预览修改由你审阅后采用。':'可以继续讨论或预览修改。执行与写入功能需要加载新版后端。'}</p><div className="assistant-starters">{((novel?NOVEL_STARTERS:STARTERS)[c.page]||[]).map((text,i)=><button key={text} onClick={()=>a.change({instruction:text,...(c.page==='script'&&i===1?{mode:'rewrite'}:{})})}>{text}</button>)}</div></div>:null}
      {history.map(({kind,value})=>kind==='batch'?<RevisionChatTurn key={value.id} batch={value} project={project} chat={revisionChat} onRecovery={onRecovery}/>:<Turn key={value.id} turn={value} {...turnProps}/>)}
      {revisionChat?.pending?.notes&&!batches.some(batch=>batch.createdAt>=revisionChat.pending.startedAt)&&<article className="assistant-turn"><div className="assistant-question"><small>你</small><p>{revisionChat.pending.instruction||DEFAULT_REVISION_QUESTION}</p><SubmittedOpinions notes={revisionChat.pending.notes} project={project}/></div><p className="assistant-thinking" role="status">正在按段落意见修改并核验写入条件…</p></article>}
      {a.pending&&<article className="assistant-turn"><div className="assistant-question"><small>你</small><p>{a.pending.instruction}</p></div><p className="assistant-thinking" role="status"><Sparkle size={15}/>{a.pending.mode==='execute'?'正在准备操作并核验执行条件…':'正在结合当前页面思考…'}</p></article>}
      {!!old.length&&<details className="assistant-legacy"><summary>此前的{novel?'小说':'编剧'}协作记录 · {old.length}</summary>{old.map(x=><Turn key={x.id} legacy turn={{...x,instruction:x.prompt,reply:x.text,roleName:novel?'小说写作搭档':'编剧搭档',creationMode:c.creationMode}} {...turnProps}/>)}</details>}<div ref={end}/>
    </div>
    <AssistantComposer a={a} project={project} go={go} revisionChat={revisionChat}/>
  </aside>}{config&&<AssistantSettings key="assistant-settings" a={a} project={project} onClose={()=>setConfig(false)} w={w}/>} {writeTurn&&<WritePreview key={writeTurn.id} turn={writeTurn} a={a} onClose={()=>setWriteTurn(null)}/>}</>;
}
