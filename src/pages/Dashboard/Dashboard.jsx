import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'
import { marketTemplates, marketOrder } from '../../data/marketTemplates'
import MiniSitePreview from '../../components/site/MiniSitePreview'

export default function Dashboard() {
  const navigate = useNavigate()
  const { company, toast, isFree, usage, remainingGenerations, site, openPaywall } = useApp()
  const { requireFeature } = useEntitlement()
  const [metrics, setMetrics] = useState(null)
  const [health, setHealth] = useState(null)
  const [taskStats, setTaskStats] = useState({ followup: null, growth: null })
  const [statsLoading, setStatsLoading] = useState(true)

  useEffect(() => {
    api.getMetrics().then(setMetrics)
    api.getHealth().then(setHealth)
  }, [])

  // 任务进度汇总：统计口径在后端（kind 过滤含分母），前端只负责展示
  useEffect(() => {
    let alive = true
    setStatsLoading(true)
    Promise.all([api.getTaskStats('followup'), api.getTaskStats('growth')])
      .then(([followup, growth]) => {
        if (alive) setTaskStats({ followup, growth })
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setStatsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const handleRegenerate = () => {
    // 重新生成属"二次生成"：免费额度用完即触发付费弹窗
    if (!requireFeature('site.generate')) return
    navigate('/onboarding')
  }

  const published = site.publishStatus === 'published'

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">WEBSITE OVERVIEW</div>
          <h1>你的独立站，正在持续增长</h1>
          <p>AI 完成基础建站，专业能力负责真正的搜索曝光与询盘转化。</p>
        </div>
        <div className="head-actions">
          <button className="ghost-btn" onClick={handleRegenerate}>✦ AI 重新生成</button>
          <Link className="primary-btn" to="/editor">编辑网站</Link>
        </div>
      </div>

      <div className="metrics-grid">
        <Metric icon="↗" tone="soft-blue" label="近 30 天访问" data={metrics?.visits30d} />
        <Metric icon="✉" tone="soft-green" label="有效询盘" data={metrics?.inquiries} />
        <Metric icon="G" tone="soft-purple" label="自然搜索点击" data={metrics?.organicClicks} />
        <Metric icon="AI" tone="soft-orange" label="AI 搜索引用" data={metrics?.aiCitations} />
      </div>

      <div className="overview-grid">
        <article className="panel site-preview-panel">
          <div className="panel-head">
            <div>
              <strong>网站实时预览</strong>
              <span>www.{company.website}</span>
            </div>
            <div className={`status-pill${published ? '' : ' draft'}`}>
              ● {published ? `已发布 · 第 ${site.publishCount || 1} 版` : '草稿 · 未发布'}
            </div>
          </div>
          <MiniSitePreview />
        </article>

        <aside className="right-stack">
          <article className="panel health-panel">
            <div className="panel-head">
              <div>
                <strong>网站健康度</strong>
                <span>AI 自动诊断</span>
              </div>
              <Link to="/growth" style={{ fontSize: 12.5, color: 'var(--blue)', fontWeight: 600 }}>查看详情</Link>
            </div>
            <div className="health-score">
              <div className="score-ring">
                <b>{health?.score ?? '—'}</b>
                <span>/100</span>
              </div>
              <div>
                <strong>{health?.status ?? '诊断中…'}</strong>
                <p>发现 {health?.opportunities ?? '—'} 项增长机会</p>
              </div>
            </div>
            <div className="health-list">
              {(health?.items ?? []).map((it) => (
                <div key={it.label}>
                  <span>{it.label}</span>
                  <b className={it.level}>{it.score}</b>
                </div>
              ))}
            </div>
          </article>

          <article className="panel language-panel">
            <div className="panel-head">
              <div>
                <strong>市场版本</strong>
                <span>不是翻译，是本地化</span>
              </div>
            </div>
            {marketOrder.map((m) => {
              const t = marketTemplates[m]
              return (
                <button key={m} className="market-row" onClick={() => navigate('/localization')}>
                  <div className="flag">{t.flag}</div>
                  <div>
                    <strong>{t.label}</strong>
                    <span>{t.region}</span>
                  </div>
                  <b>{t.status}</b>
                </button>
              )
            })}
          </article>

          <TaskProgressPanel stats={taskStats} loading={statsLoading} navigate={navigate} />
        </aside>
      </div>
    </section>
  )
}

/* ---- 任务进度总览 ---- */
const TASK_GROUPS = [
  {
    key: 'followup',
    label: '询盘跟进',
    hint: '来自询盘中心',
    to: '/inquiries',
    empty: '还没有跟进任务，去询盘中心为高意向客户建一个',
  },
  {
    key: 'growth',
    label: '增长服务',
    hint: 'AI 增长 / GEO 优化',
    to: '/growth',
    empty: '还没有增长任务，去 AI 增长提交一项优化',
  },
]

function TaskProgressPanel({ stats, loading, navigate }) {
  const all = [stats.followup, stats.growth].filter(Boolean)
  const totalAll = all.reduce((n, s) => n + s.total, 0)
  const doneAll = all.reduce((n, s) => n + s.done, 0)
  const hasAny = totalAll > 0

  return (
    <article className="panel task-panel">
      <div className="panel-head">
        <div>
          <strong>任务进度</strong>
          <span>{hasAny ? `共 ${totalAll} 项，已完成 ${doneAll} 项` : '由平台专业团队执行'}</span>
        </div>
      </div>

      {loading && <div className="empty small">统计中…</div>}

      {!loading &&
        TASK_GROUPS.map((g) => {
          const s = stats[g.key]
          if (!s) return null
          const isEmpty = s.total === 0
          return (
            <div className="task-stat" key={g.key}>
              <div className="task-stat-head">
                <div>
                  <strong>{g.label}</strong>
                  <span>{isEmpty ? g.empty : `进行中 ${s.doing} · 待处理 ${s.todo}`}</span>
                </div>
                {isEmpty ? (
                  <button className="task-stat-go" onClick={() => navigate(g.to)}>
                    去创建 →
                  </button>
                ) : (
                  <button className="task-stat-go" onClick={() => navigate(g.to)}>
                    {s.percent}% →
                  </button>
                )}
              </div>
              {!isEmpty && (
                <>
                  <div className="task-stat-bar">
                    <span style={{ width: `${s.percent}%` }} />
                  </div>
                  <div className="task-stat-nums">
                    <span>已完成 {s.done}</span>
                    <span>进行中 {s.doing}</span>
                    <span>待处理 {s.todo}</span>
                  </div>
                </>
              )}
            </div>
          )
        })}
    </article>
  )
}

function Metric({ icon, tone, label, data }) {
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
