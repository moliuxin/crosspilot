/**
 * 俄罗斯真实行政边界热力地图（geoBoundaries ADM1 · LAEA 投影 · viewBox 1000×560）
 * 区域底色 = 最近样本城市的热度档位（密度分布视觉），热斑层叠加，
 * 城市小锚点可点击下钻城市卡，区域点击下钻「该区域热词排行」。
 */
import { useMemo } from 'react'
import { REGIONS, VIEW_W, VIEW_H, project } from './russiaRegions'

const CITIES = [
  { name: 'Москва', lon: 37.6, lat: 55.8, vol: 28415, top: true, district: '中央联邦区' },
  { name: 'Санкт-Петербург', lon: 30.3, lat: 59.9, vol: 20460, district: '西北联邦区' },
  { name: 'Пермь', lon: 56.2, lat: 58.0, vol: 5115, district: '伏尔加联邦区' },
  { name: 'Нижний Новгород', lon: 44.0, lat: 56.3, vol: 9093, district: '伏尔加联邦区' },
  { name: 'Казань', lon: 49.1, lat: 55.8, vol: 10798, district: '伏尔加联邦区' },
  { name: 'Екатеринбург', lon: 60.6, lat: 56.8, vol: 11934, district: '乌拉尔联邦区' },
  { name: 'Челябинск', lon: 61.4, lat: 55.2, vol: 7956, district: '乌拉尔联邦区' },
  { name: 'Уфа', lon: 55.9, lat: 54.7, vol: 5683, district: '伏尔加联邦区' },
  { name: 'Самара', lon: 50.1, lat: 53.2, vol: 7388, district: '伏尔加联邦区' },
  { name: 'Воронеж', lon: 39.2, lat: 51.7, vol: 3694, district: '中央联邦区' },
  { name: 'Волгоград', lon: 44.5, lat: 48.7, vol: 4539, district: '南部联邦区' },
  { name: 'Ростов-на-Дону', lon: 39.7, lat: 47.2, vol: 6820, district: '南部联邦区' },
  { name: 'Краснодар', lon: 38.9, lat: 45.0, vol: 6251, district: '南部联邦区' },
  { name: 'Новосибирск', lon: 82.9, lat: 55.0, vol: 12787, district: '西伯利亚联邦区' },
  { name: 'Красноярск', lon: 92.9, lat: 56.0, vol: 3978, district: '西伯利亚联邦区' },
  { name: 'Иркутск', lon: 104.3, lat: 52.3, vol: 3210, district: '西伯利亚联邦区' },
  { name: 'Хабаровск', lon: 135.1, lat: 48.5, vol: 1820, district: '远东联邦区' },
  { name: 'Владивосток', lon: 131.9, lat: 43.1, vol: 2240, district: '远东联邦区' },
]

export const CITY_TOTAL = CITIES.reduce((s, c) => s + c.vol, 0)

function heatTier(ratio) {
  if (ratio >= 0.6) return { color: '#ff6b6b', fill: 0.30, label: '核心密度' }
  if (ratio >= 0.3) return { color: '#fbbf24', fill: 0.22, label: '高密度' }
  if (ratio >= 0.12) return { color: '#00d4ff', fill: 0.15, label: '中密度' }
  return { color: '#3b82f6', fill: 0.08, label: '低密度' }
}

export default function MapView({ maxVol, selectedCity, onSelectCity, selectedRegion, onSelectRegion }) {
  const cityPts = useMemo(() => CITIES.map((c) => ({ ...c, p: project(c.lon, c.lat) })), [])

  // 区域 ← 最近样本城市 的热度着色（诚实近似：15+3 个样本城市的最近邻）
  const regionHeat = useMemo(() => {
    return REGIONS.map((r) => {
      let best = null, bd = Infinity
      for (const c of cityPts) {
        const d = (r.cx - c.p[0]) ** 2 + (r.cy - c.p[1]) ** 2
        if (d < bd) { bd = d; best = c }
      }
      return { region: r, city: best, tier: heatTier(best.vol / maxVol) }
    })
  }, [cityPts, maxVol])

  const sorted = useMemo(() => [...cityPts].sort((a, b) => a.vol - b.vol), [cityPts])

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="bd-map-svg bd-map-geo">
      <defs>
        {[
          ['heat0', '#3b82f6', 0.5], ['heat1', '#00d4ff', 0.55],
          ['heat2', '#fbbf24', 0.6], ['heat3', '#ff6b6b', 0.65],
        ].map(([id, color, op]) => (
          <radialGradient key={id} id={id} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity={op} />
            <stop offset="45%" stopColor={color} stopOpacity={op * 0.45} />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        ))}
        <filter id="heatBlur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="legendGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="35%" stopColor="#00d4ff" />
          <stop offset="65%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#ff6b6b" />
        </linearGradient>
      </defs>

      {/* 真实行政边界（geoBoundaries ADM1）—— 区域底色=最近样本城市热度档 */}
      <g className="bd-regions">
        {regionHeat.map(({ region, city, tier }) => {
          const sel = selectedRegion?.name === region.name
          return (
            <path key={region.name} d={region.d}
              className={`bd-region${sel ? ' sel' : ''}`}
              fill={tier.color} fillOpacity={sel ? Math.min(0.5, tier.fill + 0.18) : tier.fill}
              onClick={() => onSelectRegion?.(sel ? null : { name: region.name, city, tier })}
            >
              <title>{`${region.name}（${city.district}样本）· ${tier.label}\n点击查看该区域热词排行`}</title>
            </path>
          )
        })}
      </g>

      {/* 密度热斑层 */}
      <g filter="url(#heatBlur)" pointerEvents="none">
        {sorted.map((city) => {
          const ratio = city.vol / maxVol
          const r = 24 + Math.sqrt(ratio) * 58
          return (
            <circle key={`heat-${city.name}`} cx={city.p[0]} cy={city.p[1]} r={r}
              fill={`url(#${heatTier(ratio).color === '#ff6b6b' ? 'heat3' : heatTier(ratio).color === '#fbbf24' ? 'heat2' : heatTier(ratio).color === '#00d4ff' ? 'heat1' : 'heat0'})`} />
          )
        })}
      </g>

      {/* 城市锚点（点击下钻城市卡） */}
      {cityPts.map((city) => {
        const [x, y] = city.p
        const ratio = city.vol / maxVol
        const tier = heatTier(ratio)
        const sel = selectedCity?.name === city.name
        return (
          <g key={city.name} className={`bd-city${sel ? ' sel' : ''}`}
            onClick={(e) => { e.stopPropagation(); onSelectCity?.(sel ? null : city) }}>
            <circle cx={x} cy={y} r="9" fill="transparent" />
            {sel && <circle cx={x} cy={y} r="7" fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="3,3" />}
            <circle cx={x} cy={y} r={city.top ? 3.5 : 2.2} fill={tier.color}
              stroke="#0a0e27" strokeWidth="0.8" filter={city.top ? 'url(#glow)' : undefined} />
            {city.top && <circle cx={x} cy={y} r="4.5" fill="none" stroke={tier.color} strokeWidth="1.2" className="bd-pulse-ring" />}
            <text x={x + 5} y={y - 2.5} fontSize="8.5" fill={sel ? '#fff' : '#c3cde0'} className="bd-city-label">{city.name}</text>
            <text x={x + 5} y={y + 5.5} fontSize="8" fill={tier.color} fontWeight="700" className="bd-city-label bd-city-vol">
              {(city.vol / 1000).toFixed(1)}k
            </text>
            <title>{`${city.name} · ${city.district} · ${tier.label}\n行业搜索 ${city.vol.toLocaleString()}/月（点击下钻）`}</title>
          </g>
        )
      })}

      {/* 密度图例 */}
      <g transform={`translate(${VIEW_W - 200}, ${VIEW_H - 16})`}>
        <text fontSize="9" fill="#7c8db5" x="0" y="0">搜索密度</text>
        <rect x="42" y="-7" width="100" height="8" rx="4" fill="url(#legendGrad)" opacity="0.85" />
        <text x="42" y="10" fontSize="7.5" fill="#5a6a8a">低</text>
        <text x="142" y="10" fontSize="7.5" fill="#5a6a8a">高</text>
        <text x="156" y="0" fontSize="7.5" fill="#5a6a8a">真实边界: geoBoundaries ADM1</text>
      </g>
    </svg>
  )
}
