import React,{useState} from 'react';
import {BookOpen,PenNib,ArrowRight} from '@phosphor-icons/react';
import {creationCopy,projectFormat} from './creationUI.mjs';
import {recentPosition} from './api';
export function CreationEntry({state,w,onChoose,onResume}){
  const [busy,setBusy]=useState(false);
  const run=async work=>{if(busy)return;setBusy(true);try{await work();}catch(error){w.toast(error.message);}finally{setBusy(false);}};
  const recent=[...state.projects].filter(p=>p.status!=='archived'&&!p.trashedAt).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')).slice(0,6);
  return <main className="creation-entry"><div className="entry-intro"><span className="eyebrow">YOUR WRITING DESK</span><h1>让故事，在这里生长</h1><p>选择一种创作方式，或继续上次留下的文字。</p></div><div className="creation-choices">{[['novel',BookOpen,'小说创作','从人物内心到完整世界，让每一章都有回响。','作品设定 · 人物与世界观 · 章节大纲 · 正文'],['screenplay',PenNib,'剧本创作','从故事构思到银幕表达，让每一场都有推进。','项目简报 · 资料与人物 · 分场 · 正文']].map(([format,Icon,title,description,steps])=><button className="creation-choice" key={format} disabled={busy} onClick={()=>run(()=>onChoose(format))}><Icon size={30} weight="thin"/><h2>{title}</h2><p>{description}</p><small>{steps}</small><span>进入{creationCopy(format).workspaceTitle}<ArrowRight size={18}/></span></button>)}</div><section className="entry-recent"><div className="section-heading"><h2>最近的作品</h2><small>内容保存在本机</small></div>{recent.length?<div className="entry-recent-list">{recent.map(project=><button disabled={busy} key={project.id} onClick={()=>run(()=>onResume(project.id))}><span className="entry-project-icon">{projectFormat(project)==='novel'?<BookOpen size={22}/>:<PenNib size={22}/>}</span><span><strong>{project.title}</strong><small>{creationCopy(projectFormat(project)).projectNoun} · {recentPosition(project)}</small></span><ArrowRight size={18}/></button>)}</div>:<p className="quiet-empty">从一部新作品开始，慢慢写出你的故事。</p>}</section></main>;
}
