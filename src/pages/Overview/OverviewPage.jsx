import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'

/**
 * 概览（登录后落地的通用商家 Dashboard）。
 *
 * 多站点规则（AGENTS.md）：
 * - 不自动选中或展示某个具体网站的名称；
 * - 具体网站只能从「我的网站」进入；
 * - 这里只放账号级视角：网站数 / 产品数 / 询盘数 / 最近任务 / 最近网站。
 */
export default function OverviewPage() {
  const navigate = useNavigate()
  const { user, tenant, usage, remainingGenerations } = useApp()
  const [sites, setSites] = useState([])
  const [counts, setCounts] = useState(null)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([api.getSites(), api.health(), api.getTasks({ status: 'todo', kind: 'followup' })])
      .then(([siteList, health, taskList]) => {
        if (!alive) return
        setSites(siteList || [])
        setCounts(health || {})
        setTasks(Array.isArray(taskList) ? (taskList || []).slice(0, 5) : [])
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const displayName = user?.displayName || user?.email?.split('@')[0] || '商家'
  const recentSites = sites.slice(0, 3)

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">MERCHANT OVERVIEW</div>
          <h1>{displayName}，欢迎回来</h1>
          <p>这里是你的企业经营总览。具体网站请从「我的网站」进入管理。</p>
        </div>
        <div className="head-actions">
          <Link className="ghost-btn" to="/templates">浏览模板</Link>
          <Link className="primary-btn" to="/sites/new">＋ 创建网站</Link>
        </div>
      </div>

      <div className="metrics-grid">
        <StatCard icon="◫" tone="soft-blue" label="网站数量" value={loading ? '…' : String(sites.length)} hint={sites.length ? '进入我的网站管理' : '还没有网站，去创建第一个'} to="/sites" />
        <StatCard icon="▦" tone="soft-green" label="产品数量" value={counts ? String(counts.products ?? '—') : '…'} hint="产品为账号级资产，可复用到多个网站" to="/products" />
        <StatCard icon="✉" tone="soft-purple" label="询盘数量" value={counts ? String(counts.inquiries ?? '—') : '…'} hint="来自全部网站的询盘" to="/inquiries" />
        <StatCard icon="✦" tone="soft-orange" label="免费 AI 建站" value={`${remainingGenerations}/${usage.freeGenerationLimit}`} hint="免费完整生成为账号级额度" to="/sites/new" />
      </div>

      <div className="overview-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <strong>AI 经营助手</strong>
              <span>把模型能力变成经营动作</span>
            </div>
          </div>
          <div className="assistant-grid">
            <AssistantCard title="AI 生成独立站" desc="输入产品类别，生成结构与内容" icon="✦" onClick={() => navigate('/sites/new')} />
            <AssistantCard title="AI 增长" desc="Buyer Persona · 转化 · 竞品" icon="↗" onClick={() => navigate('/growth')} />
            <AssistantCard title="SEO & GEO" desc="搜索与 AI 搜索双通道优化" icon="◎" onClick={() => navigate('/seo')} />
            <AssistantCard title="AI Agent" desc="15 个 MCP 工具，草稿需人工确认" icon="⌘" onClick={() => navigate('/agent')} />
          </div>
        </article>

        <aside className="right-stack">
          <article className="panel">
            <div className="panel-head">
              <div>
                <strong>最近网站</strong>
                <span>{sites.length ? `共 ${sites.length} 个网站` : '暂无网站'}</span>
              </div>
              <Link to="/sites" style={{ fontSize: 12.5, color: 'var(--blue)', fontWeight: 600 }}>全部 →</Link>
            </div>
            {recentSites.length === 0 && (
              <div className="empty small">
                还没有网站。<Link to="/sites/new">创建第一个网站</Link>，或用 AI 生成一个独立站。
              </div>
            )}
            {recentSites.map((s) => (
              <button key={s.id} className="market-row" onClick={() => navigate(`/sites/${s.id}`)}>
                <div className="flag">{(s.name || 'S').slice(0, 1)}</div>
                <div>
                  <strong>{s.name}</strong>
                  <span>{s.industry || s.product_category || '未设置行业'}</span>
                </div>
                <b className={`site-status site-status-${s.status}`}>{s.status === 'published' ? '已发布' : '草稿'}</b>
              </button>
            ))}
          </article>

          <article className="panel">
            <div className="panel-head">
              <div>
                <strong>最近任务</strong>
                <span>询盘跟进 / 增长服务</span>
              </div>
              <Link to="/inquiries" style={{ fontSize: 12.5, color: 'var(--blue)', fontWeight: 600 }}>查看 →</Link>
            </div>
            {tasks.length === 0 && <div className="empty small">暂无待办任务</div>}
            {tasks.map((t) => (
              <div className="task-row-mini" key={t.id}>
                <i className={`task-dot task-dot-${t.status}`} />
                <span className="task-title">{t.title}</span>
                <b>{t.status === 'todo' ? '待处理' : t.status === 'doing' ? '进行中' : '已完成'}</b>
              </div>
            ))}
          </article>
        </aside>
      </div>
    </section>
  )
}

function StatCard({ icon, tone, label, value, hint, to }) {
  return (
    <Link className="metric-card" to={to}>
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </Link>
  )
}

function AssistantCard({ title, desc, icon, onClick }) {
  return (
    <button className="assistant-card" onClick={onClick}>
      <span className="assistant-icon">{icon}</span>
      <strong>{title}</strong>
      <span>{desc}</span>
    </button>
  )
}
