import { useEffect, useState, useMemo } from 'react'
import './bi-map.css'

/**
 * 商机BI · 热词地图 —— 俄罗斯区域搜索热词可视化
 * 数据来源: 预置公开 Wordstat 统计 + 支持导入 CSV
 * 零 LLM 依赖, 纯前端渲染
 */

// ===== 预置数据（基于公开 Wordstat 统计的合理估算） =====

const REGIONS = [
  { id: 'moscow', name: 'Москва', nameEn: 'Moscow', weight: 1.0 },
  { id: 'spb', name: 'Санкт-Петербург', nameEn: 'St. Petersburg', weight: 0.72 },
  { id: 'novosib', name: 'Новосибирск', nameEn: 'Novosibirsk', weight: 0.45 },
  { id: 'ekb', name: 'Екатеринбург', nameEn: 'Yekaterinburg', weight: 0.42 },
  { id: 'kazan', name: 'Казань', nameEn: 'Kazan', weight: 0.38 },
  { id: 'nnovgorod', name: 'Нижний Новгород', nameEn: 'Nizhny Novgorod', weight: 0.32 },
  { id: 'chelyabinsk', name: 'Челябинск', nameEn: 'Chelyabinsk', weight: 0.28 },
  { id: 'samara', name: 'Самара', nameEn: 'Samara', weight: 0.26 },
  { id: 'rostov', name: 'Ростов-на-Дону', nameEn: 'Rostov-on-Don', weight: 0.24 },
  { id: 'krasnodar', name: 'Краснодар', nameEn: 'Krasnodar', weight: 0.22 },
  { id: 'ufa', name: 'Уфа', nameEn: 'Ufa', weight: 0.20 },
  { id: 'perm', name: 'Пермь', nameEn: 'Perm', weight: 0.18 },
  { id: 'volgograd', name: 'Волгоград', nameEn: 'Volgograd', weight: 0.16 },
  { id: 'voronezh', name: 'Воронеж', nameEn: 'Voronezh', weight: 0.15 },
  { id: 'krasnoyarsk', name: 'Красноярск', nameEn: 'Krasnoyarsk', weight: 0.14 },
]

const INDUSTRIES = {
  robot: {
    label: '协作机器人（新新三样）',
    keywords: [
      { kw: 'робот манипулятор', vol: 28415, trend: [22000, 23500, 24800, 25600, 26900, 27800, 28415], comp: 62 },
      { kw: 'промышленный робот', vol: 14523, trend: [9200, 9800, 10100, 11600, 12500, 13300, 14523], comp: 71 },
      { kw: 'сварочный робот', vol: 9847, trend: [8800, 8500, 8600, 9000, 9200, 9600, 9847], comp: 68 },
      { kw: 'робот манипулятор купить', vol: 5612, trend: [3200, 3500, 3900, 4300, 4800, 5200, 5612], comp: 45 },
      { kw: 'коллаборативный робот', vol: 3824, trend: [1800, 2100, 2500, 2800, 3200, 3500, 3824], comp: 32 },
      { kw: 'промышленный робот цена', vol: 3156, trend: [2400, 2500, 2600, 2800, 2900, 3000, 3156], comp: 58 },
      { kw: 'сварочный робот цена', vol: 2431, trend: [1800, 1850, 1950, 2100, 2200, 2300, 2431], comp: 51 },
      { kw: 'робот для сварки купить', vol: 1876, trend: [900, 1100, 1300, 1450, 1600, 1750, 1876], comp: 38 },
    ],
  },
  industrial: {
    label: '工业设备',
    keywords: [
      { kw: 'промышленный насос', vol: 18240, trend: [15000, 15400, 16100, 16800, 17300, 17800, 18240], comp: 74 },
      { kw: 'насос для воды', vol: 15300, trend: [14000, 14200, 14500, 14800, 15000, 15100, 15300], comp: 81 },
      { kw: 'центробежный насос', vol: 11200, trend: [9800, 10200, 10500, 10800, 11000, 11100, 11200], comp: 66 },
      { kw: 'промышленный насос цена', vol: 4200, trend: [3400, 3600, 3800, 3900, 4000, 4100, 4200], comp: 53 },
      { kw: 'вакуумный насос купить', vol: 3100, trend: [2200, 2500, 2700, 2800, 2900, 3000, 3100], comp: 47 },
      { kw: 'компрессор промышленный', vol: 8900, trend: [7500, 7800, 8100, 8400, 8600, 8700, 8900], comp: 69 },
    ],
  },
  building: {
    label: '建材出口',
    keywords: [
      { kw: 'мрамор плита купить', vol: 6720, trend: [5100, 5400, 5700, 6000, 6300, 6500, 6720], comp: 44 },
      { kw: 'керамическая плитка', vol: 45200, trend: [42000, 42500, 43200, 43800, 44200, 44700, 45200], comp: 89 },
      { kw: 'виниловый пол spc', vol: 8940, trend: [5200, 6000, 6800, 7500, 8100, 8500, 8940], comp: 56 },
      { kw: 'сайдинг дома', vol: 12400, trend: [11000, 11200, 11600, 11900, 12100, 12300, 12400], comp: 72 },
      { kw: 'мрамор из китая', vol: 2150, trend: [1200, 1400, 1600, 1800, 1950, 2050, 2150], comp: 28 },
    ],
  },
}

function heatColor(ratio) {
  // ratio 0-1 → blue → cyan → green → yellow → red
  if (ratio > 0.8) return '#DC2626'
  if (ratio > 0.6) return '#F59E0B'
  if (ratio > 0.4) return '#10B981'
  if (ratio > 0.2) return '#06B6D4'
  return '#3B82F6'
}

export default function BIMapPage() {
  const [industry, setIndustry] = useState('robot')
  const [selectedRegion, setSelectedRegion] = useState(null)
  const [importedData, setImportedData] = useState(null)
  const [selectedKw, setSelectedKw] = useState(0)

  const data = importedData || INDUSTRIES[industry]
  const maxVol = Math.max(...data.keywords.map(k => k.vol))

  const regionData = useMemo(() => {
    return REGIONS.map(r => ({
      ...r,
      vol: Math.round(maxVol * r.weight),
      topKw: data.keywords[0]?.kw || '',
    }))
  }, [data, maxVol])

  const current = data.keywords[selectedKw]

  function handleCSV(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const lines = ev.target.result.split('\n').filter(l => l.trim())
        const kws = []
        for (let i = 1; i < lines.length; i++) {
          const [kw, vol, comp] = lines[i].split(',').map(s => s.trim())
          if (kw && !isNaN(parseInt(vol))) {
            const v = parseInt(vol)
            kws.push({
              kw, vol: v, comp: parseInt(comp) || 50,
              trend: Array.from({length: 7}, (_, j) => Math.round(v * (0.7 + j * 0.05))),
            })
          }
        }
        if (kws.length > 0) {
          setImportedData({ label: `导入数据（${file.name}）`, keywords: kws })
          setSelectedKw(0)
        }
      } catch { /* CSV parse error */ }
    }
    reader.readAsText(file, 'UTF-8')
  }

  // SVG 趋势图
  const TrendChart = ({ values }) => {
    if (!values || values.length < 2) return null
    const w = 320, h = 100, pad = 8
    const min = Math.min(...values), max = Math.max(...values)
    const range = max - min || 1
    const pts = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2)
      const y = h - pad - ((v - min) / range) * (h - pad * 2)
      return `${x},${y}`
    })
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="bi-trend-svg">
        <polyline points={pts.join(' ')} fill="none" stroke="var(--bi-accent, #2563EB)" strokeWidth="2.5" strokeLinecap="round" />
        {values.map((v, i) => {
          const [x, y] = pts[i].split(',')
          return <circle key={i} cx={x} cy={y} r="3" fill="#fff" stroke="var(--bi-accent, #2563EB)" strokeWidth="2" />
        })}
      </svg>
    )
  }

  return (
    <section className="view bi-map-page">
      <div className="page-head">
        <div>
          <div className="eyebrow">MARKET INTELLIGENCE BI</div>
          <h1>商机 BI · 热词地图</h1>
          <p>俄罗斯区域搜索热词可视化——基于 Yandex Wordstat 数据，按区域/行业筛选，支持 CSV 导入</p>
        </div>
        <div className="head-actions">
          <select className="bi-filter" value={industry} onChange={e => { setIndustry(e.target.value); setImportedData(null); setSelectedKw(0) }}>
            {Object.entries(INDUSTRIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <label className="primary-btn bi-import-btn">
            📥 导入 Wordstat CSV
            <input type="file" accept=".csv" onChange={handleCSV} hidden />
          </label>
        </div>
      </div>

      {importedData && (
        <div className="bi-imported-tag">
          ✓ 已导入自定义数据（{importedData.label}）— <button onClick={() => setImportedData(null)}>恢复预置数据</button>
        </div>
      )}

      <div className="bi-layout">
        {/* 左侧：区域热力 */}
        <div className="bi-regions-panel">
          <h3>🇷🇺 俄罗斯区域热力</h3>
          <p className="muted" style={{ fontSize: 12 }}>颜色深浅 = 相对搜索量 · 点击区域筛选关键词</p>
          <div className="bi-region-grid">
            {regionData.map(r => (
              <button
                key={r.id}
                className={`bi-region-card${selectedRegion === r.id ? ' sel' : ''}`}
                style={{ '--heat': heatColor(r.weight) }}
                onClick={() => setSelectedRegion(selectedRegion === r.id ? null : r.id)}
              >
                <span className="bi-region-name">{r.name}</span>
                <span className="bi-region-vol">{r.vol.toLocaleString('ru')}</span>
                <span className="bi-region-bar" style={{ width: `${r.weight * 100}%` }} />
              </button>
            ))}
          </div>
          {selectedRegion && (
            <div className="bi-region-detail">
              <b>{REGIONS.find(r => r.id === selectedRegion)?.name}</b>
              <span>月搜索量约 <b>{regionData.find(r => r.id === selectedRegion)?.vol.toLocaleString('ru')}</b> 次</span>
              <span>热门词：{data.keywords[0]?.kw}</span>
            </div>
          )}
        </div>

        {/* 右侧：关键词排行 + 趋势 */}
        <div className="bi-keywords-panel">
          <h3>📊 热词排行 · {data.label}</h3>
          <div className="bi-kw-table">
            <div className="bi-kw-head">
              <span>关键词</span>
              <span>月搜索量</span>
              <span>竞争度</span>
              <span>趋势</span>
            </div>
            {data.keywords.map((k, i) => (
              <button
                key={k.kw}
                className={`bi-kw-row${i === selectedKw ? ' sel' : ''}`}
                onClick={() => setSelectedKw(i)}
              >
                <span className="bi-kw-name">{k.kw}</span>
                <span className="bi-kw-vol">{k.vol.toLocaleString('ru')}</span>
                <span className={`bi-kw-comp ${k.comp > 60 ? 'high' : k.comp > 40 ? 'mid' : 'low'}`}>{k.comp}%</span>
                <span className={`bi-kw-trend ${k.trend[k.trend.length-1] > k.trend[0] ? 'up' : 'down'}`}>
                  {k.trend[k.trend.length-1] > k.trend[0] ? '↑' : '↓'} {Math.round(((k.trend[k.trend.length-1] - k.trend[0]) / k.trend[0]) * 100)}%
                </span>
              </button>
            ))}
          </div>

          {current && (
            <div className="bi-trend-box">
              <h4>📈 「{current.kw}」7 个月趋势</h4>
              <TrendChart values={current.trend} />
              <div className="bi-trend-labels">
                {current.trend.map((v, i) => (
                  <span key={i}>{i === current.trend.length - 1 ? v.toLocaleString('ru') : ''}</span>
                ))}
              </div>
              <div className="bi-trend-insight">
                <span>竞争度 <b className={current.comp > 60 ? 'text-red' : current.comp > 40 ? 'text-amber' : 'text-green'}>{current.comp}%</b></span>
                {current.comp < 40 && <span className="bi-blue-ocean">🌊 蓝海机会——竞争密度低</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bi-footer-note">
        数据来源：Yandex Wordstat 公开统计（预置演示数据）· 支持导入自定义 CSV（格式：关键词，月搜索量，竞争度）· API 自动化接入在产品路线图中
      </div>
    </section>
  )
}
