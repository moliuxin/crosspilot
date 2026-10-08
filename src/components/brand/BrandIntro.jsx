import { useEffect, useState } from 'react'
import { brandInitial } from '../../data/brand'

// 会话级标记：同一会话内二次进入可跳过/缩短（sessionStorage，关闭标签页即重置）
const SEEN_KEY = 'sitepilot.brandIntro.seen'

function hasSeenIntro() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markSeenIntro() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

/**
 * 品牌进入动效（参考海澜之家官网的品牌进入感）
 *
 * 结构：品牌色 / 白色背景 → Logo 居中 → Logo 缩放+淡入+遮罩展开 → 主体顺滑进入
 * 时长：首次 1.2s；同一会话内再次进入 0.5s（缩短）
 * 品牌：完全跟随传入 brand（客户自己的 Logo 与品牌色），不写死平台品牌
 *
 * @param {object}   brand      resolveBrand() 的结果
 * @param {boolean}  enabled    是否启用（false 直接不渲染）
 * @param {string}   variant    'platform' 平台后台 | 'site' 客户独立站
 * @param {function} onDone     动画结束回调
 */
export default function BrandIntro({ brand, enabled = true, variant = 'site', onDone }) {
  const seen = hasSeenIntro()
  const duration = seen ? 500 : 1200
  const [phase, setPhase] = useState(seen ? 'short' : 'full') // full | short | exit
  const [hidden, setHidden] = useState(!enabled)

  useEffect(() => {
    if (!enabled) return
    markSeenIntro()
    const t1 = setTimeout(() => setPhase('exit'), duration)
    const t2 = setTimeout(() => {
      setHidden(true)
      onDone?.()
    }, duration + 420)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  if (hidden) return null

  const initial = brandInitial(brand)
  const bg = variant === 'site' ? brand?.dark || '#101828' : '#ffffff'
  const fg = variant === 'site' ? '#ffffff' : brand?.primary || '#315efb'

  return (
    <div
      className={`brand-intro ${phase} ${variant}`}
      style={{ '--bi-bg': bg, '--bi-fg': fg, '--bi-primary': brand?.primary || '#315efb' }}
      aria-hidden="true"
    >
      <div className="bi-bg" />
      <div className="bi-veil" />
      <div className="bi-center">
        {brand?.logoUrl ? (
          <img className="bi-logo-img" src={brand.logoUrl} alt="" />
        ) : (
          <div className="bi-logo">{initial}</div>
        )}
        <div className="bi-name">{brand?.name || 'Brand'}</div>
        <div className="bi-sub">{brand?.sub || ''}</div>
      </div>
    </div>
  )
}
