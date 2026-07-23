#!/usr/bin/env node
// ============================================================
// validate-plan.js — plan.js 结构校验器
// ============================================================
// 用法: node scripts/validate-plan.js [plan.js 路径]
// 退出码: 0 = 通过, 1 = 有错误
//
// plan.js 是纯浏览器全局脚本(无 module.exports),这里用 vm 沙箱执行后
// 从沙箱中取出全局常量做校验。AI 生成或手工修改 plan.js 后必须跑一遍。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const planPath = process.argv[2] || path.join(__dirname, '..', 'plan.js');
const errors = [];
const warnings = [];

function err(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

// ---------- 1. 在沙箱中执行 plan.js ----------
// 注意: 顶层 const 不会挂到沙箱全局对象上,所以在源码末尾附加一个对象表达式,
// 用脚本的"完成值"把这些常量取出来(和浏览器里跨 <script> 共享全局词法环境等价)。
const EXPORTS = ['PLAN_DATA', 'WEEKS', 'HABITS', 'METRICS', 'NOTE_TEMPLATES', 'VIDEO_MAP', 'EXERCISE_NAME_ALIASES', 'getVideoForExercise'];
let sandbox;
try {
  const src = fs.readFileSync(planPath, 'utf-8');
  const ctx = {};
  vm.createContext(ctx);
  const probe = EXPORTS.map(n => `typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  sandbox = vm.runInContext(`${src}\n;([${probe}]);`, ctx, { filename: planPath, timeout: 5000 })
    .reduce((o, v, i) => (o[EXPORTS[i]] = v, o), {});
} catch (e) {
  console.error(`❌ plan.js 无法执行: ${e.message}`);
  process.exit(1);
}

const { PLAN_DATA, WEEKS, HABITS, METRICS, NOTE_TEMPLATES, VIDEO_MAP, EXERCISE_NAME_ALIASES } = sandbox;

// ---------- 2. 必需常量存在性 ----------
if (!PLAN_DATA || typeof PLAN_DATA !== 'object') err('缺少 const PLAN_DATA(对象)');
if (!Array.isArray(WEEKS)) err('缺少 const WEEKS(数组)');
if (!HABITS || typeof HABITS !== 'object') err('缺少 const HABITS(对象)');
if (!Array.isArray(METRICS)) err('缺少 const METRICS(数组)');
if (!Array.isArray(NOTE_TEMPLATES)) err('缺少 const NOTE_TEMPLATES(数组)');
if (!VIDEO_MAP || typeof VIDEO_MAP !== 'object') err('缺少 const VIDEO_MAP(对象,可为空 {})');
if (!Array.isArray(EXERCISE_NAME_ALIASES)) err('缺少 const EXERCISE_NAME_ALIASES(数组,可为空 [])');
if (typeof sandbox.getVideoForExercise !== 'function') err('缺少 function getVideoForExercise(exerciseName)');

if (errors.length) { report(); }

// ---------- 3. PLAN_DATA: 晨间重置 + 训练前激活模板 ----------
function checkExercise(ex, where, idSet) {
  if (!ex || typeof ex !== 'object') return err(`${where}: 动作不是对象`);
  if (!ex.id || typeof ex.id !== 'string') err(`${where}: 缺少字符串 id`);
  else if (idSet) {
    if (idSet.has(ex.id)) err(`${where}: 动作 id "${ex.id}" 重复(id 必须全计划唯一,否则打卡/评论会错绑)`);
    idSet.add(ex.id);
  }
  if (!ex.name || typeof ex.name !== 'string') err(`${where}: 缺少字符串 name`);
  if (!ex.sets || typeof ex.sets !== 'string') err(`${where}: 缺少字符串 sets(如 "3 组 × 12 次")`);
  // weight / tip 可选
}

const globalIds = new Set();
for (const key of ['morningTemplate', 'warmupTemplate']) {
  const tpl = PLAN_DATA[key];
  if (!tpl || typeof tpl !== 'object') { err(`PLAN_DATA.${key} 缺失`); continue; }
  if (!tpl.name) err(`PLAN_DATA.${key}.name 缺失`);
  if (!Array.isArray(tpl.exercises) || tpl.exercises.length === 0) {
    err(`PLAN_DATA.${key}.exercises 必须是非空数组`); continue;
  }
  tpl.exercises.forEach((ex, i) => checkExercise(ex, `PLAN_DATA.${key}.exercises[${i}]`, globalIds));
}

// ---------- 4. WEEKS ----------
const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAY_TYPES = ['training', 'recovery', 'rest'];

if (WEEKS.length === 0) err('WEEKS 不能为空');
let prevWeekNum = null;
WEEKS.forEach((week, wi) => {
  const w = `WEEKS[${wi}]`;
  if (!week || typeof week !== 'object') return err(`${w} 不是对象`);
  if (!Number.isInteger(week.weekNum)) err(`${w}.weekNum 必须是整数`);
  else {
    if (prevWeekNum !== null && week.weekNum !== prevWeekNum + 1)
      err(`${w}.weekNum=${week.weekNum} 不连续(上一周是 ${prevWeekNum};周次必须逐周 +1,应用按 startDate 偏移量索引)`);
    prevWeekNum = week.weekNum;
  }
  if (!week.phase || typeof week.phase !== 'string') err(`${w}.phase 缺失(阶段名字符串)`);
  if (!Array.isArray(week.days) || week.days.length !== 7)
    return err(`${w}.days 必须是长度为 7 的数组(周一到周日)`);
  week.days.forEach((day, di) => {
    const d = `${w}.days[${di}]`;
    if (!day || typeof day !== 'object') return err(`${d} 不是对象`);
    if (day.dayName !== DAY_NAMES[di]) err(`${d}.dayName 应为 "${DAY_NAMES[di]}",实际 "${day.dayName}"`);
    if (!DAY_TYPES.includes(day.dayType)) err(`${d}.dayType 必须是 ${DAY_TYPES.join('/')} 之一`);
    if (!day.title || typeof day.title !== 'string') err(`${d}.title 缺失`);
    if (day.dayType === 'training') {
      if (!Array.isArray(day.groups) || day.groups.length === 0)
        return err(`${d} 是训练日,必须有非空 groups 数组`);
      day.groups.forEach((g, gi) => {
        const gp = `${d}.groups[${gi}]`;
        if (!g.title) err(`${gp}.title 缺失`);
        if (!Array.isArray(g.exercises) || g.exercises.length === 0)
          return err(`${gp}.exercises 必须是非空数组`);
        g.exercises.forEach((ex, ei) => checkExercise(ex, `${gp}.exercises[${ei}]`, globalIds));
      });
    } else {
      if (!day.description) warn(`${d} 是 ${day.dayType} 日但没有 description`);
    }
  });
});

// ---------- 5. HABITS ----------
const habitIds = new Set();
if (!Array.isArray(HABITS.toggle) || HABITS.toggle.length === 0) err('HABITS.toggle 必须是非空数组');
else HABITS.toggle.forEach((h, i) => {
  if (!h.id || !h.name || !h.icon) err(`HABITS.toggle[${i}] 需要 id/name/icon`);
  if (habitIds.has(h.id)) err(`习惯 id "${h.id}" 重复`);
  habitIds.add(h.id);
});
if (!Array.isArray(HABITS.counter)) err('HABITS.counter 必须是数组(可为空)');
else HABITS.counter.forEach((h, i) => {
  if (!h.id || !h.name || !Number.isFinite(h.target) || !h.unit)
    err(`HABITS.counter[${i}] 需要 id/name/target(数字)/unit`);
  if (habitIds.has(h.id)) err(`习惯 id "${h.id}" 重复`);
  habitIds.add(h.id);
});
// h-morning 是应用的联动锚点: 晨间重置全部完成时自动打卡
if (!habitIds.has('h-morning'))
  warn('HABITS 中没有 id 为 "h-morning" 的习惯 — 「晨间重置完成自动打卡」联动将不生效(如不需要可忽略)');

// ---------- 6. METRICS ----------
const metricIds = new Set();
if (METRICS.length === 0) err('METRICS 不能为空');
METRICS.forEach((m, i) => {
  if (!m.id || !m.name || !m.unit) err(`METRICS[${i}] 需要 id/name/unit`);
  if (metricIds.has(m.id)) err(`体测指标 id "${m.id}" 重复`);
  metricIds.add(m.id);
});

// ---------- 7. NOTE_TEMPLATES / EXERCISE_NAME_ALIASES ----------
NOTE_TEMPLATES.forEach((t, i) => {
  if (!t.id || !t.name || typeof t.content !== 'string') err(`NOTE_TEMPLATES[${i}] 需要 id/name/content`);
});
EXERCISE_NAME_ALIASES.forEach((g, i) => {
  if (!Array.isArray(g) || g.length < 2) err(`EXERCISE_NAME_ALIASES[${i}] 必须是长度≥2 的字符串数组`);
});

// ---------- 8. getVideoForExercise 行为抽查 ----------
try {
  const r = sandbox.getVideoForExercise('不存在的动作名XYZ');
  if (!r || typeof r.q !== 'string') err('getVideoForExercise 对未知动作应返回 { q: <搜索词> }');
} catch (e) {
  err(`getVideoForExercise 执行报错: ${e.message}`);
}

report();

function report() {
  const weekCount = Array.isArray(WEEKS) ? WEEKS.length : 0;
  const trainingDays = Array.isArray(WEEKS)
    ? WEEKS.reduce((n, w) => n + (w.days || []).filter(d => d.dayType === 'training').length, 0) : 0;
  for (const w of warnings) console.log(`⚠️  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`❌ ${e}`);
    console.error(`\n共 ${errors.length} 个错误。请修复后重新校验。`);
    process.exit(1);
  }
  console.log(`✅ plan.js 校验通过: ${weekCount} 周计划(Week ${WEEKS[0].weekNum}-${WEEKS[WEEKS.length - 1].weekNum}), 共 ${trainingDays} 个训练日, ${globalIds.size} 个动作条目, ${new Set([...(HABITS.toggle||[]), ...(HABITS.counter||[])].map(h => h.id)).size} 个习惯, ${METRICS.length} 项体测指标。`);
  process.exit(0);
}
