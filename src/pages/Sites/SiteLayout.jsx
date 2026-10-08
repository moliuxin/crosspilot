import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { marketTemplates } from '../../data/marketTemplates'
import './sites.css'

/**
 * 站点作用域外壳（/sites/:siteId）。
 *
 * 只有进入具体网站后才进入 site scope：
 * - 页面编辑 / 市场版本 / 版本历史 都挂在这个作用域下；
 * - 预览 / 发布 也是站点级操作；
 * - 站点不存在或不属于当前租户 → 回「我的网站」。
 */
export default function SiteLayout() {
  const { siteId } = useParams()
  const navigate = useNavigate()
  const { toast, isFree, openPaywall } = useApp()
  const [site, setSite] = useState(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    let alive = true
    setState('loading')
    api
      .getSiteDetail(siteId)
      .then((s) => {
        if (!alive) return
        if (!s) {
          setState('missing')
          return
        }
        setSite(s)
        setState('ready')
      })
      .catch(() => alive && setState('missing'))
    return () => {
      alive = false
    }
  }, [siteId])

  if (state === 'loading') return <section className="view"><div className="empty">加载站点…</div></section>

  if (state === 'missing') {
    return (
      <section className="view">
        <div className="empty">
          站点不存在或没有访问权限。
          <div style={{ marginTop: 12 }}>
            <Link className="primary-btn" to="/sites">← 返回我的网站</Link>
          </div>
        </div>
      </section>
    )
  }

  const published = site.status === 'published'

  async function togglePublish() {
    if (isFree && !published) {
      openPaywall('发布网站', '免费版可完整生成 1 次站点；发布上线属于付费能力，升级后可一键发布。', 'site.publish')
      return
    }
    try {
      const next = published ? 'draft' : 'published'
      await api.updateSite(site.id, { status: next })
      setSite({ ...site, status: next })
      toast(next === 'published' ? `「${site.name}」已发布` : `「${site.name}」已转为草稿`)
    } catch (err) {
      toast(err?.detail || '操作失败', 'warn')
    }
  }

  function openStorefront() {
    // 已发布站点直接看线上前台（site public slug）；草稿回编辑器预览
    if (published && site.public_slug) {
      window.open(`./site-preview.html?site=${encodeURIComponent(site.public_slug)}`, '_blank')
    } else {
      navigate('editor')
    }
  }

  return (
    <section className="view">
      <div className="site-detail-head">
        <div className="site-detail-title">
          <div className="site-detail-glyph">{(site.name || 'S').slice(0, 2).toUpperCase()}</div>
          <div>
            <h1>
              {site.name}{' '}
              <span className={`site-status site-status-${site.status}`}>
                ● {published ? '已发布' : site.status === 'archived' ? '已归档' : '草稿'}
              </span>
            </h1>
            <span className="site-sub">
              {site.industry || '未设置行业'}
              {site.product_category ? ` · ${site.product_category}` : ''} ·{' '}
              {(site.target_markets || []).map((m) => marketTemplates[m]?.label || m).join(' / ')}
              {site.is_default ? ' · 默认网站' : ''}
            </span>
          </div>
        </div>
        <div className="head-actions">
          <button className="ghost-btn" onClick={openStorefront}>◉ {published ? '访问前台' : '去编辑预览'}</button>
          <button className="primary-btn" onClick={togglePublish}>{published ? '转为草稿' : '发布网站'}</button>
        </div>
      </div>

      <nav className="site-tabs" aria-label="站点导航">
        <NavLink to="" end className={({ isActive }) => `site-tab${isActive ? ' active' : ''}`}>概览</NavLink>
        <NavLink to="products" className={({ isActive }) => `site-tab${isActive ? ' active' : ''}`}>产品</NavLink>
        <NavLink to="editor" className={({ isActive }) => `site-tab${isActive ? ' active' : ''}`}>页面编辑</NavLink>
        <NavLink to="markets" className={({ isActive }) => `site-tab${isActive ? ' active' : ''}`}>中 / 英 / 俄 市场版本</NavLink>
        <NavLink to="versions" className={({ isActive }) => `site-tab${isActive ? ' active' : ''}`}>版本历史</NavLink>
      </nav>

      <Outlet context={{ site, setSite }} />
    </section>
  )
}
