import {creationCopy,projectFormat} from '../creationUI.mjs';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {request} from '../api';
import {createRevisionsController,noteCurrent} from './controller.mjs';

// This owner remains mounted when the author changes pages or projects.
export function useRevisions(w,models,onViewed){
  const wRef=useRef(w),modelsRef=useRef(models),onViewedRef=useRef(onViewed),controllerRef=useRef(null),focusGeneration=useRef(0);
  const [focusRequest,setFocusRequest]=useState(null);
  wRef.current=w;modelsRef.current=models;onViewedRef.current=onViewed;
  if(!controllerRef.current)controllerRef.current=createRevisionsController({workbench:()=>wRef.current,models:()=>modelsRef.current,request});
  const controller=controllerRef.current,snapshot=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
  const projectId=w.state?.workspace.activeProjectId,project=w.state?.projects.find(project=>project.id===projectId),isOpen=project?.view?.tab==='script'&&controller.project(projectId).open;
  useEffect(()=>{controller.refreshCapabilities();},[controller]);
  useEffect(()=>{if(isOpen){modelsRef.current.refresh();controller.refreshCapabilities();}},[controller,projectId,isOpen]);
  const viewOriginal=async(id,note)=>{
    const p=wRef.current.getState()?.projects.find(project=>project.id===id),scene=p?.scenes.find(scene=>scene.id===note.sceneId);
    const unit=creationCopy(projectFormat(p)).unit;
    if(!scene){wRef.current.toast(`原${unit}已不存在，原文仍保留在段落意见中。`);return;}
    const current=noteCurrent(p,note,wRef.current.body(p,scene));
    controller.setView(id,{open:false});
    const opened=await wRef.current.go('project',id,'script',note.sceneId);
    if(opened===false)throw new Error('未能跳转原文，请先完成手动编辑后重试。');
    setFocusRequest({projectId:id,sceneId:note.sceneId,selection:current?note.selection:null,id:++focusGeneration.current});
    onViewedRef.current?.();
    if(!current)wRef.current.toast(`原文已变化。请在原${unit}重新选中段落，段落意见保留了当时的原文。`);
  };
  const beginReanchor=(id,note)=>{controller.beginReanchor(id,note.id);return viewOriginal(id,note);};
  return {controller,snapshot,models,focusRequest,onFocused:id=>setFocusRequest(current=>current?.id===id?null:current),viewOriginal,beginReanchor};
}
