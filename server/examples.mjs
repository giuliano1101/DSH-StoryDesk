// These projects are editable demonstration data, never real user commissions.
export function exampleProjects({ newProject, newCharacter, newMaterial, newScene, addVersion }) {
  const specs = [
    {
      title: '回声未寄', kind: '悬疑短片', stage: 'revision', deadline: '2026-11-13', pinned: true,
      synopsis: '【示例项目｜日期为演示数据】一封没有邮票的信，把林夏带回早已停用的车站。她与值班员对照各自的记忆，却发现两个人都在保护同一个谎言。',
      brief: { logline: '在一座停用的车站，一个人追问失踪的来信，一个人守着不敢寄出的回答。', length: '22 分钟', audience: '喜欢人物悬疑与细节伏笔的成年观众', theme: '记忆不是证据，承认才是。', constraints: '单一车站场地、三位演员；示例日期并非用户截止日。' },
      characters: [
        { name: '林夏', role: '调查者 · 28 岁', goal: '查明父亲最后一封信来自何处', secret: '她亲眼见过父亲离开，却一直说自己不记得', voice: '问题短而直接，害怕时会重复同一句话', notes: '不轻易触碰他人，但会整理桌上歪掉的物件。' },
        { name: '周屿', role: '车站值班员 · 34 岁', goal: '让林夏在天亮前离开车站', secret: '那封信是他一直没有寄出的道歉', voice: '总先纠正事实里的一个细节，再回答问题' },
        { name: '老陈', role: '退休站长 · 63 岁', goal: '封存停站前最后一本登记册', secret: '他知道信里的日期少了一天', voice: '慢，像在给自己留反悔的时间' },
      ],
      scenes: [
        { title: '旧站台', location: '东岸车站', interior: '外景', time: '雨夜', act: '第一幕', cast: [0], summary: '林夏循着信封上的压痕找到旧车站。', intent: '建立空间与疑问', outcome: '她发现值班室仍然亮着灯。', body: '铁门上挂着“停用”的牌子。\n\n林夏推了推。锁没有扣上。\n她从湿透的外套里取出信封，沿着灯光往前走。' },
        { title: '登记册', location: '候车大厅', interior: '内景', time: '夜', act: '第一幕', cast: [0, 2], summary: '老陈交出一本少了一页的登记册。', intent: '让日期成为线索', outcome: '林夏找到了与信封一致的水印。', body: '老陈把登记册压在玻璃下。\n\n老陈\n最后一天，谁都没来。\n\n林夏看向缺页处。纸边撕得很齐，像被人反复摸过。' },
        { title: '门后的伞', location: '站台走廊', interior: '外景', time: '夜', act: '第二幕', cast: [0, 1], summary: '周屿看见伞之后第一次叫错林夏的名字。', intent: '让人物反应泄露关系', outcome: '林夏意识到他认识父亲。', body: '走廊尽头，一把黑伞靠着门。\n\n周屿伸手挡住林夏。\n\n周屿\n别过去，林——\n\n他把没说完的名字咽了回去。' },
        { title: '值班室', location: '旧车站值班室', interior: '内景', time: '雨夜', act: '第二幕', cast: [0, 1], summary: '林夏把信放在桌上，周屿的目光却停在伞上。', intent: '让对白和动作透露不同的真相', outcome: '信没有打开，隐瞒却已无法继续。', body: '雨声盖过站台广播。林夏把一封没有邮票的信放在桌上。\n\n林夏\n你说你没来过这里。\n\n周屿\n我是说，我不记得了。\n\n周屿没有看信。他看的是门后的那把伞。' },
      ],
      materials: [
        { title: '车站空间与声音', category: '场景研究', body: '示例走访笔记：雨棚边缘落水很响；旧广播会先发出电流声，再传出延迟的站名。值班室的门只能向内推。', source: '内置示例 · 可替换', status: 'adopted' },
        { title: '另一种结尾', category: '备选情节', body: '林夏没有拆信，把它交还给周屿，请他自己寄出。', source: '内置示例', status: 'alternative' },
      ], task: '修改第04场对白', view: 'script', selectedScene: 3,
    },
    {
      title: '雨停之前', kind: '剧情短片', stage: 'outline', deadline: '2026-11-16', pinned: true,
      synopsis: '【示例项目｜日期为演示数据】末班车停运的雨夜，一对即将离婚的夫妻在小城车站共用一把漏雨的伞。等雨停的二十分钟里，两人必须决定谁去接被遗忘在学校的女儿。',
      brief: { logline: '一场等不到的雨停，让两个准备告别的人重新学会开口。', length: '18 分钟', audience: '关注家庭关系的成年观众', theme: '关系里的沉默与照顾', constraints: '两位主要演员，雨夜外景。日期是示例，非用户截止日。' },
      characters: [
        { name: '陈岚', role: '女主角 · 37 岁', goal: '赶上去省城的末班车', secret: '车票其实是明天的', voice: '短句，避开主语', notes: '把伞永远朝对方多偏一点。' },
        { name: '周川', role: '男主角 · 39 岁', goal: '把女儿接回家', secret: '早就接到了女儿的电话，却不敢打破安静', voice: '习惯用实际问题代替感受' },
      ],
      scenes: [
        { title: '候车亭', location: '县城客运站', interior: '外景', time: '夜', act: '第一幕', cast: [0, 1], summary: '车站熄灯，两人都没有先走。', intent: '让观众看见关系里的距离', outcome: '陈岚发现周川一直没撑开自己的伞。', body: '雨拍在候车亭的塑料顶棚上。最后一辆大巴收起灯牌。\n\n陈岚的行李箱卡在砖缝里。周川蹲下，替她把轮子提出来。\n\n陈岚\n你回去吧。\n\n周川把伞朝她那边挪了一点。\n\n周川\n再等一会儿。' },
        { title: '没接通的电话', location: '候车亭', interior: '外景', time: '夜', act: '第二幕', cast: [0, 1], summary: '女儿的来电让沉默终于有了裂口。', intent: '把争执落在一个具体选择上', outcome: '两人第一次说出各自的委屈。', body: '' },
        { title: '共用一把伞', location: '站前街', interior: '外景', time: '夜', act: '第三幕', cast: [0, 1], summary: '他们一起走向学校，决定留到明天再谈。', intent: '用行动完成关系的微小变化', outcome: '没有解决婚姻，但重新站在了同一边。', body: '' },
      ],
      materials: [{ title: '人物行动线', category: '创作笔记', body: '示例：让照顾出现在小动作里。伞、行李和未接来电，分别承担关系的三个转折。', source: '内置示例', status: 'adopted' }], task: '补齐第二幕转折', view: 'scenes', selectedScene: 1,
    },
    {
      title: '北纬三十度', kind: '迷你剧', stage: 'characters', deadline: '2026-11-20', pinned: true,
      synopsis: '【示例项目｜日期为演示数据】返乡地质摄影师陈默，沿着父亲的旧考察路线穿过三座山城。每一个接受他拍摄的人，都保存着父亲生前另一个版本的故事。',
      brief: { logline: '一位摄影师想拼回父亲的一生，却在旅途里找到了自己离开的理由。', length: '6 集 × 12 分钟', audience: '喜欢公路故事与家庭主题的观众', theme: '理解上一代，也允许自己选择不同的人生。', constraints: '三处主要山城场景；旅行与地质信息需要后续实地核对。所有日期为演示数据。' },
      characters: [
        { name: '陈默', role: '地质摄影师 · 31 岁', goal: '完成父亲未走完的考察路线', secret: '他更想卖掉父亲的老屋，用旅途拖延决定', voice: '先观察，再开口；对亲人反而更尖锐', notes: '动机待定：是完成承诺，还是证明自己已经摆脱父亲？' },
        { name: '苏禾', role: '乡村教师 · 30 岁', goal: '为即将合并的学校留下影像', secret: '她已经申请了去城里的调令', voice: '温和直接，避免替别人做决定' },
      ],
      scenes: [
        { title: '地图背面', location: '父亲老屋', interior: '内景', time: '清晨', act: '第一幕', cast: [0], summary: '陈默在老地图背面发现三个名字。', intent: '给旅途一个可以追踪的目标', outcome: '他把相机放进原本用来装房产证的包。', body: '地图被反复折叠的地方已经透光。\n\n陈默翻过来，背面是三个名字和一串坐标。\n他把待签字的卖房合同压进抽屉，拿起相机。' },
        { title: '最后一张合影', location: '山村小学', interior: '外景', time: '午后', act: '第二幕', cast: [0, 1], summary: '苏禾请他为学校拍最后一张合影。', intent: '让主人公第一次为别人停下', outcome: '陈默知道了父亲当年来到这里的原因。', body: '' },
      ],
      materials: [{ title: '人物关系待解问题', category: '人物研究', body: '示例：陈默为何多年不回家？苏禾如何理解“留下”？父亲不应只通过他人赞美出现，需要一处具体的失误。', source: '内置示例', status: 'adopted' }], task: '确定陈默的动机', view: 'library', selectedScene: 0,
    },
  ];
  return specs.map((spec, index) => {
    const p = newProject(spec);
    p.sample = true;
    p.brief = spec.brief;
    p.characters = spec.characters.map(newCharacter);
    p.materials = spec.materials.map(newMaterial);
    p.scenes = spec.scenes.map(s => newScene({ ...s, cast: s.cast.map(index => p.characters[index].id) }, p));
    p.tasks = [{ id: `example-task-${index + 1}`, title: spec.task, sceneId: p.scenes[spec.selectedScene].id, due: spec.deadline, done: false }];
    p.view = { ...p.view, tab: spec.view, sceneId: p.scenes[spec.selectedScene].id };
    p.createdAt = `2026-11-0${5 + index}T02:00:00.000Z`;
    p.updatedAt = `2026-11-12T0${2 - index}:20:00.000Z`;
    addVersion(p, '示例初稿');
    return p;
  });
}
