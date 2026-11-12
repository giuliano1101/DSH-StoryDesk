export const BACKEND_RELOAD='完整退出并重新打开 Harness 后加载新版助手';
export function assistantError(error){return error.status===404||error.code==='NOT_FOUND'?BACKEND_RELOAD:error.message;}
export function assistantReadiness({assistant,loadError,catalog,loading,modelError}){
  if(loadError)return {ready:false,label:loadError};
  if(!assistant)return {ready:false,label:'正在加载助手…'};
  if(loading)return {ready:false,label:'正在读取可用模型…'};
  if(modelError)return {ready:false,label:modelError};
  return {ready:Boolean(catalog?.connected),label:catalog?.label||'尚未连接模型'};
}
