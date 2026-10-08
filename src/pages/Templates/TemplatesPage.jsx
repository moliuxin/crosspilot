import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'
import { TEMPLATES } from './templates-data'
import './templates.css'

const ORDER_STATUS = { pending: '待处理', approved: '已开通', rejected: '已驳回' }

/**
 * 模板商城（公开路由 /templates）。
 *
 * 产品规则：
 * - 未登录可浏览 / 筛选 / 打开预览（不强制登录）；
 * - 「使用模板」时才要求登录：未登录 → 记 intended_template → 登录后回到该模板继续创建网站；
 * - 卡片 hover：full preview 从顶部缓慢滑到底部，移出平滑回顶部，不跳动；
 * - 购买走真实 ServiceOrder（登录后）。
 */
export default function TemplatesPage() {
  const navigate = useNavigate()
  const { authState, toast } = useApp()
  const { can, requireFeature, isFree } = useEntitlement()
  const [orders, setOrders] = useState([])
  const [buying, setBuying] = useState('')
  const [filter, setFilter] = useState('全部')

  const authed = authState === 'authed'

  const load = useCallback(async () => {
    if (!authed) return
    try {
      const list = await api.listServiceOrders()
      setOrders(Array.isArray(list) ? list : [])
    } catch {
      setOrders([])
    }
  }, [authed])

  useEffect(() => {
    load()
  }, [load])

  const industries = useMemo(
    () => ['全部', ...Array.from(new Set(TEMPLATES.flatMap((t) => t.industry.split(' · '))))],
    []
  )
  const visible = useMemo(
    () => (filter === '全部' ? TEMPLATES : TEMPLATES.filter((t) => t.industry.includes(filter))),
    [filter]
  )

  const ownedOf = (tid) => orders.find((o) => o.feature_key === `template.${tid}` && o.status === 'approved')
  const pendingOf = (tid) => orders.find((o) => o.feature_key === `template.${tid}` && o.status === 'pending')

  function useTemplate(t) {
    // 未登录：保存意图模板 → 登录成功后跳回商城并继续创建
    if (!authed) {
      sessionStorage.setItem('sitepilot.intended_template', t.id)
      navigate('/login')
      return
    }
    navigate(`/sites/new?template=${t.id}`)
  }

  async function buy(t) {
    if (t.is_free) {
      useTemplate(t)
      return
    }
    if (isFree && !can('template.purchase')) {
      requireFeature('template.purchase')
      return
    }
    setBuying(t.id)
    try {
      const res = await api.createServiceOrder({
        feature_key: `template.${t.id}`,
        note: `购买模板 ${t.name}（${t.industry}）`,
      })
      const oid = res?.order?.id || res?.id
      if (oid && can('template.purchase')) {
        await api.approveServiceOrder(oid).catch(() => {})
      }
      toast(`已创建购买记录：${t.name}`)
      await load()
    } catch (e) {
      if (e?.status === 402) requireFeature('template.purchase')
      else toast(`购买失败：${e?.message || '未知错误'}`)
    } finally {
      setBuying('')
    }
  }

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">TEMPLATE MARKETPLACE</div>
          <h1>模板商城</h1>
          <p>
            每个模板都有<b>真实可渲染的页面结构</b>（不只是换色），鼠标悬停卡片可滚动预览整页。
            {!authed && ' 浏览与预览无需登录；使用模板时再登录即可。'}
          </p>
        </div>
        <div className="head-actions">
          {authed ? (
            <button className="ghost-btn" onClick={load}>刷新购买记录</button>
          ) : (
            <Link className="ghost-btn" to="/login">登录后可购买 / 使用</Link>
          )}
        </div>
      </div>

      <div className="tpl-filter-row">
        {industries.map((ind) => (
          <button key={ind} className={`tpl-filter-chip${filter === ind ? ' on' : ''}`} onClick={() => setFilter(ind)}>
            {ind}
          </button>
        ))}
      </div>

      <div className="tpl-grid">
        {visible.map((t) => {
          const owned = authed && ownedOf(t.id)
          const pending = authed && pendingOf(t.id)
          return (
            <article className="tpl-card panel" key={t.id}>
              <Link to={`/templates/${t.slug}`} className="tpl-preview" aria-label={`预览 ${t.name}`}>
                <TemplateScrollPreview template={t} />
                {t.popular ? <span className="tpl-hot">最受欢迎</span> : null}
                <span className="tpl-shot-hint">悬停滚动预览整页 ↕</span>
              </Link>
              <div className="tpl-body">
                <div className="tpl-head">
                  <strong>{t.name}</strong>
                  <span className="tpl-price">{t.is_free ? '免费' : `¥${t.price}`}</span>
                </div>
                <div className="tpl-industry">{t.industry} · {(t.market_tags || []).join(' / ')}</div>
                <p className="tpl-desc">{t.desc}</p>
                <div className="tpl-tags">
                  {(t.style_tags || []).map((g) => (
                    <i key={g}>{g}</i>
                  ))}
                </div>
                <div className="tpl-actions">
                  <Link className="ghost-btn" to={`/templates/${t.slug}`}>预览</Link>
                  {!authed ? (
                    <button className="primary-btn" onClick={() => useTemplate(t)}>使用模板</button>
                  ) : owned ? (
                    <button className="primary-btn" onClick={() => useTemplate(t)}>用此模板建站</button>
                  ) : pending ? (
                    <span className="tpl-pending">开通中…</span>
                  ) : (
                    <button className="primary-btn" disabled={buying === t.id} onClick={() => buy(t)}>
                      {buying === t.id ? '处理中…' : t.is_free ? '免费使用' : '立即购买'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {authed && (
        <div className="panel">
          <div className="panel-head">
            <h3>我的购买记录</h3>
            <span className="usage-pill">{orders.length}</span>
          </div>
          {orders.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              暂无购买记录。点击「立即购买」会创建真实的订单记录，刷新后仍然存在。
            </p>
          ) : (
            <table className="data-table version-table">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>订单号</th>
                  <th style={{ width: 108 }}>类型</th>
                  <th>内容</th>
                  <th style={{ width: 96 }}>状态</th>
                  <th style={{ width: 80 }}>金额</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td><code>{o.id}</code></td>
                    <td>{o.plan_id ? '套餐' : '能力/模板'}</td>
                    <td>
                      {o.plan_id ? o.plan_id : o.feature_key}
                      {o.note ? <div className="muted" style={{ fontSize: 11.5 }}>{o.note}</div> : null}
                    </td>
                    <td>
                      <span className={`ver-tag ${o.status === 'approved' ? 'ok' : o.status === 'pending' ? 'warn' : 'info'}`}>
                        {ORDER_STATUS[o.status] || o.status}
                      </span>
                    </td>
                    <td>¥{o.amount ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 卡片内「整页滚动预览」：
 * 有真实截图（template-assets/<slug>/preview-full.webp）用截图，否则渲染结构化的迷你页面骨架。
 * hover 时 .tpl-scroll-content 平滑从顶滚到底（CSS 过渡见 templates.css）。
 */
function TemplateScrollPreview({ template: t }) {
  const [shot, setShot] = useState(null)
  useEffect(() => {
    // 真实截图优先（webp → png），都没有则回落到结构化迷你页面
    const candidates = [`template-assets/${t.slug}/preview-full.webp`, `template-assets/${t.slug}/preview-full.png`]
    let i = 0
    let dead = false
    const probe = () => {
      if (dead) return
      if (i >= candidates.length) {
        setShot(null)
        return
      }
      const src = candidates[i++]
      const img = new Image()
      img.onload = () => !dead && setShot(src)
      img.onerror = probe
      img.src = src
    }
    probe()
    return () => {
      dead = true
    }
  }, [t.slug])

  if (shot) {
    return (
      <div className="tpl-scroll-frame">
        <div className="tpl-scroll-content">
          <img className="tpl-shot" src={shot} alt={`${t.name} 整页预览`} />
        </div>
      </div>
    )
  }

  const hero = t.sections.find((s) => s.type === 'hero')?.props || {}
  const trust = t.sections.find((s) => s.type === 'trust')?.props?.items || []
  return (
    <div className="tpl-scroll-frame">
      <div className="tpl-scroll-content">
        <div className="tpl-mini-page">
          <div className="tpl-mini-nav" style={{ background: t.accent }}>
            <b style={{ color: '#fff' }}>{t.name.toUpperCase()}</b>
            <span style={{ color: 'rgba(255,255,255,0.8)' }}>Products&nbsp;&nbsp;Solutions&nbsp;&nbsp;Cases&nbsp;&nbsp;About</span>
            <button style={{ background: 'rgba(255,255,255,0.2)' }}>{hero.cta || 'GET A QUOTE'}</button>
          </div>
          <div className="tpl-mini-hero" style={{ background: t.accent }}>
            <small>{hero.eyebrow || t.industry}</small>
            <h3>{(hero.title || t.name).split('\n')[0]}</h3>
            <p>{hero.description || t.desc}</p>
          </div>
          {trust.length > 0 && (
            <div className="tpl-mini-strip">
              {trust.slice(0, 4).map((b) => (
                <span key={b}>{b}</span>
              ))}
            </div>
          )}
          {t.sections
            .filter((s) => ['products', 'applications', 'capability', 'cases'].includes(s.type))
            .map((s) => (
              <div className="tpl-mini-section" key={s.id}>
                <h4>{s.props?.title || s.label}</h4>
                <div className="tpl-mini-cards">
                  <div />
                  <div />
                  <div />
                </div>
              </div>
            ))}
          <div className="tpl-mini-cta" style={{ background: t.accent }}>
            <b>{t.sections.find((s) => s.type === 'cta')?.props?.title || 'Get a Quote'}</b>
            <span>{t.market_tags.join(' · ')}</span>
          </div>
          <div className="tpl-mini-footer">
            <span>{t.name.toUpperCase()} · DEMO</span>
            <span>Built with CrossPilot</span>
          </div>
        </div>
      </div>
    </div>
  )
}
