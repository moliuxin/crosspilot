/**
 * 机会矩阵 —— 竞争度 × 搜索量 四象限气泡图（SEO 工具标准决策图）。
 * X=竞争度(0-100) Y=月搜索量(对数刻度) 气泡大小=搜索量 颜色=采购意图。
 * 点击气泡 → 全局联动选中该词；象限底色提示机会/风险区。
 */
import { QUADRANT_META } from './biEngine'

const W = 620, H = 300
const M = { top: 16, right: 18, bottom: 34, left: 58 }
const PW = W - M.left - M.right, PH = H - M.top - M.bottom
const COMP_MID = 45

export default function OpportunityMatrix({ keywords, selectedIdx, onSelect }) {
  if (!keywords.length) return null
  const vols = keywords.map((k) => k.vol)
  const minV = Math.max(1, Math.min(...vols) * 0.8)
  const maxV = Math.max(...vols) * 1.15
  const logMin = Math.log10(minV), logMax = Math.log10(maxV)
  const volMid = [...vols].sort((a, b) => b - a)[Math.floor(vols.length / 2)]

  const x = (comp) => M.left + (comp / 100) * PW
  const y = (vol) => M.top + PH - ((Math.log10(vol) - logMin) / (logMax - logMin)) * PH

  const midX = x(COMP_MID), midY = y(volMid)
  const topByVol = [...keywords.keys()].sort((a, b) => keywords[b].vol - keywords[a].vol).slice(0, 5)

  // 对数刻度刻度值
  const ticks = []
  for (let p = Math.ceil(logMin); p <= Math.floor(logMax); p++) ticks.push(Math.pow(10, p))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="bd-matrix-svg">
      {/* 象限底色 */}
      <rect x={M.left} y={M.top} width={midX - M.left} height={midY - M.top} fill={QUADRANT_META.blue.color} />
      <rect x={midX} y={M.top} width={W - M.right - midX} height={midY - M.top} fill={QUADRANT_META.star.color} />
      <rect x={M.left} y={midY} width={midX - M.left} height={H - M.bottom - midY} fill={QUADRANT_META.tail.color} />
      <rect x={midX} y={midY} width={W - M.right - midX} height={H - M.bottom - midY} fill={QUADRANT_META.red.color} />

      {/* 轴 */}
      <line x1={M.left} y1={H - M.bottom} x2={W - M.right} y2={H - M.bottom} stroke="#1a2a5e" />
      <line x1={M.left} y1={M.top} x2={M.left} y2={H - M.bottom} stroke="#1a2a5e" />
      {/* 网格 + Y 对数刻度 */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} y1={y(t)} x2={W - M.right} y2={y(t)} stroke="#0f1f4a" strokeDasharray="2,4" />
          <text x={M.left - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#5a6a8a" className="bd-mono">
            {t >= 1000 ? `${t / 1000}k` : t}
          </text>
        </g>
      ))}
      {[0, 25, 50, 75, 100].map((c) => (
        <text key={c} x={x(c)} y={H - M.bottom + 14} textAnchor="middle" fontSize="9" fill="#5a6a8a" className="bd-mono">{c}</text>
      ))}
      {/* 中位线 */}
      <line x1={midX} y1={M.top} x2={midX} y2={H - M.bottom} stroke="#3a4a7e" strokeDasharray="5,4" />
      <line x1={M.left} y1={midY} x2={W - M.right} y2={midY} stroke="#3a4a7e" strokeDasharray="5,4" />

      {/* 象限标签 */}
      <text x={M.left + 8} y={M.top + 14} fontSize="10" fill={QUADRANT_META.blue.border} fontWeight="700">◈ 蓝海 · 快赢</text>
      <text x={W - M.right - 8} y={M.top + 14} textAnchor="end" fontSize="10" fill={QUADRANT_META.star.border} fontWeight="700">★ 明星 · 硬仗</text>
      <text x={M.left + 8} y={H - M.bottom - 8} fontSize="10" fill={QUADRANT_META.tail.border}>◇ 长尾 · 试验</text>
      <text x={W - M.right - 8} y={H - M.bottom - 8} textAnchor="end" fontSize="10" fill={QUADRANT_META.red.border}>✕ 红海 · 回避</text>

      {/* 轴标题 */}
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="#7c8db5">竞争度 KD →（阈值 45）</text>
      <text x={12} y={M.top + PH / 2} fontSize="9" fill="#7c8db5" transform={`rotate(-90 12 ${M.top + PH / 2})`} textAnchor="middle">月搜索量（对数）→</text>

      {/* 气泡 */}
      {keywords.map((k, i) => {
        const cx = x(k.comp ?? 50), cy = y(k.vol)
        const r = 4 + Math.sqrt(k.vol / maxV) * 13
        const sel = i === selectedIdx
        return (
          <g key={k.kw} className="bd-mx-bubble" onClick={() => onSelect(i)}>
            {sel && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.9" />}
            <circle cx={cx} cy={cy} r={r} fill={k.intentColor} fillOpacity={sel ? 0.95 : 0.62} stroke={k.intentColor} />
            {(sel || topByVol.includes(i)) && (
              <text x={cx} y={cy - r - 5} textAnchor="middle" fontSize="9" fill={sel ? '#fff' : '#a0aec0'} className="bd-mx-kw">
                {k.kw.length > 22 ? k.kw.slice(0, 20) + '…' : k.kw}
              </text>
            )}
            <title>{`${k.kw}\n搜索 ${k.vol.toLocaleString()} / 月 · 竞争度 ${k.comp}\n意图 ${k.intentLabel} · 词族 ${k.family}`}</title>
          </g>
        )
      })}
    </svg>
  )
}
