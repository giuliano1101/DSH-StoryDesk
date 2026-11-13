import React from 'react';
import {Button,Field,Modal} from '../components';
import {AssistantActivity} from '../assistant/AssistantActivity';
import {creationCopy,projectFormat} from '../creationUI.mjs';
import {isEpisodic} from '../../shared/episodes.mjs';
import {StoryBible} from './StoryBible';
import {DOCTOR_MODES as MODES,DOCTOR_CERTAINTY,CRAFT_MODES,CRAFT_NOTICES} from '../../shared/doctor.mjs';

const PRIORITY={high:'高',medium:'中',low:'低'};
const RHYTHMS=['自动判断','电影感中速','短视频中高密度','高密度动作或强钩子','慢节奏但高信息'];
function ModelPicker({models,busy}){
 const catalog=models.catalog;
 if(catalog?.mode!=='host')return <p className="muted" role="status">{models.error||catalog?.label||'正在读取模型连接…'}</p>;
 return <Field label="医生模型"><select aria-label="医生模型" disabled={busy||models.saving} value={JSON.stringify(catalog.selection)} onFocus={models.refresh} onChange={event=>models.choose(JSON.parse(event.target.value))}>
  <option value="null">跟随 Harness 默认{catalog.default?` · ${catalog.providers.find(p=>p.id===catalog.default.provider)?.models.find(m=>m.id===catalog.default.model)?.name||catalog.default.model}`:''}</option>
  {catalog.selection&&!catalog.providers.some(p=>p.id===catalog.selection.provider&&p.models.some(m=>m.id===catalog.selection.model))&&<option value={JSON.stringify(catalog.selection)}>所选模型已不可用</option>}
  {catalog.providers.map(p=><optgroup key={p.id} label={p.name}>{p.models.map(m=><option key={m.id} value={JSON.stringify({provider:p.id,model:m.id})}>{m.name}</option>)}</optgroup>)}
 </select>{(models.error||!catalog.connected)&&<small role="alert">{models.error||catalog.label}</small>}{catalog.partial&&<small>部分账户暂时无法读取，其余模型仍可选择。</small>}</Field>;
}
function Report({report,latest,unit,busy,onHandoff,onError}){
 const scope=report.scope==='project'?'整个作品':report.scope==='episode'?report.source.episode?.title||'当前集':`当前${unit}`,current=report.status==='current';
 return <details className="doctor-report" open={latest}><summary><strong>{MODES[report.mode]} · {scope}</strong><span className={`doctor-state ${current?'':'stale'}`}>{current?'依据未变':'依据已变化'}{report.readOnly?' · 只读历史':''}</span><time>{new Date(report.createdAt).toLocaleString('zh-CN')}</time></summary>
  <div className="doctor-report-body"><p className="doctor-meta">{report.source.project.title} · {report.model} · {report.source.scenes.length} {unit}{report.options.platform?` · ${report.options.platform}`:''} · {report.options.rhythm}{report.options.targetDuration?` · 目标时长 ${report.options.targetDuration}`:' · 目标时长未知'}</p>
  {report.readOnly&&<p className="doctor-notice">导入或上次后端会话的报告保留供阅读。重新诊断后可加入助手意见。</p>}{!current&&<p className="doctor-notice">原文或诊断依据已有变化，旧报告保留供参考。请重新诊断后再移交。</p>}
  <p>{report.summary}</p><StoryBible bible={report.bibleDocument} historical onError={onError}/>{report.limitations.length>0&&<div className="doctor-boundaries"><strong>本次边界</strong><ul>{report.limitations.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
  <p><strong>视角与分歧：</strong>{report.disagreement}</p>
  {report.issues.map(issue=><article className="doctor-issue" key={issue.id}><div className="doctor-issue-heading"><span className={`doctor-priority ${issue.priority}`}>{PRIORITY[issue.priority]}优先级</span><span>{issue.reviewer}</span>{issue.certainty&&<span>{DOCTOR_CERTAINTY[issue.certainty]}</span>}</div><h3>{issue.title}</h3>
   {issue.evidence?<><small>{report.source.scenes.find(s=>s.id===issue.evidence.sceneId)?.title||unit} · 原文</small><blockquote>{issue.evidence.selection.text}</blockquote></>:<p className="muted">依据为大纲或整体资料，未锚定正文，仅供阅读。</p>}
   {!!issue.basis?.length&&<div className="doctor-comparison"><strong>对照依据</strong>{issue.basis.map((ref,i)=><section key={i}><small>{ref.title} · {ref.kind==='outline'||ref.kind==='episode'?'大纲计划':ref.kind==='scene'?'正文':ref.kind==='reference'?'参考资料':'故事档案'}</small><blockquote>{ref.quote}</blockquote></section>)}</div>}
   <p><strong>影响：</strong>{issue.impact}</p><p><strong>修改方向：</strong>{issue.suggestion}</p>
   {issue.certainty==='needs-context'?<p className="doctor-notice">请先补充或确认资料，再重新诊断。待确认问题不会直接进入改稿。</p>:issue.evidence&&<Button small disabled={busy||!current||report.readOnly||!!issue.noteId} onClick={()=>onHandoff(report.id,issue.id)}>{issue.noteId?'已加入助手意见':'加入助手意见'}</Button>}
  </article>)}
  <p className="doctor-next"><strong>建议先做：</strong>{report.nextStep}</p>
  <details className="doctor-source"><summary>会诊时的原文 · {report.source.scenes.length} {unit}</summary>{report.source.scenes.map(scene=><section key={scene.id}><strong>{scene.title}</strong><pre>{scene.body||scene.summary||'正文尚未提供'}</pre></section>)}</details>
  </div>
 </details>;
}
export function DoctorModal({doctor,w}){
 const {controller:c,snapshot:s,models}=doctor,context=s.open,p=w.state?.projects.find(p=>p.id===context?.projectId);
 if(!context||!p)return null;
 const id=p.id,copy=creationCopy(projectFormat(p)),novel=copy.format==='novel',options=s.options[id],busy=!!s.pending[id],reports=[...(s.reports[id]||[])].reverse();
 const run=operation=>Promise.resolve().then(operation).catch(()=>{}),ready=!models.loading&&!models.error&&!!models.catalog?.connected;
 const unsupported=mode=>mode==='continuity'?!s.capabilities?.continuity:CRAFT_MODES.includes(mode)&&!s.capabilities?.craftChecks;
 return <Modal wide title={novel?'小说医生':'剧本医生'} onClose={()=>c.close()}><div className="doctor-content">
  <p className="doctor-intro">{p.title} · 诊断先找出有依据的问题。选择意见后，在 AI 协助里统一发送改稿；诊断不会改动正文。</p>
  {s.capabilities?.storyBible&&s.bibles[id]?<StoryBible bible={s.bibles[id]} onError={message=>w.toast(message)}/>:<p className="doctor-notice" role="status">{s.loading[id]?'正在整理故事档案…':'完整退出并重新打开 Harness 后加载故事档案与一致性诊断。当前诊断仅使用旧有资料。'}</p>}
  <form className="doctor-form" onSubmit={event=>{event.preventDefault();run(()=>c.diagnose(id));}}><fieldset disabled={busy} className="form-fields"><div className="form-grid">
   <Field label="诊断方式"><select aria-label="诊断方式" value={options.mode} onChange={e=>c.change(id,{mode:e.target.value})}>{Object.entries(MODES).map(([value,label])=><option key={value} value={value} disabled={unsupported(value)}>{label}</option>)}</select></Field>
   <Field label="诊断范围"><select aria-label="诊断范围" value={options.scope} onChange={e=>c.change(id,{scope:e.target.value})}>{context.sceneId&&<option value="scene">当前{copy.unit}</option>}{isEpisodic(p)&&context.episodeId&&<option value="episode">当前集</option>}<option value="project">整个作品（当前已有材料）</option></select></Field>
   <Field label="目标平台（可选）"><input aria-label="目标平台" value={options.platform} maxLength={200} placeholder={novel?'例如：连载平台；可留空':'例如：抖音、红果；可留空'} onChange={e=>c.change(id,{platform:e.target.value})}/></Field>
   <Field label="节奏档位"><select aria-label="节奏档位" value={options.rhythm} onChange={e=>c.change(id,{rhythm:e.target.value})}>{RHYTHMS.map(r=><option key={r}>{r}</option>)}</select></Field>
   <Field label="目标时长（可选）" hint="目标不代表实际时间轴，缺少时间依据时会标明未知。"><input aria-label="目标时长" value={options.targetDuration} maxLength={200} placeholder="可留空，例如：本集约 2 分钟" onChange={e=>c.change(id,{targetDuration:e.target.value})}/></Field>
   <ModelPicker models={models} busy={busy}/>
  </div></fieldset>{options.mode==='continuity'&&<p className="doctor-notice">对照全作品大纲与已采用设定，并在容量内选取其他章节正文；报告会说明未覆盖范围。双方证据不足时只列待确认问题，不自行补写世界规则。</p>}{CRAFT_NOTICES[options.mode]&&<p className="doctor-notice">{CRAFT_NOTICES[options.mode]}{unsupported(options.mode)&&' 完整退出并重新打开 Harness 后加载专项检查。'}</p>}<div className="doctor-actions"><small>{novel?'小说适配沿用剧本医生的证据方法，关注章节与读者体验。':'引用原文、区分优先级与视角，保留作者最终判断。'}</small><Button primary disabled={busy||!ready||p.status==='archived'||!!p.trashedAt||unsupported(options.mode)} type="submit">{s.pending[id]==='diagnose'?'正在诊断…':'开始诊断'}</Button></div></form>
  <AssistantActivity pending={busy?{phase:s.pending[id]==='diagnose'?'diagnosing':'handoff',startedAt:s.startedAt[id]}:null}/>
  {s.errors[id]&&<p className="error" role="alert">{s.errors[id]}</p>}
  <div className="section-heading doctor-history-heading"><h3>诊断记录 <small>{reports.length}</small></h3><Button small disabled={busy||s.loading[id]} onClick={()=>c.refresh(id)}>{s.loading[id]?'读取中…':'刷新记录'}</Button></div>
  {reports.length?reports.map((report,i)=><Report key={report.id} report={report} latest={i===0} unit={copy.unit} busy={busy} onError={message=>w.toast(message)} onHandoff={(reportId,issueId)=>run(()=>c.handoff(id,reportId,issueId))}/>):<p className="quiet-empty">选择范围开始一次诊断。每次报告都会保留，可回到这里对照改稿后的变化。</p>}
  <footer className="doctor-footer"><p>加入意见只保存修改方向。关闭窗口后，可打开 AI 协助，补充整体要求并统一发送。</p><Button disabled={busy} onClick={()=>c.close()}>关闭</Button></footer>
 </div></Modal>;
}
