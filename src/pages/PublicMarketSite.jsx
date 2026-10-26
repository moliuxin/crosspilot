import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { renderLayout } from '../components/site-blocks'
import { api } from '../services/api'
import ThemePalette from '../components/site/ThemePalette'
import '../components/site/ThemePalette.css'
import './PublicMarketSite.css'

const MARKET_META = {
  'zh-CN': { flag: '🇨🇳', label: '中文', lang: 'zh-CN' },
  'en-US': { flag: '🇺🇸', label: 'English', lang: 'en-US' },
  'ru-RU': { flag: '🇷🇺', label: 'Русский', lang: 'ru-RU' },
}

/** Yandex Metrika 接入位：填入计数器 ID(如 '12345678')即自动注入官方统计脚本(俄区站点)。
 *  为空时不注入——诚实集成点,不假装已埋点。 */
const YANDEX_METRIKA_ID = ''

/** 社交发现卡(OG/Twitter)：分享到 VK/Instagram/微信时渲染品牌卡片而非裸链 */
function setMeta(attr, key, content) {
  if (!content) return
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

/** 调色盘覆盖按站点记忆(仅本地预览,不写回已发布内容) */
function loadPalette(slug) {
  try {
    const raw = localStorage.getItem('sitepilot.palette.' + slug)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/**
 * 公开独立站(按市场独立 URL,PHASE 5/13):
 * /#/site/:slug/:market/ —— 每市场独立 Title/Description/hreflang,
 * 渲染 SiteMarketVariant(layout_schema + design_tokens + 真实资产图),
 * 不是同一 DOM 换文案。附带调色盘抽屉(预设/自定义品牌色,实时预览)。
 */
export default function PublicMarketSite() {
  const { slug, market = 'en-US' } = useParams()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [palette, setPalette] = useState(null)
  const [palOpen, setPalOpen] = useState(false)

  useEffect(() => {
    setPalette(loadPalette(slug))
    api.getPublicSite(slug, market).then(setData).catch((e) => setErr(e?.message || '加载失败'))
  }, [slug, market])

  function updatePalette(next) {
    setPalette(next)
    try {
      if (next) localStorage.setItem('sitepilot.palette.' + slug, JSON.stringify(next))
      else localStorage.removeItem('sitepilot.palette.' + slug)
    } catch { /* 隐私模式忽略 */ }
  }

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
    // 社交发现卡(OG/Twitter)——og:image 取首屏 hero 真实图(绝对地址才有效)
    const heroImg = (v?.layout_schema?.sections || []).find((s) => s.type === 'hero')?.props?.image
    const img = /^https?:\/\//.test(heroImg || '') ? heroImg : ''
    setMeta('property', 'og:title', seo.title)
    setMeta('property', 'og:description', seo.description)
    setMeta('property', 'og:type', 'website')
    setMeta('property', 'og:url', window.location.href)
    setMeta('property', 'og:image', img)
    setMeta('property', 'og:locale', v?.locale || market)
    setMeta('name', 'twitter:card', 'summary_large_image')
    setMeta('name', 'twitter:title', seo.title)
    setMeta('name', 'twitter:description', seo.description)
    setMeta('name', 'twitter:image', img)
    // Yandex Metrika 接入位:配置了计数器 ID 才注入官方脚本(俄区统计)
    if (YANDEX_METRIKA_ID && market === 'ru-RU' && !document.getElementById('ym-script')) {
      const s = document.createElement('script')
      s.id = 'ym-script'
      s.async = true
      s.src = 'https://mc.yandex.ru/metrika/tag.js'
      s.onload = () => {
        if (window.ym) window.ym(Number(YANDEX_METRIKA_ID), 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true })
      }
      document.head.appendChild(s)
    }
  }, [seo.title, seo.description, v, market])

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
  const t = { ...(v?.design_tokens || {}), ...(palette || {}) }
  const markets = (data.site?.target_markets || ['en-US']).filter((m) => MARKET_META[m])

  return (
    <div className="pub-site" style={{ background: t.bg || '#f7f8fa', color: t.text || '#182230' }}>
      <header className="pub-head" style={{ background: t.primary || '#141a24', color: t.on_dark || '#e6ebf2' }}>
        <b>{data.site?.name || data.tenant?.name}</b>
        <nav>
          {markets.map((m) => (
            <Link key={m} to={`/site/${slug}/${m}/`}
              className={`pub-lang${m === market ? ' on' : ''}`}
              style={m === market ? { background: t.accent || '#c2570c', color: t.on_accent || '#fff' } : {}}>
              {MARKET_META[m].flag} {MARKET_META[m].label}
            </Link>
          ))}
          <button className="pub-palette-btn" title="配色方案" onClick={() => setPalOpen(true)}>🎨</button>
        </nav>
      </header>

      {v ? renderLayout(sections, { designTokens: t, market, locale: v.locale, products: data.products || [] }) : (
        <div className="pub-empty">该市场版本尚未生成</div>
      )}

      <footer className="pub-foot" style={{ background: t.primary_deep || '#0b0f16', color: t.on_dark || '#e6ebf2' }}>
        <span>© {new Date().getFullYear()} {data.site?.name}</span>
        <span className="pub-src-badge">{v?.layout_schema?.layout_source === 'glm' ? 'GLM generated' : 'Rule-based layout'}</span>
      </footer>

      {palOpen && (
        <ThemePalette
          baseTokens={v?.design_tokens || {}}
          value={palette}
          onChange={updatePalette}
          onClose={() => setPalOpen(false)}
        />
      )}
    </div>
  )
}
