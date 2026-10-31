/**
 * 采购意图分层 —— 环形图 + 意图浓度大数字（「搜索里的真买家浓度」）。
 * 图例可点击 → 联动过滤热词榜单；concentration = Σ(vol×意图分)/Σvol。
 */
import { INTENT_META } from './biEngine'

const ORDER = ['transactional', 'commercial', 'brand', 'general', 'informational']

export default function IntentPanel({ keywords, concentration, activeFilter, onFilter }) {
  const totalVol = keywords.reduce((s, k) => s + k.vol, 0) || 1
  const byIntent = ORDER.map((kind) => {
    const group = keywords.filter((k) => k.intent === kind)
    return { kind, vol: group.reduce((s, k) => s + k.vol, 0), count: group.length }
  }).filter((d) => d.vol > 0)

  // 环形图几何
  const R = 52, r = 34, cx = 62, cy = 62
  let acc = -Math.PI / 2
  const segs = byIntent.map((d) => {
    const frac = d.vol / totalVol
    const a0 = acc, a1 = acc + frac * Math.PI * 2
    acc = a1
    const large = a1 - a0 > Math.PI ? 1 : 0
    const p = (ang, rad) => [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]
    const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R)
    const [xi1, yi1] = p(a1, r), [xi0, yi0] = p(a0, r)
    return {
      ...d, frac,
      path: `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${xi1},${yi1} A${r},${r} 0 ${large} 0 ${xi0},${yi0} Z`,
    }
  })

  return (
    <div className="bd-intent">
      <div className="bd-intent-top">
        <svg viewBox="0 0 124 124" className="bd-intent-donut">
          {segs.map((s) => (
            <path key={s.kind} d={s.path}
              fill={INTENT_META[s.kind].color}
              fillOpacity={activeFilter === 'all' || activeFilter === s.kind ? 0.88 : 0.25}
              stroke={INTENT_META[s.kind].color} strokeWidth="1"
              onClick={() => onFilter(activeFilter === s.kind ? 'all' : s.kind)}
              className="bd-intent-seg" />
          ))}
          <text x="62" y="58" textAnchor="middle" fontSize="17" fontWeight="800" fill="#00d4ff" className="bd-mono">{concentration}%</text>
          <text x="62" y="72" textAnchor="middle" fontSize="8" fill="#7c8db5">意图浓度</text>
        </svg>
        <div className="bd-intent-note">
          <b>采购意图浓度</b>
          <span>交易词×1.0 商业×0.55 型号×0.5 泛词×0.35 信息×0.15 加权</span>
          <span className="bd-intent-hint">点环形/图例可过滤榜单</span>
        </div>
      </div>
      <div className="bd-intent-legend">
        {byIntent.map((d) => (
          <button key={d.kind}
            className={`bd-intent-row${activeFilter === d.kind ? ' on' : ''}`}
            style={{ ['--ic']: INTENT_META[d.kind].color }}
            onClick={() => onFilter(activeFilter === d.kind ? 'all' : d.kind)}
            title={INTENT_META[d.kind].desc}>
            <span className="bd-intent-dot" />
            <span className="bd-intent-name">{INTENT_META[d.kind].label}</span>
            <span className="bd-intent-count">{d.count}词</span>
            <span className="bd-intent-share bd-mono">{Math.round(d.frac * 100)}%</span>
          </button>
        ))}
      </div>
    </div>
  )
}
