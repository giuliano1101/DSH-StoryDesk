import React,{useEffect,useState} from 'react';
import {isEpisodic,projectEpisodes} from '../shared/episodes.mjs';
import {currentEpisodeId,EPISODES_RELOAD} from './creationUI.mjs';
import {Button,Field,FormModal} from './components';
export function EpisodeControls({p,w,go,tab}){
  const [editing,setEditing]=useState(null),[destination,setDestination]=useState(null);
  useEffect(()=>{if(editing||!destination)return;setDestination(null);const live=w.getState?.(),source=live?.projects.find(project=>project.id===p.id);if(live?.workspace.screen==='project'&&live.workspace.activeProjectId===p.id&&source?.view?.tab===tab&&currentEpisodeId(source)===destination.sourceEpisode)go(p.id,tab,undefined,destination.episodeId);},[editing,destination]);
  if(!isEpisodic(p))return null;
  const episodes=projectEpisodes(p),id=currentEpisodeId(p),episode=episodes.find(e=>e.id===id),ready=w.capabilities?.episodes===true;
  return <section className="episode-controls" aria-label="分集管理"><div><Field label="当前集"><select aria-label="当前集" value={id} disabled={!ready} onChange={e=>go(p.id,tab,undefined,e.target.value)}>{episodes.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</select></Field><Button small disabled={!ready} onClick={()=>setEditing({})}>新增集</Button><Button small disabled={!ready} onClick={()=>setEditing(episode)}>编辑集</Button></div>{episode?.summary&&<p>{episode.summary}</p>}{!ready&&<p className="error" role="status">{EPISODES_RELOAD}</p>}{editing&&<FormModal title={editing.id?'编辑集':'新增集'} fields={[{name:'title',label:'集标题',required:true,autoFocus:true},{name:'summary',label:'本集梗概',rows:3}]} initial={editing} onClose={()=>setEditing(null)} onSave={async values=>{await w.flush();const data=await w.mutate(editing.id?{type:'episode.update',projectId:p.id,episodeId:editing.id,patch:values}:{type:'episode.add',projectId:p.id,episode:values});if(!editing.id)setDestination({episodeId:data.result.episodeId,sourceEpisode:id});w.toast('分集已保存');}}/>}</section>;
}
