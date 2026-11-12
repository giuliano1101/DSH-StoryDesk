import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore,createApi} from '../server/index.mjs';
import {DomainError} from '../server/domain.mjs';

const safeText=value=>typeof value==='string'?value.slice(0,300):'';
const safeSelection=value=>value&&safeText(value.provider)&&safeText(value.model)?{provider:safeText(value.provider),model:safeText(value.model)}:null;
export function hostModel(ctx){
  const selection=()=>safeSelection(ctx.get('agentDefaultModel')?.currentSelection?.());
  const sessionId=`screenwriter-desk-${randomUUID()}`;
  const catalog=async()=>{
    const llm=ctx.get('llm');
    if(!llm)return {providers:[],default:selection(),partial:false};
    let providers;
    try{providers=await llm.listProviders();if(!Array.isArray(providers))throw new Error();}
    catch{return {providers:[],default:selection(),partial:false,error:'暂时无法读取 Harness 模型，请刷新重试'};}
    const results=await Promise.allSettled(providers.filter(p=>safeText(p?.id)).map(async p=>{
      const models=await llm.listModels(p.id);
      if(!Array.isArray(models))throw new Error();
      return {id:safeText(p.id),name:safeText(p.name)||safeText(p.id),models:models.filter(m=>safeText(m?.id)).map(m=>({id:safeText(m.id),name:safeText(m.name)||safeText(m.id)}))};
    }));
    return {providers:results.filter(r=>r.status==='fulfilled'&&r.value.models.length).map(r=>r.value),default:selection(),partial:results.some(r=>r.status==='rejected')};
  };
  const resolveSelection=async requested=>{
    // Capture host default before discovery yields; later changes cannot reroute this request.
    const selected=safeSelection(requested===null||requested===undefined?selection():requested);
    const live=await catalog();
    if(!selected)throw new DomainError('Harness 尚未选择模型，请选择已连接的模型',503,'AI_NOT_CONFIGURED');
    const provider=live.providers.find(p=>p.id===selected.provider),model=provider?.models.find(m=>m.id===selected.model);
    if(!model)throw new DomainError(live.error||'所选模型当前不可用，请刷新并重新选择',503,'MODEL_UNAVAILABLE');
    return {...selected};
  };
  const model=async({system,user,signal,modelSelection})=>{
    const selected=await resolveSelection(modelSelection),llm=ctx.get('llm');
    if(!llm)throw new DomainError('Harness 模型当前不可用',503,'MODEL_UNAVAILABLE');
    const call=await llm.prepareCall({provider:selected.provider,model:selected.model,maxTokens:6000},signal);
    let text='';
    for await(const chunk of call.stream({...call.config,system,messages:[{role:'user',content:[{type:'text',text:user}],source:{kind:'dsh-screenwriter-desk'}}],sessionId,signal})){
      if(chunk.type==='text-delta')text+=chunk.text;
      if(chunk.type==='finish'&&['error','aborted'].includes(chunk.reason?.kind))throw new Error('MODEL_REQUEST_FAILED');
    }
    return {text,model:selected.model};
  };
  model.defaultSelection=selection;
  model.catalog=catalog;
  model.resolveSelection=resolveSelection;
  model.status=async(requested=null)=>{
    const live=await catalog(),selected=safeSelection(requested??live.default),provider=live.providers.find(p=>p.id===selected?.provider),chosen=provider?.models.find(m=>m.id===selected?.model);
    return {connected:Boolean(chosen),label:chosen?`${provider.name} · ${chosen.name}`:live.error||'所选模型当前不可用'};
  };
  return model;
}
export const name='dsh-screenwriter-desk';
export default {inject:['webServer','connection'],apply(ctx){
  const ready=createStore({directory:join(process.env.DSH_HOME||join(homedir(),'.dsh'),'screenwriter-desk')}).then(store=>({store}),()=>({unavailable:true}));
  const modelAdapter=hostModel(ctx);
  // API reservations and generated-report authority belong to this initialized
  // plugin/store session, not to an individual HTTP request.
  let api;
  ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/screenwriter-desk',handler:async(req,res)=>{
    const connection=ctx.get('connection');
    const rejection=typeof connection?.requestRejection==='function'?connection.requestRejection({headers:req.headers}):403;
    if(rejection){res.writeHead(rejection,{'content-type':'application/json'});res.end(JSON.stringify({error:'请从已登录的工作台访问'}));return;}
    try{
      const initialized=await ready;
      if(!initialized.store)throw new Error('STORE_UNAVAILABLE');
      api??=createApi({store:initialized.store,modelAdapter});
      const original=req.url;
      req.url=req.url.replace(/^\/screenwriter-desk(?=\/|$)/,'');
      try{if(!await api(req,res)){res.writeHead(404);res.end();}}finally{req.url=original;}
    }catch{if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'编剧工作台暂时无法连接'}));}
  }}),'screenwriter-desk: authenticated API');
  return ready.then(()=>undefined);
}};
