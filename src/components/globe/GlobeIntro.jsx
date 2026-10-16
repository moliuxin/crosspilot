import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/store/AppContext'
import Globe3D from './Globe3D'
import './globe-home.css'

const MK = (n) => `${import.meta.env.BASE_URL}marketing/${n}.webp`

/**
 * 全国赛产品官网首页(P0-1/2)。
 * 浅蓝白高端科技风 + Three.js 真 3D 地球 + 真实产品截图交错叙事。
 * 叙事顺序:3D 全球 Hero → AI建站 → 中英俄 Market-aware → SEO/GEO →
 *           Buyer Conversion → AI Brush → Agent 执行 → RFQ → 最终 CTA。
 * 所有截图来自 scripts/capture-marketing-assets.mjs(真实 CrossPilot UI,可重跑)。
 */
export default function GlobeIntro() {
  const navigate = useNavigate()
  const { authState } = useApp()
  const [authOpen, setAuthOpen] = useState(false)
  const heroRef = useRef(null)

  useEffect(() => {
    document.title = 'CrossPilot — AI 获客与转化智能体平台 | 让中国企业更快被全球客户看见'
  }, [])

  const go = (to) => navigate(authState === 'authed' ? to : '/login')

  return (
    <div className="nh">
      {/* ================= NAV ================= */}
      <header className="nh-nav">
        <div className="nh-brand">
          <span className="mark">C</span>
          <div><strong>CrossPilot</strong><span>AI 获客与转化智能体平台</span></div>
        </div>
        <nav className="nh-nav-actions">
          <button className="nh-link" onClick={() => navigate('/templates')}>模板商城</button>
          <button className="nh-link" onClick={() => document.getElementById('nh-markets')?.scrollIntoView({ behavior: 'smooth' })}>三市场演示</button>
          {authState === 'authed'
            ? <button className="nh-btn" onClick={() => navigate('/')}>进入工作台 →</button>
            : <button className="nh-btn" onClick={() => setAuthOpen(true)}>免费生成独立站</button>}
        </nav>
      </header>

      {/* ================= HERO(雪山冰湖背景 + 大型 3D 数字地球) ================= */}
      <section className="nh-hero" ref={heroRef}>
        <div className="nh-hero-bg" aria-hidden="true" />
        <div className="nh-hero-copy">
          <div className="nh-eyebrow">AI 驱动 · 让中国企业走向全球</div>
          <h1>让中国企业<br /><span className="grad">更快被全球客户看见</span></h1>
          <p className="nh-sub">一站式 AI 外贸独立站解决方案</p>
          <p className="nh-desc">
            从建站、GEO/SEO 优化到询盘转化,助力中国企业全球增长。
            AI 建站 · 市场本地化 · Buyer Conversion · RFQ 询盘,让海外增长从
            「人工运营」升级为「AI 持续执行」。
          </p>
          <div className="nh-cta-row">
            <button className="nh-btn xl" onClick={() => go('/sites/new')}>免费生成独立站 →</button>
            <button className="nh-btn ghost xl" onClick={() => document.getElementById('nh-sec-1')?.scrollIntoView({ behavior: 'smooth' })}>▶ 查看产品演示</button>
          </div>
          <div className="nh-chips">
            <span className="nh-chip"><i>✦</i> AI建站 <small>智能生成外贸网站</small></span>
            <span className="nh-chip"><i>⚝</i> SEO / GEO <small>获取全球流量</small></span>
            <span className="nh-chip"><i>◈</i> Buyer Conversion <small>采购转化准备度</small></span>
            <span className="nh-chip"><i>🤖</i> Multi-Agent <small>AI 智能获客助手</small></span>
            <span className="nh-chip"><i>✉</i> RFQ <small>询盘转化闭环</small></span>
          </div>
        </div>
        <div className="nh-hero-globe">
          <Globe3D />
          {/* 图1 式市场玻璃卡(柱状图为装饰;数字为 Demo 示意,非真实指标) */}
          <div className="nh-globe-tag t-cn">
            <span className="gt-flag">🇨🇳</span>
            <span className="gt-body"><b>中国市场<small>品牌曝光量</small></b><i className="gt-num">+260%</i></span>
            <span className="gt-bars" aria-hidden="true"><i /><i /><i /><i /></span>
            <em className="gt-demo">Demo</em>
          </div>
          <div className="nh-globe-tag t-en">
            <span className="gt-flag">🇺🇸🇬🇧</span>
            <span className="gt-body"><b>English Market<small>有效询盘</small></b><i className="gt-num">+320%</i></span>
            <span className="gt-bars" aria-hidden="true"><i /><i /><i /><i /></span>
            <em className="gt-demo">Demo</em>
          </div>
          <div className="nh-globe-tag t-ru">
            <span className="gt-flag">🇷🇺</span>
            <span className="gt-body"><b>俄罗斯市场<small>询盘增长</small></b><i className="gt-num">+180%</i></span>
            <span className="gt-bars" aria-hidden="true"><i /><i /><i /><i /></span>
            <em className="gt-demo">Demo</em>
          </div>
          <div className="nh-globe-hint">🖱 拖动旋转 · 松手自动巡航</div>
        </div>
        {/* 图1 式右侧真实数据栏(全部来自平台真实能力,非编造) */}
        <aside className="nh-side-stats" aria-label="平台真实数据">
          <div className="ss-item"><i>🌐</i><b>3 大市场</b><small>zh · en · ru 本地化生成</small></div>
          <div className="ss-item"><i>🤖</i><b>10+ Skills</b><small>真实 Skill Engine 落库</small></div>
          <div className="ss-item"><i>🔧</i><b>15 MCP 工具</b><small>真实读取业务数据</small></div>
          <div className="ss-item"><i>✅</i><b>357 测试</b><small>全链路自动化保障</small></div>
        </aside>
        {/* 曲面衔接下一屏 */}
        <div className="nh-hero-curve" aria-hidden="true" />
      </section>

      {/* ================= 1 AI SITE GENERATION ================= */}
      <MkSection id="nh-sec-1" flip={false}
        eyebrow="AI SITE GENERATION"
        title="做一个能带来询盘的外贸网站"
        desc="输入企业、产品和目标市场,CrossPilot 自动完成:"
        points={['行业理解 · Buyer Persona', '页面规划与内容生成', '视觉生成(产品相关图片)', 'RFQ 转化结构内置']}
        cta="免费生成企业网站" onCta={() => go('/sites/new')}
        shot={MK('mk-generate')} shotAlt="CrossPilot AI 建站向导(真实界面)"
      />

      {/* ================= 2 MARKET-AWARE(核心) ================= */}
      <section className="nh-sec nh-markets" id="nh-markets">
        <div className="nh-sec-head">
          <div className="nh-eyebrow">MARKET-AWARE LOCALIZATION</div>
          <h2>不是翻译网站,而是生成不同市场喜欢的网站</h2>
          <p className="nh-sec-sub">中 · 英 · 俄市场本地化 —— 同一个产品事实,三套不同市场体验。</p>
        </div>
        <div className="nh-mk3">
          {[
            { img: MK('mk-site-zh'), flag: '🇨🇳', t: '中文站', pts: ['制造能力 / 解决方案前置', '技术参数密度高', '本土设计感'] },
            { img: MK('mk-site-en'), flag: '🇺🇸', t: 'English Site', pts: ['Benefits / Applications', 'Certification 信任墙', 'Clean international layout'] },
            { img: MK('mk-site-ru'), flag: '🇷🇺', t: 'Русский сайт', pts: ['Key Specs / Supply 直给', 'Service 与技术细节', 'Technical information density'] },
          ].map((m) => (
            <figure className="nh-mk3-card" key={m.t}>
              <div className="nh-mk3-flag">{m.flag} {m.t}</div>
              <img src={m.img} alt={`${m.t} — CrossPilot 真实生成的市场变体`} loading="lazy" />
              <ul>{m.pts.map((p) => <li key={p}>{p}</li>)}</ul>
              <span className="nh-mk3-badge">{m.flag} {m.t}</span>
            </figure>
          ))}
        </div>
        <div className="nh-dims">
          {['Layout', 'Section Order', 'Copy', 'Image Style', 'CTA', 'FAQ', 'Trust Evidence'].map((d) => (
            <span key={d}>{d}</span>
          ))}
          <em>7 个维度由 Market Profile + Buyer Reading Strategy 驱动(Data-driven Localization)</em>
        </div>
        <div className="nh-sec-cta">
          <button className="nh-btn xl" onClick={() => go('/sites/new')}>查看三市场演示</button>
        </div>
      </section>

      {/* ================= 3 SEO / GEO ================= */}
      <MkSection flip
        eyebrow="SEO / GEO"
        title="让企业同时被搜索引擎与 AI 找到"
        desc="SEO 解决「搜索得到」,GEO 解决「AI 理解得到」。"
        points={['SEO / GEO 双报告(真实产品界面)', 'Entity · FAQ · Schema 结构化', 'AI Search Readiness 评估', '优化建议 → Draft → 发布']}
        cta="查看 SEO/GEO 演示" onCta={() => go('/seo/geo')}
        shot={MK('mk-seo')} shotAlt="CrossPilot GEO 可见性诊断报告(真实界面)"
      />

      {/* ================= 4 BUYER CONVERSION ================= */}
      <MkSection flip={false}
        eyebrow="BUYER CONVERSION"
        title="网站好不好,让采购商视角来判断"
        desc="以采购商阅读路径评估页面准备度 —— Readiness Score ≠ 成交概率。"
        points={['Buyer Persona 视角评估', '五维:Product Clarity / Trust / Procurement Info / CTA / RFQ', '缺失信息清单 + 可执行改进', '改进 → Draft → 发布 → Re-score']}
        cta="体验采购转化诊断" onCta={() => go('/seo/geo')}
        shot={MK('mk-site-ru')} shotAlt="采购商视角的真实俄语站页面"
        note="五维 Readiness 引擎即将上线;当前版本提供真实 SEO/GEO 诊断。"
      />

      {/* ================= 5 AI BRUSH ================= */}
      <MkSection flip
        eyebrow="AI BRUSH"
        title="圈一下,直接告诉 AI 怎么改"
        desc="选中区块 → 自然语言 → JSON Patch → Draft/Diff → 人工确认 → 发布 → 可回滚。"
        points={['Section Select + Instruction', 'Before / After 字段级 Diff', 'Confirm & Publish → Version', '一键 Rollback 恢复']}
        cta="体验 AI 画笔" onCta={() => go('/sites')}
        shot={MK('mk-brush')} shotAlt="AI 画笔:选中区块 + 自然语言指令(真实界面)"
      />

      {/* ================= 6 AGENTIC EXECUTION ================= */}
      <MkSection flip={false}
        eyebrow="AGENTIC EXECUTION"
        title="不只是给建议,而是真正执行增长任务"
        desc="Natural Language → Business Execution。Agent 通过 Skill Registry 与 MCP 工具真实读写业务数据。"
        points={['15 个 MCP 工具真实读取站点数据', 'Skill Engine(10 个真 Skill 落库运行)', 'Draft → 人工确认 → 发布安全链', '示例:找出 SEO 最差产品并优化俄语版']}
        cta="查看 Agent 工作台" onCta={() => go('/agent')}
        shot={MK('mk-agent')} shotAlt="Agent 工作台:MCP 工具面板(真实界面)"
      />

      {/* ================= 7 RFQ ================= */}
      <section className="nh-sec" id="nh-sec-rfq">
        <div className="nh-row">
          <div className="nh-copy">
            <div className="nh-eyebrow">RFQ</div>
            <h2>从页面访问,走到真实询盘</h2>
            <p className="nh-sec-sub">Visitor → Product → CTA → RFQ → Merchant Backend,询盘直接落库、可跟进、可导出。</p>
            <ul className="nh-points">
              <li>公开站 RFQ 表单(每市场独立)</li>
              <li>后台 Inquiry 真实落库与状态跟进</li>
              <li>来源页面 / 渠道可追溯</li>
            </ul>
            <button className="nh-btn xl" onClick={() => go('/inquiries')}>查看询盘后台</button>
          </div>
          <div className="nh-shots-stack">
            <img src={MK('mk-rfq-public')} alt="公开站 RFQ 区块(真实界面)" loading="lazy" />
            <img src={MK('mk-rfq-backend')} alt="商户询盘后台(真实界面)" loading="lazy" />
          </div>
        </div>
      </section>

      {/* ================= FINAL CTA ================= */}
      <section className="nh-final">
        <h2>AI 建站只是入口,<br />海外增长才是目的。</h2>
        <div className="nh-cta-row center">
          <button className="nh-btn xl" onClick={() => go('/sites/new')}>免费生成独立站</button>
          <button className="nh-btn ghost xl" onClick={() => navigate('/templates')}>查看模板商城</button>
        </div>
      </section>

      <footer className="nh-foot">
        <span>© {new Date().getFullYear()} CrossPilot · AI 获客与转化智能体平台</span>
        <span>页面截图均来自真实 CrossPilot 界面(scripts/capture-marketing-assets.mjs 自动采集)</span>
      </footer>

      {authOpen && (
        <AuthModal onClose={() => setAuthOpen(false)}
          onAuthed={() => { setAuthOpen(false); navigate('/sites/new') }} />
      )}
    </div>
  )
}

/* ---------------- 模块组件:文案左/截图右,下一模块翻转 ---------------- */
function MkSection({ id, flip, eyebrow, title, desc, points, cta, onCta, shot, shotAlt, note }) {
  return (
    <section className={`nh-sec${flip ? ' alt' : ''}`} id={id}>
      <div className={`nh-row${flip ? ' rev' : ''}`}>
        <div className="nh-copy">
          <div className="nh-eyebrow">{eyebrow}</div>
          <h2>{title}</h2>
          <p className="nh-sec-sub">{desc}</p>
          <ul className="nh-points">
            {(points || []).map((p) => <li key={p}>✓ {p}</li>)}
          </ul>
          {note && <p className="nh-note">{note}</p>}
          {cta && <button className="nh-btn xl" onClick={onCta}>{cta}</button>}
        </div>
        <div className="nh-shot-wrap">
          <figure className="nh-shot">
            <img src={shot} alt={shotAlt} loading="lazy" />
            <figcaption>{shotAlt}</figcaption>
          </figure>
        </div>
      </div>
    </section>
  )
}

/* ---------------- 登录弹窗(逻辑与视觉系统不变) ---------------- */
function AuthModal({ onClose, onAuthed }) {
  const { login, register, toast } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', company_name: '', industry: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function errText(e) {
    const d = e?.detail ?? e?.message ?? e
    if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join('; ')
    return typeof d === 'string' ? d : '操作失败,请重试'
  }

  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      if (tab === 'login') await login(form.email.trim(), form.password)
      else {
        await register({ email: form.email.trim(), password: form.password,
          company_name: form.company_name.trim(), industry: form.industry.trim() })
        toast('账户已创建,已为你初始化独立站点空间', 'success')
      }
      onAuthed()
    } catch (err) { setError(errText(err)) } finally { setBusy(false) }
  }

  return (
    <div className="gp-auth-mask" onClick={onClose}>
      <div className="gp-auth-modal nh-auth" onClick={(e) => e.stopPropagation()}>
        <button className="gp-auth-close" onClick={onClose} aria-label="关闭">×</button>
        <div className="gp-auth-head">
          <span className="mark">C</span>
          <div><strong>CrossPilot</strong><span>免费开始你的出海增长</span></div>
        </div>
        <div className="gp-auth-tabs">
          <button className={tab === 'login' ? 'on' : ''} onClick={() => { setTab('login'); setError('') }}>登录</button>
          <button className={tab === 'register' ? 'on' : ''} onClick={() => { setTab('register'); setError('') }}>注册新企业</button>
        </div>
        <form className="gp-auth-form" onSubmit={submit}>
          <label><span>邮箱</span>
            <input type="email" required autoComplete="username" placeholder="you@company.com" value={form.email} onChange={set('email')} />
          </label>
          <label><span>密码</span>
            <input type="password" required minLength={6} placeholder="至少 6 位" value={form.password} onChange={set('password')} />
          </label>
          {tab === 'register' && (<>
            <label><span>企业名称</span>
              <input required placeholder="例如:宁波 XX 机械有限公司" value={form.company_name} onChange={set('company_name')} />
            </label>
            <label><span>所属行业(可选)</span>
              <input placeholder="例如:工业水处理设备" value={form.industry} onChange={set('industry')} />
            </label>
          </>)}
          {error && <div className="gp-auth-error">{error}</div>}
          <button className="gp-btn gp-primary gp-auth-submit" disabled={busy}>
            {busy ? '请稍候…' : tab === 'login' ? '登录 CrossPilot' : '创建企业账户'}
          </button>
          <button type="button" className="gp-auth-demo" onClick={() => {
            setTab('login')
            setForm((f) => ({ ...f, email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }))
            setError('')
          }}>填入演示账号</button>
        </form>
        <p className="gp-auth-note">注册即创建独立企业空间 · 1 次免费 AI 完整生成</p>
      </div>
    </div>
  )
}
