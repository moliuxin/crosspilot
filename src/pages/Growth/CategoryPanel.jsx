/**
 * 产品品类分析 —— 三级词库：品类 → 词形族 → 关键词。
 * 行级指标（量/份额/意图浓度/KD/建议）+ 可展开子级；点品类名选中其核心词，
 * 点展开按钮显示词形族分组，点具体词全局选中。
 */
import { useState } from 'react'

export default function CategoryPanel({ categories, families, keywords, selectedIdx, onSelectKeyword, onSelect }) {
  const [openCat, setOpenCat] = useState(null)

  return (
    <div className="bd-cat">
      {categories.map((c, i) => {
        const open = openCat === c.name
        const catKws = keywords.filter((k) => c.members?.includes(k.kw))
        return (
          <div key={c.name} className={`bd-cat-block${open ? ' open' : ''}`}>
            <div className="bd-cat-row">
              <span className="bd-cat-rank" style={{ color: i === 0 ? '#fbbf24' : i === 1 ? '#cbd5e1' : i === 2 ? '#d97706' : '#5a6a8a' }}>
                {i + 1}
              </span>
              <div className="bd-cat-main">
                <div className="bd-cat-head">
                  <button className="bd-cat-name" onClick={() => onSelectKeyword?.(c.topKw)} title={`点击选中该品类核心词「${c.topKw?.kw}」`}>
                    {c.name}
                  </button>
                  <span className="bd-cat-advice" style={{ color: c.advice.color, borderColor: c.advice.color }}>{c.advice.text}</span>
                  <button className={`bd-cat-expand${open ? ' on' : ''}`} title="展开词形族"
                    onClick={() => setOpenCat(open ? null : c.name)}>▸</button>
                </div>
                <div className="bd-cat-bar-track">
                  <div className="bd-cat-bar" style={{ width: `${(c.vol / categories[0].vol) * 100}%` }} />
                </div>
                <div className="bd-cat-meta">
                  <span>{c.count} 词 · {c.vol.toLocaleString()} 次/月</span>
                  <span>份额 <b className="bd-cyan-t">{c.share}%</b></span>
                  <span>意图 <b style={{ color: c.concentration >= 45 ? '#4ecca3' : '#a0aec0' }}>{c.concentration}%</b></span>
                  <span>KD <b style={{ color: c.avgComp >= 60 ? '#ff6b6b' : c.avgComp >= 45 ? '#fbbf24' : '#4ecca3' }}>{c.avgComp}</b></span>
                  {c.blue > 0 && <span className="bd-cat-blue">◈ 蓝海×{c.blue}</span>}
                </div>
              </div>
            </div>
            {open && (
              <div className="bd-cat-children">
                {(c.famGroups || []).map((fam) => (
                  <div key={fam.name} className="bd-fam">
                    <span className="bd-fam-name">{fam.name} <i>{fam.count}词 · {(fam.vol / 1000).toFixed(1)}k</i></span>
                    <div className="bd-fam-words">
                      {fam.words.map((k) => {
                        const idx = keywords.indexOf(k)
                        return (
                          <button key={k.kw} className={`bd-word-chip${idx === selectedIdx ? ' sel' : ''}`}
                            style={{ ['--ic']: k.intentColor }} onClick={() => onSelect?.(idx)} title={`${k.kw} · ${k.vol}/月 · ${k.intentLabel} · 价值${k.value}`}>
                            {k.kw.length > 26 ? k.kw.slice(0, 24) + '…' : k.kw}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
