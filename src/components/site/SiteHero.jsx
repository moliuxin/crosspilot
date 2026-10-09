// 独立站前台 Hero（视觉基线来自 legacy-demo/site-preview.html）
// 不同市场使用不同结构：信息密度 / CTA / 信任元素 / 图片风格
export default function SiteHero({ template, compact = false, brand = 'AQUAFLOW' }) {
  if (!template) return null
  const lines = template.title.split('\n')

  return (
    <section className="site-hero" data-market={template.code}>
      <div className="hero-bg" aria-hidden="true" />
      <div className="hero-inner" style={compact ? { padding: '28px' } : undefined}>
        <div className="hero-copy">
          <small className="hero-tag">{template.tag}</small>
          <h1 className="hero-title">
            {lines.map((l, i) => (
              <span key={i}>
                {l}
                {i < lines.length - 1 && <br />}
              </span>
            ))}
          </h1>
          <p className="hero-desc">{template.desc}</p>
          <div className="hero-cta">
            <button className="hero-btn-primary">{template.cta}</button>
            <button className="hero-btn-ghost">{template.secondaryCta} →</button>
          </div>
          <div className="hero-stats">
            {template.features.map((f) => (
              <div key={f.label}>
                <b>{f.value}</b>
                <span>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-halo" />
          <div className="hero-machine"><span /><b /><i /></div>
          <div className="hero-techcard tc1"><small>System Capacity</small><b>120 m³/h</b></div>
          <div className="hero-techcard tc2"><small>Uptime</small><b>99.2%</b></div>
          <div className="hero-brandmark">{brand}<span>®</span></div>
        </div>
      </div>
      <div className="hero-trust">
        {template.trustBadges.map((b) => (
          <span key={b}>{b}</span>
        ))}
      </div>
    </section>
  )
}
