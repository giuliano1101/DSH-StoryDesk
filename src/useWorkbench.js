import {createWorkspaceNavigation,createNavigationGuard,createProjectLifecycle} from './creationUI.mjs';
import {useCallback, useEffect, useRef, useState} from 'react';
import {request} from './api';
import {inspectAssistantDialogs} from './assistant/execution.mjs';
import {createEditingGate} from './assistant/editingGate.mjs';

const RECOVERY_KEY = 'screenwriter-unsaved-v1';
const POSITION_KEY = 'screenwriter-positions-v1';
export function useWorkbench() {
  const [state, setState] = useState(null);
  const [capabilities,setCapabilities]=useState({}),capabilitiesRef=useRef({});
  const [ai, setAi] = useState({connected:false,label:''});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState(() => {try {return JSON.parse(localStorage.getItem(RECOVERY_KEY) || '{}');} catch {return {};}});
  const [saving, setSaving] = useState(false);
  const [navigating,setNavigating]=useState(false),navigationGuard=useRef(null);
  if(!navigationGuard.current)navigationGuard.current=createNavigationGuard(setNavigating);
  const isNavigating=useCallback(()=>navigationGuard.current.isBusy(),[]);
  const [saveError, setSaveError] = useState(false);
  const [pendingForms,setPendingForms]=useState({}),[,setEditingGeneration]=useState(0),editingGate=useRef(null);
  if(!editingGate.current)editingGate.current=createEditingGate();
  const isProjectLocked=useCallback(id=>editingGate.current.isProjectLocked(id),[]),isSharedLocked=useCallback(()=>editingGate.current.isSharedLocked(),[]);
  const acquireEditingLock=useCallback(target=>{const token=editingGate.current.acquire(target);setEditingGeneration(x=>x+1);return token;},[]);
  const releaseEditingLock=useCallback(token=>{editingGate.current.release(token);setEditingGeneration(x=>x+1);},[]);
  const pendingFormRef=useRef({});
  const reportFormSave=useCallback((key,status)=>{const next={...pendingFormRef.current};if(status==='saved')delete next[key];else next[key]=status;pendingFormRef.current=next;setPendingForms(next);},[]);
  const stateRef = useRef(null), draftRef = useRef(drafts), queue = useRef(Promise.resolve()), timer = useRef(), noticeTimer = useRef(), viewTimer=useRef(), pendingViews=useRef({});
  const positions=useRef(null);
  const flushers=useRef(new Map());
  const registerFlusher=useCallback((key,fn)=>{flushers.current.set(key,fn);return()=>flushers.current.delete(key);},[]);
  if(!positions.current){try{positions.current=JSON.parse(localStorage.getItem(POSITION_KEY)||'{}');}catch{positions.current={};}}
  const toast = useCallback(text => {setNotice(text); clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(''), 4500);}, []);
  const accept = useCallback(incoming => {
    if (incoming && (!stateRef.current || incoming.revision >= stateRef.current.revision)) {stateRef.current=incoming;setState(incoming);}
  }, []);
  const reload = useCallback(async () => {try {const data=await request('/state');accept(data.state);capabilitiesRef.current=data.capabilities||{};setCapabilities(capabilitiesRef.current);setAi(data.ai || {connected:false});setError('');} catch(e){setError(e.message);}}, [accept]);
  useEffect(() => {reload();return () => {clearTimeout(timer.current);clearTimeout(viewTimer.current);clearTimeout(noticeTimer.current);};}, [reload]);
  const mutate = useCallback((action,options={}) => {
    if(!editingGate.current.allows(action,options.adoptionToken))return Promise.reject(new Error('正在采用修改，请稍候再编辑这项内容。'));
    const work = queue.current.catch(()=>{}).then(async () => {const data=await request('/actions',{action});accept(data.state);return data;});
    queue.current=work;
    return work;
  }, [accept]);
  const persistDrafts = next => {draftRef.current=next;setDrafts(next);try {localStorage.setItem(RECOVERY_KEY,JSON.stringify(next));} catch {setSaveError(true);}};
  const flush = useCallback(async (options={}) => {
    clearTimeout(timer.current);clearTimeout(viewTimer.current);
    for(const save of flushers.current.values())await save(options);
    const entries=Object.entries(draftRef.current);
    const views=Object.entries(pendingViews.current);
    if (!entries.length&&!views.length) {await queue.current.catch(()=>{});return;}
    if(entries.length)setSaving(true);
    try {
      for (const [key,d] of entries) {
        const project=stateRef.current?.projects.find(p=>p.id===d.projectId);
        if(project?.trashedAt)continue;
        if(!project?.scenes.some(s=>s.id===d.sceneId)) continue;
        await mutate({type:'scene.update',projectId:d.projectId,sceneId:d.sceneId,patch:{body:d.text}},options);
        if(draftRef.current[key]?.text===d.text){const next={...draftRef.current};delete next[key];persistDrafts(next);}
      }
      for(const [projectId,view] of views){
        if(!stateRef.current?.projects.some(p=>p.id===projectId&&!p.trashedAt))continue;
        await mutate({type:'view.save',projectId,view});
        if(pendingViews.current[projectId]===view)delete pendingViews.current[projectId];
      }
      setSaveError(false);
    } catch(e) {setSaveError(true);throw e;} finally {setSaving(false);}
  }, [mutate]);
  const getView=(projectId,sceneId)=>{
    const view=stateRef.current?.projects.find(p=>p.id===projectId)?.view||{};
    return positions.current[`${projectId}:${sceneId}`]||(view.sceneId===sceneId?view:{cursor:{start:0,end:0},scrollTop:0});
  };
  const rememberView=(projectId,view)=>{
    pendingViews.current[projectId]={...pendingViews.current[projectId],...view};
    if(view.sceneId){positions.current[`${projectId}:${view.sceneId}`]={...positions.current[`${projectId}:${view.sceneId}`],...view};try{localStorage.setItem(POSITION_KEY,JSON.stringify(positions.current));}catch{}}
    clearTimeout(viewTimer.current);viewTimer.current=setTimeout(()=>flush().catch(e=>toast(e.message)),700);
  };
  const editBody = (projectId,sceneId,text) => {
    if(isNavigating()){toast('正在切换创作页面，请稍候继续编辑。');return false;}
    if(editingGate.current.isProjectLocked(projectId)){toast('正在采用修改，请稍候继续写作。');return false;}
    persistDrafts({...draftRef.current,[`${projectId}:${sceneId}`]:{projectId,sceneId,text}});
    clearTimeout(timer.current);
    timer.current=setTimeout(()=>flush().catch(e=>toast(e.message)),650);
  };
  useEffect(() => {
    const onClose=e=>{if(Object.keys(draftRef.current).length||Object.keys(pendingFormRef.current).length){e.preventDefault();e.returnValue='';}};
    const onKey=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();flush().then(()=>toast('已保存')).catch(e=>toast(e.message));}};
    addEventListener('beforeunload',onClose);addEventListener('keydown',onKey);
    return()=>{removeEventListener('beforeunload',onClose);removeEventListener('keydown',onKey);};
  },[flush,toast]);
  const act = async (action,message) => {try{const result=await mutate(action);if(message)toast(message);return result;}catch(e){toast(e.message);throw e;}};
  const navigation=createWorkspaceNavigation({guard:navigationGuard.current,getState:()=>stateRef.current,getCapabilities:()=>capabilitiesRef.current,flush,mutate,getView,dialogs:()=>!!document.querySelector('[role="dialog"]:not([data-assistant-popup]):not([data-revision-composer]),[data-revision-composer][aria-busy="true"]')});
  const lifecycle=createProjectLifecycle({guard:navigationGuard.current,getState:()=>stateRef.current,getCapabilities:()=>capabilitiesRef.current,flush,mutate,dialogs:inspectAssistantDialogs});
  const trashProject=id=>{if(isProjectLocked(id))return Promise.reject(new Error('正在采用修改，请稍候。'));return lifecycle.trash(id);},restoreProject=id=>lifecycle.restore(id);
  const navigate=async work=>{try{await work();return true;}catch(e){toast(e.message);return false;}};
  const enter=()=>navigate(()=>navigation.enter()),chooseMode=format=>navigate(()=>navigation.choose(format));
  const go=(screen,projectId,tab,sceneId,episodeId)=>navigate(async()=>{if(projectId)return navigation.open(projectId,tab,sceneId,episodeId);return navigation.show(screen);});
  const body = (p,s) => draftRef.current[`${p.id}:${s.id}`]?.text ?? s.body ?? '';
  const getState=useCallback(()=>stateRef.current,[]);
  return {trashProject,restoreProject,navigating,isNavigating,capabilities,enter,chooseMode,isProjectLocked,isSharedLocked,acquireEditingLock,releaseEditingLock,getState,state,ai,setAi,error,notice,toast,reload,accept,mutate,act,go,drafts,body,editBody,flush,saving:saving||Object.values(pendingForms).includes('saving'),saveError:saveError||Object.values(pendingForms).includes('error'),getView,rememberView,registerFlusher,reportFormSave};
}
