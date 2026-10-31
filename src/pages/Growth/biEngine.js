/**
 * 商机 BI 分析引擎（纯函数，与后端 services/wordstat.py 规则镜像）。
 * 零 LLM：俄语标记词意图分层 + 词形族聚合 + 机会象限，全部确定性规则。
 */

// ── 俄语采购意图标记词（RU-SEO 标准词表）─────────────────────────
const TX = [
  'купить', 'куплю', 'купил', 'купит', 'купите', 'цена', 'цены', 'цене', 'стоимость',
  'сколько стоит', 'оптом', 'поставщик', 'поставщики', 'поставщика', 'производитель',
  'производители', 'производителя', 'заказать', 'заказ', 'доставка',
  'с доставкой', 'продажа', 'продам', 'прайс', 'где купить', 'в наличии',
  'недорого', 'дешево', 'со скидкой', 'акци', 'оплата', 'рассрочка',
]
const CM = [
  'лучший', 'лучшая', 'лучшие', 'топ ', 'топ-', 'рейтинг', 'сравнить',
  'сравнение', 'какой ', 'какую ', 'выбрать', 'выбор', 'отзывы', 'обзор',
  ' vs ', 'аналог', 'официальный сайт', 'каталог', 'фото', 'характеристики',
]
const IN = [
  'как ', 'что такое', 'своими руками', 'схема', 'чертеж', 'чертёж',
  'инструкция', 'принцип работы', 'виды', 'устройство', 'почему',
  'руководство', 'способ', 'пошагово', 'пример',
]

export const INTENT_META = {
  transactional: { label: '交易', score: 1.0, color: '#4ecca3', desc: '带 купить/цена/оптом 等采购动作词' },
  commercial: { label: '商业比较', score: 0.55, color: '#fbbf24', desc: '对比/评测/选型阶段' },
  brand: { label: '品牌/型号', score: 0.5, color: '#c084fc', desc: '含型号数字，采购后期' },
  general: { label: '通用', score: 0.35, color: '#64748b', desc: '品类泛词，需内容承接' },
  informational: { label: '信息', score: 0.15, color: '#60a5fa', desc: '科普/原理，低采购意图' },
}

/** 规则分类一个关键词的采购意图。 */
export function classifyIntent(kw) {
  const low = ' ' + String(kw).toLowerCase() + ' '
  for (const m of TX) if (low.includes(m)) return 'transactional'
  for (const m of CM) if (low.includes(m)) return 'commercial'
  for (const m of IN) if (low.includes(m)) return 'informational'
  if (/[0-9a-z]/.test(String(kw).toLowerCase())) return 'brand'
  return 'general'
}

// ── 俄语词形族（屈折后缀剥离，首词词干为族键）─────────────────────
const SUF = [
  'ами', 'ями', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
  'ой', 'ей', 'ый', 'ий', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие',
  'ов', 'ев', 'ам', 'ям', 'ах', 'ях', 'у', 'ю', 'а', 'я', 'ы', 'и', 'е', 'ь',
]
function stem(word) {
  let w = word.toLowerCase()
  for (const s of SUF) {
    if (w.endsWith(s) && w.length - s.length >= 4) { w = w.slice(0, -s.length); break }
  }
  return w
}
export function familyOf(kw) {
  const first = String(kw).trim().split(/[\s/]+/)[0]
  return first ? stem(first).slice(0, 8) : '—'
}

// ── 产品品类规则（按数据集；导入数据集自动按词形族聚类）──────────
// 顺序即优先级：首个命中的标记词决定品类。
export const CATEGORY_RULES = {
  robot: [
    { name: '机械臂 Manipulator', marks: ['манипулятор'] },
    { name: '焊接机器人', marks: ['сварочн', 'сварки', 'сварка'] },
    { name: '协作机器人', marks: ['коллаборативн', 'cobot'] },
    { name: '工业机器人', marks: ['промышленн'] },
    { name: '码垛/物流机器人', marks: ['паллет', 'pallet', 'упаков'] },
    { name: '其他', marks: [] },
  ],
  industrial: [
    { name: '工业泵', marks: ['насос'] },
    { name: '压缩机', marks: ['компрессор'] },
    { name: '真空设备', marks: ['вакуумн'] },
    { name: '其他', marks: [] },
  ],
  building: [
    { name: '瓷砖', marks: ['плитк'] },
    { name: '外墙板/挂板', marks: ['сайдинг'] },
    { name: 'SPC 地板', marks: ['пол'] },
    { name: '大理石/石材', marks: ['мрамор'] },
    { name: '其他', marks: [] },
  ],
}

/** 品类分类器工厂：预置数据集用规则，导入数据集退化为词形族聚类。 */
export function makeCategorizer(industryKey, isImported) {
  if (isImported) return (kw, k) => k.family || familyOf(kw)
  const rules = CATEGORY_RULES[industryKey] || []
  return (kw) => {
    const low = ' ' + String(kw).toLowerCase() + ' '
    for (const r of rules) if (r.marks.some((m) => low.includes(m))) return r.name
    return '其他'
  }
}

// ── 产品价值评分（透明三因子：量级40 + 采购意图35 + 竞争反向25）──
export function valueScore(vol, maxVol, intentScore, comp) {
  const normVol = maxVol ? Math.sqrt(vol / maxVol) : 0          // sqrt 压头部优势
  const compEase = 1 - (comp ?? 50) / 100
  return Math.round(40 * normVol + 35 * intentScore + 25 * compEase)
}
export function quadrantOf(comp, vol, volMid) {
  const highVol = vol >= volMid
  const lowComp = comp < 45
  if (highVol && lowComp) return 'blue'    // 蓝海机会 · Quick Win
  if (highVol && !lowComp) return 'star'   // 明星词 · 硬仗
  if (!highVol && lowComp) return 'tail'   // 长尾 · 低成本试验
  return 'red'                             // 红海 · 回避
}
export const QUADRANT_META = {
  blue: { label: '蓝海机会 · 快赢', color: 'rgba(78, 204, 163, 0.07)', border: '#4ecca3' },
  star: { label: '明星词 · 硬仗', color: 'rgba(251, 191, 36, 0.05)', border: '#fbbf24' },
  tail: { label: '长尾 · 低成本试验', color: 'rgba(0, 212, 255, 0.04)', border: '#00d4ff' },
  red: { label: '红海 · 建议回避', color: 'rgba(255, 107, 107, 0.05)', border: '#ff6b6b' },
}

/** 给关键词数组补齐 intent/family/quadrant/value 字段（不修改原对象）。 */
export function enrichKeywords(keywords) {
  const vols = keywords.map((k) => k.vol).sort((a, b) => b - a)
  const volMid = vols.length ? vols[Math.floor(vols.length / 2)] : 0
  const maxVol = vols[0] || 0
  const withMeta = keywords.map((k) => {
    const intent = k.intent || classifyIntent(k.kw)
    const intentScore = INTENT_META[intent].score
    return {
      ...k,
      intent,
      intentLabel: INTENT_META[intent].label,
      intentScore,
      intentColor: INTENT_META[intent].color,
      family: k.family || familyOf(k.kw),
      quadrant: quadrantOf(k.comp ?? 50, k.vol, volMid),
      value: valueScore(k.vol, maxVol, intentScore, k.comp ?? 50),
    }
  })
  const totalVol = withMeta.reduce((s, k) => s + k.vol, 0)
  const families = {}
  withMeta.forEach((k) => { families[k.family] = (families[k.family] || 0) + k.vol })
  const metrics = {
    totalVol,
    volMid,
    maxVol: vols[0] || 0,
    avgComp: withMeta.length ? Math.round(withMeta.reduce((s, k) => s + (k.comp ?? 50), 0) / withMeta.length) : 0,
    blueOcean: withMeta.filter((k) => (k.comp ?? 50) < 40).length,
    // 采购意图浓度：按意图分加权的搜索量占比 —— 「搜索里的真买家浓度」
    concentration: totalVol ? Math.round((withMeta.reduce((s, k) => s + k.vol * k.intentScore, 0) / totalVol) * 1000) / 10 : 0,
    familyCount: Object.keys(families).length,
    topFamily: Object.entries(families).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    top1Share: totalVol ? Math.round((vols[0] / totalVol) * 1000) / 10 : 0,
    // 价值分均值 & 最高价值词
    avgValue: withMeta.length ? Math.round(withMeta.reduce((s, k) => s + k.value, 0) / withMeta.length) : 0,
  }
  return { keywords: withMeta, metrics, families }
}

/** 品类汇总分析：每品类的词数/搜索量/份额/意图浓度/平均竞争度/蓝海词数 + 行动建议 + 词形族分组。 */
export function analyzeCategories(keywords, categorize) {
  const map = {}
  keywords.forEach((k) => {
    const cat = categorize(k.kw, k)
    if (!map[cat]) map[cat] = { name: cat, count: 0, vol: 0, intentVol: 0, compSum: 0, blue: 0, topKw: null, members: [], fams: {} }
    const c = map[cat]
    c.count += 1
    c.vol += k.vol
    c.intentVol += k.vol * k.intentScore
    c.compSum += k.comp ?? 50
    if ((k.comp ?? 50) < 40) c.blue += 1
    if (!c.topKw || k.vol > c.topKw.vol) c.topKw = k
    c.members.push(k.kw)
    const fam = k.family || familyOf(k.kw)
    if (!c.fams[fam]) c.fams[fam] = { name: fam, vol: 0, words: [] }
    c.fams[fam].vol += k.vol
    c.fams[fam].words.push(k)
  })
  const totalVol = keywords.reduce((s, k) => s + k.vol, 0) || 1
  return Object.values(map)
    .map((c) => {
      const concentration = Math.round((c.intentVol / c.vol) * 1000) / 10
      const avgComp = Math.round(c.compSum / c.count)
      const advice = concentration >= 45 && avgComp < 60
        ? { text: '优先切入', color: '#4ecca3' }
        : avgComp >= 60
          ? { text: '内容攻坚', color: '#fbbf24' }
          : concentration < 35
            ? { text: '承接优化', color: '#60a5fa' }
            : { text: '观察', color: '#7c8db5' }
      const famGroups = Object.values(c.fams)
        .sort((a, b) => b.vol - a.vol)
        .map((f) => ({ name: f.name, vol: f.vol, count: f.words.length, words: [...f.words].sort((a, b) => b.vol - a.vol) }))
      return { ...c, famGroups, share: Math.round((c.vol / totalVol) * 1000) / 10, concentration, avgComp, advice }
    })
    .sort((a, b) => b.vol - a.vol)
}
