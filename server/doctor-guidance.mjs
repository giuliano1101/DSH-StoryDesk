// Curated adaptations, not the complete skill bundle. Exact originals and hashes:
// docs/skill-handoff/ADOPTION.md and
// docs/skill-handoff/2026-11-13-script-writing-studio/manifest.json.
const base='docs/skill-handoff/2026-11-13-script-writing-studio/script-writing-studio/references/';
export const DOCTOR_GUIDANCE_VERSION='script-writing-studio-adapted-2026-11-14-v7';
const general='从结构编辑（因果与铺垫回收）、角色视角（动机与言行）、读者或观众（理解与期待）等不同立场诊断。单场采用三个对口视角，较大范围按材料选择。各自指出有证据的真实弱点或未来风险，说明影响、优先级、可执行修改方向；不虚构履历、不评分、不保证市场效果。保留立场差异；如果确实一致，诚实说明召集偏差风险，不捏造争论。材料不足必须缩小结论并列明最小补充材料，不能把单场推断冒充全剧结论。';
const rhythm='检查开场的注意力理由、冲突或谜题、信息/情绪/关系的持续增量、结尾继续阅读或观看的理由。慢不是问题，无功能的慢才是问题：辨认沉默、停顿、环境描写承担的情绪、悬念、关系、信息或蓄力功能。用选定节奏档位审视可压缩段与应保留的呼吸。平台是作者目标，不是已经核验的平台规范；禁止编造平台时限或算法规律。没有可靠逐段时间轴时，具体秒数及时间点是否达标一律未知；目标总时长也不能证明开场在第几秒，不得将字数直接等同实拍秒数。只按文本顺序评估。';
const dialogue='仅诊断现有对白，不重写台词、不改剧情结构。以角色辨识度、潜台词、冲突推进、类型与年代语感、信息效率、长短句与停顿的可朗读性、金句是否属于角色这七维扫描；优先身份与推进，不强塞金句。引用原句，说明具体命中维度和为什么需要修改，再给修改指令。强情绪检查语气、呼吸、微动作和过度表演边界。缺少角色身份/年代依据时说明未知，无对白则说明无法判断，不能伪造对白。自然语速风险用条件性判断，没有时间轴不虚构秒数。';
const craft={
 motivation:'本次专项检查人物动机：沿“目标→阻力→选择→代价→后果/成长”核对关键行动；区分角色口头声称、实际行为和叙述者判断。检查动机是否有文本支撑、重大转变是否有触发与过渡、角色是否只为推动剧情而行动。隐瞒动机、不可靠叙述、矛盾欲望、非理性决定和主动背叛均可能是创作选择，不能要求人物永远理性或忠于初始性格。缺少动机依据时优先 needs-context，并列出需要作者确认的最小信息；不推测诊断角色心理疾病，不替作者补造经历。',
 foreshadow:'本次专项检查伏笔回收：追踪文本明确建立的谜题、承诺、异常细节和关键物件，区分“已回收、计划后续回收、尚待确认”，在 impact 中写明线索来源、当前状态和实际覆盖范围。对已有回收检查其与铺垫的联系和是否有足够依据；对疑似遗漏先核对全作品大纲和提供的前后文。大纲计划不是已发生事实；结局尚未写到、作者计划后续回收、开放结局或局部正文未覆盖后文，都不能直接判成遗忘或未兑现。不是所有细节都必须成为伏笔，不建立虚构的完整伏笔清单。只有已有明确兑现节点/完结依据且文本确有问题才提出 supported；缺少结局或回收节点依据时用 needs-context，不能把未找到当成不存在。',
 suspense:'本次专项检查悬念信息释放：分别追踪读者或观众与角色的知情状态、信息来源及获取顺序，核对谜题建立、线索公平性、过早泄底、揭晓铺垫、重复解释、假悬念与揭晓后的后果。区分好奇、悬念、戏剧反讽和突袭；读者比人物知道得多不等于泄密。区分有意隐瞒与违反既定叙述视角的信息遮蔽，不把梦境、倒叙、误导或不可靠叙述自动判错。结合类型和作者目标，不强求每章每场都有悬念、反转或悬崖结尾；缺少读者/角色知情依据或后续揭晓时使用 needs-context，不替作者决定谜底。',
};
export function doctorGuidance(mode,{platform='',novel=false,shortDrama=false}={}){
 const sources=mode==='dialogue'?['03-dialogue-expert.md']:['02-script-doctor.md','02-startup-workflow.md','02-rules-granularity-output.md','02-boundary-interface.md','02-panels-examples.md'];
 let instruction=mode==='dialogue'?dialogue:general;
 if(craft[mode])instruction+=craft[mode]+'创作质量带有审美判断，必须区分 supported（有原文依据的创作问题，不等于客观逻辑错误）、suggestion（可选创作建议）和 needs-context（信息不足，待确认）；每个问题必须返回 certainty。supported 和 suggestion 必须有精确目标正文 evidence；涉及前文、设定或大纲的判断同时给逐字 basis 引用。只有满足双方证据要求的客观矛盾才可用 conflict。无正文锚点的整体问题只能作为 needs-context，不能进入自动修改。每条说明原文、判断理由、影响和可执行修改方向，不生成替换正文；没有有依据的问题可以返回空 issues。'+(novel?'小说重点看叙述视角、内心与行为的关系、章节承诺与信息揭晓，允许适当的内心描写和慢节奏。':'剧本重点看画面、声音、对白和可表演行动如何让观众理解动机与线索；电视剧和短剧结合分集大纲辨认集内兑现与跨集悬念，不强加固定秒数。');
 if(mode==='continuity')instruction+='本次专门进行故事一致性检查：逐项对照故事档案的世界规则、人物能力与知情状态、全作品大纲、以及实际提供的跨章正文。每个问题必须标明 certainty（conflict 或 needs-context）并给对照引用。明确区分“双方文字相矛盾”和“缺少过渡解释/信息尚未提供”，不把未来大纲当成当前已发生事实。不得因为没有检出就保证全书自洽。';
 if(mode==='rhythm'||platform||shortDrama){instruction+=rhythm;sources.push('01b-rhythm-matrix.md');}
 if(novel)instruction+='本项目为小说：这是从剧本医生证据方法派生的小说适配，不是原技能提供的小说模块。使用章节、读者、叙述视角、叙述距离、内心与感官描写等自然术语；不套用剧本场景头，不把内心活动判为不能拍摄，也不强加短视频时限。对白七维只用于实际人物对白。';
 return {instruction,provenance:{version:DOCTOR_GUIDANCE_VERSION,sources:sources.map(path=>base+path)}};
}
