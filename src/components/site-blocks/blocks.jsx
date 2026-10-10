import './site-blocks.css'

/**
 * Schema-driven Site Blocks(PHASE 5/6)。
 * 每个组件只消费 props(由后端 layout_schema 输出),禁止 dangerouslySetInnerHTML。
 * 真实图片:props.image(Asset Slot 管线注入)→ <img> 懒加载/alt/错误回退/CSS 占位兜底。
 * ctx: { designTokens, market, productName, locale }
 */

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

export function HeroIndustrial({ props = {}, variant = '', ctx }) {
  const t = ctx?.designTokens || {}
  const dark = variant === 'technical-dark' || ctx?.market === 'ru-RU'
  return (
    <section
      className="sb-hero"
      data-variant={variant || 'industrial'}
      style={{
        background: dark
          ? `linear-gradient(135deg, ${t.primary || '#141a24'}, ${t.primary_deep || '#0b0f16'})`
          : `linear-gradient(135deg, ${t.bg || '#f7f8fa'}, #fff)`,
        color: dark ? t.on_dark || '#e6ebf2' : t.text || '#182230',
      }}
    >
      <div className="sb-hero-inner">
        {props.eyebrow && <p className="sb-eyebrow" style={{ color: t.accent || '#c2570c' }}>{props.eyebrow}</p>}
        <h1 style={{ fontSize: 'clamp(28px, 4.4vw, 46px)', margin: '0 0 14px', lineHeight: 1.15 }}>
          {props.title || ctx?.productName || 'Products'}
        </h1>
        {props.description && <p className="sb-lead">{props.description}</p>}
        {props.cta && (
          <button
            className="sb-btn"
            style={{ background: t.accent || '#c2570c', color: t.on_accent || '#fff' }}
          >
            {props.cta}
          </button>
        )}
      </div>
      <SlotImage src={props.image} alt={props.title || 'hero'} className="sb-img sb-hero-img" />
    </section>
  )
}

export function BenefitsGrid({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  const items = (props.items || []).slice(0, 6)
  return (
    <section className="sb-block">
      <h2>{props.title || 'Why us'}</h2>
      <div className="sb-grid">
        {(items.length ? items : ['Reliability', 'Delivery', 'Support']).map((b, i) => (
          <div className="sb-card" key={i} style={{ borderColor: t.border || '#e3e8ef' }}>
            <b>{typeof b === 'string' ? b : b.title}</b>
            {typeof b === 'object' && b.desc && <p>{b.desc}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

export function ProductGrid({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  const items = (props.items || []).slice(0, 6)
  return (
    <section className="sb-block">
      <h2>{props.title || 'Products'}</h2>
      <div className="sb-grid sb-grid-3">
        {(items.length ? items : [1, 2, 3].map((n) => ({ name: `Series ${n}` }))).map((p, i) => (
          <div className="sb-card sb-product" key={i} style={{ borderColor: t.border || '#e3e8ef' }}>
            <div className="sb-media" style={{ background: (t.primary || '#1f2733') + '22' }} />
            <b>{p.name || p.title}</b>
            {p.spec && <p className="sb-muted">{p.spec}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

export function SpecsTable({ props = {}, ctx }) {
  const rows = (props.rows || []).slice(0, 8)
  return (
    <section className="sb-block">
      <h2>{props.title || 'Key specifications'}</h2>
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
    </section>
  )
}

export function Applications({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  const items = (props.items || []).slice(0, 4)
  return (
    <section className="sb-block sb-alt">
      <h2>{props.title || 'Applications'}</h2>
      <div className="sb-grid">
        {(items.length ? items : ['Automotive', 'Electronics', 'Metalworking']).map((a, i) => (
          <div className="sb-card" key={i}>
            <div className="sb-media" style={{ background: (t.accent || '#c2570c') + '1f' }} />
            <b>{typeof a === 'string' ? a : a.name}</b>
          </div>
        ))}
      </div>
    </section>
  )
}

export function CertGrid({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  const items = props.items || []
  return (
    <section className="sb-block">
      <h2>{props.title || 'Certifications & Trust'}</h2>
      <div className="sb-trust">
        {(items.length ? items : ['ISO 9001', 'CE', 'EAC']).map((c, i) => (
          <span key={i} style={{ borderColor: t.accent || '#c2570c', color: t.text || '#182230' }}>{c}</span>
        ))}
      </div>
    </section>
  )
}

export function CasesGrid({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  const items = (props.items || []).slice(0, 3)
  return (
    <section className="sb-block">
      <h2>{props.title || 'Case studies'}</h2>
      <div className="sb-grid sb-grid-3">
        {(items.length ? items : ['Project A', 'Project B', 'Project C']).map((c, i) => (
          <div className="sb-card" key={i} style={{ borderColor: t.border || '#e3e8ef' }}>
            <div className="sb-media" style={{ background: (t.primary || '#1f2733') + '18' }} />
            <b>{typeof c === 'string' ? c : c.title}</b>
            {typeof c === 'object' && c.result && <p className="sb-muted">{c.result}</p>}
          </div>
        ))}
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
      <h2>{props.title || 'FAQ'}</h2>
      <div className="sb-faq">
        {(items.length ? items : DEMO_FAQ).map((f, i) => (
          <details key={i}>
            <summary>{Array.isArray(f) ? f[0] : f.q}</summary>
            <p>{Array.isArray(f) ? f[1] : f.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

export function RfqBlock({ props = {}, ctx }) {
  const t = ctx?.designTokens || {}
  return (
    <section className="sb-block sb-rfq" style={{ background: t.primary || '#141a24', color: t.on_dark || '#e6ebf2' }}>
      <h2 style={{ color: 'inherit' }}>{props.title || 'Request a quote'}</h2>
      <p className="sb-muted" style={{ color: (t.on_dark || '#ccc') + 'cc' }}>
        {props.description || 'Send your requirements — our engineers reply within 48h.'}
      </p>
      <button className="sb-btn" style={{ background: t.accent || '#c2570c', color: t.on_accent || '#fff' }}>
        {props.cta || 'Submit RFQ'}
      </button>
    </section>
  )
}
