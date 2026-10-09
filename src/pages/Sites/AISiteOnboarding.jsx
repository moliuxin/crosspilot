import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { marketTemplates, marketOrder } from '../../data/marketTemplates'
import './sites.css'

/**
 * AI 建站引导（AI Site Onboarding，P0-AI-SITE-GENERATION）。
 *
 * 五步：基础信息 → 目标客户 → 目标市场 → 风格 → 生成。
 * 后端链路：Industry Analyzer → Buyer Persona → Market Profile → Site Plan
 *          → Image Brief → GLM-Image → 站点 + 页面 + 图片资产。
 * 免费额度账号级 1 次,生成成功才扣;用完 402 → 付费墙。
 */
const STEPS = ['基础信息', '目标客户', '目标市场', '网站风格', 'AI 生成']
const STYLES = [
  { key: 'professional', label: '专业工业', desc: '深蓝 / 金属 / 大留白' },
  { key: 'minimal', label: '极简国际', desc: '明亮 / 干净 / 快询盘' },
  { key: 'tech', label: '科技', desc: '深色 / 参数 / 产品特写' },
  { key: 'premium', label: '高端', desc: '编辑级摄影 / 电影光' },
  { key: 'ai', label: 'AI 推荐', desc: '按产品类别自动选择' },
]

export default function AISiteOnboarding() {
  const navigate = useNavigate()
  const { toast, openPaywall, refreshUsage } = useApp()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    company_name: '',
    product_category: '',
    product_description: '',
    target_buyer: '',
    target_markets: ['zh-CN', 'en-US', 'ru-RU'],
    preferred_style: 'professional',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function toggleMarket(m) {
    setForm((f) => {
      const has = f.target_markets.includes(m)
      const next = has ? f.target_markets.filter((x) => x !== m) : [...f.target_markets, m]
      return { ...f, target_markets: next.length ? next : f.target_markets }
    })
  }

  function next() {
    setError('')
    if (step === 0 && !form.product_category.trim()) {
      setError('请填写「你主要销售什么产品」——这是 AI 理解行业的起点')
      return
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  async function generate() {
    setBusy(true)
    setError('')
    try {
      const data = await api.generateSite({
        ...form,
        product_category: form.product_category.trim(),
        company_name: form.company_name.trim(),
      })
      setResult(data)
      // 生成成功消耗免费额度后，立即从服务端刷新（侧栏 0/1 即时可见）
      refreshUsage()
      toast('AI 独立站已生成:结构 / 三语文案 / 视觉资产已就绪')
    } catch (err) {
      if (err?.status === 402) {
        openPaywall('AI 完整生成', err?.detail?.message || '免费完整生成次数已用完（账号级 1 次），升级套餐后可继续生成。', 'site.generate')
      } else {
        setError(err?.detail?.message || err?.detail || err?.message || '生成失败，请重试')
      }
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return <GenerateResult result={result} onEnter={() => navigate(`/sites/${result.site.id}`)} />
  }

  return (
    <div className="panel ai-onboarding">
      <div className="onboarding-steps">
        {STEPS.map((s, i) => (
          <span key={s} className={`onb-step${i === step ? ' on' : i < step ? ' done' : ''}`}>
            <i>{i < step ? '✓' : i + 1}</i> {s}
          </span>
        ))}
      </div>

      {step === 0 && (
        <div className="onb-form">
          <label>
            <span>公司名称</span>
            <input value={form.company_name} onChange={set('company_name')} placeholder="例如：宁波 XX 泵业有限公司" />
          </label>
          <label>
            <span>你主要销售什么产品？ *</span>
            <input value={form.product_category} onChange={set('product_category')} placeholder="例如：工业水泵" />
          </label>
          <label>
            <span>产品补充描述（可选）</span>
            <textarea rows={3} value={form.product_description} onChange={set('product_description')} placeholder="离心泵、出口俄罗斯与欧洲、支持 OEM…" />
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="onb-form">
          <label>
            <span>目标客户是谁？</span>
            <input value={form.target_buyer} onChange={set('target_buyer')} placeholder="例如：工程采购商 / EPC 总包 / 分销商" />
          </label>
          <p className="onb-hint">AI 会据此生成 Buyer Persona（角色 / 关心点 / 顾虑 / 搜索词），用于站点文案与 CTA 策略。</p>
        </div>
      )}

      {step === 2 && (
        <div className="onb-form">
          <div>
            <span>目标市场（可多选，将生成不同市场版本——不是翻译）</span>
            <div className="market-picker">
              {marketOrder.map((m) => (
                <button key={m} type="button" className={`market-chip pickable${form.target_markets.includes(m) ? ' on' : ''}`} onClick={() => toggleMarket(m)}>
                  {marketTemplates[m].flag} {marketTemplates[m].label}
                </button>
              ))}
            </div>
          </div>
          <p className="onb-hint">同一商品事实（参数 / SKU / 认证）共享；布局、叙述、视觉、CTA 按市场独立生成。</p>
        </div>
      )}

      {step === 3 && (
        <div className="onb-form">
          <div>
            <span>网站风格</span>
            <div className="style-picker">
              {STYLES.map((s) => (
                <button key={s.key} type="button" className={`style-option${form.preferred_style === s.key ? ' on' : ''}`} onClick={() => setForm((f) => ({ ...f, preferred_style: s.key }))}>
                  <strong>{s.label}</strong>
                  <span>{s.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="onb-hint">风格会固化为整站 Visual Style Profile，所有 AI 图片继承同一风格（不漂移）。</p>
        </div>
      )}

      {step === 4 && (
        <div className="onb-generate">
          <div className="onb-summary">
            <div><span>产品类别</span><b>{form.product_category}</b></div>
            <div><span>目标客户</span><b>{form.target_buyer || '按行业默认'}</b></div>
            <div><span>目标市场</span><b>{form.target_markets.map((m) => marketTemplates[m]?.label || m).join(' / ')}</b></div>
            <div><span>网站风格</span><b>{STYLES.find((s) => s.key === form.preferred_style)?.label}</b></div>
          </div>
          {busy ? (
            <div className="onb-busy">
              <div className="boot-spinner" />
              <div>
                <strong>AI 正在生成独立站…</strong>
                <span>行业理解 → 买家画像 → 市场表达 → 站点结构 → 图片简报 → 视觉资产</span>
              </div>
            </div>
          ) : (
            <button className="primary-btn big" onClick={generate}>✦ 生成独立站</button>
          )}
          <p className="onb-hint">免费完整生成为账号级 1 次，仅在生成成功后消耗；失败不扣。</p>
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}

      <div className="onb-nav">
        <button className="ghost-btn" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>← 上一步</button>
        {step < 4 && <button className="primary-btn" onClick={next}>下一步 →</button>}
      </div>
    </div>
  )
}

function GenerateResult({ result, onEnter }) {
  const { plan, site, assets, image_note } = result
  const markets = Object.keys(plan.markets || {})
  return (
    <div className="panel ai-onboarding">
      <div className="panel-head">
        <div>
          <strong>「{site.name}」已生成</strong>
          <span>
            结构 {plan.site_structure?.length || 0} 个板块 · 三市场版本 {markets.length} 个 · AI 图片 {assets.length} 张
            {plan._source === 'template' ? ' · 内容链路：内置模板（配置真实 LLM 后自动升级）' : ' · 内容链路：GLM'}
          </span>
        </div>
        <button className="primary-btn" onClick={onEnter}>进入网站管理 →</button>
      </div>

      {image_note && <div className="auth-warn">{image_note}</div>}

      <div className="gen-markets">
        {markets.map((m) => {
          const hero = plan.markets[m].hero || {}
          return (
            <div className="gen-market" key={m}>
              <div className="flag">{marketTemplates[m]?.flag || '🌐'}</div>
              <strong>{marketTemplates[m]?.label || m}</strong>
              <p className="gen-hero-title">{hero.title}</p>
              <p className="gen-hero-desc">{hero.description}</p>
              <span className="gen-cta">CTA：{hero.cta}</span>
            </div>
          )
        })}
      </div>
      <p className="onb-hint">三个市场是独立表达（层级 / 叙述 / CTA / 视觉），不是互译；商品事实层共享。</p>

      {assets.length > 0 && (
        <div className="gen-assets">
          {assets.slice(0, 6).map((a) => (
            <figure className="gen-asset" key={a.id}>
              <img src={a.url} alt={a.section_id} />
              <figcaption>
                {a.market} · {a.role || a.section_id}
                <b className={`src-tag ${a.source_type}`}>{a.source_type === 'REAL' ? 'REAL' : 'AI'}</b>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}
