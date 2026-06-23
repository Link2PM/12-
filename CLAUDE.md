# 体态修复训练手册 — 项目文档

## 项目概述

个人体态矫正训练 PWA 应用，单文件架构（`index.html` ~5200行，所有 HTML/CSS/JS 内联）。配合 `sw.js` 提供 PWA 离线缓存。

**GitHub**: https://github.com/Link2PM/12-  
**当前版本**: v1.0.1  
**用户**: 单人自用工具，运行在 iOS Safari / PWA 模式

## 核心设计原则

1. **单文件自包含**: 所有代码内联在 index.html 中，零外部 CDN 依赖，`file://` 可直接打开
2. **离线优先**: 数据存 localStorage（主） + IndexedDB（备份/媒体），Service Worker 做 PWA 离线缓存
3. **训练计划解耦**: 训练计划定义在 `WEEKS` 数组和 `PLAN_DATA` 对象中，是纯数据结构。UI、AI 分析等功能从这些数据结构动态读取，修改训练计划不需要改其他代码
4. **数据安全**: 所有数据仅存本地浏览器，API Key 仅发送到对应 AI 厂商，不经过任何中间服务器
5. **AI 分析以问题发现为导向**: System Prompt 强调客观真实，不鼓励式反馈。可要求用户拍视频验证、暂停动作、降重量

## 文件结构

```
index.html          — 主应用（~5200行，HTML + CSS + JS 全内联）
sw.js               — Service Worker（Network-first 离线缓存）
CLAUDE.md           — 本文件
12周训练计划_V3_*.md — 训练计划原始文档（参考用）
ai-report-*.md      — 历史 AI 分析报告导出
```

## 代码结构（index.html 内部）

按行号区域划分：

| 区域 | 行号范围 | 内容 |
|------|----------|------|
| CSS 样式 | 11-960 | 全部内联样式，dark theme，CSS 变量定义 |
| HTML 结构 | 1460-1500 | Tab 导航 + 各视图容器 |
| 训练计划数据 | 1500-2120 | `PLAN_DATA`（晨间/激活模板）、`buildPhase*Week()`、`WEEKS` 数组、`HABITS`、`METRICS` |
| 数据库层 | 2240-2560 | IndexedDB + localStorage 双写，`dbGet/dbPut/dbAdd/dbGetAll` 等 |
| 工具函数 | 2570-2680 | `todayStr()`、`fmtDate()`、`escHtml()`、`exerciseIdToKey()` 等 |
| AI 分析 | 2730-3020 | `AI_PROVIDERS` 配置、`callAI()`、`assembleDailyContext()`、`triggerAIAnalysis()` |
| 今日视图 | 3020-3380 | `renderToday()`（含习惯打卡内嵌 + AI 分析区域） |
| 周计划视图 | 3450-3520 | `renderSchedule()` |
| 微习惯视图 | 3520-3610 | `renderHabits()` |
| 体测视图 | 3630-3720 | `renderMetrics()` |
| 分析视图 | 3720-3850 | `renderAnalysis()`（统计汇总） |
| 设置视图 | 3850-3980 | `renderSettings()`（训练日期、AI 配置、导出导入） |
| 数据导出/导入 | 4350-4720 | `exportJSON()`、`importData()`、`generateAIReport()` |
| 初始化 | 4850-4900 | 自执行启动函数，数据迁移、SW 注册 |

## 数据存储

### localStorage 主存储（`LS_STORES`）

| Store | keyPath | 用途 |
|-------|---------|------|
| `workoutLogs` | `id`(自增) | 训练完成记录 `{id, date, exerciseId, completed, completedAt}` |
| `exerciseNotes` | `id`(自增) | 动作评论/笔记 `{id, exerciseId, exerciseKey, text, createdAt}` |
| `dailyHabits` | `date` | 每日习惯打卡 `{date, habits: {}, counters: {}}` |
| `bodyMetrics` | `id`(自增) | 体测数据 `{id, metricId, date, value}` |
| `settings` | `key` | 设置项 `{key, value}` |
| `aiAnalysis` | `date` | AI 分析结果 `{date, content, generatedAt, model, provider}` |

### IndexedDB（`PostureRecoveryApp`, DB_VERSION=2）

与 localStorage 同构，额外包含：
- `media` store：照片/视频 Blob，通过 `noteId` 关联到 exerciseNotes

### 关键 Settings 键

- `startDate`: 训练开始日期（Week 3 周一），用于计算当前周次
- `aiProvider`: AI 接入商 ID（`claude`/`gemini`/`qwen`/`deepseek`）
- `aiApiKey`: AI API Key
- `aiModel`: 自定义模型名（可选，留空用默认）

## AI 分析功能

### 多厂商支持（`AI_PROVIDERS`）

| ID | 厂商 | 默认模型 | API 格式 |
|----|------|----------|----------|
| `claude` | Anthropic | `claude-sonnet-4-6` | 自有 Messages API |
| `gemini` | Google | `gemini-2.5-flash` | Gemini API (SSE) |
| `qwen` | 阿里云 | `qwen-plus` | OpenAI 兼容 |
| `deepseek` | DeepSeek | `deepseek-chat` | OpenAI 兼容 |

### 数据流

```
用户点击"生成 AI 分析" → triggerAIAnalysis(dateStr)
  → assembleDailyContext(dateStr)  // 组装当天+7天训练数据
  → callAI(systemPrompt, context)  // 流式调用选定的 AI 厂商
  → dbPut('aiAnalysis', record)    // 保存到本地
  → 渲染到今日视图卡片中
```

### System Prompt 原则

- 角色：严谨的运动康复顾问
- 客观真实 > 鼓励，不淡化问题
- 可要求：拍视频确认动作、暂停训练、降重量
- 数据不足时说"无法判断"
- 200-400 字，简体中文

## 训练计划结构

```javascript
PLAN_DATA = {
  morningTemplate: { exercises: [...] },  // 晨间重置（每天）
  warmupTemplate: { exercises: [...] }    // 训练前激活（训练日）
}

WEEKS = [
  {
    weekNum: 3,
    phase: 'Phase 0 - 基础激活期',
    note: '...',
    days: [
      { dayName: '周一', dayType: 'training', title: '...', groups: [...] },
      { dayName: '周日', dayType: 'rest', title: '...', description: '...' }
    ]
  },
  // ... Week 3-18
]
```

**4 个阶段**:
- Phase 0 (Week 3-6): 基础激活期
- Phase 1 (Week 7-10): 对称巩固期
- Phase 2 (Week 11-14): 渐进期
- Phase 3 (Week 15-18): 目标期

**修改训练计划**: 只需修改 `WEEKS` 数组和 `PLAN_DATA` 中的数据，其他所有功能（今日视图、AI 分析、进度统计）会自动适配。

## 习惯打卡

8 个勾选项 + 2 个计数项，定义在 `HABITS` 常量中。

**双入口**: 今日视图底部（内嵌）+ 独立"微习惯"Tab
**自动联动**: 晨间重置动作全部完成时，自动勾选 `h-morning` 习惯

## 开发注意事项

1. **修改后验证**: `node -e "..."` 提取 `<script>` 内容做语法检查
2. **版本号**: 采用语义化三段式 `major.minor.patch`（如 `v1.0.1`）——第 1 位仅在超级大升级时 +1，第 2 位常规功能升级，第 3 位 bug 修复。需同时更新三处：设置页底部文本、`assembleSyncPayload()` 与 `exportJSON()` 中的 `appVersion`
3. **新增 Store**: 需改 4 处：`LS_STORES` 数组、`DB_VERSION` + `onupgradeneeded`、`_lsPut/_lsGet/_lsDelete` 的 keyField 条件、`clearAllData` 的 stores 列表
4. **导出兼容**: 新增数据表时，需同步更新 `exportJSON()`、`importData()`、`previewImport()`、`debugStorageStatus()`
5. **推送**: `git push origin main`，用户通过 GitHub Pages 或本地文件访问
6. **CSS 变量**: `--bg-0`~`--bg-3`(背景), `--text-0`~`--text-3`(文字), `--accent`(金色), `--good`(绿), `--warn`(橙), `--bad`(红)
