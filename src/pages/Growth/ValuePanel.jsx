/**
 * 产品价值分析 —— 价值分 TOP 榜（透明三因子：量级40% + 采购意图35% + 竞争反向25%）。
 * 回答「先做哪个词」：不是量最大，而是量×意图×可进性的综合最高。
 */
const MEDALS = ['🥇', '🥈', '🥉']

export default function ValuePanel({ keywords, selectedIdx, onSelect }) {
  const ranked = keywords
    .map((k, i) => ({ k, i }))
    .sort((a, b) => b.k.value - a.k.value)
    .slice(0, 6)
  const maxVal = ranked[0]?.k.value || 1

  return (
    <div className="bd-val">
      <div className="bd-val-formula">价值分 = 量级×40 + 采购意图×35 + 竞争可进性×25（0-100，透明可解释）</div>
      {ranked.map(({ k, i }, rank) => (
        <button key={k.kw} className={`bd-val-row${i === selectedIdx ? ' sel' : ''}`} onClick={() => onSelect(i)}>
          <span className="bd-val-medal">{MEDALS[rank] || rank + 1}</span>
          <div className="bd-val-main">
            <div className="bd-val-head">
              <span className="bd-val-kw">{k.kw}</span>
              {rank === 0 && <span className="bd-val-best">首选推荐</span>}
            </div>
            <div className="bd-val-bar-track">
              <div className="bd-val-bar" style={{ width: `${(k.value / maxVal) * 100}%` }} />
            </div>
            <div className="bd-val-meta">
              <span>量 <b>{(k.vol / 1000).toFixed(1)}k</b></span>
              <span>意图 <b style={{ color: k.intentColor }}>{k.intentLabel}</b></span>
              <span>KD <b>{k.comp}</b></span>
              <span>族 {k.family}</span>
            </div>
          </div>
          <span className="bd-val-score bd-mono">{k.value}</span>
        </button>
      ))}
    </div>
  )
}
