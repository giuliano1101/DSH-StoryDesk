// Shared vocabulary only; diagnosis and write authority stay on the server.
export const DOCTOR_MODES={general:'综合会诊',rhythm:'平台节奏',dialogue:'对白诊断',continuity:'故事一致性',motivation:'人物动机',foreshadow:'伏笔回收',suspense:'悬念信息释放'};
export const CRAFT_MODES=['motivation','foreshadow','suspense'];
export const usesCrossScene=mode=>mode==='continuity'||CRAFT_MODES.includes(mode);
export const DOCTOR_CERTAINTY={conflict:'存在对照冲突',supported:'有原文依据的创作问题',suggestion:'可选创作建议，由作者决定', 'needs-context':'信息不足，待确认'};
export const CRAFT_NOTICES={
 motivation:'对照人物设定、全作品大纲和可覆盖的前后文，检查目标、选择、代价与成长依据；隐瞒动机或缺少材料先列为待确认，不擅自补造心理。',
 foreshadow:'区分已回收、计划后续回收与尚待确认。尚未写到的结局和有意留白不会仅因未回收而判错；报告会注明实际覆盖范围。',
 suspense:'检查读者与角色的知情差、线索公平性和揭晓顺序；保留作者选择的悬念强度，不强求每场、每章都有反转。',
};
