import { useCallback, useEffect, useState } from 'react'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { renderLayout } from '../../components/site-blocks'
import './market-variants.css'

const MARKET_META = {
  'zh-CN': { flag: '🇨🇳', label: '中文站', note: '制造能力前置' },
  'en-US': { flag: '🇺🇸', label: 'English', note: 'Benefits 叙事' },
  'ru-RU': { flag: '🇷🇺', label: 'Русский', note: '参数与服务直给' },
}

/**
 * PHASE 6 前端:三市场变体并排 —— 真正不同的 layout_schema / design_tokens / 文案,
 * 由 site-blocks Schema 渲染器按变体数据渲染(不是同一 DOM 换文案)。
 */
export default function MarketVariantsPanel({ siteId }) {
  const { toast } = useApp()
  const [variants, setVariants] = useState([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!siteId) return
    api.getMarketVariants(siteId).then(setVariants).catch(() => setVariants([]))
  }, [siteId])

  useEffect(() => { load() }, [load])

  async function regenerate() {
    setBusy(true)
    try {
      const res = await api.generateMarketVariants(siteId)
      setVariants(res.variants || [])
      toast('三市场变体已生成(结构级差异,非翻译)', 'success')
    } catch (e) {
      toast(`生成失败:${e?.message || e?.detail?.message || '请稍后重试'}`, 'warn')
    } finally {
      setBusy(false)
    }
  }

  if (!siteId) return null

  return (
    <section className="panel mv-panel">
      <div className="panel-head">
        <div>
          <h3>市场变体 · Market Variants(结构级)</h3>
          <p className="muted" style={{ fontSize: 12.5 }}>
            每个市场拥有独立的布局顺序、设计令牌、文案与资产清单;Product Facts 三站共享不可变。
          </p>
        </div>
        <button className="primary-btn" onClick={regenerate} disabled={busy}>
          {busy ? '✦ 生成中…' : '✦ 生成三市场变体'}
        </button>
      </div>

      {variants.length === 0 && (
        <div className="empty" style={{ padding: '26px 0' }}>
          尚无市场变体 —— 点击「生成三市场变体」,系统将按行业画像为每个市场产出独立结构。
        </div>
      )}

      <div className="mv-grid">
        {variants.map((v) => {
          const meta = MARKET_META[v.market] || {}
          const sections = v.layout_schema?.sections || []
          const tokens = v.design_tokens || {}
          const hero = v.content_json?.copy?.hero || {}
          const assets = Object.values(v.asset_manifest || {})
          return (
            <article className="mv-card" key={v.market}>
              <header className="mv-head" style={{ background: tokens.primary || '#141a24', color: tokens.on_dark || '#e6ebf2' }}>
                <span className="mv-flag">{meta.flag}</span>
                <div>
                  <b>{meta.label}</b>
                  <span>{meta.note} · {sections.length} 个区块</span>
                </div>
              </header>
              <div className="mv-body">
                {hero.cta && (
                  <div className="mv-cta" style={{ background: tokens.accent || '#c2570c', color: tokens.on_accent || '#fff' }}>
                    CTA:{hero.cta}
                  </div>
                )}
                {renderLayout(sections, {
                  designTokens: tokens,
                  market: v.market,
                  locale: v.locale,
                })}
              </div>
              <footer className="mv-foot">
                <span>资产 {assets.length}:{assets.map((a) => a.source_type).filter(Boolean).join(' / ') || '—'}</span>
                <span className="mv-src">{v.layout_schema?.layout_source === 'glm' ? 'GLM 布局' : '规则布局'}</span>
              </footer>
            </article>
          )
        })}
      </div>
    </section>
  )
}
