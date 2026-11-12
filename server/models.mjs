import {DomainError,object} from './domain.mjs';
import {aiStatus} from './ai.mjs';
export function validateModelSelection(value){
  if(value===null)return null;
  object(value,'模型选择');
  if(Object.keys(value).some(k=>!['provider','model'].includes(k))||!['provider','model'].every(k=>typeof value[k]==='string'&&value[k].trim()&&value[k].length<=300))throw new DomainError('模型选择格式不正确',400,'INVALID_MODEL_SELECTION');
  return {provider:value.provider,model:value.model};
}
export async function modelCatalog(store,adapter){
  if(!adapter?.catalog)return {mode:adapter?'adapter':'standalone',providers:[],selection:null,default:null,effective:null,...await aiStatus(store,adapter)};
  const selection=validateModelSelection((await store.readSettings()).modelSelection??null),live=await adapter.catalog(),effective=selection??live.default;
  const provider=live.providers.find(p=>p.id===effective?.provider),model=provider?.models.find(m=>m.id===effective?.model),connected=Boolean(model);
  return {mode:'host',...live,selection,effective,connected,label:model?`${provider.name} · ${model.name}`:live.error||(selection?'所选模型当前不可用，请重新选择':'Harness 尚未连接可用模型'),...(!connected?{code:effective?'MODEL_UNAVAILABLE':'AI_NOT_CONFIGURED'}:{})};
}
export async function saveModelSelection(store,adapter,input){
  object(input,'模型设置');
  if(Object.keys(input).some(k=>k!=='selection')||!Object.hasOwn(input,'selection'))throw new DomainError('模型设置格式不正确',400,'INVALID_MODEL_SELECTION');
  if(!adapter?.catalog||!adapter?.resolveSelection)throw new DomainError('当前运行方式请使用模型连接设置',400,'MODEL_SELECTION_UNSUPPORTED');
  const selection=validateModelSelection(input.selection);
  if(selection)await adapter.resolveSelection(selection);
  await store.updateSettings(previous=>({...previous,modelSelection:selection}));
  return modelCatalog(store,adapter);
}
export async function captureModelSelection(store,adapter,body){
  object(body,'AI 请求');
  if(!adapter?.resolveSelection)return undefined;
  // Freeze the host default before the private settings read can yield. A saved override still wins.
  const hasDefaultSnapshot=typeof adapter.defaultSelection==='function';
  const defaultSnapshot=hasDefaultSnapshot?validateModelSelection(adapter.defaultSelection()):undefined;
  const choice=Object.hasOwn(body,'modelSelection')?validateModelSelection(body.modelSelection):validateModelSelection((await store.readSettings()).modelSelection??null);
  if(choice===null&&hasDefaultSnapshot){
    if(!defaultSnapshot)throw new DomainError('Harness 尚未选择模型，请选择已连接的模型',503,'AI_NOT_CONFIGURED');
    return adapter.resolveSelection(defaultSnapshot);
  }
  return adapter.resolveSelection(choice);
}
