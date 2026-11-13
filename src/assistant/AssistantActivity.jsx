import React,{useEffect,useState} from 'react';
import {Sparkle} from '@phosphor-icons/react';
import {activityPresentation} from './activity.mjs';

export function ActivitySparkle({size=18,...props}){return <Sparkle {...props} size={size} className="assistant-activity-star" aria-hidden="true"/>;}
export function AssistantActivity({pending}){
  const [now,setNow]=useState(Date.now),[mountedAt]=useState(Date.now);
  const startedAt=pending?.startedAt;
  useEffect(()=>{
    if(!pending)return;
    setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[!!pending,startedAt]);
  const view=activityPresentation(pending?{...pending,startedAt:startedAt??mountedAt}:null,now);
  if(!view)return null;
  return <div className="assistant-activity" data-phase={pending.phase}>
    <span className="assistant-activity-symbol"><ActivitySparkle size={20}/></span>
    <div className="assistant-activity-copy"><div className="assistant-activity-heading"><strong>{view.title}</strong><span className="assistant-activity-elapsed" aria-hidden="true">{view.elapsed}</span></div><p role="status" aria-live="polite" aria-atomic="true">{view.detail}</p></div>
  </div>;
}
