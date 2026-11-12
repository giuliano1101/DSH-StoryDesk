// Curated adaptations, not the complete skill bundle. Exact originals and hashes:
// docs/skill-handoff/ADOPTION.md and
// docs/skill-handoff/2026-11-13-script-writing-studio/manifest.json.
const base='docs/skill-handoff/2026-11-13-script-writing-studio/script-writing-studio/references/';
export const DOCTOR_GUIDANCE_VERSION='script-writing-studio-adapted-2026-11-13-v1';
const general='从结构编辑（因果与铺垫回收）、角色视角（动机与言行）、读者或观众（理解与期待）等不同立场诊断。单场采用三个对口视角，较大范围按材料选择。各自指出有证据的真实弱点或未来风险，说明影响、优先级、可执行修改方向；不虚构履历、不评分、不保证市场效果。保留立场差异；如果确实一致，诚实说明召集偏差风险，不捏造争论。材料不足必须缩小结论并列明最小补充材料，不能把单场推断冒充全剧结论。';
const rhythm='检查开场的注意力理由、冲突或谜题、信息/情绪/关系的持续增量、结尾继续阅读或观看的理由。慢不是问题，无功能的慢才是问题：辨认沉默、停顿、环境描写承担的情绪、悬念、关系、信息或蓄力功能。用选定节奏档位审视可压缩段与应保留的呼吸。平台是作者目标，不是已经核验的平台规范；禁止编造平台时限或算法规律。没有可靠逐段时间轴时，具体秒数及时间点是否达标一律未知；目标总时长也不能证明开场在第几秒，不得将字数直接等同实拍秒数。只按文本顺序评估。';
const dialogue='仅诊断现有对白，不重写台词、不改剧情结构。以角色辨识度、潜台词、冲突推进、类型与年代语感、信息效率、长短句与停顿的可朗读性、金句是否属于角色这七维扫描；优先身份与推进，不强塞金句。引用原句，说明具体命中维度和为什么需要修改，再给修改指令。强情绪检查语气、呼吸、微动作和过度表演边界。缺少角色身份/年代依据时说明未知，无对白则说明无法判断，不能伪造对白。自然语速风险用条件性判断，没有时间轴不虚构秒数。';
export function doctorGuidance(mode,{platform='',novel=false,shortDrama=false}={}){
 const sources=mode==='dialogue'?['03-dialogue-expert.md']:['02-script-doctor.md','02-startup-workflow.md','02-rules-granularity-output.md','02-boundary-interface.md','02-panels-examples.md'];
 let instruction=mode==='dialogue'?dialogue:general;
 if(mode==='rhythm'||platform||shortDrama){instruction+=rhythm;sources.push('01b-rhythm-matrix.md');}
 if(novel)instruction+='本项目为小说：这是从剧本医生证据方法派生的小说适配，不是原技能提供的小说模块。使用章节、读者、叙述视角、叙述距离、内心与感官描写等自然术语；不套用剧本场景头，不把内心活动判为不能拍摄，也不强加短视频时限。对白七维只用于实际人物对白。';
 return {instruction,provenance:{version:DOCTOR_GUIDANCE_VERSION,sources:sources.map(path=>base+path)}};
}
