import {creationCopy,projectFormat} from '../creationUI.mjs';
import React,{useState} from 'react';
import {Button} from '../components';
import {changeAvailable,noteCurrent} from './controller.mjs';

const toggle=(items,id)=>items.includes(id)?items.filter(item=>item!==id):[...items,id];
const timestamp=value=>value?new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'历史预览';
export function RevisionInbox({p,scene,w,revisions:r,onClose,onRecovery}){
  const copy=creationCopy(projectFormat(p));
  const {controller:c,snapshot,models}=r,local=c.project(p.id),busy=snapshot.pending[p.id],capabilities=snapshot.capabilities;
  const [deleteId,setDeleteId]=useState('');
  const run=work=>{try{Promise.resolve(work()).catch(()=>{});}catch(error){w.toast(error.message);}};
  const notes=p.revisionNotes||[],batches=p.revisionBatches||[],batch=batches.find(batch=>batch.id===local.batchId)||batches.at(-1);
  const current=note=>{const source=p.scenes.find(scene=>scene.id===note.sceneId);return noteCurrent(p,note,source?w.body(p,source):'');};
  const eligible=note=>note.status==='open'&&current(note)&&!local.editors[note.id]&&p.status!=='archived';
  const checked=local.checkedNotes.map(id=>notes.find(note=>note.id===id)).filter(Boolean),invalidChecked=checked.some(note=>!eligible(note));
  const filtered=notes.filter(note=>(local.sceneFilter!=='current'||note.sceneId===scene.id)&&(local.statusFilter==='all'||note.status===local.statusFilter));
  const selectedChanges=batch?(local.checkedChanges[batch.id]||[]):[],selectedPreview=batch?.changes.filter(change=>selectedChanges.includes(change.id))||[];
  const receipt=snapshot.receipts[p.id]?.batchId===batch?.id?snapshot.receipts[p.id]:null;
  const recoveryReferences=[...new Map([...(batch?.preEditVersionIds||[]),...(receipt?.preEditVersionIds||[])].map(reference=>[JSON.stringify([reference.projectId,reference.versionId]),reference])).values()];
  const available=change=>changeAvailable(p,batch,change,local.editors)&&current(change);
  const blockedPreview=selectedPreview.some(change=>!available(change));
  const catalog=models.catalog,modelReady=!!catalog?.connected&&!models.loading&&!models.error;
  const sceneNames=new Map([...(p.versions||[]).flatMap(version=>version.snapshot?.scenes||[]),...p.scenes].map(scene=>[scene.id,scene.title]));
  const sceneName=sceneId=>sceneNames.get(sceneId)||`原${copy.unit}已不存在`;
  const sceneLabel=sceneId=>{const index=p.scenes.findIndex(scene=>scene.id===sceneId),title=sceneName(sceneId);return index>=0?`第 ${String(index+1).padStart(2,'0')} ${copy.unitCount} · ${title}`:title===`原${copy.unit}已不存在`?title:`历史${copy.unit} · ${title}`;};
  const set=patch=>c.setView(p.id,patch);
  const capabilitiesReady=capabilities?.notes===true;
  return <section className="revision-inbox" aria-label="段落批注箱">
    <header className="revision-heading"><div><span className="eyebrow">{p.title} · 全作品意见</span><h2>段落批注箱 <small>{notes.filter(note=>note.status==='open').length} 条待处理</small></h2></div><Button onClick={onClose}>返回正文</Button></header>
    <p className="revision-intro">先收集意见，再勾选一起生成。保存意见保留原文；只有采用后才会改动正文。</p>
    {(snapshot.capabilityError||snapshot.capabilityLoading||!capabilitiesReady)&&<div className="revision-notice" role="status"><span>{snapshot.capabilityError||'正在读取批注功能…'}</span><Button disabled={snapshot.capabilityLoading} onClick={()=>c.refreshCapabilities()}>重试连接</Button></div>}
    {snapshot.storageError&&<p role="alert" className="revision-error">{snapshot.storageError}</p>}
    {snapshot.errors[p.id]&&<p role="alert" className="revision-error">{snapshot.errors[p.id]}</p>}
    {Object.entries(local.composers).map(([sceneId,draft])=>{const source=p.scenes.find(scene=>scene.id===sceneId);return <section key={sceneId} className="revision-composer">
      <div className="revision-card-heading"><h3>添加批注 · {sceneName(sceneId)}</h3><span className="badge">尚未保存</span></div>
      <small className="revision-source">{sceneLabel(sceneId)}</small><label className="revision-label">当时选中的原文</label><pre className="revision-excerpt">{draft.selection.text}</pre>
      <label className="field"><span>这段想怎么改</span><textarea aria-label={`修改意见：${sceneName(sceneId)}`} value={draft.instruction} rows={3} placeholder={copy.format==='novel'?'例如：保留人物内心与叙述视角，补充感官细节，让犹豫更细腻。':'例如：保留雨声，缩短解释，让人物用动作表达犹豫。'} onChange={event=>c.setComposerInstruction(p.id,sceneId,event.target.value)}/></label>
      <div className="revision-actions"><Button primary disabled={!!busy||!capabilitiesReady||!draft.instruction.trim()||!source||source.archived||p.status==='archived'} onClick={()=>run(()=>c.saveComposer(p.id,sceneId))}>保存意见</Button><Button disabled={!!busy} onClick={()=>c.cancelComposer(p.id,sceneId)}>取消这条草稿</Button><small>意见草稿保存在本机，切换页面后仍保留。</small></div>
    </section>;})}
    {local.reanchorId&&<div className="revision-notice"><p>正在为一条意见重新选段。请返回它的原{copy.unit}，在正文选中当前段落后确认；意见文字会保留。</p><Button onClick={()=>{const note=notes.find(note=>note.id===local.reanchorId);if(note)r.viewOriginal(p.id,note);}}>回到原{copy.unit}选段</Button><Button onClick={()=>set({reanchorId:''})}>取消重新选段</Button></div>}
    <div className="revision-list-toolbar"><h3>已保存的意见 <small>{notes.length}</small></h3><div className="revision-filters"><label>{copy.unit}<select aria-label={`批注${copy.unit}范围`} value={local.sceneFilter} onChange={event=>set({sceneFilter:event.target.value})}><option value="all">全部{copy.unit}</option><option value="current">当前{copy.unit}</option></select></label><label>状态<select aria-label="批注状态" value={local.statusFilter} onChange={event=>set({statusFilter:event.target.value})}><option value="open">待处理</option><option value="applied">已采用</option><option value="all">全部状态</option></select></label></div></div>
    <div className="revision-note-list">{filtered.length?filtered.map(note=>{const source=p.scenes.find(scene=>scene.id===note.sceneId),fresh=current(note),editor=local.editors[note.id];return <article key={note.id} className="revision-note">
      <div className="revision-card-heading"><label className="revision-check"><input type="checkbox" aria-label={`选择意见：${sceneName(note.sceneId)} ${note.instruction}`} checked={local.checkedNotes.includes(note.id)} disabled={!!busy||!eligible(note)&&!local.checkedNotes.includes(note.id)} onChange={()=>set({checkedNotes:toggle(local.checkedNotes,note.id)})}/><strong>{sceneName(note.sceneId)}</strong></label><span className={`badge ${!fresh&&note.status==='open'?'revision-stale':''}`}>{note.status==='applied'?'已采用':fresh?'原文有效':'原文已变化'}</span></div>
      <small className="revision-source">{sceneLabel(note.sceneId)}</small><pre className="revision-excerpt">{note.selection.text}</pre>
      {editor?<><label className="field"><span>编辑修改意见</span><textarea aria-label={`编辑意见：${sceneName(note.sceneId)}`} rows={3} value={editor.instruction} onChange={event=>c.setNoteInstruction(p.id,note.id,event.target.value)}/></label><div className="revision-actions"><Button primary disabled={!!busy||!capabilitiesReady||!editor.instruction.trim()} onClick={()=>run(()=>c.saveNote(p.id,note.id))}>保存意见</Button><Button disabled={!!busy} onClick={()=>c.cancelEdit(p.id,note.id)}>取消编辑</Button><small>保存前，此意见的旧预览暂不可采用。</small></div></>:<p className="revision-instruction">{note.instruction}</p>}
      {!fresh&&note.status==='open'&&<p className="revision-guidance">这段原文已变化。回到原{copy.unit}，手动选中现在要改的段落，再重新生成预览。</p>}
      <div className="revision-actions"><Button onClick={()=>r.viewOriginal(p.id,note)}>查看原文</Button>{note.status==='open'&&!editor&&<Button disabled={!!busy||!capabilitiesReady||source?.archived} onClick={()=>run(()=>c.startEdit(p.id,note.id))}>编辑意见</Button>}{note.status==='open'&&!fresh&&<Button disabled={!!busy||!capabilitiesReady||source?.archived||!source} onClick={()=>run(()=>r.beginReanchor(p.id,note))}>重新选中段落</Button>}{deleteId===note.id?<><span>删除这条意见？{editor?'未保存的编辑也会移除。':''}</span><Button disabled={!!busy||!capabilitiesReady} onClick={()=>run(async()=>{await c.remove(p.id,note.id);setDeleteId('');})}>确认删除</Button><Button onClick={()=>setDeleteId('')}>保留</Button></>:<Button disabled={!!busy||!capabilitiesReady} onClick={()=>setDeleteId(note.id)}>删除</Button>}</div>
    </article>;}):<div className="revision-empty">{notes.length?'这个范围还没有意见。':'在正文中选中一段文字，点击「添加批注」，先记下你的修改意见。'}</div>}</div>
    <section className="revision-generation"><div className="revision-card-heading"><h3>一起处理意见</h3><small>已勾选 {checked.length} 条</small></div>
      <div className="revision-model-status" role="status">{models.loading?'正在读取可用模型…':models.error||catalog?.label||'尚未连接模型'}</div>
      {catalog?.mode==='host'&&<label className="field"><span>处理模型 · 与页面助手共用选择</span><select aria-label="批注处理模型" disabled={models.saving} value={JSON.stringify(catalog.selection)} onFocus={models.refresh} onChange={event=>models.choose(JSON.parse(event.target.value))}><option value="null">跟随 Harness 默认{catalog.default?` · ${catalog.providers.find(provider=>provider.id===catalog.default.provider)?.models.find(model=>model.id===catalog.default.model)?.name||catalog.default.model}`:''}</option>{catalog.selection&&!catalog.providers.some(provider=>provider.id===catalog.selection.provider&&provider.models.some(model=>model.id===catalog.selection.model))&&<option value={JSON.stringify(catalog.selection)}>所选模型已不可用</option>}{catalog.providers.map(provider=><optgroup key={provider.id} label={provider.name}>{provider.models.map(model=><option key={model.id} value={JSON.stringify({provider:provider.id,model:model.id})}>{model.name}</option>)}</optgroup>)}</select></label>}
      {catalog?.partial&&<p className="revision-source">部分账户暂时无法读取，其余模型仍可选择。</p>}
      <div className="revision-actions"><Button primary disabled={!!busy||!capabilities?.generate||!modelReady||!checked.length||invalidChecked} onClick={()=>run(()=>c.generate(p.id,local.checkedNotes))}>{busy==='generate'?'正在生成完整对照…':`生成修改预览（${checked.length}）`}</Button><Button disabled={models.loading} onClick={models.refresh}>刷新模型</Button>{checked.length>0&&<Button disabled={!!busy} onClick={()=>set({checkedNotes:[]})}>清空勾选</Button>}</div>
      {invalidChecked&&<p className="revision-guidance">勾选中含已变化、已采用或正在编辑的意见。请先处理这些意见，或清空后重新勾选。</p>}
      {!modelReady&&!models.loading&&<p className="revision-guidance">连接可用模型后即可生成；仍可继续收集和保存意见。</p>}
    </section>
    {batches.length>0&&<section className="revision-previews"><div className="revision-list-toolbar"><h3>修改前后对照</h3><label>生成记录<select aria-label="批注生成记录" value={batch?.id||''} onChange={event=>set({batchId:event.target.value})}>{[...batches].reverse().map((batch,index)=><option key={batch.id} value={batch.id}>{timestamp(batch.createdAt)}{index===0?' · 最新':''}{batch.readOnly?' · 导入只读':''}</option>)}</select></label></div>
      <p className="revision-source">本次使用：{batch.model||'原记录未提供模型名称'}{batch.readOnly?' · 导入预览只供阅读，请根据意见重新生成。':''}</p>
      {batch.changes.map(change=>{const canApply=available(change),note=notes.find(note=>note.id===change.noteId),editing=!!local.editors[change.noteId];return <article key={change.id} className="revision-preview">
        <div className="revision-card-heading"><label className="revision-check"><input type="checkbox" aria-label={`选择修改：${change.sceneTitle||sceneName(change.sceneId)} ${change.instruction||''}`} checked={selectedChanges.includes(change.id)} disabled={!!busy||!canApply&&!selectedChanges.includes(change.id)} onChange={()=>set({checkedChanges:{...local.checkedChanges,[batch.id]:toggle(selectedChanges,change.id)}})}/><strong>{change.sceneTitle||sceneName(change.sceneId)}</strong></label><span className={`badge ${!canApply&&change.status!=='applied'?'revision-stale':''}`}>{change.status==='applied'?'已采用':batch.readOnly?'导入只读':editing?'意见正在编辑':canApply?'待采用':'原文或意见已变化'}</span></div>
        <small className="revision-source">{sceneLabel(change.sceneId)}</small><p className="revision-instruction">修改意见：{change.instruction||'原记录未提供意见文字'}</p>
        <div className="revision-comparison"><div><h4>原文</h4><pre>{change.selection.text}</pre></div><div><h4>建议修改</h4><pre>{change.replacement}</pre></div></div>
        <div className="revision-actions"><Button primary disabled={!!busy||!capabilities?.apply||!canApply} onClick={()=>run(()=>c.apply(p.id,batch.id,[change.id]))}>采用此条</Button>{!canApply&&change.status!=='applied'&&note&&<Button onClick={()=>{set({statusFilter:'open',sceneFilter:'all'});if(!current(note))run(()=>r.beginReanchor(p.id,note));else w.toast('请在上方核对并勾选已保存的意见，重新生成预览。');}}>根据意见重新处理</Button>}</div>
      </article>;})}
      <div className="revision-actions revision-adoption"><Button primary disabled={!!busy||!capabilities?.apply||!selectedPreview.length||blockedPreview} onClick={()=>run(()=>c.apply(p.id,batch.id,selectedChanges))}>{busy==='apply'?'正在采用并保存…':`采用所选修改（${selectedPreview.length}）`}</Button><Button disabled={!!busy} onClick={()=>set({checkedChanges:{...local.checkedChanges,[batch.id]:batch.changes.filter(available).map(change=>change.id)}})}>勾选可采用的修改</Button>{selectedChanges.length>0&&<Button disabled={!!busy} onClick={()=>set({checkedChanges:{...local.checkedChanges,[batch.id]:[]}})}>清空预览勾选</Button>}</div>
      {blockedPreview&&<p className="revision-guidance">所选预览中有不可采用的条目。请重新勾选有效修改；完整对照会继续保留。</p>}
      {(receipt||recoveryReferences.length>0)&&<div className="revision-receipt" role="status">{receipt&&<span>最近一次已采用 {receipt.appliedChangeIds?.length||0} 条修改。</span>}{recoveryReferences.map(reference=><Button key={`${reference.projectId}:${reference.versionId}`} onClick={()=>onRecovery?.(reference)}>查看修改前版本{p.versions?.find(version=>version.id===reference.versionId)?.name?` · ${p.versions.find(version=>version.id===reference.versionId).name}`:''}</Button>)}</div>}
    </section>}
  </section>;
}
