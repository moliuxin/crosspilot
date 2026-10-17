import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { renderLayout } from '../components/site-blocks'
import { api } from '../services/api'
import './PublicMarketSite.css'

const MARKET_META = {
  'zh-CN': { flag: '🇨🇳', label: '中文', lang: 'zh-CN' },
  'en-US': { flag: '🇺🇸', label: 'English', lang: 'en-US' },
  'ru-RU': { flag: '🇷🇺', label: 'Русский', lang: 'ru-RU' },
}

/**
 * 公开独立站(按市场独立 URL,PHASE 5/13):
 * /#/site/:slug/:market/ —— 每市场独立 Title/Description/hreflang,
 * 渲染 SiteMarketVariant(layout_schema + design_tokens + 真实资产图),
 * 不是同一 DOM 换文案。
 */
export default function PublicMarketSite() {
  const { slug, market = 'en-US' } = useParams()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.getPublicSite(slug, market).then(setData).catch((e) => setErr(e?.message || '加载失败'))
  }, [slug, market])

  const meta = MARKET_META[market] || MARKET_META['en-US']
  const v = data?.market_variant
  const seo = v?.seo_metadata || {}

  useEffect(() => {
    if (seo.title) document.title = seo.title
    let desc = document.querySelector('meta[name="description"]')
    if (!desc) {
      desc = document.createElement('meta')
      desc.name = 'description'
      document.head.appendChild(desc)
    }
    if (seo.description) desc.content = seo.description
  }, [seo.title, seo.description])

  if (err) {
    return (
      <div className="pub-site">
        <div className="pub-empty">
          站点不存在或尚未发布。<Link to="/intro">← 返回首页</Link>
        </div>
      </div>
    )
  }
  if (!data) return <div className="pub-site"><div className="pub-empty">加载中…</div></div>

  const sections = v?.layout_schema?.sections || []
  const tokens = v?.design_tokens || {}
  const markets = (data.site?.target_markets || ['en-US']).filter((m) => MARKET_META[m])

  return (
    <div className="pub-site" style={{ background: tokens.bg || '#f7f8fa', color: tokens.text || '#182230' }}>
      <header className="pub-head" style={{ background: tokens.primary || '#141a24', color: tokens.on_dark || '#e6ebf2' }}>
        <b>{data.site?.name || data.tenant?.name}</b>
        <nav>
          {markets.map((m) => (
            <Link key={m} to={`/site/${slug}/${m}/`}
              className={`pub-lang${m === market ? ' on' : ''}`}
              style={m === market ? { background: tokens.accent || '#c2570c', color: tokens.on_accent || '#fff' } : {}}>
              {MARKET_META[m].flag} {MARKET_META[m].label}
            </Link>
          ))}
        </nav>
      </header>

      {v ? renderLayout(sections, { designTokens: tokens, market, locale: v.locale, products: data.products || [] }) : (
        <div className="pub-empty">该市场版本尚未生成</div>
      )}

      <footer className="pub-foot" style={{ background: tokens.primary_deep || '#0b0f16', color: tokens.on_dark || '#e6ebf2' }}>
        <span>© {new Date().getFullYear()} {data.site?.name}</span>
        <span className="pub-src-badge">{v?.layout_schema?.layout_source === 'glm' ? 'GLM generated' : 'Rule-based layout'}</span>
      </footer>
    </div>
  )
}
