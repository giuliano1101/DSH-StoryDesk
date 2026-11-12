import {roleForContext,creationCopy} from '../creationUI.mjs';
import {useModels} from './useModels';
import {assistantReadiness,assistantError} from './modelState.mjs';
import {useCallback,useEffect,useRef,useState} from 'react';
import {request} from '../api';
import {adoptionTargets} from './editingGate.mjs';
import {assistantContextKey} from '../../shared/assistant-context.mjs';
import {assistantMode,createAssistantExecutor,executionCapabilities,executionStatus} from './execution.mjs';
import {buildContext,completeDraft,mergeAssistantSnapshot,normalizeDrafts,own,ROLE_BY_PAGE,updateDraft,validSelection} from './helpers.mjs';
const RECOVERY='screenwriter-assistant-drafts-v1';
export function useAssistant(w,focus,selection){
  const [snapshot,setSnapshot]=useState(null),[loadError,setLoadError]=useState(''),[drafts,setDrafts]=useState(()=>{try{return normalizeDrafts(JSON.parse(localStorage.getItem(RECOVERY)||'{}'));}catch{return {};}}),[pending,setPending]=useState({}),[errors,setErrors]=useState({}),[turnErrors,setTurnErrors]=useState({}),[applying,setApplying]=useState({});
  const models=useModels(w.ai),readiness=assistantReadiness({assistant:snapshot?.assistant,loadError,catalog:models.catalog,loading:models.loading,modelError:models.error}),capabilities=executionCapabilities(snapshot?.assistant);
  const generation=useRef(0),wRef=useRef(w),focusRef=useRef(focus),selectionRef=useRef(selection),pendingRef=useRef(new Set()),applyingRef=useRef(new Set()),executor=useRef(null);wRef.current=w;focusRef.current=focus;selectionRef.current=selection;
  const context=buildContext(w.state,focus,selection,w.body),key=assistantContextKey(context),roleId=roleForContext(context),recovered=own(drafts,key),draft={instruction:'',...recovered,mode:assistantMode(recovered)};
  useEffect(()=>{try{localStorage.setItem(RECOVERY,JSON.stringify(drafts));}catch{}},[drafts]);
  const accept=useCallback((data,gen,revision)=>{if(!data.assistant)return;setSnapshot(current=>mergeAssistantSnapshot(current,{assistant:data.assistant,generation:gen,revision:data.state?.revision??revision??0}));if(data.state)wRef.current.accept(data.state);},[]);
  if(!executor.current)executor.current=createAssistantExecutor({workbench:()=>wRef.current,liveContext:()=>buildContext(wRef.current.getState(),focusRef.current,selectionRef.current,wRef.current.body),request,accept:data=>accept(data,++generation.current),onBusy:(id,busy)=>setApplying(x=>({...x,[id]:busy}))});
  const refresh=useCallback(async()=>{const gen=++generation.current,revision=wRef.current.getState()?.revision||0;try{const data=await request('/assistant');accept(data,gen,revision);setLoadError('');}catch(e){setLoadError(assistantError(e));}},[accept]);
  useEffect(()=>{if(!w.state)return;const timer=setTimeout(()=>refresh(),80);return()=>clearTimeout(timer);},[w.state?.assistant,!!w.state,refresh]);
  const change=useCallback((patch,targetKey=key)=>setDrafts(current=>updateDraft(current,targetKey,patch)),[key]);
  useEffect(()=>{if(['execute','rewrite'].includes(draft.mode)&&context.selection&&!draft.scope)change({scope:'selection'});},[key,draft.mode,draft.scope,!!context.selection,change]);
  const scope=draft.scope||(context.selection?'selection':'scene');
  const copy=creationCopy(context.creationMode),novel=copy.format==='novel';
  const sceneArchived=w.state?.projects.find(p=>p.id===context.projectId)?.scenes.find(s=>s.id===context.sceneId)?.archived;
  const invalidRewrite=draft.mode==='rewrite'&&(sceneArchived?`当前显示已归档${copy.unit}，可讨论；恢复${copy.unit}后才能改写。`:!context.sceneId?(novel?'先到章节大纲创建或选择一章，再生成改写。':'先到分场创建或选择一场戏，再生成改写。'):scope==='selection'&&!context.selection?`选中段落已消失或已修改，请重新选择，或明确切换为当前${copy.unit}。`:'');
  const bodyRangeHint=draft.mode==='execute'&&context.page==='script'&&(sceneArchived?`已归档${copy.unit}不能写入正文，可执行其他允许的操作。`:scope==='selection'&&!context.selection?`选中段落已消失或已修改；本次不能写入正文。请重新选择，或明确切换为当前${copy.unit}。`:'');
  const sendReady=readiness.ready&&(draft.mode!=='execute'||capabilities.execute);
  const rememberError=(turn,error)=>setTurnErrors(x=>({...x,[turn.id]:assistantError(error)}));
  const submit=async()=>{
    if(!sendReady||!draft.instruction.trim()||pendingRef.current.has(key)||invalidRewrite)return;
    const sent=draft.instruction,sentGeneration=draft.instructionGeneration??0,targetKey=key,targetContext=structuredClone(context),targetModel=models.catalog?.mode==='host'?structuredClone(models.catalog.effective):undefined,mode=draft.mode,targetScope=scope;
    pendingRef.current.add(targetKey);setPending(x=>({...x,[targetKey]:{instruction:sent,mode,startedAt:Date.now()}}));setErrors(x=>({...x,[targetKey]:''}));
    try{
      await wRef.current.flush();
      const state=wRef.current.getState(),p=state.projects.find(p=>p.id===targetContext.projectId),s=p?.scenes.find(s=>s.id===targetContext.sceneId);
      if(targetContext.selection&&!validSelection(s?wRef.current.body(p,s):'',targetContext.selection))throw new Error('选中段落已修改，请重新选择后发送。');
      const gen=++generation.current,data=await request('/assistant',{context:targetContext,mode,instruction:sent,...(targetModel?{modelSelection:targetModel}:{}),...(mode==='rewrite'||mode==='execute'&&targetContext.page==='script'?{scope:targetScope}:{})});
      accept(data,gen);setDrafts(current=>completeDraft(current,targetKey,sent,sentGeneration));
      if(mode==='execute'&&data.turn?.actions?.length){try{const applied=await executor.current.autoApply(data.turn);if(applied)wRef.current.toast(executionStatus(applied.turn));}catch(e){rememberError(data.turn,e);wRef.current.toast('执行尚未完成，请查看回复中的原因。');}}
      else wRef.current.toast(mode==='execute'?'助手未执行操作，请查看回复':`${p?'《'+p.title+'》的':'当前页面的'}助手回复已就绪`);
    }catch(e){setErrors(x=>({...x,[targetKey]:assistantError(e)}));if(e.code==='MODEL_UNAVAILABLE')models.refresh();}finally{pendingRef.current.delete(targetKey);setPending(x=>{const next={...x};delete next[targetKey];return next;});}
  };
  const saveConfig=async(payload)=>{const gen=++generation.current,data=await request('/assistant/config',payload);accept(data,gen);return data;};
  const importSkill=async(markdown)=>{const gen=++generation.current,data=await request('/assistant/skills',{markdown});accept(data,gen);return data;};
  const apply=async(turn,legacy=false)=>{
    setTurnErrors(x=>({...x,[turn.id]:''}));
    if(!legacy){try{if(turn.mode==='execute'&&!capabilities.execute)throw new Error(capabilities.message);const data=await executor.current.apply(turn);if(data)wRef.current.toast(turn.mode==='execute'?executionStatus(data.turn):'修改已采用，修改前的内容已存档');return data;}catch(e){rememberError(turn,e);return null;}}
    if(applyingRef.current.has(turn.id))return;applyingRef.current.add(turn.id);let adoptionToken;setApplying(x=>({...x,[turn.id]:true}));
    try{adoptionToken=wRef.current.acquireEditingLock(adoptionTargets(turn,context.projectId));await wRef.current.flush({adoptionToken});await wRef.current.mutate({type:'ai.apply',projectId:turn.projectId||context.projectId,suggestionId:turn.id},{adoptionToken});await refresh();wRef.current.toast('修改已采用，修改前的内容已存档');}
    catch(e){rememberError(turn,e);}finally{if(adoptionToken)wRef.current.releaseEditingLock(adoptionToken);applyingRef.current.delete(turn.id);setApplying(x=>({...x,[turn.id]:false}));}
  };
  const write=async(turn,preview)=>{
    setTurnErrors(x=>({...x,[turn.id]:''}));
    try{if(!capabilities.write)throw new Error(capabilities.message);const data=await executor.current.write(turn,preview);if(data)wRef.current.toast(`已写入 · ${data.destination?.label||'页面内容'}`);return data;}catch(e){rememberError(turn,e);throw e;}
  };
  return {models,readiness,capabilities,sendReady,assistant:snapshot?.assistant,loadError,refresh,context,key,roleId,draft,scope,change,invalidRewrite,bodyRangeHint,submit,pending:own(pending,key),pendingCount:Object.keys(pending).length,error:own(errors,key),turnErrors,apply,write,applying,saveConfig,importSkill};
}
