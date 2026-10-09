import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'
import { ai } from '../../services/ai'
import { api } from '../../services/api'
import { marketTemplates, marketOrder } from '../../data/marketTemplates'
import { resolveBrand } from '../../data/brand'
import SiteHero from '../../components/site/SiteHero'
import AiWaiting, { WAIT_STEPS } from '../../components/brand/AiWaiting'
import BrandIntro from '../../components/brand/BrandIntro'
import { PLATFORM_BRAND } from '../../data/brand'

export default function Onboarding() {
  const navigate = useNavigate()
  const { onboarding, setOnboarding, usage, dispatch, toast, remainingGenerations, openPaywall, setSite } = useApp()
  const { requireFeature } = useEntitlement()
  const [step, setStep] = useState('form') // form | hero | verify | generating | done
  const [form, setForm] = useState({
    industry: '工业水处理设备',
    companyName: 'AQUAFLOW Industrial',
    products: 'Industrial RO System, Ultrafiltration Unit',
    markets: ['en-US'],
  })
  const [hero, setHero] = useState(null)
  const [verify, setVerify] = useState({ company: 'AQUAFLOW Industrial', contact: '', phone: '', code: '', website: '' })
  const [codeSent, setCodeSent] = useState(false)

  const selectedMarket = form.markets[0] || 'en-US'
  const template = marketTemplates[selectedMarket]

  const toggleMarket = (m) => {
    setForm((f) => ({
      ...f,
      markets: f.markets.includes(m) ? f.markets.filter((x) => x !== m) : [...f.markets, m],
    }))
  }

  // 步骤 1：输入 → 立即生成 Hero 预览
  const handleGenerateHero = async () => {
    if (!form.industry || !form.companyName) {
      toast('请填写行业与企业名称', 'warn')
      return
    }
    const res = await ai.generateSite(form)
    setHero(res)
    setOnboarding(form)
    setStep('hero')
  }

  // 步骤 2：生成完整网站 → 触发企业身份核验
  const handleVerifyEntry = () => {
    // 免费账户每家企业可体验 1 次完整生成（持久化计数，用完触发付费弹窗）
    if (!requireFeature('site.generate')) return
    setStep('verify')
  }

  const handleSendCode = () => {
    if (!/^\+?[\d\s-]{6,}$/.test(verify.phone)) {
      toast('请填写有效手机号', 'warn')
      return
    }
    setCodeSent(true)
    toast('验证码已发送，请输入收到的 6 位数字验证码')
  }

  // 步骤 3：核验通过 → 进入 AI 生成
  const handleVerifySubmit = async () => {
    if (!verify.company || !verify.contact) {
      toast('请填写企业名称与联系人', 'warn')
      return
    }
    if (!codeSent || (verify.code || '').length < 4) {
      toast('请先获取并填写验证码', 'warn')
      return
    }
    const res = await api.verifyCompany(verify)
    if (res.verified) {
      startGeneration()
    }
  }

  // 步骤 4：进入 AI 品牌等待页（品牌跟随商家）
  const startGeneration = () => {
    setStep('generating')
  }

  const finishGeneration = () => {
    // 免费次数 +1 并持久化（localStorage，刷新不丢）
    dispatch({ type: 'CONSUME_GENERATION' })
    api.consumeFreeGeneration()
    // 生成结果写入站点状态（SiteState 持久化）
    setSite({
      companyName: form.companyName,
      industry: form.industry,
      products: form.products,
      targetMarkets: form.markets.length ? form.markets : ['en-US'],
      verified: true,
    })
    setStep('done')
  }

  const enterDashboard = () => {
    setOnboarding({ step: 'done' })
    navigate('/')
  }

  const stepIndex = useMemo(() => ({ form: 1, hero: 2, verify: 3, generating: 4, done: 5 }[step]), [step])

  // 等待页使用客户品牌（商家自己的 Logo / 品牌色优先）
  const brand = resolveBrand({ brand: { name: form.companyName || 'Your Brand', primary: template?.accent } }, 'merchant')

  if (step === 'generating') {
    return (
      <div className="onboard-wrap has-wait">
        <AiWaiting brand={brand} title="正在生成你的网站" steps={WAIT_STEPS.site} stepMs={720} onDone={finishGeneration} />
      </div>
    )
  }

  return (
    <div className="onboard-wrap">
      <BrandIntro brand={PLATFORM_BRAND} variant="platform" />
      <div className="onboard-card">
        <div className="onboard-step">
          首次 AI 建站 · 步骤 {stepIndex} / 5
          <button className="onboard-skip" onClick={enterDashboard}>
            进入工作台 →
          </button>
        </div>

        {step === 'form' && (
          <>
            <h1>输入你的产品，30 分钟拥有带来询盘的英文独立站</h1>
            <p>
              按你的行业与产品<b>现场生成</b>（不是套模板）：三语言、SEO 就绪、可直接发布。
              传统建站公司报价 <s>¥50,000 起</s>、周期 6–8 周 —— 你的第一版<b>免费</b>。
            </p>
            <ol className="onboard-steps" aria-label="三步上线">
              <li><b>1</b> 填产品与目标市场</li>
              <li><b>2</b> AI 现场生成三语言站</li>
              <li><b>3</b> 发布上线，开始收询盘</li>
            </ol>
            <div className="form-grid">
              <div className="form-field">
                <label>行业</label>
                <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
              </div>
              <div className="form-field">
                <label>企业名称</label>
                <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
              </div>
              <div className="form-field full">
                <label>主营产品</label>
                <textarea rows="2" value={form.products} onChange={(e) => setForm({ ...form, products: e.target.value })} />
              </div>
              <div className="form-field full">
                <label>目标市场（决定市场模板，不只是语言）</label>
                <div className="market-pick">
                  {marketOrder.map((m) => (
                    <button key={m} className={form.markets.includes(m) ? 'active' : ''} onClick={() => toggleMarket(m)}>
                      {marketTemplates[m].flag} · {marketTemplates[m].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="onboard-actions">
              <button className="primary-btn" onClick={handleGenerateHero}>生成首屏预览 →</button>
              <button className="ghost-btn" onClick={enterDashboard}>跳过，先看示例工作台</button>
              <span className="usage-pill">免费完整生成 {usage.freeGenerationUsed}/{usage.freeGenerationLimit}</span>
            </div>

            {/* 客户证言：示例商家场景（演示数据，明确标注，不冒充真实客户） */}
            <div className="onboard-testimonials">
              <div className="ot-head">
                <span>像你一样的工厂在用它</span>
                <i>示例客户场景 · 演示数据</i>
              </div>
              <div className="ot-grid">
                <blockquote>
                  <p>「以前海外客户问我有没有英文官网，只能发平台店铺链接。现在官网在 Google 搜得到，上个月接到 3 条直接询盘。」</p>
                  <footer>五金工具出口 · 宁波 · 月询盘 6 → 20+</footer>
                </blockquote>
                <blockquote>
                  <p>「俄语版是按当地采购习惯重新组织的，不是机翻。客户说看得出我们懂俄罗斯市场。」</p>
                  <footer>工业泵阀 · 温州 · 新增俄语市场订单</footer>
                </blockquote>
                <blockquote>
                  <p>「SEO 分数从 58 提到 83，每一项改动都能核对、不满意能回滚。这才是给老板看的系统。」</p>
                  <footer>水处理设备 · 佛山 · SEO 58 → 83</footer>
                </blockquote>
              </div>
            </div>
          </>
        )}

        {step === 'hero' && hero && (
          <>
            <h1>这是你的首屏预览</h1>
            <p>已按「{template.label}」市场模板生成。继续即可生成完整网站。</p>
            <div className="hero-preview">
              <SiteHero template={template} compact />
            </div>
            <div className="onboard-actions">
              <button className="ghost-btn" onClick={() => setStep('form')}>返回修改</button>
              <button className="primary-btn" onClick={handleVerifyEntry}>生成完整网站 →</button>
              <span className="usage-pill">本次将使用 1 次免费完整生成</span>
            </div>
          </>
        )}

        {step === 'verify' && (
          <>
            <h1>生成完整网站前，验证企业身份</h1>
            <p>每家企业可免费体验 1 次完整 AI 建站，用于确认潜在客户身份。当前为演示环境：验证码不做真实短信下发，输入任意 4 位以上数字即可通过。</p>
            <div className="form-grid">
              <div className="form-field">
                <label>企业名称</label>
                <input value={verify.company} onChange={(e) => setVerify({ ...verify, company: e.target.value })} />
              </div>
              <div className="form-field">
                <label>联系人</label>
                <input value={verify.contact} onChange={(e) => setVerify({ ...verify, contact: e.target.value })} />
              </div>
              <div className="form-field">
                <label>手机号</label>
                <input placeholder="+86 138 0000 0000" value={verify.phone} onChange={(e) => setVerify({ ...verify, phone: e.target.value })} />
              </div>
              <div className="form-field">
                <label>验证码</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={verify.code} onChange={(e) => setVerify({ ...verify, code: e.target.value })} />
                  <button className="ghost-btn" onClick={handleSendCode} style={{ whiteSpace: 'nowrap' }}>
                    {codeSent ? '重新发送' : '获取验证码'}
                  </button>
                </div>
              </div>
              <div className="form-field full">
                <label>已有官网（可选）</label>
                <input placeholder="https://" value={verify.website} onChange={(e) => setVerify({ ...verify, website: e.target.value })} />
              </div>
            </div>
            <div className="onboard-actions">
              <button className="ghost-btn" onClick={() => setStep('hero')}>返回</button>
              <button className="primary-btn" onClick={handleVerifySubmit}>验证并开始生成 →</button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <h1>网站已生成 🎉</h1>
            <p>已使用 1 次免费完整生成。后续修改、版本迭代、发布、绑定域名与高级 SEO/GEO 需付费或客服申请解锁。</p>
            <span className="usage-pill">已使用 {usage.freeGenerationUsed}/{usage.freeGenerationLimit} 次完整生成</span>
            <div className="onboard-actions">
              <button className="primary-btn" onClick={enterDashboard}>进入网站后台 →</button>
              <button
                className="ghost-btn"
                onClick={() => requireFeature('site.generate')}
              >
                再生成一版（需付费）
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
