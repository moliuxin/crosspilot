import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { marketTemplates, marketOrder } from '../../data/marketTemplates'
import { TEMPLATES } from '../Templates/templates-data'
import './sites.css'

/**
 * 创建网站（/sites/new）。
 *
 * 三种创建方式（对应产品规则）：
 * - AI 生成：完整 AI 独立站生成（账号级 1 次免费，之后 Credits / 套餐）；
 * - 模板创建：选一个模板起步（模板结构会应用到新网站）；
 * - 空白创建：免费，最小默认页面结构。
 */
export default function SiteNew() {
  const navigate = useNavigate()
  const { toast, remainingGenerations } = useApp()
  const [params] = useSearchParams()
  const presetTemplate = params.get('template') || ''
  const [mode, setMode] = useState(presetTemplate ? 'template' : 'blank')
  const [form, setForm] = useState({
    name: '',
    industry: '',
    product_category: '',
    target_markets: ['en-US'],
    template_id: presetTemplate,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function toggleMarket(m) {
    setForm((f) => {
      const has = f.target_markets.includes(m)
      const next = has ? f.target_markets.filter((x) => x !== m) : [...f.target_markets, m]
      return { ...f, target_markets: next.length ? next : f.target_markets }
    })
  }

  async function createBlank() {
    if (!form.name.trim()) {
      setError('请填写网站名称')
      return
    }
    setBusy(true)
    setError('')
    try {
      const site = await api.createSite({
        name: form.name.trim(),
        industry: form.industry.trim(),
        product_category: form.product_category.trim(),
        target_markets: form.target_markets,
        template_id: mode === 'template' ? form.template_id : '',
      })
      toast(`网站「${site.name}」已创建`)
      navigate(`/sites/${site.id}`)
    } catch (err) {
      setError(err?.detail || '创建失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">CREATE WEBSITE</div>
          <h1>创建网站</h1>
          <p>选择一种方式开始。后续 AI 整站生成也会从这里发起。</p>
        </div>
        <Link className="ghost-btn" to="/sites">← 返回我的网站</Link>
      </div>

      <div className="create-modes">
        <button className={`create-mode${mode === 'ai' ? ' on' : ''}`} onClick={() => setMode('ai')}>
          <span className="create-mode-icon">✦</span>
          <strong>AI 生成</strong>
          <span className="create-mode-desc">输入产品类别，AI 生成完整独立站（结构 / 文案 / 视觉）</span>
          <span className="create-mode-price">
            {remainingGenerations > 0 ? '首次免费（账号级 1 次）' : '需要 100 Credits 或套餐'}
          </span>
        </button>
        <button className={`create-mode${mode === 'template' ? ' on' : ''}`} onClick={() => setMode('template')}>
          <span className="create-mode-icon">▩</span>
          <strong>模板创建</strong>
          <span className="create-mode-desc">从模板商城选择一个行业模板快速起步</span>
          <span className="create-mode-price">免费 / 按模板定价</span>
        </button>
        <button className={`create-mode${mode === 'blank' ? ' on' : ''}`} onClick={() => setMode('blank')}>
          <span className="create-mode-icon">◫</span>
          <strong>空白创建</strong>
          <span className="create-mode-desc">最小默认页面结构，自己搭建内容</span>
          <span className="create-mode-price">免费</span>
        </button>
      </div>

      {mode === 'ai' && (
        <div className="panel create-ai-panel">
          <div className="panel-head">
            <div>
              <strong>AI 站点引导（AI Site Onboarding）</strong>
              <span>产品类别 → 目标客户 → 目标市场 → 风格 → 生成</span>
            </div>
          </div>
          <p className="create-ai-hint">
            AI 将先理解你的产品类别，生成 Industry Profile、Buyer Persona、Site Plan 与 Image Brief，
            再产出结构与市场文案；中 / 英 / 俄是不同市场版本，不是翻译。
          </p>
          <Link className="primary-btn" to="/onboarding">进入 AI 建站引导 →</Link>
        </div>
      )}

      {mode === 'template' && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <strong>选择模板</strong>
              <span>模板决定初始页面结构与视觉风格</span>
            </div>
            <Link to="/templates" style={{ fontSize: 12.5, color: 'var(--blue)', fontWeight: 600 }}>浏览全部模板 →</Link>
          </div>
          <div className="create-template-grid">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className={`create-template-card${form.template_id === t.id ? ' on' : ''}`}
                onClick={() => setForm((f) => ({ ...f, template_id: t.id, name: f.name || t.name }))}
              >
                <span className="create-template-cover" style={{ background: t.accent }} />
                <strong>{t.name}</strong>
                <span>{t.industry} · {(t.markets || []).join(' / ')}</span>
                <b>{t.is_free ? '免费' : `￥${t.price}`}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      {(mode === 'blank' || mode === 'template') && (
        <div className="panel create-form-panel">
          <div className="panel-head">
            <div>
              <strong>网站信息</strong>
              <span>{mode === 'template' ? '已选择模板，可再补充网站资料' : '填写基础信息'}</span>
            </div>
          </div>
          <div className="create-form">
            <label className="auth-field">
              <span>网站名称 *</span>
              <input type="text" required placeholder="例如：工业水泵英文站" value={form.name} onChange={set('name')} />
            </label>
            <label className="auth-field">
              <span>行业</span>
              <input type="text" placeholder="例如：工业水处理设备" value={form.industry} onChange={set('industry')} />
            </label>
            <label className="auth-field">
              <span>主要产品类别</span>
              <input type="text" placeholder="例如：工业离心泵" value={form.product_category} onChange={set('product_category')} />
            </label>
            <div className="auth-field">
              <span>目标市场（可多选）</span>
              <div className="market-picker">
                {marketOrder.map((m) => {
                  const on = form.target_markets.includes(m)
                  return (
                    <button key={m} type="button" className={`market-chip pickable${on ? ' on' : ''}`} onClick={() => toggleMarket(m)}>
                      {marketTemplates[m].flag} {marketTemplates[m].label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button className="primary-btn" onClick={createBlank} disabled={busy}>
            {busy ? '创建中…' : mode === 'template' ? '用模板创建网站' : '创建网站'}
          </button>
        </div>
      )}
    </section>
  )
}
