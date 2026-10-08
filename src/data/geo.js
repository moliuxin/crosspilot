// GEO（Generative Engine Optimization）数据层
// 设计原则（参考瑞诺国际的专业服务包装逻辑）：
//   商家看到的是「AI 是否容易理解我的企业 / 哪些产品没进 AI 知识结构 / 缺哪些 FAQ /
//   品牌实体是否清晰 / 哪些页面值得优先优化 / 优化前后发生了什么变化」。
//   技术层（Schema / Entity / llms.txt / 内链 / 语义）隐藏处理，只在高级详情里出现。

// 1) AI 搜索可见性概览：商家最容易理解的入口指标
export const geoVisibility = {
  score: 61,
  level: '待提升',
  summary: '你的网站在 AI 搜索中「能被理解」，但「被引用」还不够。',
  stats: [
    { key: 'ai_citation', label: 'AI 平台引用次数', value: '42', delta: '+9', unit: '次/月' },
    { key: 'entity_clarity', label: '品牌实体清晰度', value: '中', delta: '', unit: '' },
    { key: 'covered_products', label: '已进入 AI 知识结构的产品', value: '6 / 12', delta: '', unit: '' },
    { key: 'missing_faq', label: '缺失的采购 FAQ', value: '18', delta: '', unit: '条' },
  ],
  // 商家视角的一句话解释
  meanings: [
    { q: 'AI 平台是否容易理解我的企业？', a: '部分可以。企业定位与主营品类清晰，但缺少统一的实体描述。', state: 'warn' },
    { q: '哪些产品没有进入 AI 知识结构？', a: '6 个产品的参数与用途未被结构化，AI 难以引用。', state: 'bad' },
    { q: '哪些 FAQ 缺失？', a: '缺 18 条采购向 FAQ（交付、认证、定制、售后等）。', state: 'bad' },
    { q: '品牌 / 产品实体是否清晰？', a: '品牌名与产品名在页面中表述不一致，影响实体归并。', state: 'warn' },
    { q: '哪些页面值得优先优化？', a: '3 个核心产品页 + 1 个应用场景页。', state: 'info' },
    { q: '优化前后发生了什么变化？', a: '上次优化后 AI 引用 +9 次/月，2 个产品进入引用池。', state: 'good' },
  ],
}

// 2) 诊断问题项 → 推荐动作（商家可读）
export const geoIssues = [
  {
    id: 'geo_01',
    title: 'AI 难以确认「你是做什么的」',
    why: '企业描述分散在多个页面，AI 无法形成统一认识。',
    impact: 'high',
    action: '统一企业实体描述',
    effect: '让 AI 在所有页面读到一致的企业定义',
    tasks: 1,
  },
  {
    id: 'geo_02',
    title: '6 个产品的技术参数未被 AI 读取',
    why: '参数以图片或自由文本呈现，缺少机器可读结构。',
    impact: 'high',
    action: '结构化产品参数',
    effect: '让 AI 能直接引用你的规格与用途',
    tasks: 6,
  },
  {
    id: 'geo_03',
    title: '缺少采购决策所需的 FAQ',
    why: 'AI 回答采购问题时找不到你的官方口径。',
    impact: 'high',
    action: '补全采购 FAQ',
    effect: '抢在 AI 回答中给出你的标准答案',
    tasks: 18,
  },
  {
    id: 'geo_04',
    title: '品牌与产品名称表述不一致',
    why: '同一产品在不同页面用了不同叫法，实体无法归并。',
    impact: 'mid',
    action: '统一命名规范',
    effect: '提高品牌实体识别准确度',
    tasks: 4,
  },
  {
    id: 'geo_05',
    title: '应用场景页缺少语义关联',
    why: 'AI 无法将你的产品与具体应用行业建立联系。',
    impact: 'mid',
    action: '补全场景语义关联',
    effect: '在行业类提问中获得曝光',
    tasks: 3,
  },
]

// 3) 优化任务（可执行清单）
export const geoTasks = [
  { id: 't1', group: '企业实体', title: '统一企业实体描述（About / 首页 / 页脚）', done: false, impact: 'high' },
  { id: 't2', group: '产品结构', title: '为 6 个产品补全机器可读参数', done: false, impact: 'high' },
  { id: 't3', group: '采购 FAQ', title: '补全 18 条采购向 FAQ', done: false, impact: 'high' },
  { id: 't4', group: '命名规范', title: '统一 4 处品牌 / 产品命名', done: false, impact: 'mid' },
  { id: 't5', group: '场景关联', title: '为 3 个应用场景页补语义关联', done: false, impact: 'mid' },
  { id: 't6', group: '内容覆盖', title: '为 2 个高价值问题补充专题内容', done: true, impact: 'mid' },
  { id: 't7', group: '抓取入口', title: '配置 AI 抓取说明入口', done: true, impact: 'low' },
]

// 4) 优化前后变化
export const geoCompare = {
  before: { citation: 28, covered: 2, faq: 4, entityClarity: '低' },
  after: { citation: 57, covered: 8, faq: 22, entityClarity: '高' },
  window: '近 90 天',
  items: [
    { label: 'AI 平台引用次数', before: '28 次/月', after: '57 次/月', delta: '+104%' },
    { label: '进入知识结构的产品', before: '2 个', after: '8 个', delta: '+6' },
    { label: '可供 AI 引用的 FAQ', before: '4 条', after: '22 条', delta: '+18' },
    { label: '品牌实体清晰度', before: '低', after: '高', delta: '提升' },
  ],
}

// 5) 持续监测
export const geoMonitor = {
  updatedAt: '今天 09:20',
  frequency: '每周自动监测',
  trend: [
    { week: 'W1', value: 34 },
    { week: 'W2', value: 38 },
    { week: 'W3', value: 41 },
    { week: 'W4', value: 45 },
    { week: 'W5', value: 49 },
    { week: 'W6', value: 54 },
    { week: 'W7', value: 57 },
  ],
  alerts: [
    { level: 'info', text: '3 个新产品上线，等待进入 AI 知识结构' },
    { level: 'warn', text: '2 个页面的 FAQ 被竞品覆盖，建议更新口径' },
  ],
}

// 6) 技术层：默认隐藏，仅在「高级技术详情」展开
export const geoTechLayer = [
  { key: 'Schema', desc: 'Organization / Product / FAQPage 结构化数据' },
  { key: 'Entity', desc: '品牌与产品实体定义与归并' },
  { key: 'llms.txt', desc: '面向 AI 抓取的内容说明入口' },
  { key: 'Internal Link', desc: '页面语义关联与内链图谱' },
  { key: 'Semantics', desc: '页面语义完整度与主题覆盖' },
  { key: 'Coverage', desc: '内容覆盖度与问题域广度' },
]

// GEO 作为专业付费服务的说明
export const geoService = {
  price: 12800,
  unit: '年',
  note: '含诊断、优化执行、持续监测与季度复盘',
  includes: [
    'AI 可见性诊断报告（含竞品对比）',
    '产品结构 / FAQ / 实体描述优化执行',
    'AI 抓取入口与语义结构配置',
    '每周自动监测 + 异常提醒',
    '季度效果复盘（优化前后对比）',
  ],
}
