// site-preview.html 的独立入口：渲染客户独立站前台
// 视觉方向（参考 Beautiful Web Template 气质）：
//   大留白 / 大图 / 高级字体层级 / 强首屏 / 少边框 / 少卡片 / 图片优先 / 内容块呼吸感
// 结构：上（定位+Hero+卖点+信任）— 中（系列+产品+场景+实力+案例）— 下（证书+FAQ+资料+RFQ+联系）
import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useState } from 'react'
import { marketTemplates, marketOrder } from './data/marketTemplates'
import { resolveIndustryVisual } from './data/brand'
import { api, getSitePreviewData } from './services/api'
import BrandIntro from './components/brand/BrandIntro'
import {
  siteNav,
  siteSeries,
  siteApplications,
  siteCapability,
  siteCases,
  siteCertificates,
  siteResources,
  siteContact,
  siteUI,
} from './data/siteContent'
import './components/site/site.css'

// 默认品牌：仅在「租户未发布站点 / 无品牌信息」时作为模板兜底。
// 正常路径由 /api/public/site?tenant=<slug> 按租户注入（每家企业一套独立站）。
const DEFAULT_BRAND = {
  name: 'Your Brand',
  sub: 'B2B MANUFACTURER',
  logoText: 'Y',
  logoUrl: '',
  primary: '#0e7490',
  primary2: '#155e75',
  dark: '#07161b',
}

const pick = (obj, market) => (obj && (obj[market] ?? obj['en-US'])) || ''

/** 区块样式 props → 前台渲染属性（与编辑器画布同一套取值） */
const styleAttrs = (props = {}) => ({
  'data-pad': props.padding || 'comfortable',
  'data-align': props.align || 'left',
  'data-bg': props.background || 'light',
})

function SiteApp() {
  const [market, setMarket] = useState('en-US')
  const [saved, setSaved] = useState({ page: null, products: [], brand: null, tenant: null })
  const [loading, setLoading] = useState(true)
  const template = marketTemplates[market]
  const t = siteUI[market]
  const visual = useMemo(() => resolveIndustryVisual('industrial equipment'), [])

  // 读取「按租户渲染的已发布站点」：URL 带 ?tenant=<slug> 时来自 /api/public/site；
  // 无参数时退回已登录链路；都拿不到才用内置模板兜底（首次访问体验不降级）。
  useEffect(() => {
    let alive = true
    getSitePreviewData()
      .then((d) => { if (alive) setSaved(d || { page: null, products: [], brand: null, tenant: null }) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // 品牌随租户走：接口给什么就用什么，缺失才回退默认模板
  const brand = useMemo(() => {
    const b = saved.brand
    if (!b?.name) return DEFAULT_BRAND
    const seed = String(b.name).trim()
    return {
      ...DEFAULT_BRAND,
      name: seed.toUpperCase(),
      sub: (b.industry || DEFAULT_BRAND.sub).toUpperCase(),
      logoText: seed.charAt(0).toUpperCase(),
    }
  }, [saved.brand])

  const sectionOf = (type) => (saved.page?.sections || []).find((s) => s.type === type)
  // 后端已连通时产品就是真值（空即空），绝不用 mock 冒充
  const products = saved.products || []

  const heroSec = sectionOf('hero')
  const trustSec = sectionOf('trust')
  const seriesSec = sectionOf('products')
  const productsSec = sectionOf('products')
  const appsSec = sectionOf('applications')
  const capSec = sectionOf('capability')
  const casesSec = sectionOf('cases')
  const ctaSec = sectionOf('cta')

  return (
    <div
      className="site-page"
      data-market={market}
      data-loading={loading ? '1' : '0'}
      style={{ '--sb': brand.primary, '--sb2': brand.primary2, '--sbd': brand.dark }}
    >
      <BrandIntro brand={brand} variant="site" />

      <SiteNav market={market} setMarket={setMarket} template={template} t={t} brand={brand} />
      <SiteHero template={template} visual={visual} section={heroSec} brand={brand} />

      {/* 上部：信任背书 */}
      <TrustStrip badges={trustSec?.props?.items || template.trustBadges} section={trustSec} />

      <main className="site-main">
        {/* 中部：产品系列 */}
        <SeriesSection market={market} t={t} section={seriesSec} />

        {/* 中部：核心产品 */}
        <ProductsSection market={market} template={template} products={products} section={productsSec} />

        {/* 中部：应用场景 */}
        <ApplicationsSection market={market} t={t} section={appsSec} />

        {/* 中部：制造与工程能力 */}
        <CapabilitySection market={market} section={capSec} />

        {/* 中部：项目案例 */}
        <CasesSection market={market} t={t} section={casesSec} />

        {/* 下部：CTA（编辑器里添加/调整的询盘转化区块） */}
        {ctaSec && <CtaSection market={market} section={ctaSec} t={t} />}

        {/* 下部：证书 + FAQ + 资料 */}
        <LowerSection market={market} template={template} t={t} section={sectionOf('cases')} />

        {/* 下部：RFQ */}
        <RfqSection market={market} t={t} template={template} section={ctaSec} />
      </main>

      {/* 浮动 WhatsApp 商务联系（外贸买家首选沟通渠道，真实 wa.me 跳转） */}
      <WhatsAppFloat market={market} t={t} brand={brand} />

      {/* 下部：联系 + 页脚 */}
      <SiteFooter brand={brand} market={market} t={t} />
    </div>
  )
}

/* ---------------- WhatsApp 浮动联系 ---------------- */
const WA_TEXT = {
  'en-US': "Hello! I'm interested in your products. Could you share a quote for ",
  'ru-RU': 'Здравствуйте! Интересует ваша продукция. Пришлите, пожалуйста, расчёт для ',
  'zh-CN': '您好！我对贵司产品感兴趣，想咨询报价：',
}

function WhatsAppFloat({ market, t, brand }) {
  const digits = (siteContact.whatsapp || '').replace(/\D/g, '')
  if (!digits) return null
  // 预填的品牌名必须来自当前租户，而不是写死的演示品牌
  const text = `${WA_TEXT[market] || WA_TEXT['en-US']}${(brand || DEFAULT_BRAND).name}`.trim()
  return (
    <a
      className="wa-float"
      href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat on WhatsApp"
      title={`WhatsApp: ${siteContact.whatsapp}`}
    >
      <svg viewBox="0 0 32 32" width="26" height="26" fill="currentColor" aria-hidden="true">
        <path d="M16 3C9.4 3 4 8.3 4 14.9c0 2.6.8 5 2.3 7L4.4 29l7.3-1.9c1.9 1 4 1.6 6.3 1.6 6.6 0 12-5.3 12-11.9S22.6 3 16 3zm0 21.8c-2 0-3.9-.5-5.5-1.5l-.4-.2-4.3 1.1 1.2-4.1-.3-.4c-1.2-1.8-1.8-3.8-1.8-5.9 0-6 5-10.9 11.1-10.9s11.1 4.9 11.1 10.9-5 11-11.1 11zm6.1-8.2c-.3-.2-2-1-2.3-1.1-.3-.1-.5-.2-.8.2-.2.3-.9 1.1-1 1.3-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.3-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.5 0-.6-.1-.2-.8-1.9-1-2.6-.3-.6-.6-.5-.8-.6h-.7c-.2 0-.6.1-1 .5-.3.3-1.2 1.2-1.2 2.9s1.3 3.4 1.4 3.6c.2.2 2.5 3.9 6.1 5.4.9.4 1.5.6 2 .7.9.3 1.7.2 2.3.1.7-.1 2-.8 2.3-1.6.3-.8.3-1.5.2-1.6-.1-.2-.3-.3-.6-.4z" />
      </svg>
      <span className="wa-tip">{t.waTip || 'WhatsApp Us'}</span>
    </a>
  )
}

/* ---------------- 导航 ---------------- */
function SiteNav({ market, setMarket, template, t, brand }) {
  const [open, setOpen] = useState(false)
  const b = brand || DEFAULT_BRAND
  return (
    <header className="site-nav">
      <div className="site-nav-inner">
        <a className="site-logo" href="#top">
          {b.logoUrl ? (
            <img src={b.logoUrl} alt={b.name} />
          ) : (
            <span className="sl-mark">{b.logoText}</span>
          )}
          <span className="sl-name">{b.name}</span>
        </a>

        <nav className={`site-menu${open ? ' open' : ''}`}>
          {siteNav.map((n) => (
            <a key={n.key} href={`#${n.key}`}>
              {pick(n.label, market)}
            </a>
          ))}
        </nav>

        <div className="site-nav-actions">
          <select className="market-switch" value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Language">
            {marketOrder.map((m) => (
              <option key={m} value={m}>
                {marketTemplates[m].label}
              </option>
            ))}
          </select>
          <a className="site-cta" href="#rfq">
            {template.cta}
          </a>
          <button className="site-burger" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            ☰
          </button>
        </div>
      </div>
    </header>
  )
}

/* ---------------- Hero（强首屏） ---------------- */
function SiteHero({ template, visual, section, brand }) {
  const p = section?.props || {}
  const title = p.title || template.title
  const lines = title.split('\n')
  return (
    <section className="site-hero" id="top" data-visual={visual.mood} {...styleAttrs(p)}>
      <div className="sh-media" aria-hidden="true">
        <div className="sh-img" />
        <div className="sh-grad" />
      </div>

      <div className="sh-inner">
        <p className="sh-tag">{p.eyebrow || (brand?.sub ? `${brand.sub} · ${template.tag}` : template.tag)}</p>
        <h1 className="sh-title">
          {lines.map((l, i) => (
            <span key={i}>
              {l}
              {i < lines.length - 1 && <br />}
            </span>
          ))}
        </h1>
        <p className="sh-desc">{p.description || template.desc}</p>

        <div className="sh-actions">
          <a className="sh-primary" href="#rfq">
            {p.cta || template.cta}
          </a>
          <a className="sh-ghost" href="#products">
            {template.secondaryCta}
          </a>
        </div>

        <div className="sh-stats">
          {template.features.map((f) => (
            <div key={f.label}>
              <b>{f.value}</b>
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sh-scroll">
        {template.code === 'ru-RU' ? 'Прокрутите вниз' : template.code === 'zh-CN' ? '向下滚动' : 'Scroll to explore'}
      </div>
    </section>
  )
}

/* ---------------- 信任背书 ---------------- */
function TrustStrip({ badges, section }) {
  return (
    <div className="trust-strip-site" {...styleAttrs(section?.props)}>
      <div className="ts-inner">
        {badges.map((b) => (
          <span key={b}>{b}</span>
        ))}
      </div>
    </div>
  )
}

/* ---------------- 产品系列（大图） ---------------- */
function SeriesSection({ market, t, section }) {
  const p = section?.props || {}
  const heading = p.title || (market === 'ru-RU' ? 'Продукция' : market === 'zh-CN' ? '产品系列' : 'Product Series')
  return (
    <section className="site-block" id="products" {...styleAttrs(p)}>
      <div className="block-head">
        <span className="block-idx">01</span>
        <h2>{heading}</h2>
        <span className="block-more">{t.viewAll} →</span>
      </div>

      <div className="series-grid">
        {siteSeries.map((s) => (
          <article className={`series-card tone-${s.tone}`} key={s.id}>
            <div className="series-media" aria-hidden="true" />
            <div className="series-body">
              <span className="series-meta">{pick(s.meta, market)}</span>
              <h3>{pick(s.name, market)}</h3>
              <p>{pick(s.lead, market)}</p>
              <span className="series-link">{t.learnMore} →</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ---------------- 核心产品 ---------------- */
function ProductsSection({ market, template, products, section }) {
  const p = section?.props || {}
  const heading = p.title || (market === 'ru-RU' ? 'Избранные продукты' : market === 'zh-CN' ? '核心产品' : 'Featured Products')
  return (
    <section className="site-block alt" {...styleAttrs(p)}>
      <div className="block-head">
        <span className="block-idx">02</span>
        <h2>{heading}</h2>
      </div>

      <div className="products-edit">
        {products.slice(0, 4).map((p2, i) => (
          <article className="pe-item" key={p2.id}>
            <div className={`pe-media m${(i % 4) + 1}`} aria-hidden="true" />
            <div className="pe-body">
              <span className="pe-cat">{p2.category}</span>
              <h3>{p2.name}</h3>
              <p className="pe-model">{p2.model}</p>
              <dl className="pe-specs">
                {(p2.specs || []).slice(0, 3).map((s) => (
                  <div key={s.key}>
                    <dt>{s.key}</dt>
                    <dd>{s.value}</dd>
                  </div>
                ))}
              </dl>
              <a className="pe-link" href="#rfq">
                {template.cta} →
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ---------------- 应用场景 ---------------- */
function ApplicationsSection({ market, t, section }) {
  const p = section?.props || {}
  return (
    <section className="site-block" id="solutions" {...styleAttrs(p)}>
      <div className="block-head">
        <span className="block-idx">03</span>
        <h2>{p.title || t.applied}</h2>
      </div>

      <div className="apps-edit">
        {siteApplications.map((a, i) => (
          <article className={`app-item a${i + 1}`} key={a.id}>
            <div className="app-media" aria-hidden="true" />
            <div className="app-body">
              <h3>{pick(a.title, market)}</h3>
              <p>{pick(a.desc, market)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ---------------- 制造与工程能力 ---------------- */
function CapabilitySection({ market, section }) {
  const c = siteCapability
  const p = section?.props || {}
  return (
    <section className="site-block dark" id="capability" {...styleAttrs(p)}>
      <div className="cap-edit">
        <div className="cap-copy">
          <span className="block-idx light">04</span>
          <h2>{p.title || pick(c.title, market)}</h2>
          <p>{p.description || pick(c.desc, market)}</p>
        </div>
        <div className="cap-stats">
          {c.stats.map((s) => (
            <div key={s.value}>
              <b>{s.value}</b>
              <span>{pick(s.label, market)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------------- 项目案例 ---------------- */
function CasesSection({ market, t, section }) {
  const p = section?.props || {}
  return (
    <section className="site-block" id="cases" {...styleAttrs(p)}>
      <div className="block-head">
        <span className="block-idx">05</span>
        <h2>{p.title || t.cases}</h2>
      </div>

      <div className="cases-edit">
        {siteCases.map((c) => (
          <article className="case-item" key={c.id}>
            <span className="case-sector">{pick(c.sector, market)}</span>
            <h3>{pick(c.title, market)}</h3>
            <span className="case-result">{pick(c.result, market)}</span>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ---------------- 询盘 CTA（编辑器「添加模块」新增的区块） ---------------- */
function CtaSection({ market, section, t }) {
  const p = section?.props || {}
  return (
    <section className="site-block" id="cta-band" {...styleAttrs(p)}>
      <div className="block-head">
        <span className="block-idx">06</span>
        <h2>{p.title || t.rfqTitle}</h2>
      </div>
      <div className="block-copy">
        <p>{p.description || t.rfqLead}</p>
        <a className="sh-primary" href="#rfq">{p.cta || t.submit}</a>
      </div>
    </section>
  )
}

/* ---------------- 下部：证书 + FAQ + 资料 ---------------- */
function LowerSection({ market, template, t, section }) {
  const p = section?.props || {}
  return (
    <section className="site-block alt" id="resources" {...styleAttrs(p)}>
      <div className="lower-grid">
        <div className="lower-col">
          <h3 className="lower-title">
            {market === 'ru-RU' ? 'Сертификаты' : market === 'zh-CN' ? '资质认证' : 'Certificates'}
          </h3>
          <div className="cert-row">
            {siteCertificates.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>

          <h3 className="lower-title mt">{t.resources}</h3>
          <div className="res-list">
            {siteResources.map((r) => (
              <a className="res-item" key={r.id} href="#rfq">
                <span className="res-name">{pick(r.name, market)}</span>
                <span className="res-size">{r.size}</span>
                <span className="res-dl">{t.download} ↓</span>
              </a>
            ))}
          </div>
        </div>

        <div className="lower-col">
          <h3 className="lower-title">{t.faq}</h3>
          <div className="faq-edit">
            {template.faq.map((f) => (
              <details className="faq-q" key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------------- RFQ ---------------- */
// RFQ 表单：真实提交 → localStorage → 商家后台「询盘中心」可见（跨页面演示闭环）
function RfqSection({ market, t, template, section }) {
  const [form, setForm] = useState({ name: '', company: '', email: '', message: '' })
  const [errors, setErrors] = useState({})
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const sp = section?.props || {}

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    const tenantSlug = new URLSearchParams(window.location.search).get('tenant') || ''
    const errs = {}
    if (!form.name.trim()) errs.name = t.required
    if (!form.email.trim()) errs.email = t.required
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = t.emailInvalid
    if (!form.message.trim()) errs.message = t.required
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSending(true)
    // RFQ 是唯一允许匿名的写入：带上租户标识，询盘落进对应企业的后台
    await api.createInquiry(form, tenantSlug)
    setSending(false)
    setDone(true)
  }

  return (
    <section className="site-block rfq-block" id="rfq" {...styleAttrs(sp)}>
      <div className="rfq-inner">
        <div className="rfq-copy">
          <span className="block-idx light">06</span>
          <h2>{sp.title || t.rfqTitle}</h2>
          <p>{sp.description || t.rfqLead}</p>
          <div className="rfq-assure">
            {template.trustBadges.slice(0, 3).map((b) => (
              <span key={b}>{b}</span>
            ))}
          </div>
        </div>

        {done ? (
          <div className="rfq-done">
            <b>✓ {t.rfqDone}</b>
            <span>{t.rfqDoneLead}</span>
          </div>
        ) : (
          <form className="rfq-edit" onSubmit={submit} noValidate>
            <input placeholder={t.name} aria-label={t.name} value={form.name} onChange={set('name')} className={errors.name ? 'invalid' : ''} />
            {errors.name && <small className="rfq-err">{errors.name}</small>}
            <input placeholder={t.company} aria-label={t.company} value={form.company} onChange={set('company')} />
            <input placeholder={t.email} aria-label={t.email} type="email" value={form.email} onChange={set('email')} className={errors.email ? 'invalid' : ''} />
            {errors.email && <small className="rfq-err">{errors.email}</small>}
            <textarea placeholder={t.message} aria-label={t.message} rows={4} value={form.message} onChange={set('message')} className={errors.message ? 'invalid' : ''} />
            {errors.message && <small className="rfq-err">{errors.message}</small>}
            <button type="submit" disabled={sending}>{sending ? t.sending : t.submit}</button>
          </form>
        )}
      </div>
    </section>
  )
}

/* ---------------- 页脚 ---------------- */
function SiteFooter({ brand, market, t }) {
  return (
    <footer className="site-footer">
      <div className="sf-inner">
        <div className="sf-brand">
          <span className="sf-mark">{brand.logoText}</span>
          <div>
            <b>{brand.name}</b>
            <span>{brand.sub}</span>
          </div>
        </div>

        <div className="sf-cols">
          <div>
            <span className="sf-cap">{t.contact}</span>
            <a href={`mailto:${siteContact.email}`}>{siteContact.email}</a>
            <a href={`tel:${siteContact.phone}`}>{siteContact.phone}</a>
            <span>{pick(siteContact.address, market)}</span>
            <span>{pick(siteContact.hours, market)}</span>
          </div>
          <div>
            <span className="sf-cap">{t.resources}</span>
            {siteNav.map((n) => (
              <a key={n.key} href={`#${n.key}`}>
                {pick(n.label, market)}
              </a>
            ))}
          </div>
        </div>
      </div>
      <div className="sf-bottom">
        <span>
          © {new Date().getFullYear()} {brand.name}. All rights reserved.
        </span>
        <span>Built with WorkBuddy SitePilot</span>
      </div>
    </footer>
  )
}

createRoot(document.getElementById('site-root')).render(<SiteApp />)
