import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'
import { templateBySlug } from '../Templates/templates-data'
import '../Templates/templates.css'

// 体验建站：输入产品类别 → 本地即时生成一个可预览的独立站（无需登录 / 无验证码）。
// 内容为按类别拼装的演示数据（标注 Demo），登录后才走真实 AI 生成链路。
const TRY_PRESETS = ['工业水泵', 'LED 照明', '食品机械', '汽车配件', '建筑陶瓷', '宠物用品']

const CATEGORY_META = {
  工业水泵: { en: 'Industrial Pumps', apps: ['市政供水', '工业循环水', '矿山排水'], spec: [['流量', '240 m³/h'], ['扬程', '85 m']] },
  'LED 照明': { en: 'LED Lighting', apps: ['商业照明', '市政工程', '植物工厂'], spec: [['光效', '160 lm/W'], ['寿命', '50,000 h']] },
  食品机械: { en: 'Food Machinery', apps: ['中央厨房', '烘焙产线', '饮料灌装'], spec: [['产能', '2.4 t/h'], ['材质', 'SUS304']] },
  汽车配件: { en: 'Auto Parts', apps: ['主机配套', '售后维修', '出口批发'], spec: [['公差', '±0.02 mm'], ['认证', 'IATF 16949']] },
  建筑陶瓷: { en: 'Building Ceramics', apps: ['地产精装', '市政景观', '海外工程'], spec: [['吸水率', '≤0.5%'], ['防滑', 'R10']] },
  宠物用品: { en: 'Pet Supplies', apps: ['连锁零售', '电商品牌', '海外分销'], spec: [['材质', '食品级硅胶'], ['起订', '500 件']] },
}

function metaFor(cat) {
  return CATEGORY_META[cat.trim()] || { en: cat.trim() || 'Your Products', apps: ['工程项目', '批发分销', '品牌定制'], spec: [['品质', '稳定交付'], ['定制', 'OEM/ODM']] }
}

function buildTrySections(cat) {
  const m = metaFor(cat)
  const name = cat.trim() || '你的产品'
  return [
    { type: 'hero', props: { eyebrow: `PREVIEW · ${m.en.toUpperCase()}`, title: `${name}源头工厂\n批量供应 · 支持 OEM/ODM`, description: `面向全球采购商的 ${name} 独立站首屏：突出产能、认证与交付能力，引导询盘。`, cta: '获取报价方案' } },
    { type: 'trust', props: { items: ['ISO 9001', 'CE 认证', '48h 响应', '全球交付'] } },
    { type: 'products', props: { title: `${name} · 产品系列` } },
    { type: 'applications', props: { title: '应用场景' } },
    { type: 'capability', props: { title: '工程与交付能力' } },
    { type: 'cta', props: { title: `像这样把你的 ${name} 卖向全球` } },
  ]
}

function TrySection({ sec, t, idx, m }) {
  const p = sec.props || {}
  switch (sec.type) {
    case 'hero':
      return (
        <section className="demo-hero demo-hero-light" data-align="left">
          <div className="demo-hero-inner">
            <p className="demo-eyebrow">{p.eyebrow}</p>
            <h1>{(p.title || '').split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}</h1>
            <p className="demo-lead">{p.description}</p>
            <div className="demo-actions">
              <button className="demo-btn primary">{p.cta}</button>
              <button className="demo-btn">浏览产品</button>
            </div>
          </div>
          <div className="demo-hero-visual" style={{ background: t.accent }} />
        </section>
      )
    case 'trust':
      return <div className="demo-trust">{(p.items || []).map((b) => <span key={b}>{b}</span>)}</div>
    case 'products':
      return (
        <section className="demo-block">
          <div className="demo-block-head"><span className="demo-idx">01</span><h2>{p.title}</h2></div>
          <div className="demo-product-grid">
            {[1, 2, 3].map((n) => (
              <article key={n} className="demo-product">
                <div className="demo-product-media" style={{ background: t.accent, opacity: 0.16 + n * 0.08 }} />
                <span className="demo-cat">系列 {n}</span>
                <h3>{m.en} Series {n}</h3>
                <dl>
                  <div><dt>{m.spec[0][0]}</dt><dd>{m.spec[0][1]}</dd></div>
                  <div><dt>{m.spec[1][0]}</dt><dd>{m.spec[1][1]}</dd></div>
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
          <div className="demo-block-head"><span className="demo-idx">02</span><h2>{p.title}</h2></div>
          <div className="demo-app-grid">
            {m.apps.map((a, n) => (
              <article key={a} className={`demo-app a${n + 1}`}>
                <div className="demo-app-media" style={{ background: t.accent, opacity: 0.2 + n * 0.1 }} />
                <h3>{a}</h3>
                <p>按场景组织的解决方案与交付案例（演示内容）。</p>
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
              <span className="demo-idx light">03</span>
              <h2>{p.title}</h2>
              <p>研发、制造、质检与出口交付的一体化能力说明。</p>
            </div>
            <div className="demo-cap-stats">
              {[['20+', '年制造经验'], ['60+', '出口国家'], ['300+', '交付项目'], ['48h', '询盘响应']].map(([v, l]) => (
                <div key={l}><b>{v}</b><span>{l}</span></div>
              ))}
            </div>
          </div>
        </section>
      )
    case 'cta':
      return (
        <section className="demo-block cta-band" style={{ background: t.accent }}>
          <h2 className="demo-cta-title">{p.title}</h2>
          <p>登录后用真实 AI 链路生成你的中 / 英 / 俄三语站点（演示数据不复用）。</p>
          <button className="demo-btn light">发送询盘</button>
        </section>
      )
    default:
      return null
  }
}

// 使用说明：把「我要做什么 → 去哪里做 → 怎么确认成功」讲清楚。
// 每条流程都带真实跳转入口，不是静态说明文档。
const FLOWS = [
  {
    id: 'site',
    title: '从零建站',
    goal: '得到一个可对外的三语独立站',
    steps: [
      { t: '填写企业信息', d: '行业、主营品类、目标市场 —— 这决定首屏主张与信息层级', to: '/onboarding' },
      { t: 'AI 完整生成', d: '生成首屏、产品区、认证墙、FAQ、RFQ 表单等完整结构', to: '/' },
      { t: '人工确认后发布', d: '所有 AI 产出的内容都先出 Draft + Diff，确认后才写入线上', to: '/agent' },
      { t: '到独立站前台核对', d: '确认访客看到的就是你要表达的内容', to: '/', site: true },
    ],
    note: '每个企业有 1 次免费的 AI 完整生成机会。之后的重新生成属于付费能力。',
  },
  {
    id: 'product',
    title: '上架产品',
    goal: '让产品能被搜索到、被看懂、被询价',
    steps: [
      { t: '导入或新建产品', d: '支持 Excel/CSV 批量导入，自动解析规格与分类', to: '/products' },
      { t: '补齐规格与卖点', d: '采购商关心的参数、认证、交付周期直接决定询盘意愿', to: '/products' },
      { t: '跑一次 SEO 优化', d: '真实改写 Title / Slug / Meta / H1 / FAQ / Schema，不是只涨分数', to: '/seo' },
      { t: '发布并留版本', d: '每次发布生成版本记录，随时可对比与回滚', to: '/versions' },
    ],
    note: 'SEO 优化属于付费能力；优化前后可在「版本历史」里逐字段对比。',
  },
  {
    id: 'inquiry',
    title: '处理询盘',
    goal: '把访客变成可跟进的商机',
    steps: [
      { t: '询盘自动落库', d: '独立站 RFQ 表单提交后直接写入数据库，不依赖邮件', to: '/inquiries' },
      { t: '按状态跟进', d: '新询盘 → 已联系 → 已报价 → 成交，全程可追溯', to: '/inquiries' },
      { t: '建跟进任务', d: '为询盘创建带步骤的跟进任务，避免漏单', to: '/inquiries' },
      { t: '导出交接', d: '支持 CSV 导出，方便交给销售或 CRM', to: '/inquiries' },
    ],
  },
  {
    id: 'market',
    title: '多语言市场',
    goal: '中 / 英 / 俄不是翻译，而是按市场重构',
    steps: [
      { t: '选择目标市场', d: '不同市场的信任元素、CTA 与信息详略都不一样', to: '/localization' },
      { t: '生成市场版本', d: '俄语区强化 EAC/交付说明，英语区强化规格对比', to: '/localization' },
      { t: '核对本地表达', d: '在独立站前台切换语言实际查看', to: '/', site: true },
    ],
    note: '高级三语本地化属于付费能力。',
  },
  {
    id: 'version',
    title: '版本与回滚',
    goal: '任何改动都可追溯、可撤销',
    steps: [
      { t: '查看变更记录', d: '发布 / 编辑 / SEO / GEO / 回滚都会留痕', to: '/versions' },
      { t: '对比 before/after', d: '逐字段查看改了什么，确认是否符合预期', to: '/versions' },
      { t: '确认真回滚', d: '回滚会真实写回数据库，并生成一条新的回滚版本', to: '/versions' },
    ],
  },
]

const FAQ = [
  {
    q: '为什么我的按钮点了没钱也没反应？',
    a: '付费能力会弹出统一的套餐升级窗口，并创建一条真实的服务订单记录。可以在「模板商城 → 我的购买记录」里看到它，刷新后依然存在。',
  },
  {
    q: 'AI 会直接改我的线上网站吗？',
    a: '不会。所有内容变更都遵循 Draft → Diff → 人工确认 → Publish。没有你的确认，线上内容不会变。',
  },
  {
    q: '回滚是真回滚吗？',
    a: '是。回滚会读取历史版本的 before 快照并真实写回数据库，同时生成一条 action=rollback 的新版本记录。回滚后可再次回滚撤销。',
  },
  {
    q: '免费额度怎么算？',
    a: '每个企业（租户）1 次免费的 AI 完整建站。额度按企业独立计算，不与其他企业共享。',
  },
  {
    q: 'SEO 优化会改哪些字段？',
    a: 'Title、Slug、Meta Description、H1、FAQ、图片 ALT、Schema 结构化数据与内链。优化前后可在版本历史里逐字段对比。',
  },
]

export default function HelpPage() {
  const navigate = useNavigate()
  const { entitlements } = useApp()
  const { planName, isFree } = useEntitlement()
  const [open, setOpen] = useState('site')
  const [tryCat, setTryCat] = useState('')
  const [tryResult, setTryResult] = useState(null)

  const current = useMemo(() => FLOWS.find((f) => f.id === open) || FLOWS[0], [open])

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">HELP CENTER</div>
          <h1>使用说明</h1>
          <p>
            按「我要做什么」组织，每个步骤都直接跳到对应功能页。
            当前套餐：<b>{planName || (isFree ? '免费版' : '专业版')}</b>
            {entitlements?.features ? ` · 已开通 ${entitlements.features.length} 项能力` : ''}
          </p>
        </div>
        <div className="head-actions">
          <button className="primary-btn" onClick={() => navigate('/onboarding')}>重新走一遍建站流程</button>
        </div>
      </div>

      <div className="help-layout">
        <aside className="help-nav panel">
          <div className="panel-head">
            <h3>我想……</h3>
          </div>
          {FLOWS.map((f) => (
            <button
              key={f.id}
              className={`help-nav-item${open === f.id ? ' active' : ''}`}
              onClick={() => setOpen(f.id)}
            >
              <strong>{f.title}</strong>
              <small>{f.goal}</small>
            </button>
          ))}
        </aside>

        <div className="help-main">
          <div className="panel help-try-panel">
            <div className="panel-head">
              <h3>⚡ 体验建站 · 30 秒预览你产品的网站</h3>
              <span className="usage-pill">免登录 · 无需验证码</span>
            </div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              输入你的产品类别，立即本地生成一个可浏览的独立站预览（演示数据）。
              不注册、不登录、不填验证码 —— 满意了再登录用真实 AI 生成中 / 英 / 俄三语站点。
            </p>
            <div className="help-try-row">
              <input
                className="help-try-input"
                placeholder="例如：工业水泵 / LED 照明 / 食品机械…"
                value={tryCat}
                onChange={(e) => setTryCat(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setTryResult(tryCat)}
              />
              <button className="primary-btn" onClick={() => setTryResult(tryCat)}>生成预览网站</button>
            </div>
            <div className="help-try-chips">
              {TRY_PRESETS.map((c) => (
                <button key={c} className={`help-try-chip${tryCat === c ? ' on' : ''}`} onClick={() => setTryCat(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>{current.title}</h3>
              <span className="usage-pill">{current.steps.length} 步</span>
            </div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>{current.goal}</p>
            <ol className="help-steps">
              {current.steps.map((s, i) => (
                <li key={s.t}>
                  <span className="help-step-no">{i + 1}</span>
                  <div className="help-step-body">
                    <strong>{s.t}</strong>
                    <p>{s.d}</p>
                    <button className="link-btn" onClick={() => navigate(s.to)}>
                      {s.site ? '打开独立站前台 →' : '前往该功能 →'}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            {current.note && <div className="help-note">💡 {current.note}</div>}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>常见问题</h3>
            </div>
            <div className="help-faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>还需要人工帮忙？</h3>
            </div>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.75 }}>
              在「AI 增长」里选择对应能力并提交专业服务任务，平台团队会接手执行；
              任务进度与交付结果在提交后即可实时查看，不需要等待邮件回复。
            </p>
            <div className="vdrawer-actions">
              <button className="primary-btn" onClick={() => navigate('/growth')}>前往 AI 增长</button>
              <button className="ghost-btn" onClick={() => navigate('/templates')}>浏览模板商城</button>
            </div>
          </div>
        </div>
      </div>

      {tryResult !== null && (
        <div className="help-try-overlay">
          <div className="tpl-public-page">
            <header className="tpl-demo-topbar">
              <div className="tpl-demo-brand">
                <span className="tpl-demo-logo" style={{ background: (templateBySlug('industrial-pro') || {}).accent }}>
                  {(tryCat.trim() || 'P').charAt(0)}
                </span>
                <div>
                  <strong>{tryCat.trim() || '你的产品'} · 独立站预览</strong>
                  <span>体验建站 · 本地即时生成</span>
                </div>
              </div>
              <div className="tpl-demo-actions">
                <span className="site-status site-status-published">DEMO DATA</span>
                <button className="ghost-btn" onClick={() => setTryResult(null)}>← 换个类别</button>
                <button className="primary-btn" onClick={() => navigate('/login')}>登录后真实生成</button>
              </div>
            </header>
            <div className="tpl-demo-stage" data-accent="industrial-pro">
              {buildTrySections(tryResult).map((sec, idx) => (
                <TrySection key={idx} sec={sec} t={templateBySlug('industrial-pro') || {}} idx={idx} m={metaFor(tryResult)} />
              ))}
              <footer className="tpl-demo-footer">
                <span>© {new Date().getFullYear()} 体验建站 Demo · 内容为演示数据（Demo / Test）</span>
                <span>Powered by CrossPilot</span>
              </footer>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
