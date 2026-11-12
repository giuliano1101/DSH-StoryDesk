import {modelCatalog,saveModelSelection,captureModelSelection} from './models.mjs';
import { DomainError, appendSuggestion, prepareSuggestion } from './domain.mjs';
import { aiStatus, buildPrompts, callModel, readPublicSettings, saveSettings } from './ai.mjs';
import { exportDocument } from './exports.mjs';
import { BODY_LIMIT, PROJECT_IMPORT_LIMIT } from './limits.mjs';
import { appendAssistantTurn, applyAssistantTurn, buildAssistantPrompts, configureAssistant, getAssistant, importAssistantSkill, prepareAssistantRequest, writeAssistantReply } from './assistant.mjs';
import { appendRevisionBatch, applyRevisions, buildRevisionPrompts, prepareRevisions, reviseNote, revisionCapabilities } from './revisions.mjs';
import {prepareDoctor,buildDoctorPrompts,appendDoctorReport,authorizeDoctor,doctorReports,handoffDoctorIssue} from './doctor.mjs';

function sendJson(res, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(bytes);
}
function readBody(req, { allowProjectImport = false } = {}) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new DomainError('请求须使用 JSON 格式', 415, 'UNSUPPORTED_MEDIA_TYPE');
  const transportLimit = allowProjectImport ? PROJECT_IMPORT_LIMIT : BODY_LIMIT;
  const tooLarge = () => new DomainError(allowProjectImport ? '项目导入请求上限为 64 MiB；请选择较小的版本备份，或保留本机 state.json 完整数据文件。其他操作上限为 2 MiB。' : '提交内容超过 2 MiB，请拆分后重试', 413, 'BODY_TOO_LARGE');
  const declared = Number(req.headers['content-length']);
  if (declared > transportLimit) { req.resume(); throw tooLarge(); }
  return new Promise((resolve, reject) => {
    let received = 0;
    let failed = false;
    const parts = [];
    req.on('data', part => {
      if (failed) return;
      received += part.length;
      if (received > transportLimit) { failed = true; parts.length = 0; reject(tooLarge()); }
      else parts.push(part);
    });
    req.once('end', () => {
      if (failed) return;
      let body;
      try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); }
      catch { reject(new DomainError('JSON 格式不正确', 400, 'INVALID_JSON')); return; }
      if (received > BODY_LIMIT && body?.action?.type !== 'project.import') {
        reject(new DomainError('此操作超过 2 MiB；只有项目 JSON 备份导入可使用 64 MiB 上限', 413, 'BODY_TOO_LARGE'));
        return;
      }
      resolve(body);
    });
    req.once('error', () => reject(new DomainError('请求未完整接收', 400, 'INVALID_BODY')));
    req.once('aborted', () => reject(new DomainError('请求已取消', 400, 'REQUEST_ABORTED')));
  });
}
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new DomainError('请从工作台页面提交请求', 403, 'ORIGIN_REJECTED');
  if (!req.headers.origin) return;
  let origin;
  try { origin = new URL(req.headers.origin); } catch { throw new DomainError('请求来源不正确', 403, 'ORIGIN_REJECTED'); }
  if (origin.host !== req.headers.host) throw new DomainError('请从工作台页面提交请求', 403, 'ORIGIN_REJECTED');
}
export function createApi({ store, modelAdapter } = {}) {
  if (!store) throw new Error('createApi requires a store');
  const doctorAuthority=new Map(),doctorBusy=new Set();
  return async function handleApi(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { sendJson(res, 400, { error: '请求网址不正确', code: 'INVALID_URL' }); return true; }
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return false;
    try {
      sameOrigin(req);
      const path = url.pathname;
      const methods = { '/api/state': ['GET'], '/api/actions': ['POST'], '/api/ai': ['POST'], '/api/settings': ['GET', 'POST'], '/api/models': ['GET', 'POST'], '/api/export': ['GET'], '/api/assistant': ['GET', 'POST'], '/api/assistant/config': ['POST'], '/api/assistant/skills': ['POST'], '/api/assistant/apply': ['POST'], '/api/assistant/write': ['POST'], '/api/revisions': ['GET'], '/api/revisions/notes': ['POST'], '/api/revisions/generate': ['POST'], '/api/revisions/apply': ['POST'], '/api/doctor':['GET','POST'], '/api/doctor/handoff':['POST'] };
      if (!methods[path]) throw new DomainError('找不到此接口', 404, 'NOT_FOUND');
      if (!methods[path].includes(req.method)) { res.setHeader('allow', methods[path].join(', ')); throw new DomainError('请求方法不支持', 405, 'METHOD_NOT_ALLOWED'); }
      if (path === '/api/state') sendJson(res, 200, { state: await store.read(), ai: await aiStatus(store, modelAdapter), capabilities: { creationFormats: ['screenplay', 'novel'], episodes: true, projectTrash: true } });
      else if (path === '/api/actions') { const body = await readBody(req, { allowProjectImport: true }); sendJson(res, 200, await store.dispatch(body?.action)); }
      else if (path === '/api/models') sendJson(res, 200, req.method === 'GET' ? await modelCatalog(store,modelAdapter) : await saveModelSelection(store,modelAdapter,await readBody(req)));
      else if (path === '/api/settings') sendJson(res, 200, req.method === 'GET' ? await readPublicSettings(store) : await saveSettings(store, await readBody(req)));
      else if(path==='/api/doctor'&&req.method==='GET')sendJson(res,200,{reports:doctorReports(await store.read(),url.searchParams.get('projectId'),doctorAuthority)});
      else if(path==='/api/doctor/handoff'){
        const body=await readBody(req),result=await store.transaction(state=>handoffDoctorIssue(state,body,doctorAuthority));
        sendJson(res,200,{state:result.state,...result.result});
      }
      else if(path==='/api/doctor'){
        const body=await readBody(req),projectId=body?.projectId;
        if(doctorBusy.has(projectId))throw new DomainError('此作品正在诊断，请等待本次完成。',409,'DOCTOR_BUSY');
        doctorBusy.add(projectId);
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        const timeout=setTimeout(()=>controller.abort(),120000);timeout.unref?.();
        try{
          const modelSelection=await captureModelSelection(store,modelAdapter,body),state=await store.read(),prepared=prepareDoctor(state,body),prompts=buildDoctorPrompts(state,prepared);
          const output=await callModel({store,modelAdapter,system:prompts.system,user:prompts.user,modelSelection,signal:controller.signal});
          if(controller.signal.aborted)throw new DomainError('诊断已取消或超时，原文未改变。',504,'AI_TIMEOUT');
          const result=await store.transaction(current=>appendDoctorReport(current,prepared,output,modelSelection,prompts.guidance));
          authorizeDoctor(doctorAuthority,result.result);
          const report=doctorReports(result.state,projectId,doctorAuthority).find(r=>r.id===result.result.id);
          sendJson(res,200,{state:result.state,report});
        }finally{clearTimeout(timeout);res.off('close',abort);doctorBusy.delete(projectId);}
      }
      else if (path === '/api/revisions') sendJson(res, 200, { capabilities: revisionCapabilities() });
      else if (path === '/api/revisions/notes' || path === '/api/revisions/apply') {
        const body = await readBody(req);
        const applied = path.endsWith('/apply');
        const result = await store.transaction(state => (applied ? applyRevisions : reviseNote)(state, body));
        sendJson(res, 200, { state: result.state, ...(applied ? { result: result.result } : result.result) });
      }
      else if (path === '/api/revisions/generate') {
        const body = await readBody(req);
        // Capture the host choice once, before any later asynchronous context read.
        const modelSelection = await captureModelSelection(store, modelAdapter, body);
        const state = await store.read();
        const prepared = prepareRevisions(state, body);
        const prompts = buildRevisionPrompts(state, prepared);
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', abort);
        const timeout = setTimeout(() => controller.abort(), 120_000);
        timeout.unref?.();
        try {
          const output = await callModel({ store, modelAdapter, ...prompts, modelSelection, signal: controller.signal });
          const result = await store.transaction(current => appendRevisionBatch(current, prepared, output, modelSelection));
          sendJson(res, 200, { state: result.state, batch: result.result });
        } finally { clearTimeout(timeout); res.off('close', abort); }
      }
      else if (path === '/api/assistant' && req.method === 'GET') sendJson(res, 200, { assistant: getAssistant(await store.read()) });
      else if (path === '/api/assistant/config' || path === '/api/assistant/skills' || path === '/api/assistant/apply' || path === '/api/assistant/write') {
        const body = await readBody(req);
        const operation = path.endsWith('/config') ? configureAssistant : path.endsWith('/skills') ? importAssistantSkill : path.endsWith('/write') ? writeAssistantReply : applyAssistantTurn;
        const result = await store.transaction(state => operation(state, body));
        sendJson(res, 200, { state: result.state, assistant: getAssistant(result.state), ...(path.endsWith('/skills') ? { skill: result.result } : path.endsWith('/apply') || path.endsWith('/write') ? result.result : {}) });
      }
      else if (path === '/api/assistant') {
        const body = await readBody(req);
        const modelSelection = await captureModelSelection(store,modelAdapter,body);
        const state = await store.read();
        const prepared = prepareAssistantRequest(state, body);
        const prompts = buildAssistantPrompts(state, prepared);
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', abort);
        const timeout = setTimeout(() => controller.abort(), 120_000);
        timeout.unref?.();
        try {
          const output = await callModel({ store, modelAdapter, ...prompts, modelSelection, signal: controller.signal });
          const result = await store.transaction(current => appendAssistantTurn(current, prepared, output));
          sendJson(res, 200, { state: result.state, assistant: getAssistant(result.state), turn: result.result });
        } finally { clearTimeout(timeout); res.off('close', abort); }
      }
      else if (path === '/api/ai') {
        const body = await readBody(req);
        const modelSelection = await captureModelSelection(store,modelAdapter,body);
        const state = await store.read();
        const suggestion = prepareSuggestion(state, body);
        const prompts = buildPrompts(state, suggestion);
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', abort);
        const timeout = setTimeout(() => controller.abort(), 120_000);
        timeout.unref?.();
        try {
          const output = await callModel({ store, modelAdapter, ...prompts, modelSelection, signal: controller.signal });
          // Re-read and append inside a serialized transaction after model completion.
          const result = await store.transaction(current => appendSuggestion(current, suggestion, output));
          sendJson(res, 200, { state: result.state, suggestion: result.result });
        } finally { clearTimeout(timeout); res.off('close', abort); }
      } else if (path === '/api/export') {
        const output = await exportDocument(await store.read(), { projectId: url.searchParams.get('projectId'), format: url.searchParams.get('format'), versionId: url.searchParams.get('versionId') });
        res.writeHead(200, { 'content-type': output.contentType, 'content-length': output.bytes.length, 'content-disposition': `attachment; filename="screenplay.${url.searchParams.get('format')}"; filename*=UTF-8''${encodeURIComponent(output.filename).replace(/'/g, '%27')}`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(output.bytes);
      }
    } catch (error) {
      if (!res.headersSent && !res.destroyed) sendJson(res, error instanceof DomainError ? error.status : 500, { error: error instanceof DomainError ? error.message : '操作未完成，请重试。数据文件已保留。', code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR' });
    }
    return true;
  };
}
