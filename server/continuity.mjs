import {createHash} from 'node:crypto';
import {isEpisodic,projectEpisodes,episodeScenes} from '../shared/episodes.mjs';

const TEXT_BUDGET=24000,MAX_PASSAGES=24;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const passageId=(id,start,end)=>`passage:${encodeURIComponent(id)}:${start}:${end}`;
const ordered=p=>isEpisodic(p)?projectEpisodes(p).flatMap(e=>episodeScenes(p,e.id)):p.scenes.filter(s=>!s.archived);
function alignedRange(body,start,end,maximum){
 if(start>0&&/[\uDC00-\uDFFF]/.test(body[start]))start--;
 end=Math.min(end,start+maximum);
 if(end<body.length&&/[\uDC00-\uDFFF]/.test(body[end]))end--;
 return {start,end};
}
export function captureContinuity(project,targets){
 const scenes=ordered(project),targetIds=new Set(targets.map(s=>s.id)),targetPositions=scenes.flatMap((s,i)=>targetIds.has(s.id)?[i]:[]);
 const cast=new Set(targets.flatMap(s=>s.cast||[])),targetText=targets.map(s=>s.body).join('\n');
 const names=(project.characters||[]).filter(c=>c.status==='adopted'&&(cast.has(c.id)||targetText.includes(c.name))).map(c=>c.name).filter(Boolean);
 const candidates=scenes.map((s,index)=>({s,index})).filter(({s})=>!targetIds.has(s.id)&&s.body.trim());
 const allFit=candidates.length<=MAX_PASSAGES&&candidates.reduce((n,{s})=>n+s.body.length,0)<=TEXT_BUDGET;
 const score=({s,index})=>(s.cast||[]).filter(id=>cast.has(id)).length*100+names.filter(name=>s.body.includes(name)).length*20+1/(1+Math.min(...targetPositions.map(i=>Math.abs(i-index)),scenes.length));
 candidates.sort((a,b)=>score(b)-score(a)||a.index-b.index);
 const passages=[];let remaining=TEXT_BUDGET;
 for(const {s} of candidates){
  if(remaining<=0||passages.length>=MAX_PASSAGES)break;
  let ranges;
  if((allFit||s.body.length<=4000)&&s.body.length<=remaining)ranges=[{start:0,end:s.body.length}];
  else{
   const size=Math.min(1000,remaining);ranges=[{start:0,end:Math.min(size,s.body.length)},{start:Math.max(0,s.body.length-size),end:s.body.length}];
   const at=names.map(name=>s.body.indexOf(name)).find(index=>index>=1000&&index<s.body.length-1000);
   if(at!==undefined)ranges.push({start:Math.max(0,at-400),end:Math.min(s.body.length,at+600)});
  }
  const taken=[];
  for(const range of ranges){
   if(remaining<=0||passages.length>=MAX_PASSAGES)break;
   const {start,end}=alignedRange(s.body,range.start,range.end,remaining);
   if(end<=start||taken.some(r=>r.start<end&&start<r.end))continue;
   taken.push({start,end});const text=s.body.slice(start,end);remaining-=text.length;
   passages.push({id:passageId(s.id,start,end),sceneId:s.id,title:s.title,start,end,text,revision:s.revision});
  }
 }
 const covered=new Set(passages.map(p=>p.sceneId)),complete=new Set(passages.filter(p=>p.start===0&&p.end===scenes.find(s=>s.id===p.sceneId).body.length).map(p=>p.sceneId));
 return {schemaVersion:1,sourceFingerprint:hash(scenes.map(s=>({id:s.id,title:s.title,body:s.body,revision:s.revision,cast:s.cast||[]}))),passages,coverage:{totalScenes:candidates.length,coveredScenes:covered.size,completeScenes:complete.size,excerptScenes:covered.size-complete.size,omittedScenes:candidates.length-covered.size}};
}
export function validateContinuity(value,ownedSceneIds){
 const bad=()=>{throw new Error('跨章节对照档案格式或来源不正确');};
 const keys=(x,allowed)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!allowed.includes(k)))bad();};
 keys(value,['schemaVersion','sourceFingerprint','passages','coverage']);
 if(value.schemaVersion!==1||!(/^[a-f0-9]{64}$/).test(value.sourceFingerprint)||!Array.isArray(value.passages)||value.passages.length>MAX_PASSAGES)bad();
 const ids=new Set(),covered=new Set();let size=0;
 for(const p of value.passages){
  keys(p,['id','sceneId','title','start','end','text','revision']);
  if(!ownedSceneIds.has(p.sceneId)||typeof p.title!=='string'||p.title.length>1000||typeof p.text!=='string'||!p.text.length||!Number.isSafeInteger(p.start)||p.start<0||!Number.isSafeInteger(p.end)||p.end-p.start!==p.text.length||!Number.isSafeInteger(p.revision)||p.revision<0||p.id!==passageId(p.sceneId,p.start,p.end)||ids.has(p.id))bad();
  ids.add(p.id);covered.add(p.sceneId);size+=p.text.length;
 }
 if(size>TEXT_BUDGET)bad();
 const c=value.coverage;keys(c,['totalScenes','coveredScenes','completeScenes','excerptScenes','omittedScenes']);
 if(Object.keys(c).length!==5||Object.values(c).some(n=>!Number.isSafeInteger(n)||n<0)||c.coveredScenes!==covered.size||c.completeScenes+c.excerptScenes!==c.coveredScenes||c.coveredScenes+c.omittedScenes!==c.totalScenes)bad();
 return structuredClone(value);
}
