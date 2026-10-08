import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { marketTemplates } from '../../data/marketTemplates'
import './sites.css'

/**
 * 我的网站（/sites）。
 *
 * 多站点架构的唯一站点列表入口：
 * - 一个账号可创建和管理多个独立站；
 * - 具体网站的管理（页面编辑 / 市场版本 / 版本历史）从这里进入；
 * - 侧栏不再出现「网站 / 页面编辑 / 页面内容」等重复入口。
 */
export default function SitesPage() {
  const navigate = useNavigate()
  const { toast, openPaywall } = useApp()
  const [sites, setSites] = useState(null)
  const [busyId, setBusyId] = useState('')

  async function refresh() {
    try {
      setSites(await api.getSites())
    } catch {
      setSites([])
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function togglePublish(site) {
    setBusyId(site.id)
    try {
      const next = site.status === 'published' ? 'draft' : 'published'
      await api.updateSite(site.id, { status: next })
      toast(next === 'published' ? `「${site.name}」已发布` : `「${site.name}」已切换为草稿`)
      await refresh()
    } catch (err) {
      toast(err?.detail || '操作失败', 'warn')
    } finally {
      setBusyId('')
    }
  }

  async function removeSite(site) {
    if (!window.confirm(`确定删除网站「${site.name}」？\n该网站的页面将被删除；询盘作为业务记录会保留。`)) return
    setBusyId(site.id)
    try {
      await api.deleteSite(site.id)
      toast(`「${site.name}」已删除`)
      await refresh()
    } catch (err) {
      toast(err?.detail || '删除失败', 'warn')
    } finally {
      setBusyId('')
    }
  }

  const loading = sites === null

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">MY WEBSITES</div>
          <h1>我的网站</h1>
          <p>一个账号可以创建和管理多个独立站。进入具体网站后才能编辑它的页面与市场版本。</p>
        </div>
        <div className="head-actions">
          <Link className="ghost-btn" to="/templates">从模板开始</Link>
          <Link className="primary-btn" to="/sites/new">＋ 创建网站</Link>
        </div>
      </div>

      {loading && <div className="empty">加载中…</div>}

      {!loading && sites.length === 0 && (
        <div className="sites-empty panel">
          <div className="sites-empty-icon">◫</div>
          <h2>还没有网站</h2>
          <p>创建第一个独立站，开始你的出海业务。产品资料是账号级资产，可复用到每个网站。</p>
          <div className="sites-empty-actions">
            <Link className="primary-btn" to="/sites/new">✦ AI 生成独立站（首次免费）</Link>
            <Link className="ghost-btn" to="/templates">先逛逛模板商城</Link>
          </div>
        </div>
      )}

      {!loading && sites.length > 0 && (
        <div className="sites-grid">
          {sites.map((s) => {
            const published = s.status === 'published'
            return (
              <article className="site-card" key={s.id}>
                <div className="site-card-top" data-status={s.status}>
                  <div className="site-card-glyph">{(s.name || 'S').slice(0, 2).toUpperCase()}</div>
                  <span className={`site-status site-status-${s.status}`}>
                    ● {published ? '已发布' : s.status === 'archived' ? '已归档' : '草稿'}
                  </span>
                </div>
                <div className="site-card-body">
                  <h3 onClick={() => navigate(`/sites/${s.id}`)} role="button" tabIndex={0}>{s.name}</h3>
                  <p className="site-card-meta">
                    {s.industry || '未设置行业'}
                    {s.product_category ? ` · ${s.product_category}` : ''}
                  </p>
                  <div className="site-card-markets">
                    {(s.target_markets || []).map((m) => (
                      <span key={m} className="market-chip">{marketTemplates[m]?.flag || ''} {marketTemplates[m]?.label || m}</span>
                    ))}
                  </div>
                  <div className="site-card-stats">
                    <span>页面 {s.pages ?? '—'}</span>
                    <span>询盘 {s.inquiries ?? '—'}</span>
                    <span>更新 {s.updated_at_human || '—'}</span>
                  </div>
                </div>
                <div className="site-card-actions">
                  <button className="primary-btn small" onClick={() => navigate(`/sites/${s.id}`)} disabled={busyId === s.id}>
                    进入管理
                  </button>
                  <button className="ghost-btn small" onClick={() => togglePublish(s)} disabled={busyId === s.id}>
                    {published ? '转为草稿' : '发布'}
                  </button>
                  <button
                    className="ghost-btn small danger"
                    onClick={() => removeSite(s)}
                    disabled={busyId === s.id || s.is_default}
                    title={s.is_default ? '默认网站承载存量数据，不可删除' : '删除网站'}
                  >
                    删除
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
