import './site-blocks.css'

/**
 * Schema-driven Site Blocks(PHASE 5/6 + v2 视觉升级)。
 * 每个组件只消费 props(由后端 layout_schema 输出),禁止 dangerouslySetInnerHTML。
 * 真实图片:props.image(Asset Slot 管线注入)→ <img> 懒加载/alt/错误回退/CSS 占位兜底。
 * ctx: { designTokens, market, productName, locale, products }
 * 设计令牌通过 CSS 变量(--sb-*)注入 section 根节点,样式集中在 site-blocks.css。
 */

/** hex → rgba(scrim 遮罩用);非 7 位 hex 原样返回避免炸样式 */
function hexA(hex, a) {
  if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const n = parseInt(hex.slice(1), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
  }
  return hex
}

/** designTokens → CSS 变量(CSS 侧自带回退值) */
function vars(t = {}) {
  return {
    '--sb-accent': t.accent,
    '--sb-primary': t.primary,
    '--sb-primary-deep': t.primary_deep,
    '--sb-radius': t.radius ? `${t.radius}px` : undefined,
  }
}

function SlotImage({ src, alt = '', className = 'sb-img', style }) {
  if (!src) return null
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      onError={(e) => { e.currentTarget.style.display = 'none' }}
    />
  )
}

/** 媒体框:有图满铺 4:3;无图时才渲染品牌色占位块 */
function MediaBox({ src, alt, tint, chip }) {
  return (
    <div className="sb-media" style={src ? undefined : { background: tint || 'rgba(127,137,161,0.16)' }}>
      <SlotImage src={src} alt={alt} className="sb-media-img" />
      {chip}
    </div>
  )
}

/** 区块标题:大标题 + accent 下划短杠 */
function BlockHead({ title }) {
  return (
    <div className="sb-head">
      <h2>{title}</h2>
      <i className="sb-head-bar" aria-hidden="true" />
    </div>
  )
}

export function HeroIndustrial({ props = {}, variant = '', ctx }) {
  const t = ctx?.designTokens || {}
  const dark = variant === 'technical-dark' || ctx?.market === 'ru-RU'
  const img = props.image
  const ctaLabel = props.cta || (ctx?.market === 'ru-RU' ? 'Запросить КП' : ctx?.market === 'zh-CN' ? '获取报价' : 'Get a Quote')
  const moreLabel = ctx?.market === 'ru-RU' ? 'Смотреть продукцию' : ctx?.market === 'zh-CN' ? '浏览产品' : 'Browse Products'
  return (
    <section
      className={`sb-hero${img ? ' sb-hero-media' : ''}`}
      data-variant={variant || 'industrial'}
      style={{
        ...vars(t),
        background: img ? undefined
          : dark
            ? `linear-gradient(135deg, ${t.primary || '#141a24'}, ${t.primary_deep || '#0b0f16'})`
            : `linear-gradient(135deg, ${t.bg || '#f7f8fa'}, #fff)`,
        color: img ? '#fff' : dark ? t.on_dark || '#e6ebf2' : t.text || '#182230',
      }}
    >
      {img && <SlotImage src={img} alt="" className="sb-hero-bg" />}
      {img && (
        <div
          className="sb-hero-scrim"
          style={{ background: `linear-gradient(100deg, ${hexA(t.primary_deep || '#0b0f16', 0.88)} 8%, ${hexA(t.primary || '#141a24', 0.55)} 52%, ${hexA(t.primary || '#141a24', 0.18)} 100%)` }}
        />
      )}
      <div className="sb-hero-inner">
        {props.eyebrow && <p className="sb-eyebrow" style={{ color: '#fff', borderColor: hexA(t.accent || '#c2570c', 0.65), background: hexA(t.accent || '#c2570c', 0.32) }}>{props.eyebrow}</p>}
        <h1>{props.title || ctx?.productName || 'Products'}</h1>
        {props.description && <p className="sb-lead">{props.description}</p>}
        <div className="sb-cta-row">
          <button className="sb-btn" style={{ background: t.accent || '#c2570c', color: t.on_accent || '#fff' }}>
            {ctaLabel}
          </button>
          <button className="sb-btn sb-btn-ghost">{moreLabel}</button>
        </div>
      </div>
    </section>
  )
}

export function BenefitsGrid({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  const items = (props.items || []).slice(0, 6)
  return (
    <section className="sb-block" style={vars(t)}>
      <div className="sb-inner">
        <BlockHead title={props.title || 'Why us'} />
        <div className="sb-grid">
          {(items.length ? items : ['Reliability', 'Delivery', 'Support']).map((b, i) => (
            <div className="sb-card sb-benefit" key={i}>
              <span className="sb-ico" aria-hidden="true">✓</span>
              <b>{typeof b === 'string' ? b : b.title}</b>
              {typeof b === 'object' && b.desc && <p className="sb-muted">{b.desc}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function ProductGrid({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  // 优先渲染站点挂载的真实产品(名称/型号/首条规格/产品图);无挂载产品时回落 props.items
  const linked = (ctx?.products || [])
    .filter((p) => (p.images || []).length > 0) // 只展示有真实图的产品,避免回落共享封面
    .slice(0, 6)
    .map((p) => ({
      name: p.name,
      model: p.model,
      spec: (p.specs || []).map((s) => (typeof s === 'string' ? s : `${s.key}: ${s.value}`))[0] || '',
      image: (p.images || [])[0] || '',
    }))
  const items = linked.length ? linked : (props.items || []).slice(0, 6)
  return (
    <section className="sb-block" style={vars(t)}>
      <div className="sb-inner">
        <BlockHead title={props.title || 'Products'} />
        <div className="sb-grid sb-grid-3">
          {(items.length ? items : [1, 2, 3].map((n) => ({ name: `Series ${n}` }))).map((p, i) => (
            <div className="sb-card sb-product" key={i}>
              <MediaBox
                src={p.image || (i === 0 ? props.image : '')}
                alt={p.name || p.title || 'product'}
                tint={hexA(t.primary || '#1f2733', 0.13)}
                chip={p.model ? <span className="sb-chip">{p.model}</span> : null}
              />
              <b>{p.name || p.title}</b>
              {p.spec && <p className="sb-muted">{p.spec}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function SpecsTable({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  const rows = (props.rows || []).slice(0, 8)
  return (
    <section className="sb-block" style={vars(t)}>
      <div className="sb-inner">
        <BlockHead title={props.title || 'Key specifications'} />
        <table className="sb-table">
          <tbody>
            {(rows.length ? rows : [['Model', '—'], ['Payload', '—'], ['Repeatability', '—']]).map((r, i) => (
              <tr key={i}>
                <th>{r[0]}</th>
                <td>{r[1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function Applications({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  const items = (props.items || []).slice(0, 4)
  return (
    <section className="sb-block" style={vars(t)}>
      <div className="sb-inner">
        <BlockHead title={props.title || 'Applications'} />
        <div className="sb-grid">
          {(items.length ? items : ['Automotive', 'Electronics', 'Metalworking']).map((a, i) => (
            <div className="sb-card" key={i}>
              <MediaBox
                src={typeof a === 'object' ? (a.image || props.image) : props.image}
                alt={typeof a === 'string' ? a : (a.name || 'application')}
                tint={hexA(t.accent || '#c2570c', 0.12)}
              />
              <b>{typeof a === 'string' ? a : a.name}</b>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function CertGrid({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  const items = props.items || []
  return (
    <section className="sb-block" style={vars(t)}>
      <div className="sb-inner">
        <BlockHead title={props.title || 'Certifications & Trust'} />
        <div className="sb-trust">
          {(items.length ? items : ['ISO 9001', 'CE', 'EAC']).map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
      </div>
    </section>
  )
}

export function CasesGrid({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  const items = (props.items || []).slice(0, 3)
  return (
    <section className="sb-block" style={vars(t)}>
      <div className="sb-inner">
        <BlockHead title={props.title || 'Case studies'} />
        <div className="sb-grid sb-grid-3">
          {(items.length ? items : ['Project A', 'Project B', 'Project C']).map((c, i) => (
            <div className="sb-card" key={i}>
              <MediaBox
                src={typeof c === 'object' ? (c.image || props.image) : props.image}
                alt={typeof c === 'string' ? c : (c.title || 'case')}
                tint={hexA(t.primary || '#1f2733', 0.11)}
              />
              <b>{typeof c === 'string' ? c : c.title}</b>
              {typeof c === 'object' && c.result && <p className="sb-muted">{c.result}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const DEMO_FAQ = [
  ['What is the lead time?', 'Typically 4–8 weeks depending on configuration.'],
  ['Do you provide commissioning?', 'Yes — installation, commissioning and operator training are included.'],
]

export function Faq({ props = {} }) {
  const items = (props.items || []).slice(0, 6)
  return (
    <section className="sb-block">
      <div className="sb-inner">
        <BlockHead title={props.title || 'FAQ'} />
        <div className="sb-faq">
          {(items.length ? items : DEMO_FAQ).map((f, i) => (
            <details key={i}>
              <summary>{Array.isArray(f) ? f[0] : f.q}</summary>
              <p>{Array.isArray(f) ? f[1] : f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

export function RfqBlock({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  return (
    <section
      className="sb-block sb-rfq"
      style={{
        ...vars(t),
        background: `linear-gradient(135deg, ${t.primary || '#141a24'}, ${t.primary_deep || '#0b0f16'})`,
        color: t.on_dark || '#e6ebf2',
      }}
    >
      <div className="sb-inner">
        <h2 style={{ color: 'inherit' }}>{props.title || 'Request a quote'}</h2>
        <p className="sb-muted" style={{ color: (t.on_dark || '#ccc') + 'cc', marginBottom: 22 }}>
          {props.description || 'Send your requirements — our engineers reply within 48h.'}
        </p>
        <button className="sb-btn" style={{ background: t.accent || '#c2570c', color: t.on_accent || '#fff' }}>
          {props.cta || 'Submit RFQ'}
        </button>
      </div>
    </section>
  )
}
