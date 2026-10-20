import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { templateBySlug } from './templates-data'
import { renderLayout } from '../../components/site-blocks'
import { api } from '../../services/api'
import ThemePalette from '../../components/site/ThemePalette'
import '../../components/site/ThemePalette.css'
import './templates.css'
import './../PublicMarketSite.css'

const MARKET_META = {
  'zh-CN': { flag: '🇨🇳', label: '中文' },
  'en-US': { flag: '🇺🇸', label: 'English' },
  'ru-RU': { flag: '🇷🇺', label: 'Русский' },
}

function loadPalette(slug) {
  try {
    const raw = localStorage.getItem('sitepilot.palette.' + slug)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/**
 * 模板 Demo 预览（公开路由 /templates/:slug，无需登录）。
 *
 * 有 demoSlug 的模板（全部 6 个）：直接渲染 **Skill 流水线真实生成的站点**
 * （行业画像→主题→布局→Transcreation→cogview 视觉），支持三市场切换——
 * 三套布局/文案/图片由 SiteMarketVariant 独立持久化，不是翻译换色。
 * 无 demoSlug 的模板回落静态 DemoSection（内容标注 Demo）。
 * 「使用模板」登录后创建网站；未登录先记录 intended_template。
 */
export default function TemplatePreview() {
  const { slug } = useParams()
  const t = templateBySlug(slug)
  const [market, setMarket] = useState('en-US')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [palette, setPalette] = useState(null)
  const [palOpen, setPalOpen] = useState(false)

  useEffect(() => {
    if (!t?.demoSlug) return
    setPalette(loadPalette(t.demoSlug))
    setData(null); setErr('')
    api.getPublicSite(t.demoSlug, market)
      .then((d) => {
        if (!d?.market_variant) throw new Error('该市场版本尚未生成')
        setData(d)
      })
      .catch((e) => setErr(e?.message || '加载失败'))
  }, [t?.demoSlug, market])

  function updatePalette(next) {
    setPalette(next)
    try {
      if (next) localStorage.setItem('sitepilot.palette.' + t.demoSlug, JSON.stringify(next))
      else localStorage.removeItem('sitepilot.palette.' + t.demoSlug)
    } catch { /* 隐私模式忽略 */ }
  }

  if (!t) {
    return (
      <div className="tpl-public-page">
        <div className="empty">
          模板不存在。
          <div style={{ marginTop: 12 }}>
            <Link to="/templates" className="primary-btn">← 返回模板商城</Link>
          </div>
        </div>
      </div>
    )
  }

  function useTemplate() {
    if (!localStorage.getItem('sitepilot.token')) {
      sessionStorage.setItem('sitepilot.intended_template', t.id)
      window.location.hash = '#/login'
      return
    }
    window.location.hash = `#/sites/new?template=${t.id}`
  }

  const markets = (t.market_tags || []).filter((m) => MARKET_META[m])
  const v = data?.market_variant
  const sections = v?.layout_schema?.sections || []
  const baseTokens = v?.design_tokens || {}
  const tokens = { ...baseTokens, ...(palette || {}) }  // 调色盘覆盖后的有效令牌

  return (
    <div className="tpl-public-page">
      <header className="tpl-demo-topbar">
        <div className="tpl-demo-brand">
          <span className="tpl-demo-logo" style={{ background: t.accent }}>{t.name.charAt(0)}</span>
          <div>
            <strong>{t.name}</strong>
            <span>
              {t.industry} · {t.demoSlug ? 'Skill 流水线真实生成(非静态模板)' : 'Demo 预览'}
            </span>
          </div>
        </div>
        <div className="tpl-demo-actions">
          {t.demoSlug && markets.length > 0 && (
            <div className="tpl-market-switch">
              {markets.map((m) => (
                <button key={m} className={`tpl-mk-btn${m === market ? ' on' : ''}`}
                  onClick={() => setMarket(m)}>
                  {MARKET_META[m].flag} {MARKET_META[m].label}
                </button>
              ))}
            </div>
          )}
          <Link className="ghost-btn" to="/templates">← 返回商城</Link>
          <button className="primary-btn" onClick={useTemplate}>使用模板</button>
        </div>
      </header>

      {t.demoSlug ? (
        <div className="tpl-live-stage">
          {err && <div className="empty">{err}。<Link to="/templates" className="ghost-btn">返回商城</Link></div>}
          {!err && !data && <div className="empty">加载 Skill 生成站点…</div>}
          {!err && data && (
            <div className="pub-site" style={{ background: tokens.bg || '#f7f8fa', color: tokens.text || '#182230' }}>
              <div className="pub-head" style={{ background: tokens.primary || '#141a24', color: tokens.on_dark || '#e6ebf2' }}>
                <b>{data.site?.name || t.name}</b>
                <nav>
                  {markets.map((m) => (
                    <button key={m} className={`pub-lang${m === market ? ' on' : ''}`}
                      style={m === market ? { background: tokens.accent || '#c2570c', color: tokens.on_accent || '#fff' } : {}}
                      onClick={() => setMarket(m)}>
                      {MARKET_META[m].flag} {MARKET_META[m].label}
                    </button>
                  ))}
                  <button className="pub-palette-btn" title="配色方案" onClick={() => setPalOpen(true)}>🎨</button>
                </nav>
              </div>
              {sections.length ? renderLayout(sections, { designTokens: tokens, market, locale: v.locale, products: data.products || [] }) : (
                <div className="empty">该市场版本暂无内容</div>
              )}
              <footer className="pub-foot" style={{ background: tokens.primary_deep || '#0b0f16', color: tokens.on_dark || '#e6ebf2' }}>
                <span>© {new Date().getFullYear()} {data.site?.name || t.name} · 由 CrossPilot Skill 流水线生成(布局/文案/图片均为 AI 真实产出)</span>
                <span className="pub-src-badge">Skill-generated</span>
              </footer>
              {palOpen && (
                <ThemePalette
                  baseTokens={baseTokens}
                  value={palette}
                  onChange={updatePalette}
                  onClose={() => setPalOpen(false)}
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="tpl-demo-stage" data-accent={t.id}>
          {t.sections.map((sec, idx) => (
            <DemoSection key={sec.id || idx} sec={sec} t={t} idx={idx} />
          ))}
          <footer className="tpl-demo-footer">
            <span>© {new Date().getFullYear()} {t.name} Demo · 内容为演示数据（Demo / Test）</span>
            <span>Powered by CrossPilot</span>
          </footer>
        </div>
      )}
    </div>
  )
}

function DemoSection({ sec, t, idx }) {
  const p = sec.props || {}
  switch (sec.type) {
    case 'hero':
      return (
        <section className={`demo-hero demo-hero-${p.background || 'light'}`} data-align={p.align || 'left'}>
          <div className="demo-hero-inner">
            {p.eyebrow && <p className="demo-eyebrow">{p.eyebrow}</p>}
            <h1>{(p.title || '').split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}</h1>
            <p className="demo-lead">{p.description}</p>
            <div className="demo-actions">
              <button className="demo-btn primary">{p.cta || 'Get a Quote'}</button>
              <button className="demo-btn">Browse Products</button>
            </div>
          </div>
          <div className="demo-hero-visual" style={{ background: t.accent }} />
        </section>
      )
    case 'trust':
      return (
        <div className="demo-trust">
          {(p.items || []).map((b) => (
            <span key={b}>{b}</span>
          ))}
        </div>
      )
    case 'products':
      return (
        <section className="demo-block">
          <div className="demo-block-head">
            <span className="demo-idx">{String(idx + 1).padStart(2, '0')}</span>
            <h2>{p.title || 'Products'}</h2>
          </div>
          <div className="demo-product-grid">
            {[1, 2, 3].map((n) => (
              <article key={n} className="demo-product">
                <div className="demo-product-media" style={{ background: t.accent, opacity: 0.16 + n * 0.08 }} />
                <span className="demo-cat">Series {n}</span>
                <h3>Demo Product {n}</h3>
                <dl>
                  <div><dt>Capacity</dt><dd>{n * 40} m³/h</dd></div>
                  <div><dt>Model</dt><dd>DM-{100 + n}</dd></div>
                </dl>
                <span className="demo-link">Request Quote →</span>
              </article>
            ))}
          </div>
        </section>
      )
    case 'applications':
      return (
        <section className="demo-block alt">
          <div className="demo-block-head">
            <span className="demo-idx">{String(idx + 1).padStart(2, '0')}</span>
            <h2>{p.title || 'Applications'}</h2>
          </div>
          <div className="demo-app-grid">
            {['Municipal', 'Industrial', 'Mining'].map((a, n) => (
              <article key={a} className={`demo-app a${n + 1}`}>
                <div className="demo-app-media" style={{ background: t.accent, opacity: 0.2 + n * 0.1 }} />
                <h3>{a}</h3>
                <p>Application scenario description with project context and outcomes.</p>
              </article>
            ))}
          </div>
        </section>
      )
    case 'capability':
      return (
        <section className="demo-block dark">
          <div className="demo-cap">
            <div>
              <span className="demo-idx light">{String(idx + 1).padStart(2, '0')}</span>
              <h2>{p.title || 'Capability'}</h2>
              <p>Engineering, manufacturing and delivery capabilities described here.</p>
            </div>
            <div className="demo-cap-stats">
              {[['20+', 'Years'], ['60+', 'Countries'], ['300+', 'Projects'], ['48h', 'Response']].map(([v, l]) => (
                <div key={l}><b>{v}</b><span>{l}</span></div>
              ))}
            </div>
          </div>
        </section>
      )
    case 'cases':
      return (
        <section className="demo-block">
          <div className="demo-block-head">
            <span className="demo-idx">{String(idx + 1).padStart(2, '0')}</span>
            <h2>{p.title || 'Cases'}</h2>
          </div>
          <div className="demo-case-grid">
            {['EPC Project A', 'Plant Upgrade B', 'Turnkey C'].map((c) => (
              <article key={c} className="demo-case">
                <span className="demo-sector">Demo Case</span>
                <h3>{c}</h3>
                <span className="demo-result">Delivered on schedule · Demo data</span>
              </article>
            ))}
          </div>
        </section>
      )
    case 'cta':
      return (
        <section className="demo-block cta-band" style={{ background: t.accent }}>
          <h2 className="demo-cta-title">{p.title || 'Get a Quote'}</h2>
          <p>Send your requirements — demo band.</p>
          <button className="demo-btn light">{p.cta || 'Send Inquiry'}</button>
        </section>
      )
    default:
      return null
  }
}
