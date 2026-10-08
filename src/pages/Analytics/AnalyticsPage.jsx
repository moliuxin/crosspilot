import { useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'

/**
 * 数据分析（/analytics）。
 *
 * 全部数据来自真实接口推导：
 * - /api/metrics 营销指标（后端按询盘/SEO/GEO 真值计算）；
 * - /api/inquiries 询盘明细 → 按日趋势 / 意向 / 状态 / 国家分布。
 * 不展示任何虚构数字；后端不可用时明确提示。
 */
export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState(null)
  const [inquiries, setInquiries] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    Promise.all([api.getMetrics(), api.getInquiries()])
      .then(([m, i]) => {
        setMetrics(m)
        setInquiries(i.inquiries || [])
      })
      .catch(() => setFailed(true))
  }, [])

  const trend = useMemo(() => {
    const days = []
    const byDay = new Map()
    for (let k = 13; k >= 0; k--) {
      const d = new Date()
      d.setDate(d.getDate() - k)
      const key = d.toISOString().slice(0, 10)
      days.push(key)
      byDay.set(key, 0)
    }
    for (const i of inquiries || []) {
      const key = (i.created_at || '').slice(0, 10)
      if (byDay.has(key)) byDay.set(key, byDay.get(key) + 1)
    }
    return days.map((d) => ({ day: d, count: byDay.get(d) }))
  }, [inquiries])

  const maxTrend = Math.max(1, ...trend.map((t) => t.count))

  const dist = (field, order) => {
    const m = new Map()
    for (const i of inquiries || []) {
      const k = i[field] || '—'
      m.set(k, (m.get(k) || 0) + 1)
    }
    let entries = Array.from(m.entries())
    if (order) entries = entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    else entries = entries.sort((a, b) => b[1] - a[1])
    return entries.slice(0, 6)
  }

  const INTENT_LABEL = { hot: '高意向', warm: '中意向', cold: '低意向' }
  const STATUS_LABEL = { new: '新询盘', contacted: '已联系', following: '跟进中', done: '已完成' }
  const maxDist = Math.max(1, ...(inquiries ? [inquiries.length] : [1]))

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">ANALYTICS</div>
          <h1>数据分析</h1>
          <p>账号级经营数据：营销指标与询盘结构。指标由后端按真实数据推导。</p>
        </div>
      </div>

      {failed && <div className="empty">数据加载失败：后端服务不可用。</div>}

      {!failed && (
        <>
          <div className="metrics-grid">
            <MetricCard icon="↗" tone="soft-blue" label="近 30 天访问" data={metrics?.visits30d} />
            <MetricCard icon="✉" tone="soft-green" label="有效询盘" data={metrics?.inquiries} />
            <MetricCard icon="G" tone="soft-purple" label="自然搜索点击" data={metrics?.organicClicks} />
            <MetricCard icon="AI" tone="soft-orange" label="AI 搜索引用" data={metrics?.aiCitations} />
          </div>

          <div className="overview-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <strong>询盘趋势（近 14 天）</strong>
                  <span>按询盘创建时间统计</span>
                </div>
              </div>
              <div className="trend-chart">
                {trend.map((t) => (
                  <div className="trend-col" key={t.day} title={`${t.day.slice(5)}：${t.count} 条`}>
                    <div className="trend-bar-wrap">
                      <div className="trend-bar" style={{ height: `${Math.max(4, (t.count / maxTrend) * 100)}%` }} data-zero={t.count === 0} />
                    </div>
                    <span className="trend-label">{t.day.slice(8)}</span>
                  </div>
                ))}
              </div>
            </article>

            <aside className="right-stack">
              <article className="panel">
                <div className="panel-head">
                  <div>
                    <strong>意向分布</strong>
                    <span>hot / warm / cold</span>
                  </div>
                </div>
                <Bars rows={dist('intent', ['hot', 'warm', 'cold']).map(([k, v]) => [INTENT_LABEL[k] || k, v])} max={maxDist} />
              </article>

              <article className="panel">
                <div className="panel-head">
                  <div>
                    <strong>状态分布</strong>
                    <span>询盘流转</span>
                  </div>
                </div>
                <Bars rows={dist('status', ['new', 'contacted', 'following', 'done']).map(([k, v]) => [STATUS_LABEL[k] || k, v])} max={maxDist} />
              </article>

              <article className="panel">
                <div className="panel-head">
                  <div>
                    <strong>来源国家 Top</strong>
                    <span>按询盘统计</span>
                  </div>
                </div>
                <Bars rows={dist('country')} max={maxDist} />
              </article>
            </aside>
          </div>
        </>
      )}
    </section>
  )
}

function MetricCard({ icon, tone, label, data }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{data?.value ?? '—'}</strong>
        <small className="positive">{data?.delta ?? ''}</small>
      </div>
    </article>
  )
}

function Bars({ rows, max }) {
  if (!rows.length) return <div className="empty small">暂无数据</div>
  return (
    <div className="dist-list">
      {rows.map(([label, value]) => (
        <div className="dist-row" key={label}>
          <span className="dist-label">{label}</span>
          <div className="dist-bar">
            <span style={{ width: `${Math.max(3, (value / max) * 100)}%` }} />
          </div>
          <b>{value}</b>
        </div>
      ))}
    </div>
  )
}
