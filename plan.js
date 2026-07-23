// ============================================================
// plan.js — 训练计划数据（个人定制文件）
// ============================================================
// 本文件定义整个应用的训练计划、习惯打卡项、体测指标等个人化内容。
// 应用壳 index.html 从这里读取数据渲染,修改本文件不需要改动应用代码。
// 修改后请运行: node scripts/validate-plan.js 校验结构。
// 必须在 index.html 主脚本之前加载。

// ============================================================
// 训练计划数据
// ============================================================
const PLAN_DATA = {
  warmupTemplate: {
    name: '训练前激活套餐',
    duration: '15 分钟',
    description: '没做完这 15 分钟，不进主训练区。修复期最高杠杆的 15 分钟。',
    exercises: [
      { id: 'wu-foot-1', name: '短足训练', sets: '2 组 × 10 次/侧', tip: '激活足底内在肌' },
      { id: 'wu-foot-2', name: '单腿站立', sets: '2 组 × 30 秒/侧', tip: '晃严重先睁眼，稳了切闭眼' },
      { id: 'wu-core-1', name: '90/90 死虫呼吸', sets: '5 次完整呼吸', tip: '4 秒吸 / 6 秒呼' },
      { id: 'wu-core-2', name: '死虫', sets: '2 组 × 8 次', tip: '腰贴地，对侧手脚缓慢下放' },
      { id: 'wu-core-3', name: '鸟狗', sets: '2 组 × 8 次', tip: '对侧手脚伸出，稳定 1 秒' },
      { id: 'wu-scap-1', name: 'YTW 俯卧', sets: '2 组 × 8 次/动作', tip: '无重量或 1kg 哑铃' },
      { id: 'wu-scap-2', name: '前锯肌推墙', sets: '2 组 × 12 次', tip: '推到顶峰肩胛前伸' },
      { id: 'wu-comp-1', name: '左侧补偿:前锯肌推墙', sets: '12 次', tip: '左侧弱多做一组' },
      { id: 'wu-comp-2', name: '左侧补偿:鸟狗', sets: '8 次', tip: '专注左侧稳定性' },
      { id: 'wu-comp-3', name: '左侧补偿:弹力带肩外旋', sets: '15 次', tip: '修肩袖' }
    ]
  },
  morningTemplate: {
    name: '每日体态矫正',
    duration: '5 分钟',
    description: '每天执行（含休息日）。建议绑定固定场景（如睡前）。仅需弹力带+泡沫轴+门框',
    exercises: [
      { id: 'dc-1', name: '泡沫轴胸椎伸展', sets: '60s (10次后仰)', tip: '横放背部，双手抱头。对抗驼背' },
      { id: 'dc-2', name: '门框胸小肌PNF拉伸', sets: '90s (每侧45s)', tip: '肱骨前移头号松解' },
      { id: 'dc-3', name: '弹力带拉脱', sets: '2×15', tip: '外旋肌+后三角激活' },
      { id: 'dc-4', name: '左侧上斜方肌拉伸', sets: '45s', tip: '仅左侧。高低肩矫正' },
      { id: 'dc-5', name: '鸽子式', sets: '每侧60s', tip: 'O型腿/梨状肌松解' }
    ]
  }
};

function buildActivationWeek(weekNum, w, isLastWeek) {
  // 每周的阶段说明,让用户清楚自己在 Phase 0 的哪个阶段
  const stageLabels = {
    3: '🌱 启动',
    4: '🌿 建立',
    5: '🍀 强化',
    6: '🏁 毕业测试'
  };
  const stage = stageLabels[weekNum] || '';
  
  const noteParts = [];
  if (weekNum === 3) noteParts.push('Phase 0 第 1 周 · 重点是建立感知,不是冲重量。每组之间休息 90 秒。');
  if (weekNum === 4) noteParts.push('Phase 0 第 2 周 · 加入标准训练动作,重量比 Week 3 提升一档。');
  if (weekNum === 5) noteParts.push('Phase 0 第 3 周 · 巩固动作模式,重量再提升。');
  if (weekNum === 6) noteParts.push('Phase 0 第 4 周 · 🏁 毕业测试周! 本周末完成动作录像自检(RDL、深蹲、单臂划船),并准备进入 Phase 1。');
  
  return {
    weekNum,
    phase: `Phase 0 - 基础激活期 (Week ${weekNum}/6 · ${stage})`,
    note: noteParts.join(' '),
    days: [
      {
        dayName: '周一', dayType: 'training', title: `Week ${weekNum} 周一 · 上肢拉日 (${stage})`,
        groups: [{
          title: '主训练',
          exercises: [
            { id: `w${weekNum}-d1-1`, name: '死悬', sets: '3 组 × 30 秒', weight: '自重', tip: '主动下沉肩胛，不耸肩' },
            { id: `w${weekNum}-d1-2`, name: '高位下拉(反握)', sets: '4 组 × 10 次', weight: `${w.pulldownReverse} kg`, tip: '反握减少上斜方代偿' },
            { id: `w${weekNum}-d1-3`, name: '坐姿绳索划船(窄握)', sets: '4 组 × 12 次', weight: `${w.seatedRow} kg`, tip: '顶峰停 2 秒挤压肩胛' },
            { id: `w${weekNum}-d1-4`, name: '单臂哑铃划船', sets: '4 组 × 10 次/侧', weight: `${w.dbRow} kg`, tip: '左右同重，先沉肩胛再拉肘' },
            { id: `w${weekNum}-d1-5`, name: '面拉', sets: '4 组 × 15 次', weight: '中等', tip: '后三角 + 下斜方，必做' },
            { id: `w${weekNum}-d1-6`, name: '弹力带肩外旋', sets: '3 组 × 15 次/侧', weight: '弹力带', tip: '修肩袖，左侧多 1 组' }
          ]
        }, {
          title: '握力收尾(5 分钟)',
          exercises: [
            { id: `w${weekNum}-d1-grip`, name: '哑铃悬挂', sets: '3 组 × 力竭', weight: '20 kg', tip: '握不住即停' }
          ]
        }]
      },
      {
        dayName: '周二', dayType: 'training', title: `Week ${weekNum} 周二 · 下肢日 (髋铰链与足踝)`,
        groups: [{
          title: '主训练',
          exercises: [
            { id: `w${weekNum}-d2-1`, name: '蚌式 + 侧步', sets: '3 组 × 12 次/侧', weight: '阻力带', tip: '激活臀中肌' },
            { id: `w${weekNum}-d2-2`, name: '罗马尼亚硬拉(RDL)', sets: '4 组 × 10 次', weight: `${w.rdl} kg`, tip: '屁股向后推，腰背中立，杠铃贴大腿' },
            { id: `w${weekNum}-d2-3`, name: '高脚杯深蹲', sets: '4 组 × 10 次', weight: `哑铃 ${w.gobletSquat} kg`, tip: '替代杠铃深蹲，躯干更直立' },
            { id: `w${weekNum}-d2-4`, name: '保加利亚分腿蹲', sets: '3 组 × 8 次/侧', weight: w.splitSquat, tip: '左侧先做' },
            { id: `w${weekNum}-d2-5`, name: '单腿 RDL', sets: '3 组 × 8 次/侧', weight: w.singleRdl, tip: '🔑 金钥匙动作' },
            { id: `w${weekNum}-d2-6`, name: '髋外展器械', sets: '3 组 × 15 次', weight: '中等', tip: 'O 型腿专项' },
            { id: `w${weekNum}-d2-7`, name: '提踵 + 胫骨前肌', sets: '3 组 × 15 次', weight: '自重', tip: '小腿前后平衡' }
          ]
        }]
      },
      {
        dayName: '周三', dayType: 'training', title: `Week ${weekNum} 周三 · 核心 + Zone 2 有氧`,
        description: '低关节负荷日，在两个力量日之间',
        groups: [{
          title: '核心循环 × 3 轮',
          description: '每轮无休完成，轮间休 90 秒',
          exercises: [
            { id: `w${weekNum}-d3-c1`, name: '死虫加重', sets: '10 次', weight: '2 kg', tip: '腰贴地' },
            { id: `w${weekNum}-d3-c2`, name: '鸟狗', sets: '10 次/侧', weight: '自重', tip: '对侧稳定' },
            { id: `w${weekNum}-d3-c3`, name: '侧平板', sets: '30 秒/侧', weight: '自重', tip: '记录左侧时长' },
            { id: `w${weekNum}-d3-c4`, name: 'Pallof Press', sets: '12 次/侧', weight: '中等', tip: '抗旋转' },
            { id: `w${weekNum}-d3-c5`, name: '反向卷腹', sets: '12 次', weight: '自重', tip: '下腹激活' }
          ]
        }, {
          title: 'Zone 2 有氧',
          exercises: [
            { id: `w${weekNum}-d3-cardio`, name: 'Zone 2 有氧', sets: '15 分钟', weight: '心率 120-135', tip: '能鼻子呼吸、能正常说话' }
          ]
        }]
      },
      {
        dayName: '周四', dayType: 'training', title: `Week ${weekNum} 周四 · 上肢推日 (前锯肌与胸椎)`,
        groups: [{
          title: '主训练',
          exercises: [
            { id: `w${weekNum}-d4-1`, name: '俯卧撑加强版', sets: '3 组 × 10 次', weight: '自重', tip: '推到顶峰再多推一点，前锯激活' },
            { id: `w${weekNum}-d4-2`, name: '哑铃卧推', sets: '4 组 × 10 次', weight: `${w.dbBench} kg/侧`, tip: '双手独立，强制对称' },
            { id: `w${weekNum}-d4-3`, name: '哑铃推肩(坐姿靠背)', sets: '4 组 × 10 次/侧', weight: `${w.dbShoulderPress} kg`, tip: '左侧先做' },
            { id: `w${weekNum}-d4-4`, name: '器械上斜推胸', sets: '3 组 × 10 次', weight: '中等', tip: '上胸激活' },
            { id: `w${weekNum}-d4-5`, name: '绳索下压', sets: '3 组 × 12 次', weight: '中等', tip: '三头肌' },
            { id: `w${weekNum}-d4-6`, name: 'YTW 俯卧', sets: '3 组 × 8 次/动作', weight: `${w.ytw} kg`, tip: '巩固后链激活' }
          ]
        }]
      },
      {
        dayName: '周五', dayType: 'training', title: `Week ${weekNum} 周五 · 整合日 + 核心强化`,
        groups: [{
          title: '整合动作',
          exercises: [
            { id: `w${weekNum}-d5-1`, name: '哑铃行走', sets: '4 组 × 40 米', weight: `${w.farmerWalk} kg/侧`, tip: '修复期最高性价比动作' },
            { id: `w${weekNum}-d5-2`, name: '单侧哑铃行走', sets: '3 组 × 20 米/侧', weight: `${w.suitcaseWalk} kg`, tip: '抗侧屈，治游泳圈神器' },
            { id: `w${weekNum}-d5-3`, name: '辅助引体', sets: '4 组 × 5 次', weight: `${w.assistedPullup} kg 辅助`, tip: '记录辅助重量变化' },
            { id: `w${weekNum}-d5-4`, name: '山羊挺', sets: '3 组 × 12 次', weight: '自重', tip: '后链强化' },
            { id: `w${weekNum}-d5-5`, name: '悬垂举腿(腿可弯)', sets: '3 组 × 8 次', weight: '自重', tip: '深层核心 + 握力' },
            { id: `w${weekNum}-d5-6`, name: '绳索劈柴', sets: '3 组 × 10 次/侧', weight: '中等', tip: '抗旋转 + 全身整合' }
          ]
        }, {
          title: '握力收尾',
          exercises: [
            { id: `w${weekNum}-d5-grip`, name: '哑铃悬挂', sets: '3 组 × 力竭', weight: '20 kg', tip: '' }
          ]
        }]
      },
      { dayName: '周六', dayType: 'recovery', title: `Week ${weekNum} 周六 · 专业筋膜松解 + 自由活动`, description: '60 分钟专业松解，前后做评估测试。剩余时间自由' },
      { dayName: '周日', dayType: 'rest', title: `Week ${weekNum} 周日 · 完全休息`, description: '只做晨间重置 + 微习惯' }
    ]
  };
}

// ============================================================
// V3 训练计划数据（2026-06-08 起，W7-18）
// 更新训练计划时只需修改下面的日模板和阶段配置
// ============================================================

const V3_RELEASE_EXERCISES = [
  { name: '泡沫轴全身滚压', sets: '8min', weight: '', tip: '臀外侧/大腿后侧/左侧肩颈/胸椎' },
  { name: '胸小肌PNF拉伸', sets: '3次/侧 · 45s', weight: '', tip: '门框。肱骨前移头号松解' },
  { name: '肩关节后囊拉伸', sets: '45s/侧', weight: '', tip: '' },
  { name: '鸽子式', sets: '60s/侧', weight: '', tip: '梨状肌/O型腿' },
  { name: '跪姿髂腰肌拉伸', sets: '45s/侧', weight: '', tip: '' },
  { name: '墙壁天使', sets: '3×10', weight: '', tip: '' },
  { name: '左侧上斜方肌拉伸', sets: '3次 · 45s', weight: '', tip: '仅左侧。高低肩矫正' },
  { name: '左侧腰方肌拉伸', sets: '30s', weight: '', tip: '仅左侧' },
  { name: '右侧肩胛下沉激活', sets: '3×12', weight: '轻弹力带', tip: '仅右侧' }
];

const V3_PHASE1_DAYS = {
  mon: {
    title: '拉力日（背部为主）',
    groups: [{
      title: '主训练',
      exercises: [
        { name: '弹力带面拉', sets: '3×15', weight: '轻-中弹力带', tip: '第一个做。拉至耳侧，外旋到位' },
        { name: '高位下拉（反握·助力带）', sets: '3×10', weight: '60kg', tip: '肩胛下沉启动 → 肘向身体拉' },
        { name: '坐姿绳索划船（助力带）', sets: '3×12', weight: '50kg', tip: '肘贴体侧，顶峰挤压1秒' },
        { name: '死虫（Dead Bug）', sets: '3×10/侧', weight: '自重', tip: '划船组间做。抗伸展核心', superSet: true },
        { name: '单臂哑铃划船（助力带）', sets: '3×10/侧', weight: '12kg', tip: '躯干平行，肘高过背' },
        { name: '死悬（握力专项）', sets: '3×力竭', weight: '自重', tip: '目标从50s → 60s' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '15min', weight: 'HR 115-128', tip: '快走或慢跑' }]
    }]
  },
  tue: {
    title: '推力日（胸+肩+三头）',
    groups: [{
      title: '主训练',
      exercises: [
        { name: '器械上斜推胸', sets: '3×8-10', weight: '各10kg', tip: '左侧先力竭时记录差距，降重不借力' },
        { name: '哑铃侧平举', sets: '3×15', weight: '3-5kg', tip: '轻重量高次数，不加重肱骨前移' },
        { name: '窄距俯卧撑', sets: '3×力竭', weight: '自重', tip: '三头+核心。记录次数' },
        { name: '侧平板支撑', sets: '2×20-30s/侧', weight: '自重', tip: '俯卧撑组间做。抗侧屈核心', superSet: true },
        { name: '绳索下压', sets: '3×12', weight: '10kg', tip: '三头孤立' },
        { name: '弹力带拉脱', sets: '2×15', weight: '轻弹力带', tip: '推完必拉，平衡前后链' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '15min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  wed: {
    title: '下肢A · 蹲类主导',
    groups: [{
      title: '臀肌激活（热身）',
      exercises: [
        { name: '蚌式+侧卧外展', sets: '各1×20', weight: '轻弹力带', tip: '臀肌激活，不可跳过' }
      ]
    }, {
      title: '主训练',
      exercises: [
        { name: '高脚杯深蹲', sets: '3×10', weight: '25kg', tip: '膝对脚尖' },
        { name: '保加利亚分腿蹲', sets: '3×8/侧', weight: '15kg', tip: '下降3秒，膝盖朝前' },
        { name: '髋外展器械', sets: '3×12', weight: '35kg', tip: '臀中肌专项' },
        { name: '弹力带侧向走', sets: '3×15步/侧', weight: '中弹力带', tip: 'O型腿专项' },
        { name: 'Pallof Press 抗旋转', sets: '3×12/侧', weight: '轻弹力带', tip: '抗旋转核心' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '15min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  thu: {
    title: '上肢综合日（拉为主+少量推）',
    groups: [{
      title: '主训练',
      exercises: [
        { name: '辅助引体（离心）', sets: '3×5-6', weight: '重弹力带', tip: '每组前3次肩胛引体激活。下降4秒' },
        { name: '哑铃俯身划船（助力带）', sets: '3×12/侧', weight: '14kg', tip: '背部第二次刺激' },
        { name: '弹力带面拉', sets: '3×15', weight: '中弹力带', tip: '外旋肌第二次激活' },
        { name: '器械推胸（平推）', sets: '3×10', weight: '各7.5-10kg', tip: '推类补量，不追力竭' },
        { name: '悬垂举腿/仰卧举腿', sets: '3×10', weight: '自重', tip: '屈曲核心。握力够就悬垂' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '15min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  fri: {
    title: '下肢B · 髋铰链主导',
    groups: [{
      title: '臀肌激活（热身）',
      exercises: [
        { name: '蚌式+侧卧外展', sets: '各1×20', weight: '轻弹力带', tip: '' }
      ]
    }, {
      title: '主训练',
      exercises: [
        { name: '罗马尼亚硬拉（助力带）', sets: '3×10', weight: '30kg', tip: '腹内压保持，感受腘绳拉伸' },
        { name: '单腿臀推', sets: '3×10/侧', weight: '自重→哑铃', tip: '顶部夹臀2秒' },
        { name: '单腿RDL', sets: '3×10/侧 + 右侧+1组', weight: '10kg', tip: '右侧多1组补弱侧' },
        { name: '卷腹/反向卷腹', sets: '3×15', weight: '自重', tip: '单腿RDL组间做。屈曲核心', superSet: true },
        { name: '农夫走', sets: '3×30m', weight: '20kg/手', tip: '单手提=手提箱走，抗侧屈。左手额外1趟' },
        { name: '弹力带侧向走', sets: '3×15步/侧', weight: '中弹力带', tip: 'O型腿第二次' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '15min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  sat: {
    title: 'HIIT + 松解',
    groups: [{
      title: 'HIIT 间歇训练',
      exercises: [
        { name: 'HIIT 热身', sets: '3min', weight: '', tip: '快走，HR<120' },
        { name: 'HIIT 间歇', sets: '6组 · 快跑30s + 慢走90s', weight: '', tip: 'P1不追极限心率，建立模式' }
      ]
    }, {
      title: '松解',
      exercises: V3_RELEASE_EXERCISES
    }]
  }
};

const V3_PHASE2_DAYS = {
  mon: {
    title: '拉力日（Phase 2）',
    groups: [{
      title: '主训练',
      exercises: [
        { name: '弹力带面拉', sets: '3×15', weight: '中弹力带', tip: '升级阻力' },
        { name: '高位下拉（反握）', sets: '1×12脱带 + 3×10戴带', weight: '65-75kg', tip: '+1组，热身脱带' },
        { name: '坐姿绳索划船', sets: '1×12脱带 + 3×10戴带', weight: '55-65kg', tip: '' },
        { name: '死虫（进阶：伸腿）', sets: '3×10/侧', weight: '自重', tip: '抗伸展核心', superSet: true },
        { name: '单臂哑铃划船（助力带）', sets: '3×10/侧', weight: '14-18kg', tip: '' },
        { name: '死悬', sets: '3×力竭', weight: '自重', tip: '目标60s → 90s' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '20min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  tue: {
    title: '推力日（Phase 2）',
    groups: [{
      title: '主训练',
      exercises: [
        { name: '器械上斜推胸', sets: '4×8-10', weight: '各10-15kg', tip: '+1组' },
        { name: '哑铃侧平举', sets: '3×15', weight: '5-7.5kg', tip: '渐进' },
        { name: '哑铃肩推（W13评估后）', sets: '3×10', weight: '5kg起步', tip: '仅通过评估后恢复' },
        { name: '侧平板支撑', sets: '2×30-45s/侧', weight: '自重', tip: '抗侧屈核心，进阶时长', superSet: true },
        { name: '绳索下压', sets: '3×12', weight: '12.5-15kg', tip: '' },
        { name: '弹力带拉脱', sets: '2×15', weight: '中弹力带', tip: '' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '20min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  wed: {
    title: '下肢A · 蹲类（Phase 2）',
    groups: [{
      title: '臀肌激活（热身）',
      exercises: [
        { name: '蚌式+侧卧外展', sets: '各1×20', weight: '弹力带', tip: '' }
      ]
    }, {
      title: '主训练',
      exercises: [
        { name: '杠铃深蹲', sets: '4×8', weight: '空杆+10kg起', tip: '从高脚杯升级' },
        { name: '保加利亚分腿蹲', sets: '3×8/侧', weight: '17.5-22.5kg', tip: '渐进' },
        { name: '髋外展器械', sets: '3×12', weight: '40-50kg', tip: '' },
        { name: '弹力带侧向走', sets: '3×15步/侧', weight: '中-重弹力带', tip: '' },
        { name: 'Pallof Press', sets: '3×12/侧', weight: '弹力带', tip: '' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '20min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  thu: {
    title: '上肢综合日（Phase 2）',
    groups: [{
      title: '主训练',
      exercises: [
        { name: '引体向上', sets: '3×力竭(目标1-3个) + 离心补至5次', weight: '自重/轻弹力带', tip: '尝试完整引体' },
        { name: '哑铃俯身划船（助力带）', sets: '3×10/侧', weight: '16-20kg', tip: '' },
        { name: '弹力带面拉', sets: '3×15', weight: '中弹力带', tip: '' },
        { name: '器械推胸（平推）', sets: '3×10', weight: '各10-12.5kg', tip: '' },
        { name: '悬垂举腿', sets: '3×10-12', weight: '自重', tip: '此时握力应能支撑' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '20min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  fri: {
    title: '下肢B · 髋铰链（Phase 2）',
    groups: [{
      title: '臀肌激活（热身）',
      exercises: [
        { name: '蚌式+侧卧外展', sets: '各1×20', weight: '弹力带', tip: '' }
      ]
    }, {
      title: '主训练',
      exercises: [
        { name: '罗马尼亚硬拉', sets: '1×10脱带 + 3×8戴带', weight: '40-50kg', tip: '+1组，热身脱带' },
        { name: '杠铃臀推', sets: '3×10', weight: '空杆起步渐进', tip: '替代单腿臀推，更高负载' },
        { name: '单腿RDL', sets: '3×10/侧 + 右侧+1组', weight: '12.5-15kg', tip: '' },
        { name: '卷腹/反向卷腹', sets: '3×15-20', weight: '自重', tip: '屈曲核心', superSet: true },
        { name: '农夫走', sets: '3×30m', weight: '22.5-25kg/手', tip: '抗侧屈核心，渐进' },
        { name: '弹力带侧向走', sets: '3×15步/侧', weight: '中-重弹力带', tip: '' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '20min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  sat: {
    title: 'HIIT + 松解（Phase 2）',
    groups: [{
      title: 'HIIT 间歇训练',
      exercises: [
        { name: 'HIIT 热身', sets: '3min', weight: '', tip: '快走' },
        { name: 'HIIT 间歇', sets: '8组 · 快跑20s + 慢走60s', weight: '', tip: '密度提升' }
      ]
    }, {
      title: '松解',
      exercises: V3_RELEASE_EXERCISES
    }]
  }
};

const V3_PHASE3_DAYS = {
  mon: {
    title: '拉力日（Phase 3）',
    groups: [{
      title: '主训练',
      exercises: [
        { name: '弹力带面拉', sets: '3×15', weight: '中-重弹力带', tip: '' },
        { name: '高位下拉（反握）', sets: '2×10脱带 + 2×8戴带', weight: '75-85kg', tip: '脱带组增多' },
        { name: '坐姿绳索划船', sets: '2×10脱带 + 2×8戴带', weight: '60-70kg', tip: '' },
        { name: '健腹轮/死虫进阶', sets: '3×8-10', weight: '自重', tip: '抗伸展核心进阶', superSet: true },
        { name: '单臂哑铃划船', sets: '3×10/侧', weight: '18-22kg', tip: '尝试脱带' },
        { name: '死悬（可加重）', sets: '3×力竭', weight: '自重 → +5kg', tip: '90s+可加重' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '20min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  tue: {
    title: '推力日（Phase 3）',
    groups: [{
      title: '主训练',
      exercises: [
        { name: '器械上斜推胸', sets: '4×8', weight: '各15-17.5kg', tip: '' },
        { name: '哑铃肩推', sets: '3×8-10', weight: '7.5-10kg', tip: '渐进（如已通过评估）' },
        { name: '侧平板支撑', sets: '2×45-60s/侧', weight: '自重', tip: '抗侧屈核心进阶', superSet: true },
        { name: '哑铃侧平举', sets: '3×12', weight: '7.5kg', tip: '' },
        { name: '绳索下压', sets: '3×12', weight: '15-17.5kg', tip: '' },
        { name: '弹力带拉脱', sets: '2×15', weight: '中弹力带', tip: '' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '20min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  wed: {
    title: '下肢A · 蹲类（Phase 3）',
    groups: [{
      title: '臀肌激活（热身）',
      exercises: [
        { name: '蚌式+侧卧外展', sets: '各1×20', weight: '中弹力带', tip: '' }
      ]
    }, {
      title: '主训练',
      exercises: [
        { name: '杠铃深蹲', sets: '4×6-8', weight: '空杆+25-35kg', tip: '次数降，重量升' },
        { name: '保加利亚分腿蹲', sets: '3×8/侧', weight: '22.5-27.5kg', tip: '' },
        { name: '髋外展器械', sets: '3×12', weight: '50-55kg', tip: '' },
        { name: '弹力带侧向走', sets: '3×15步/侧', weight: '重弹力带', tip: '' },
        { name: 'Pallof Press', sets: '3×12/侧', weight: '中弹力带', tip: '' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '20min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  thu: {
    title: '上肢综合日（Phase 3）',
    groups: [{
      title: '主训练',
      exercises: [
        { name: '引体向上', sets: '4×力竭(目标3-5个)', weight: '自重', tip: '主攻5个目标' },
        { name: '哑铃俯身划船', sets: '3×10/侧', weight: '20-24kg', tip: '尝试脱带' },
        { name: '弹力带面拉', sets: '3×15', weight: '重弹力带', tip: '' },
        { name: '器械推胸（平推）', sets: '3×8', weight: '各12.5-15kg', tip: '' },
        { name: '悬垂举腿', sets: '4×12', weight: '自重', tip: '增量' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '20min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  fri: {
    title: '下肢B · 髋铰链（Phase 3）',
    groups: [{
      title: '臀肌激活（热身）',
      exercises: [
        { name: '蚌式+侧卧外展', sets: '各1×20', weight: '中弹力带', tip: '' }
      ]
    }, {
      title: '主训练',
      exercises: [
        { name: '罗马尼亚硬拉', sets: '2×8脱带 + 2×6戴带', weight: '50-57.5kg', tip: '脱带组增多' },
        { name: '杠铃臀推', sets: '4×8', weight: '渐进', tip: '+1组' },
        { name: '单腿RDL', sets: '3×10/侧 + 右侧+1组', weight: '15-17.5kg', tip: '评估右侧是否追平' },
        { name: '卷腹/反向卷腹', sets: '3×20', weight: '自重', tip: '屈曲核心', superSet: true },
        { name: '农夫走', sets: '3×40m', weight: '25-30kg/手', tip: '距离延长' },
        { name: '弹力带侧向走', sets: '3×15步/侧', weight: '重弹力带', tip: '' }
      ]
    }, {
      title: 'Zone 2 收尾',
      exercises: [{ name: 'Zone 2 有氧', sets: '20min', weight: 'HR 115-128', tip: '' }]
    }]
  },
  sat: {
    title: 'HIIT + 松解（Phase 3）',
    groups: [{
      title: 'HIIT 间歇训练',
      exercises: [
        { name: 'HIIT 热身', sets: '3min', weight: '', tip: '快走' },
        { name: 'HIIT 间歇', sets: '10组 · 快跑20s + 慢走60s', weight: '', tip: '' }
      ]
    }, {
      title: '松解',
      exercises: V3_RELEASE_EXERCISES
    }]
  }
};

const V3_PHASE_CONFIG = {
  1: {
    label: 'Phase 1 - 模式建立·握力重建',
    range: [7, 10],
    days: V3_PHASE1_DAYS,
    stageLabels: { 7: '🌱 启动', 8: '🌿 适应', 9: '🍀 强化', 10: '🏁 减载' },
    notes: [
      '助力带全程使用',
      '肩推 Phase 1 暂停（5/21 数据显示代偿）',
      '渐进参考: 上肢每2周+2.5kg，下肢每周+2.5kg'
    ]
  },
  2: {
    label: 'Phase 2 - 力量进阶·减脂加速',
    range: [11, 14],
    days: V3_PHASE2_DAYS,
    stageLabels: { 11: '🌱 启动', 12: '🌿 适应', 13: '🍀 强化', 14: '🏁 减载' },
    notes: [
      '助力带: 热身组脱带，工作组戴',
      'W13 评估肩推: 面拉后手背自然朝外侧 → 通过',
      'W11 起肌酸 3-5g/天',
      'Zone 2 延长至 20min'
    ]
  },
  3: {
    label: 'Phase 3 - 强化冲刺·目标收尾',
    range: [15, 18],
    days: V3_PHASE3_DAYS,
    stageLabels: { 15: '🌱 启动', 16: '🌿 适应', 17: '🍀 强化', 18: '🏁 减载+终测' },
    notes: [
      '助力带: 仅最重1-2组使用',
      '引体目标: 5个/组',
      'W18 最终测试'
    ]
  }
};

function deloadSets(sets) {
  return sets.replace(/(\d+)(×|组)/g, (_, n, sep) => Math.ceil(parseInt(n) / 2) + sep);
}

function buildV3Note(weekNum, pc, isDeload) {
  const phaseWeekIdx = weekNum - pc.range[0] + 1;
  let note = `${pc.label} 第 ${phaseWeekIdx} 周`;
  if (isDeload) {
    note += ' · ⚡ 减载周: 组数减半，重量 -15%，注重恢复';
  } else {
    note += ' · ' + pc.notes.join(' · ');
  }
  return note;
}

function buildV3Week(weekNum) {
  const phaseNum = weekNum <= 10 ? 1 : weekNum <= 14 ? 2 : 3;
  const pc = V3_PHASE_CONFIG[phaseNum];
  const isDeload = (weekNum === 10 || weekNum === 14 || weekNum === 18);
  const stage = pc.stageLabels[weekNum];

  const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六'];

  const days = dayKeys.map((key, idx) => {
    const tmpl = pc.days[key];
    let dayExCounter = 0;
    return {
      dayName: dayNames[idx],
      dayType: 'training',
      title: `Week ${weekNum} ${dayNames[idx]} · ${tmpl.title}`,
      skipWarmup: true,
      groups: tmpl.groups.map(g => ({
        title: g.title,
        description: g.description,
        exercises: g.exercises.map((ex) => {
          dayExCounter += 1;
          return {
            id: `w${weekNum}-d${idx + 1}-${dayExCounter}`,
            name: ex.name,
            sets: isDeload ? deloadSets(ex.sets) : ex.sets,
            weight: ex.weight || '',
            tip: ex.tip || '',
            superSet: ex.superSet || false
          };
        })
      }))
    };
  });

  days.push({
    dayName: '周日',
    dayType: 'rest',
    title: `Week ${weekNum} 周日 · 休息`,
    description: '只做每日体态矫正 + 微习惯'
  });

  return {
    weekNum,
    phase: `${pc.label} (Week ${weekNum} · ${stage})`,
    note: buildV3Note(weekNum, pc, isDeload),
    days
  };
}

const WEEKS = [
  {
    weekNum: 3,
    phase: 'Phase 0 - 基础激活期 (Week 3/6 · 🌱 感知)',
    note: 'Phase 0 第 1 周 · 本周训练量刻意偏低,目标是建立发力感知和习惯,不是突破极限。重点动作: 高位下拉/划船时主动下沉肩胛。',
    days: [
      {
        dayName: '周一', dayType: 'training', title: 'Week 3 周一 · 感知训练 A (肩胛与上肢)',
        groups: [{
          title: '主训练',
          description: '专注感知目标肌群',
          exercises: [
            { id: 'w3-d1-1', name: '死悬', sets: '3 组 × 15 秒', weight: '自重', tip: '感觉肩胛主动下沉' },
            { id: 'w3-d1-2', name: '高位下拉(反握)', sets: '3 组 × 12 次', weight: '40 kg', tip: '肘带动，不是手' },
            { id: 'w3-d1-3', name: '面拉', sets: '3 组 × 15 次', weight: '轻', tip: '后三角挤压' },
            { id: 'w3-d1-4', name: '俯卧撑', sets: '3 组 × 8 次', weight: '自重', tip: '胸推出，顶峰肩胛前伸' },
            { id: 'w3-d1-5', name: '单臂哑铃划船', sets: '3 组 × 10 次/侧', weight: '10 kg', tip: '先沉肩胛再拉，左右同重' },
            { id: 'w3-d1-6', name: '弹力带肩外旋', sets: '2 组 × 15 次/侧', weight: '弹力带', tip: '肩袖激活' }
          ]
        }]
      },
      { dayName: '周二', dayType: 'recovery', title: 'Week 3 周二 · 主动恢复', description: '晨间重置完整版 + 户外散步 20-30 分钟。有意识挺胸、步态练习' },
      {
        dayName: '周三', dayType: 'training', title: 'Week 3 周三 · 感知训练 B (下肢与核心)',
        groups: [{
          title: '主训练',
          description: '建立髋铰链 + 足踝感知',
          exercises: [
            { id: 'w3-d3-1', name: '蚌式开合', sets: '3 组 × 15 次/侧', weight: '轻阻力带', tip: '臀外侧发力，不是腰' },
            { id: 'w3-d3-2', name: '弹力带侧步', sets: '3 组 × 10 步/侧', weight: '中阻力带', tip: '臀中肌持续张力' },
            { id: 'w3-d3-3', name: '高脚杯深蹲', sets: '3 组 × 10 次', weight: '哑铃 10 kg', tip: '膝盖不内扣' },
            { id: 'w3-d3-4', name: '单腿 RDL(辅助)', sets: '3 组 × 8 次/侧', weight: '自重', tip: '腘绳肌拉长感' },
            { id: 'w3-d3-5', name: '死虫加重', sets: '3 组 × 10 次', weight: '2 kg 哑铃', tip: '腰贴地' },
            { id: 'w3-d3-6', name: '鸟狗', sets: '3 组 × 10 次/侧', weight: '自重', tip: '对侧稳定' },
            { id: 'w3-d3-7', name: '侧平板', sets: '2 组 × 20 秒/侧', weight: '自重', tip: '记录基线时间' }
          ]
        }]
      },
      { dayName: '周四', dayType: 'recovery', title: 'Week 3 周四 · 主动恢复', description: '晨间重置完整版 + 户外散步 20-30 分钟' },
      {
        dayName: '周五', dayType: 'training', title: 'Week 3 周五 · 感知训练 C (整合)',
        groups: [{
          title: '主训练',
          description: '巩固模式 + 整合性动作',
          exercises: [
            { id: 'w3-d5-1', name: '高位下拉(窄正握)', sets: '3 组 × 12 次', weight: '40 kg', tip: '强化拉模式' },
            { id: 'w3-d5-2', name: '坐姿划船', sets: '3 组 × 12 次', weight: '35 kg', tip: '肩胛挤压，顶峰停 2 秒' },
            { id: 'w3-d5-3', name: '哑铃推肩', sets: '3 组 × 10 次/侧', weight: '8 kg', tip: '肩胛稳定，不耸肩' },
            { id: 'w3-d5-4', name: '哑铃行走', sets: '3 组 × 40 米', weight: '12 kg/侧', tip: '核心稳定 + 握力' },
            { id: 'w3-d5-5', name: 'Pallof Press', sets: '3 组 × 12 次/侧', weight: '中等', tip: '抗旋转' },
            { id: 'w3-d5-6', name: '山羊挺', sets: '3 组 × 10 次', weight: '自重', tip: '下斜方 + 后链' }
          ]
        }]
      },
      { dayName: '周六', dayType: 'recovery', title: 'Week 3 周六 · 首次筋膜松解 + 自由活动', description: '完成第一次专业筋膜松解(60 分钟)。前后做评估测试记录。剩余时间完全自由' },
      { dayName: '周日', dayType: 'rest', title: 'Week 3 周日 · 完全休息', description: '只做晨间重置和微习惯' }
    ]
  },
  buildActivationWeek(4, { rdl: 35, gobletSquat: 12, splitSquat: '自重', singleRdl: '自重', pulldownReverse: 45, seatedRow: 35, dbRow: 13, dbBench: 10, dbShoulderPress: 10, ytw: 1, farmerWalk: 12, suitcaseWalk: 10, assistedPullup: 35 }, false),
  buildActivationWeek(5, { rdl: 40, gobletSquat: 15, splitSquat: '各 5 kg', singleRdl: '5 kg', pulldownReverse: 50, seatedRow: 40, dbRow: 15, dbBench: 12, dbShoulderPress: 12, ytw: 1, farmerWalk: 14, suitcaseWalk: 12, assistedPullup: 32 }, false),
  buildActivationWeek(6, { rdl: 45, gobletSquat: 17, splitSquat: '各 7 kg', singleRdl: '7 kg', pulldownReverse: 55, seatedRow: 45, dbRow: 17, dbBench: 14, dbShoulderPress: 14, ytw: 2, farmerWalk: 16, suitcaseWalk: 14, assistedPullup: 30 }, true),
  
  // ========== V3 计划: Phase 1-3 (Week 7-18) ==========
  buildV3Week(7), buildV3Week(8), buildV3Week(9), buildV3Week(10),
  buildV3Week(11), buildV3Week(12), buildV3Week(13), buildV3Week(14),
  buildV3Week(15), buildV3Week(16), buildV3Week(17), buildV3Week(18)
];

const HABITS = {
  toggle: [
    { id: 'h-morning', name: '每日矫正', icon: '🦴' },
    { id: 'h-sleep', name: '23:30 前入睡', icon: '😴' },
    { id: 'h-protein', name: '蛋白质达标', icon: '🍗' },
    { id: 'h-creatine', name: '肌酸 3-5g', icon: '💊' },
    { id: 'h-fishoil', name: '鱼油', icon: '🐟' },
    { id: 'h-fascia', name: '自主筋膜松解', icon: '🌀' }
  ],
  counter: [
    { id: 'h-water', name: '饮水', target: 8, unit: '杯' }
  ]
};

const METRICS = [
  { id: 'm-weight', name: '体重', unit: 'kg', tip: '晨起空腹便后' },
  { id: 'm-bodyfat', name: '体脂率', unit: '%', tip: '体脂秤数据' },
  { id: 'm-muscle', name: '肌肉量', unit: 'kg', tip: '体脂秤数据' },
  { id: 'm-deadhang', name: '死悬时间', unit: '秒', tip: '双手抓单杠至力竭' },
  { id: 'm-singleleg-l', name: '单腿闭眼站立(左)', unit: '秒', tip: '晃 > 10° 停止' },
  { id: 'm-singleleg-r', name: '单腿闭眼站立(右)', unit: '秒', tip: '晃 > 10° 停止' },
  { id: 'm-sideplank-l', name: '侧平板(左)', unit: '秒', tip: '至力竭' },
  { id: 'm-sideplank-r', name: '侧平板(右)', unit: '秒', tip: '至力竭' },
  { id: 'm-pullup-assist', name: '辅助引体所需重量', unit: 'kg', tip: '能做 5 次的最轻辅助' },
  { id: 'm-tva', name: '主动腹横肌收紧时长', unit: '秒', tip: '能有意识维持多久' }
];

const NOTE_TEMPLATES = [
  { id: 'workout', name: '训练记录', content: '重量：\n组数 × 次数：\n动作感受：\n左右差异：\n下次调整：' },
  { id: 'feeling', name: '动作感受', content: '今天对这个动作的感觉：\n找到的发力感：\n遇到的代偿：\n改进方向：' },
  { id: 'progress', name: '进步记录', content: '本次表现：\n相比上次：\n关键变化：\n备注：' },
  { id: 'free', name: '自由记录', content: '' }
];

// ============================================================
// 视频资源映射
// ============================================================
// 按动作名做模糊匹配,每个动作可以提供:
// - q: 自定义搜索词(默认是"动作名 教学")
// - bv: 精选 Bilibili BV ID(可选,有则直接嵌入)
// - note: 视频要点说明(可选)
const VIDEO_MAP = {
  // 晨间重置
  '泡沫轴胸椎伸展': { q: '泡沫轴胸椎伸展 富贵包' },
  '猫牛式': { q: '猫牛式 胸椎' },
  '下巴内收': { q: 'chin tuck 下巴内收 颈椎' },
  '墙面天使': { q: 'wall angels 墙天使' },
  '90/90 呼吸': { q: '90/90 呼吸 死虫' },
  '死虫慢速版': { q: '死虫 dead bug 教学' },
  '侧卧呼吸': { q: '90/90 侧卧呼吸 腹斜肌' },
  
  // 激活套餐
  '短足训练': { q: 'short foot 短足训练 足弓' },
  '单腿站立': { q: '单腿站立 平衡 训练' },
  '90/90 死虫呼吸': { q: '90/90 呼吸 腹横肌' },
  '死虫': { q: '死虫 dead bug 标准动作' },
  '鸟狗': { q: '鸟狗 bird dog 标准' },
  'YTW 俯卧': { q: 'YTW 俯卧 下斜方' },
  '前锯肌推墙': { q: '前锯肌推墙 push up plus' },
  
  // 上肢拉
  '死悬': { q: 'dead hang 死悬 引体准备' },
  '高位下拉(反握)': { q: '反握高位下拉 教学' },
  '高位下拉(窄正握)': { q: '高位下拉 窄握 教学' },
  '坐姿绳索划船': { q: '坐姿划船 窄握 肩胛' },
  '坐姿划船': { q: '坐姿划船 窄握 肩胛' },
  '单臂哑铃划船': { q: '单臂哑铃划船 教学' },
  '面拉': { q: 'face pull 面拉 教学' },
  '弹力带肩外旋': { q: '弹力带肩外旋 肩袖' },
  
  // 下肢
  '蚌式开合': { q: '蚌式 clam shell 臀中肌' },
  '蚌式 + 侧步': { q: '蚌式 侧步 臀中肌激活' },
  '弹力带侧步': { q: '弹力带侧步 monster walk' },
  '罗马尼亚硬拉(RDL)': { q: '罗马尼亚硬拉 RDL 教学 髋铰链' },
  '罗马尼亚硬拉': { q: '罗马尼亚硬拉 RDL 教学 髋铰链' },
  '高脚杯深蹲': { q: '高脚杯深蹲 goblet squat 教学' },
  '保加利亚分腿蹲': { q: '保加利亚分腿蹲 教学 膝盖' },
  '单腿 RDL': { q: '单腿罗马尼亚硬拉 single leg RDL' },
  '髋外展器械': { q: '髋外展器械 臀中肌' },
  '提踵 + 胫骨前肌': { q: '提踵 胫骨前肌 小腿训练' },
  '单腿 RDL(辅助)': { q: '单腿 RDL 辅助 平衡' },
  
  // 上肢推
  '俯卧撑': { q: '俯卧撑 标准动作 肩胛' },
  '俯卧撑加强版': { q: 'push up plus 俯卧撑加强版 前锯肌' },
  '哑铃卧推': { q: '哑铃卧推 教学 双手独立' },
  '哑铃推肩': { q: '坐姿哑铃推肩 教学 肩胛' },
  '哑铃推肩(坐姿靠背)': { q: '坐姿哑铃推肩 靠背 教学' },
  '器械上斜推胸': { q: '器械上斜推胸 教学' },
  '绳索下压': { q: '绳索下压 三头肌' },
  
  // 整合 + 核心
  '哑铃行走': { q: '农夫行走 farmer walk 教学' },
  '单侧哑铃行走': { q: 'suitcase carry 单侧农夫行走 抗侧屈' },
  '辅助引体': { q: '辅助引体机 教学' },
  '山羊挺': { q: '山羊挺 superman 后链' },
  '悬垂举腿(腿可弯)': { q: '悬垂举腿 hanging leg raise' },
  '绳索劈柴': { q: '绳索劈柴 wood chopper 抗旋转' },
  'Pallof Press': { q: 'pallof press 抗旋转 教学' },
  '反向卷腹': { q: '反向卷腹 reverse crunch' },
  '侧平板': { q: 'side plank 侧平板 教学' },
  '死虫加重': { q: '死虫加重 dead bug 进阶' },
  
  // 握力
  '哑铃悬挂': { q: '哑铃悬挂 握力训练' },
  
  // 有氧
  'Zone 2 有氧': { q: 'zone 2 有氧 心率 训练' }
};

// 根据动作名查找视频信息
function getVideoForExercise(exerciseName) {
  // 先精确匹配
  if (VIDEO_MAP[exerciseName]) return VIDEO_MAP[exerciseName];
  
  // 模糊匹配:遍历 keys,看动作名是否包含某个 key 或反之
  for (const [key, val] of Object.entries(VIDEO_MAP)) {
    // 去掉括号内容比较
    const cleanName = exerciseName.replace(/[(（].*?[)）]/g, '').trim();
    const cleanKey = key.replace(/[(（].*?[)）]/g, '').trim();
    if (cleanName === cleanKey || 
        cleanName.includes(cleanKey) || 
        cleanKey.includes(cleanName)) {
      return val;
    }
  }
  
  // 完全没匹配,返回默认搜索
  return { q: exerciseName + ' 教学' };
}

// 动作名别名映射 — 新旧计划中同一动作可能有不同命名
// 同一组内的名字共享历史记录
const EXERCISE_NAME_ALIASES = [
  ['高位下拉（反握·助力带）', '高位下拉（反握）', '高位下拉(反握)'],
  ['坐姿绳索划船（助力带）', '坐姿绳索划船', '坐姿划船', '坐姿绳索划船(窄握)'],
  ['单臂哑铃划船（助力带）', '单臂哑铃划船'],
  ['哑铃俯身划船（助力带）', '哑铃俯身划船'],
  ['死虫（Dead Bug）', '死虫', '死虫慢速版'],
  ['死虫（进阶：伸腿）', '死虫加重', '健腹轮/死虫进阶'],
  ['死悬（握力专项）', '死悬（可加重）', '死悬', '死悬 + 肩胛激活', '死悬 + 激活'],
  ['罗马尼亚硬拉（助力带）', '罗马尼亚硬拉', '罗马尼亚硬拉(RDL)'],
  ['单腿RDL', '单腿 RDL', '单腿 RDL + 哑铃', '单腿 RDL(辅助)'],
  ['辅助引体（离心）', '弹力带辅助引体', '弹力带辅助引体(慢离心)', '离心引体', '离心延时引体'],
  ['引体向上', '完整引体向上', '多握法引体', 'EMOM 引体向上'],
  ['哑铃肩推', '哑铃肩推（W13评估后）', '哑铃推肩', '哑铃推肩(坐姿)', '哑铃推肩(坐姿靠背)', '推举(站姿)'],
  ['弹力带面拉', '面拉'],
  ['杠铃深蹲', '杠铃后蹲', '杠铃前蹲'],
  ['Pallof Press 抗旋转', 'Pallof Press'],
  ['悬垂举腿/仰卧举腿', '悬垂举腿', '悬垂举腿(腿可弯)'],
  ['卷腹/反向卷腹', '反向卷腹'],
  ['蚌式+侧卧外展', '蚌式开合', '蚌式 + 侧步激活'],
  ['弹力带侧向走', '弹力带侧步'],
  ['侧平板支撑', '侧平板'],
  ['窄距俯卧撑', '俯卧撑加强版', '俯卧撑加强版(Push-up Plus)'],
  ['农夫走', '单侧哑铃行走', '哑铃行走'],
  ['器械推胸（平推）', '器械上斜推胸'],
];
