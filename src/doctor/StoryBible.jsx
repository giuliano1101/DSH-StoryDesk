import React from 'react';
import {Button} from '../components';

const MISSING={title:'作品名称',logline:'故事前提',synopsis:'故事梗概',theme:'主题',constraints:'创作约束',characters:'已采用人物',worldMaterials:'已采用世界设定',outlineScenes:'章节 / 分场大纲',outlineDetails:'部分大纲只有标题，尚无情节概要'};
export function StoryBible({bible,historical=false,onError}){
 if(!bible)return null;
 const download=()=>{
  let url,anchor;
  try{url=URL.createObjectURL(new Blob([bible.markdown],{type:'text/markdown;charset=utf-8'}));anchor=document.createElement('a');anchor.href=url;anchor.download=bible.filename;anchor.hidden=true;document.body.appendChild(anchor);anchor.click();}
  catch(error){onError?.('故事档案下载未完成，请重试。');}
  finally{anchor?.remove();if(url)setTimeout(()=>URL.revokeObjectURL(url),1000);}
 };
 return <details className="doctor-bible"><summary><strong>{historical?'本次诊断的故事档案':'已关联故事档案'}</strong><span>版本 {bible.fingerprint.slice(0,10)}</span></summary>
  <p>{historical?'保留诊断当时的资料快照，便于追溯判断依据。':'自动读取全作品已保存的大纲、人物与已采用资料。修改原始资料后自动更新；不另建一份需要手动同步的设定。'}</p>
  <p className="doctor-meta">大纲 {bible.coverage.outlineScenes} 场 / 章 · 人物 {bible.coverage.characters} 位 · 世界设定 {bible.coverage.worldMaterials} 条</p>
  {!!bible.coverage.missing?.length&&<p className="doctor-notice">待补充：{bible.coverage.missing.map(code=>MISSING[code]||code).join('；')}。缺失信息保持未知。</p>}
  <p>世界与人物设定、参考资料、大纲计划分别标明来源；计划不等于已经发生的事实。不要在下载副本中修改后期待自动回写，请到作品设定或资料页面修改来源。</p>
  <Button small onClick={download}>下载 Markdown</Button><pre>{bible.markdown}</pre>
 </details>;
}
