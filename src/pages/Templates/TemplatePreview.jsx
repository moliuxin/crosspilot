import { Link, useParams } from 'react-router-dom'
import { templateBySlug } from './templates-data'
import './templates.css'

/**
 * 模板 Demo 预览（公开路由 /templates/:slug，无需登录）。
 *
 * - 按模板自己的 sections 结构渲染（不同模板 = 不同页面结构，不是换色）；
 * - 内容为 Demo 数据并明确标注（Truthfulness 规则：Demo 必须标注）；
 * - 登录后可「使用模板」创建网站；未登录先记录 intended_template 再去登录。
 */
export default function TemplatePreview() {
  const { slug } = useParams()
  const t = templateBySlug(slug)

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
    // 未登录：记录意图模板 → 登录后回到模板继续（不强制未登录用户注册）
    if (!localStorage.getItem('sitepilot.token')) {
      sessionStorage.setItem('sitepilot.intended_template', t.id)
      window.location.hash = '#/login'
      return
    }
    window.location.hash = `#/sites/new?template=${t.id}`
  }

  return (
    <div className="tpl-public-page">
      <header className="tpl-demo-topbar">
        <div className="tpl-demo-brand">
          <span className="tpl-demo-logo" style={{ background: t.accent }}>{t.name.charAt(0)}</span>
          <div>
            <strong>{t.name}</strong>
            <span>{t.industry} · Demo 预览</span>
          </div>
        </div>
        <div className="tpl-demo-actions">
          <span className="site-status site-status-published">DEMO DATA</span>
          <Link className="ghost-btn" to="/templates">← 返回商城</Link>
          <button className="primary-btn" onClick={useTemplate}>使用模板</button>
        </div>
      </header>

      <div className="tpl-demo-stage" data-accent={t.id}>
        {t.sections.map((sec, idx) => (
          <DemoSection key={sec.id || idx} sec={sec} t={t} idx={idx} />
        ))}
        <footer className="tpl-demo-footer">
          <span>© {new Date().getFullYear()} {t.name} Demo · 内容为演示数据（Demo / Test）</span>
          <span>Powered by CrossPilot</span>
        </footer>
      </div>
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
