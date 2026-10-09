import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { marketTemplates, marketOrder } from '../../data/marketTemplates'
import './settings.css'

/**
 * 设置（/settings）：企业资料 / 账户与安全 / 语言与市场 / 隐私与条款 / 套餐与额度。
 *
 * 隐私条款收在设置内（AGENTS.md：Privacy and Policies live under 设置）。
 */
const TABS = [
  { key: 'company', label: '企业资料' },
  { key: 'account', label: '账户与安全' },
  { key: 'markets', label: '语言与市场' },
  { key: 'privacy', label: '隐私与条款' },
  { key: 'billing', label: '套餐与额度' },
]

export default function SettingsPage() {
  const [tab, setTab] = useState('company')
  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">SETTINGS</div>
          <h1>设置</h1>
          <p>企业资料、账户、语言市场、隐私条款与套餐额度集中管理。</p>
        </div>
      </div>
      <nav className="site-tabs" aria-label="设置导航">
        {TABS.map((t) => (
          <button key={t.key} className={`site-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'company' && <CompanyTab />}
      {tab === 'account' && <AccountTab />}
      {tab === 'markets' && <MarketsTab />}
      {tab === 'privacy' && <PrivacyTab />}
      {tab === 'billing' && <BillingTab />}
    </section>
  )
}

/* ---------------- 企业资料 ---------------- */
function CompanyTab() {
  const { toast } = useApp()
  const [company, setCompany] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .getCompany()
      .then((c) => {
        setCompany(c)
        setForm({
          companyName: c.companyName || c.name || '',
          industry: c.industry || '',
          products: c.products || '',
        })
      })
      .catch(() => setForm({ companyName: '', industry: '', products: '' }))
  }, [])

  async function save() {
    setBusy(true)
    try {
      await api.updateSiteState({
        companyName: form.companyName,
        industry: form.industry,
        products: form.products,
      })
      toast('企业资料已保存')
    } catch {
      toast('保存失败：后端服务不可用', 'warn')
    } finally {
      setBusy(false)
    }
  }

  if (!form) return <div className="empty">加载中…</div>
  return (
    <div className="panel settings-panel">
      <div className="settings-form">
        <label>
          <span>企业名称</span>
          <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        </label>
        <label>
          <span>所属行业</span>
          <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
        </label>
        <label>
          <span>主营产品（用于 AI 理解业务）</span>
          <textarea rows={3} value={form.products} onChange={(e) => setForm({ ...form, products: e.target.value })} />
        </label>
        <button className="primary-btn" onClick={save} disabled={busy}>
          {busy ? '保存中…' : '保存企业资料'}
        </button>
      </div>
    </div>
  )
}

/* ---------------- 账户与安全 ---------------- */
function AccountTab() {
  const { user, tenant, logout, toast } = useApp()
  return (
    <div className="panel settings-panel">
      <div className="account-rows">
        <div className="account-row">
          <span>邮箱</span>
          <b>{user?.email || '—'}</b>
        </div>
        <div className="account-row">
          <span>显示名称</span>
          <b>{user?.displayName || '—'}</b>
        </div>
        <div className="account-row">
          <span>角色</span>
          <b>{user?.role === 'owner' ? '企业管理员' : user?.role === 'operator' ? '平台运营' : '企业员工'}</b>
        </div>
        <div className="account-row">
          <span>所属企业</span>
          <b>{tenant?.name || '—'}</b>
        </div>
        <div className="account-row">
          <span>登录方式</span>
          <b>JWT Bearer（72 小时有效）</b>
        </div>
      </div>
      <div className="settings-note">
        密码修改与员工邀请将在后续版本提供。当前如需重置密码，请联系平台运营。
      </div>
      <button
        className="ghost-btn"
        onClick={async () => {
          await logout()
          toast('已退出登录')
        }}
      >
        退出登录
      </button>
    </div>
  )
}

/* ---------------- 语言与市场 ---------------- */
function MarketsTab() {
  const { toast } = useApp()
  const [loc, setLoc] = useState(null)
  const [language, setLanguage] = useState('zh-CN')

  useEffect(() => {
    api
      .getLocalization()
      .then((d) => {
        setLoc(d)
        setLanguage(d.defaultLanguage || 'zh-CN')
      })
      .catch(() => {})
  }, [])

  async function generate(market) {
    try {
      await api.generateMarket(market)
      toast(`已生成 ${market} 市场版本`)
      setLoc(await api.getLocalization())
    } catch (e) {
      toast(e?.detail?.message || e?.message || '生成失败', 'warn')
    }
  }

  return (
    <div className="panel settings-panel">
      <div className="settings-form">
        <label>
          <span>后台默认语言</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {marketOrder.map((m) => (
              <option key={m} value={m}>
                {marketTemplates[m].flag} {marketTemplates[m].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="market-rows">
        {(loc?.available || ['en-US', 'ru-RU', 'zh-CN']).map((m) => {
          const on = (loc?.markets || ['en-US']).includes(m)
          return (
            <div className="market-row-line" key={m}>
              <div className="flag">{marketTemplates[m]?.flag}</div>
              <div>
                <strong>{marketTemplates[m]?.label || m}</strong>
                <span>{marketTemplates[m]?.region || ''}</span>
              </div>
              {on ? (
                <b className="site-status site-status-published">已生成</b>
              ) : (
                <button className="ghost-btn small" onClick={() => generate(m)}>生成</button>
              )}
            </div>
          )
        })}
      </div>
      {loc && (
        <div className="settings-note">
          免费额外市场额度：剩余 {loc.freeExtraLeft ?? 0} / {loc.freeExtraLimit ?? 1}。
          {loc.requiresPayment ? ' 额度已用完，升级套餐可解锁全部市场。' : ''}
        </div>
      )}
    </div>
  )
}

/* ---------------- 隐私与条款 ---------------- */
function PrivacyTab() {
  return (
    <div className="panel settings-panel">
      <PolicyBlock
        title="隐私政策（Privacy Policy）"
        items={[
          '我们仅收集经营本服务所必需的数据：企业资料、产品、页面内容、询盘与访问日志。',
          '询盘数据按企业租户隔离存储，不同企业之间互不可见。',
          'AI 能力（文案生成 / 优化建议）在处理你的内容时遵循「草稿 → 人工确认 → 发布」流程，不会未经确认修改线上内容。',
          '你可以随时导出或要求删除自己的企业数据。',
        ]}
      />
      <PolicyBlock
        title="服务条款（Terms of Service）"
        items={[
          '每个账号享有 1 次免费完整 AI 建站；再次生成消耗 Credits 或需升级套餐。',
          'AI 画笔为付费能力，免费账户可见入口但需升级后使用。',
          '禁止使用本服务发布虚假资质、证书或捏造的产品事实。',
          '演示数据一律标注 Demo / Test，不冒充真实经营数据。',
        ]}
      />
      <div className="settings-note">
        完整法律文本将在正式上线前由法务审校后发布。当前页面为产品内置摘要。
      </div>
    </div>
  )
}

function PolicyBlock({ title, items }) {
  return (
    <div className="policy-block">
      <h3>{title}</h3>
      <ul>
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  )
}

/* ---------------- 套餐与额度 ---------------- */
function BillingTab() {
  const { entitlements, usage, remainingGenerations, openPaywall } = useApp()
  const [credits, setCredits] = useState(null)
  const [logs, setLogs] = useState([])

  useEffect(() => {
    api.getCredits().then(setCredits).catch(() => {})
    api.getCreditLogs().then(setLogs).catch(() => {})
  }, [])

  return (
    <div className="billing-grid">
      <article className="panel settings-panel">
        <div className="panel-head">
          <div>
            <strong>当前套餐</strong>
            <span>{entitlements?.planName || '免费版'}</span>
          </div>
          <button
            className="primary-btn small"
            onClick={() => openPaywall('升级套餐', '升级后解锁不限次生成、GEO、Agent 自动化、多语言市场版本与版本回滚。', 'plan.upgrade')}
          >
            升级套餐
          </button>
        </div>
        <div className="account-rows">
          <div className="account-row">
            <span>免费完整生成</span>
            <b>剩余 {remainingGenerations} / {usage.freeGenerationLimit}（账号级）</b>
          </div>
          <div className="account-row">
            <span>Credits 余额</span>
            <b>{credits?.balance ?? '—'}</b>
          </div>
          <div className="account-row">
            <span>已用 Credits</span>
            <b>{credits?.used ?? '—'}</b>
          </div>
        </div>
      </article>

      <article className="panel settings-panel">
        <div className="panel-head">
          <div>
            <strong>额度流水</strong>
            <span>最近 8 条</span>
          </div>
        </div>
        {logs.length === 0 && <div className="empty small">暂无流水</div>}
        {logs.slice(0, 8).map((l) => (
          <div className="task-row-mini" key={l.id}>
            <span className="task-title">{l.skill || '—'}</span>
            <b style={{ color: l.cost > 0 ? '#b45309' : '#047857' }}>{l.cost > 0 ? `-${l.cost}` : `+${-l.cost}`}</b>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{l.time || ''}</span>
          </div>
        ))}
      </article>
    </div>
  )
}
