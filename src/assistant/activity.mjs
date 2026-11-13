// Phases are advanced by request continuations, never by an animation timer.
export function activityPresentation(pending,now=Date.now()){
  if(!pending)return null;
  const start=typeof pending.startedAt==='number'?pending.startedAt:Date.parse(pending.startedAt);
  const seconds=Number.isFinite(start)?Math.max(0,Math.floor((now-start)/1000)):0;
  const writing=pending.phase==='writing',preparing=pending.phase==='preparing',diagnosing=pending.phase==='diagnosing';
  const longWait=seconds>=30;
  const title=preparing?'准备请求':writing?'正在写入':diagnosing?'正在会诊':pending.mode==='execute'?'正在整理操作':pending.mode==='rewrite'?'正在生成修改':'正在思考';
  const detail=preparing?(longWait?'保存当前内容用时较久，完成前不会发送模型请求。':'已收到你的指令，正在保存当前内容。'):writing?'正在核验并保存修改，完成后会显示实际结果。':longWait?(diagnosing?'本次会诊等待较久，仍在等待模型回复；原文保持不变。':'本次等待较久，仍在等待模型回复。可收起助手继续创作。'):diagnosing?'正在分析所选材料，诊断不会修改原文。':'正在等待模型回复，可收起助手继续创作。';
  if(pending.phase==='handoff')return {title:'正在保存意见',detail:'正在加入助手意见，原文保持不变。',longWait,elapsed:`已等待 ${seconds}秒`};
  return {title,detail,longWait,elapsed:`已等待 ${seconds<60?seconds+'秒':Math.floor(seconds/60)+'分'+String(seconds%60).padStart(2,'0')+'秒'}`};
}
