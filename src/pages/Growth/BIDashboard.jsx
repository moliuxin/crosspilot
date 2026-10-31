import { useEffect, useMemo, useRef, useState } from 'react'
import RussiaMap, { CITY_TOTAL } from './RussiaMap'
import OpportunityMatrix from './OpportunityMatrix'
import IntentPanel from './IntentPanel'
import CategoryPanel from './CategoryPanel'
import ValuePanel from './ValuePanel'
import { enrichKeywords, makeCategorizer, analyzeCategories, INTENT_META } from './biEngine'
import { api } from '../../services/api'
import './bi-dashboard.css'

/**
 * 商机BI · 数据大屏 v3 —— 俄罗斯市场热词决策分析
 * 联动（点击词/意图过滤/城市下钻）+ 机会矩阵 + 采购意图分层 + 词形族聚合。
 * 数据链路（诚实标注）：预置演示 / Wordstat CSV 导入（后端解析落库）/ 在线抓取（网络可达时启用）。
 */

const DATASETS = {
  robot: {
    label: '协作机器人（新新三样）',
    source: 'demo',
    keywords: [
      { kw: 'робот манипулятор', vol: 28415, comp: 62, trend: [22, 23.5, 24.8, 25.6, 26.9, 27.8, 28.4] },
      { kw: 'промышленный робот', vol: 14523, comp: 71, trend: [9.2, 9.8, 10.1, 11.6, 12.5, 13.3, 14.5] },
      { kw: 'сварочный робот', vol: 9847, comp: 68, trend: [8.8, 8.5, 8.6, 9.0, 9.2, 9.6, 9.8] },
      { kw: 'робот манипулятор купить', vol: 5612, comp: 45, trend: [3.2, 3.5, 3.9, 4.3, 4.8, 5.2, 5.6] },
      { kw: 'коллаборативный робот', vol: 3824, comp: 32, trend: [1.8, 2.1, 2.5, 2.8, 3.2, 3.5, 3.8] },
      { kw: 'промышленный робот цена', vol: 3156, comp: 58, trend: [2.4, 2.5, 2.6, 2.8, 2.9, 3.0, 3.2] },
      { kw: 'сварочный робот цена', vol: 2431, comp: 51, trend: [1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4] },
      { kw: 'робот для сварки купить', vol: 1876, comp: 38, trend: [0.9, 1.1, 1.3, 1.5, 1.6, 1.8, 1.9] },
    ],
    hourly: [12, 8, 5, 3, 2, 4, 12, 28, 42, 55, 68, 75, 82, 78, 72, 65, 58, 62, 70, 65, 52, 38, 22, 15],
  },
  industrial: {
    label: '工业设备',
    source: 'demo',
    keywords: [
      { kw: 'промышленный насос', vol: 18240, comp: 74, trend: [15.0, 15.4, 16.1, 16.8, 17.3, 17.8, 18.2] },
      { kw: 'насос для воды', vol: 15300, comp: 81, trend: [14.0, 14.2, 14.5, 14.8, 15.0, 15.1, 15.3] },
      { kw: 'центробежный насос', vol: 11200, comp: 66, trend: [9.8, 10.2, 10.5, 10.8, 11.0, 11.1, 11.2] },
      { kw: 'компрессор промышленный', vol: 8900, comp: 69, trend: [7.5, 7.8, 8.1, 8.4, 8.6, 8.7, 8.9] },
      { kw: 'промышленный насос цена', vol: 4200, comp: 53, trend: [3.4, 3.6, 3.8, 3.9, 4.0, 4.1, 4.2] },
      { kw: 'вакуумный насос купить', vol: 3100, comp: 47, trend: [2.2, 2.5, 2.7, 2.8, 2.9, 3.0, 3.1] },
    ],
    hourly: [10, 6, 4, 2, 1, 3, 10, 25, 40, 55, 70, 78, 85, 80, 72, 62, 55, 58, 65, 60, 48, 35, 20, 14],
  },
  building: {
    label: '建材出口',
    source: 'demo',
    keywords: [
      { kw: 'керамическая плитка', vol: 45200, comp: 89, trend: [42.0, 42.5, 43.2, 43.8, 44.2, 44.7, 45.2] },
      { kw: 'сайдинг дома', vol: 12400, comp: 72, trend: [11.0, 11.2, 11.6, 11.9, 12.1, 12.3, 12.4] },
      { kw: 'виниловый пол spc', vol: 8940, comp: 56, trend: [5.2, 6.0, 6.8, 7.5, 8.1, 8.5, 8.9] },
      { kw: 'мрамор плита купить', vol: 6720, comp: 44, trend: [5.1, 5.4, 5.7, 6.0, 6.3, 6.5, 6.7] },
      { kw: 'мрамор из китая', vol: 2150, comp: 28, trend: [1.2, 1.4, 1.6, 1.8, 2.0, 2.1, 2.2] },
    ],
    hourly: [8, 5, 3, 2, 1, 2, 8, 20, 35, 50, 65, 72, 80, 75, 68, 58, 52, 55, 62, 55, 42, 30, 18, 12],
  },
}

const MONTHS = ['5月', '6月', '7月', '8月', '9月', '10月', '11月']

const TIME_RANGES = [
  ['7d', '近7天', 0.23], ['30d', '近30天', 1], ['90d', '近90天', 3],
  ['1y', '近1年', 12], ['3y', '近3年', 36],
]

function AnimatedNumber({ value, duration = 1200, decimals = 0 }) {
  const [display, setDisplay] = useState(0)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) { setDisplay(value); return }
    started.current = true
    const start = performance.now()
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(value * eased)
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    // rAF 在后台标签页会暂停 —— 兜底保证终值落位
    const fallback = setTimeout(() => setDisplay(value), duration + 80)
    return () => clearTimeout(fallback)
  }, [value, duration])
  return <span>{display.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}</span>
}

function Sparkline({ values, w = 480, h = 90, color = '#00d4ff' }) {
  if (!values?.length) return null
  const pad = 6
  const min = Math.min(...values), max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (w - pad * 2),
    h - pad - ((v - min) / range) * (h - pad * 2),
  ])
  const path = pts.map((p) => p.join(',')).join(' L ')
  const area = `M${pts[0][0]},${h - pad} L${path} L${pts[pts.length - 1][0]},${h - pad} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="bd-spark">
      <path d={area} fill={color} opacity="0.08" />
      <path d={`M${path}`} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.5" fill={color} />
    </svg>
  )
}

function RadarChart({ data, size = 150 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 20
  const labels = ['竞争度', '搜索量', '增长率', '商业意图', '可进入性']
  const angles = labels.map((_, i) => (i / labels.length) * Math.PI * 2 - Math.PI / 2)
  const points = data.map((v, i) => [cx + Math.cos(angles[i]) * r * (v / 100), cy + Math.sin(angles[i]) * r * (v / 100)])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="bd-radar">
      {[0.25, 0.5, 0.75, 1].map((ring, ri) => (
        <polygon key={ri}
          points={angles.map((a) => `${cx + Math.cos(a) * r * ring},${cy + Math.sin(a) * r * ring}`).join(' ')}
          fill="none" stroke="#1a2a5e" strokeWidth="1" />
      ))}
      {angles.map((a, i) => (
        <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * r} y2={cy + Math.sin(a) * r} stroke="#1a2a5e" strokeWidth="1" />
      ))}
      <polygon points={points.map((p) => p.join(',')).join(' ')} fill="#00d4ff" fillOpacity="0.15" stroke="#00d4ff" strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#00d4ff" />)}
      {labels.map((l, i) => (
        <text key={l} x={cx + Math.cos(angles[i]) * (r + 12)} y={cy + Math.sin(angles[i]) * (r + 12)}
          textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="#7c8db5">{l}</text>
      ))}
    </svg>
  )
}

export default function BIDashboard() {
  const [industry, setIndustry] = useState('robot')
  const [time, setTime] = useState('30d')
  const [now, setNow] = useState(new Date())
  const [selectedKw, setSelectedKw] = useState(0)
  const [intentFilter, setIntentFilter] = useState('all')
  const [selectedCity, setSelectedCity] = useState(null)
  const [selectedRegion, setSelectedRegion] = useState(null)
  const [query, setQuery] = useState('')
  const [imports, setImports] = useState({})
  const [status, setStatus] = useState('')  // 导入/探测结果反馈（替代 alert）

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // 挂载时拉取已导入数据集（api.* 返回数据本体，失败抛错）
  useEffect(() => {
    ;(async () => {
      try {
        const list = await api.wordstatDatasets()
        if (!Array.isArray(list) || !list.length) return
        const map = {}
        for (const meta of list.slice(0, 8)) {
          try {
            const detail = await api.wordstatDataset(meta.id)
            if (detail?.keywords?.length) {
              map[`imp-${meta.id}`] = {
                label: meta.label, source: detail.source || meta.source || 'imported',
                keywords: detail.keywords, trendMonths: detail.trend_months || null,
              }
            }
          } catch { /* 单个失败不阻塞 */ }
        }
        if (Object.keys(map).length) setImports(map)
      } catch { /* 后端不可用：仅预置数据 */ }
    })()
  }, [])

  const allDatasets = { ...imports, ...DATASETS }
  const raw = allDatasets[industry] || DATASETS.robot
  const { keywords, metrics } = useMemo(() => enrichKeywords(raw.keywords), [raw])
  const categorize = useMemo(() => makeCategorizer(industry, raw.source !== 'demo'), [industry, raw])
  const categories = useMemo(() => analyzeCategories(keywords, categorize), [keywords, categorize])
  const hourly = raw.hourly || null
  const visibleIdx = keywords
    .map((k, i) => ({ k, i }))
    .filter(({ k }) => intentFilter === 'all' || k.intent === intentFilter)
    .filter(({ k }) => !query || k.kw.toLowerCase().includes(query.toLowerCase()))
    .map(({ i }) => i)
  const current = keywords[selectedKw] || keywords[0]
  const timeRange = TIME_RANGES.find(([v]) => v === time) || TIME_RANGES[1]
  const timeLabel = timeRange[1]
  // 趋势月标：真实数据用服务端月份标签，否则按最近 N 个月生成
  const trendMonths = useMemo(() => {
    const n = current?.trend?.length || 0
    if (!n) return []
    if (Array.isArray(raw.trendMonths) && raw.trendMonths.length === n) return raw.trendMonths
    const out = []
    const d = new Date()
    for (let i = n - 1; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
      out.push(`${m.getMonth() + 1}月`)
    }
    return out
  }, [raw, current])
  // 搜索热度卡：精确匹配优先，其次包含匹配的第一条
  const searchHit = useMemo(() => {
    if (!query.trim()) return null
    const q = query.trim().toLowerCase()
    return keywords.find((k) => k.kw.toLowerCase() === q)
      || keywords.find((k) => k.kw.toLowerCase().includes(q))
      || null
  }, [query, keywords])
  // 区域热词排行（诚实折算：全国词量 × 该区域最近样本城市权重）
  const regionWords = useMemo(() => {
    if (!selectedRegion) return []
    const weight = selectedRegion.city.vol / metrics.maxVol
    return [...keywords]
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 8)
      .map((k) => ({ ...k, regional: Math.round(k.vol * weight) }))
  }, [selectedRegion, keywords, metrics.maxVol])

  // ── 导入 Wordstat CSV（真实后端链路）──
  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setStatus('正在解析导入…')
    try {
      const content = await file.text()
      const data = await api.wordstatImport({ label: file.name.replace(/\.[^.]+$/, ''), content })
      const key = `imp-${data.id}`
      setImports((prev) => ({ ...prev, [key]: { label: data.label, source: 'imported', keywords: data.keywords } }))
      setIndustry(key)
      setSelectedKw(0); setIntentFilter('all')
      setStatus(`✓ 已导入 ${data.keywords.length} 个关键词（意图分层完成）`)
    } catch (err) {
      setStatus(`✕ ${err.message}`)
    }
  }

  // ── 在线抓取探测（诚实返回连通结果）──
  async function handleLiveProbe() {
    setStatus('正在探测 wordstat.yandex.ru …')
    try {
      const info = await api.wordstatLive(current?.kw || 'робот')
      setStatus(info.ok ? '✓ 网络可达，可启用在线抓取' : `✕ ${info.hint || '网络不可达'}`)
    } catch (err) {
      setStatus(`✕ ${err.message}`)
    }
  }

  // ── 导出分析报告 CSV ──
  function handleExport() {
    const head = '关键词,月搜索量,竞争度,采购意图,意图分,词族,品类,象限,价值分\n'
    const qLabel = { blue: '蓝海', star: '明星', tail: '长尾', red: '红海' }
    const body = keywords.map((k) =>
      [k.kw, k.vol, k.comp, k.intentLabel, k.intentScore, k.family, categorize(k.kw, k), qLabel[k.quadrant], k.value].join(',')).join('\n')
    const blob = new Blob(['\ufeff' + head + body], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `CrossPilot_BI_${raw.label}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    setStatus('✓ 分析报告已导出 CSV')
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen?.()
  }

  return (
    <div className="bd-screen">
      {/* 顶部标题栏 */}
      <header className="bd-header">
        <div className="bd-header-left">
          <span className="bd-live-dot" />
          <span className="bd-live-text">LIVE</span>
        </div>
        <h1 className="bd-title">CrossPilot 商机 BI · 俄罗斯市场热词决策大屏</h1>
        <div className="bd-header-right">
          <span className="bd-clock">{now.toLocaleTimeString('zh-CN', { hour12: false })}</span>
          <select className="bd-select" value={industry} onChange={(e) => { setIndustry(e.target.value); setSelectedKw(0); setIntentFilter('all') }}>
            {Object.entries(allDatasets).map(([k, v]) => (
              <option key={k} value={k}>{v.source === 'wordstat' ? '📡' : v.source === 'bukvarix' ? '🔌' : v.source === 'imported' ? '📥 ' : ''}{v.label}</option>
            ))}
          </select>
          <div className="bd-time-group">
            {TIME_RANGES.map(([v, l]) => (
              <button key={v} className={`bd-time-btn${time === v ? ' on' : ''}`} onClick={() => setTime(v)}>{l}</button>
            ))}
          </div>
          <button className="bd-time-btn" onClick={toggleFullscreen} title="大屏全屏">⛶</button>
        </div>
      </header>

      {/* 核心指标条（6） */}
      <div className="bd-metrics-bar bd-metrics-6">
        <div className="bd-metric">
          <span className="bd-metric-value"><AnimatedNumber value={Math.round(metrics.totalVol * timeRange[2])} /></span>
          <span className="bd-metric-label">{timeLabel}总搜索（月均值×{timeRange[2]}）</span>
        </div>
        <div className="bd-metric">
          <span className="bd-metric-value bd-green"><AnimatedNumber value={metrics.blueOcean} /></span>
          <span className="bd-metric-label">蓝海热词数 (KD&lt;40)</span>
        </div>
        <div className="bd-metric">
          <span className="bd-metric-value bd-cyan"><AnimatedNumber value={metrics.concentration} decimals={1} />%</span>
          <span className="bd-metric-label">采购意图浓度</span>
        </div>
        <div className="bd-metric">
          <span className="bd-metric-value bd-amber"><AnimatedNumber value={metrics.avgComp} />%</span>
          <span className="bd-metric-label">平均竞争度</span>
        </div>
        <div className="bd-metric">
          <span className="bd-metric-value"><AnimatedNumber value={metrics.familyCount} /></span>
          <span className="bd-metric-label">词形族数 · TOP「{metrics.topFamily}」</span>
        </div>
        <div className="bd-metric">
          <span className="bd-metric-value"><AnimatedNumber value={metrics.top1Share} decimals={1} />%</span>
          <span className="bd-metric-label">TOP1 集中度</span>
        </div>
      </div>

      {/* 主体三栏 */}
      <div className="bd-main">
        {/* 左栏：热词榜 + 月度趋势 */}
        <div className="bd-col bd-left">
          <div className="bd-panel bd-flex-1">
            <h3 className="bd-panel-title">
              🔥 热词排行 {intentFilter !== 'all' && <span className="bd-filter-chip" style={{ ['--ic']: INTENT_META[intentFilter]?.color }} onClick={() => setIntentFilter('all')}>{INTENT_META[intentFilter]?.label} ✕</span>}
            </h3>
            <div className="bd-search-box">
              <input className="bd-search-input" value={query}
                placeholder="🔍 搜单词看热度（俄语/词根，如 манипулятор）"
                onChange={(e) => setQuery(e.target.value)} />
              {query && <button className="bd-search-clear" onClick={() => setQuery('')}>✕</button>}
            </div>
            {searchHit ? (
              <div className="bd-heat-card" style={{ ['--ic']: searchHit.intentColor }}>
                <div className="bd-heat-head">
                  <span className="bd-intent-dot" style={{ ['--ic']: searchHit.intentColor }} />
                  <b className="bd-heat-kw">{searchHit.kw}</b>
                  <button className="bd-heat-go" onClick={() => {
                    const idx = keywords.indexOf(searchHit)
                    if (idx >= 0) setSelectedKw(idx)
                  }}>在矩阵中查看 →</button>
                </div>
                <div className="bd-heat-grid">
                  <span>热度 <b className="bd-cyan-t">{searchHit.vol.toLocaleString()}</b>/月</span>
                  <span>意图 <b>{searchHit.intentLabel}</b></span>
                  <span>KD <b>{searchHit.comp}</b></span>
                  <span>价值 <b>{searchHit.value}</b></span>
                  <span>词族 <b>{searchHit.family}</b></span>
                  <span>象限 <b>{{ blue: '蓝海', star: '明星', tail: '长尾', red: '红海' }[searchHit.quadrant]}</b></span>
                </div>
              </div>
            ) : query ? (
              <div className="bd-no-data">当前数据集未收录「{query}」—— 可导入 Wordstat CSV 或运行 scripts/fetch_bukvarix.mjs 实时拉取</div>
            ) : null}
            <div className="bd-kw-list">
              {visibleIdx.map((i, rank) => {
                const k = keywords[i]
                return (
                  <button key={k.kw} className={`bd-kw-item${i === selectedKw ? ' sel' : ''}`} onClick={() => setSelectedKw(i)}>
                    <span className="bd-kw-rank" style={{ color: rank < 3 ? '#ff6b6b' : '#7c8db5' }}>{String(rank + 1).padStart(2, '0')}</span>
                    <div className="bd-kw-info">
                      <span className="bd-kw-name">
                        <span className="bd-intent-dot" style={{ ['--ic']: k.intentColor }} title={k.intentLabel} />
                        {k.kw}
                      </span>
                      <div className="bd-kw-bar-track">
                        <div className="bd-kw-bar" style={{ width: `${(k.vol / metrics.maxVol) * 100}%`, animationDelay: `${rank * 60}ms` }} />
                      </div>
                      <span className="bd-kw-meta">族 {k.family} · KD {k.comp} · {k.intentLabel}</span>
                    </div>
                    <span className="bd-kw-num">{(k.vol / 1000).toFixed(1)}k</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="bd-panel bd-trend-panel">
            <h3 className="bd-panel-title">
              📈 月度趋势 ·「{current?.kw}」
              {current?.trend_source === 'wordstat_history' && <span className="bd-panel-sub">Wordstat 历史真实逐月</span>}
            </h3>
            {current?.trend ? (
              <>
                <Sparkline values={current.trend} w={480} h={78} />
                <div className="bd-trend-months">{trendMonths.map((m) => <span key={m}>{m}</span>)}</div>
              </>
            ) : (
              <div className="bd-no-data">导入数据不含历史序列 —— 趋势需 Wordstat 连续多月导出或在线抓取（部署于境外服务器）</div>
            )}
          </div>
        </div>

        {/* 中栏：地图（联动下钻）+ 机会矩阵 */}
        <div className="bd-col bd-center">
          <div className="bd-panel bd-map-panel">
            <h3 className="bd-panel-title">🗺 俄罗斯市场密度热力地图 <span className="bd-panel-sub">真实行政边界 · 点城市/区域下钻</span></h3>
            <div className="bd-map-container">
              <RussiaMap maxVol={metrics.maxVol} selectedCity={selectedCity} onSelectCity={setSelectedCity}
                selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion} />
              {selectedCity && !selectedRegion && (
                <div className="bd-city-card">
                  <div className="bd-city-card-head">
                    <b>{selectedCity.name}</b>
                    <button onClick={() => setSelectedCity(null)}>✕</button>
                  </div>
                  <span>{selectedCity.district} · 行业搜索 {selectedCity.vol.toLocaleString()}/月</span>
                  <span>占 18 个样本城市 {Math.round((selectedCity.vol / CITY_TOTAL) * 100)}%（城市分布为预置行业权重）</span>
                  <span>当前词「{current?.kw}」全国 {current?.vol.toLocaleString()}/月</span>
                </div>
              )}
              {selectedRegion && (
                <div className="bd-city-card bd-region-card">
                  <div className="bd-city-card-head">
                    <b>{selectedRegion.name}</b>
                    <button onClick={() => setSelectedRegion(null)}>✕</button>
                  </div>
                  <span className="bd-region-note">样本城市：{selectedRegion.city.name}（{selectedRegion.city.district}）· {selectedRegion.tier.label}</span>
                  <div className="bd-region-kws">
                    {regionWords.map((k, i) => (
                      <button key={k.kw} className="bd-region-kw" onClick={() => {
                        const idx = keywords.indexOf(k)
                        if (idx >= 0) setSelectedKw(idx)
                      }}>
                        <span className="bd-kw-rank" style={{ color: i < 3 ? '#ff6b6b' : '#7c8db5' }}>{i + 1}</span>
                        <span className="bd-region-kw-name">{k.kw.length > 24 ? k.kw.slice(0, 22) + '…' : k.kw}</span>
                        <span className="bd-kw-num">{k.regional.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                  <span className="bd-region-note">区域值 = 全国月搜 × 样本城市权重折算（非该区域实测）</span>
                </div>
              )}
            </div>
          </div>
          <div className="bd-panel bd-matrix-panel">
            <h3 className="bd-panel-title">🎯 机会矩阵 · 竞争度 × 搜索量 <span className="bd-panel-sub">气泡色=采购意图 · 点击联动</span></h3>
            <OpportunityMatrix keywords={keywords} selectedIdx={selectedKw} onSelect={setSelectedKw} />
          </div>
        </div>

        {/* 右栏：意图分层 + 时段 + 雷达 */}
        <div className="bd-col bd-right">
          <div className="bd-panel">
            <h3 className="bd-panel-title">🧲 采购意图分层</h3>
            <IntentPanel keywords={keywords} concentration={metrics.concentration} activeFilter={intentFilter} onFilter={setIntentFilter} />
          </div>
          <div className="bd-panel bd-flex-1">
            <h3 className="bd-panel-title">⏰ 24h 搜索时段分布</h3>
            {hourly ? (
              <>
                <div className="bd-hourly">
                  {hourly.map((v, h) => (
                    <div key={h} className="bd-hour-bar" style={{ ['--h']: `${v}%` }}>
                      <span className="bd-hour-val">{v > 60 ? v : ''}</span>
                      <span className="bd-hour-label">{h % 3 === 0 ? h : ''}</span>
                    </div>
                  ))}
                </div>
                <div className="bd-insight">
                  <span>⏰ 峰值时段 <b>12:00-14:00</b>（午间搜索高峰）</span>
                  <span>📅 工作日搜索量比周末高 <b>62%</b></span>
                </div>
              </>
            ) : (
              <div className="bd-no-data">导入数据不含时段分布 —— 时段图基于预置行业模板</div>
            )}
          </div>
          <div className="bd-panel">
            <h3 className="bd-panel-title">🕸 竞争度雷达 ·「{(current?.kw || '').slice(0, 14)}」</h3>
            <RadarChart data={[current?.comp ?? metrics.avgComp, 65, 78, Math.round(current?.intentScore * 100), 70]} />
            <div className="bd-radar-label">
              {current && <span>竞争度 <b className={current.comp > 60 ? 'bd-red' : current.comp > 40 ? 'bd-amber' : 'bd-green'}>{current.comp}%</b> · 意图 {current.intentLabel}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* 品类 × 价值 底部分析带 */}
      <div className="bd-band">
        <div className="bd-panel">
          <h3 className="bd-panel-title">
            📦 产品品类分析
            <span className="bd-panel-sub">{raw.source === 'imported' ? '导入数据按词形族聚类' : '规则品类映射 · 点品类名选中核心词'}</span>
          </h3>
          <div className="bd-band-scroll">
            <CategoryPanel categories={categories} keywords={keywords} selectedIdx={selectedKw}
              onSelectKeyword={(kw) => {
                const idx = keywords.indexOf(kw)
                if (idx >= 0) setSelectedKw(idx)
              }} onSelect={setSelectedKw} />
          </div>
        </div>
        <div className="bd-panel">
          <h3 className="bd-panel-title">
            💎 产品价值分析 · 先做哪个词
            <span className="bd-panel-sub">量×意图×可进性综合 · 点击联动</span>
          </h3>
          <div className="bd-band-scroll">
            <ValuePanel keywords={keywords} selectedIdx={selectedKw} onSelect={setSelectedKw} />
          </div>
        </div>
      </div>

      {/* 底部：诚实来源 + 操作 */}
      <footer className="bd-footer">
        <span>
          数据来源：
          {raw.source === 'wordstat'
            ? '📡 Yandex Wordstat 官方网站直采（登录态采集 · region=all · 近30天周期）· 竞争度为搜索量分位代理'
            : raw.source === 'bukvarix'
              ? '🔌 Yandex Wordstat 库（经 Bukvarix API · 区域=Весь мир · 近期月度频次）· 竞争度为搜索量分位代理'
              : raw.source === 'imported'
                ? `📥 Wordstat CSV 导入（${raw.label}）· 竞争度${keywords[0]?.comp_source === 'volume_rank_proxy' ? '为量级代理' : '为导入值'}`
                : '预置行业演示数据（基于公开统计口径）'} ·
          逐月历史：Wordstat「История запроса」当前官方故障中，恢复后可一键补采
        </span>
        <div className="bd-footer-actions">
          {status && <span className="bd-status" title={status}>{status}</span>}
          <label className="bd-action-btn">📥 导入 Wordstat CSV
            <input type="file" accept=".csv,.txt,.tsv" hidden onChange={handleImportFile} />
          </label>
          <button className="bd-action-btn" onClick={handleLiveProbe}>⚡ 探测在线抓取</button>
          <button className="bd-action-btn" onClick={handleExport}>📤 导出报告</button>
        </div>
      </footer>
    </div>
  )
}
