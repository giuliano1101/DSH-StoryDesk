import {useEffect,useRef,useSyncExternalStore} from 'react';
import {request} from '../api';
import {createDoctorController} from './controller.mjs';

// Stable owner: responses remain with their captured project across navigation.
export function useDoctor(w,models,revisions){
 const live=useRef({w,models,revisions}),owner=useRef(null);live.current={w,models,revisions};
 if(!owner.current)owner.current=createDoctorController({workbench:()=>live.current.w,models:()=>live.current.models,opinionDrafts:id=>live.current.revisions.controller.project(id),request});
 const controller=owner.current,snapshot=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot),projectId=snapshot.open?.projectId;
 useEffect(()=>{if(projectId)live.current.models.refresh();},[projectId]);
 useEffect(()=>{if(projectId)controller.refresh(projectId);},[projectId,w.state?.revision,controller]);
 return {controller,snapshot,models};
}
