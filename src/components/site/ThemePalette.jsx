import { useState } from 'react'

/**
 * 站点调色盘(instant_site_ai skill_5 theme_panel 的 React 移植,零 LLM):
 * 预设主题卡(三色点) + Primary/Accent 自定义取色 + 恢复默认。
 * 只覆盖品牌色(primary/primary_deep/accent/accent_deep/on_dark/on_accent),
 * 版面令牌(bg/text/border/字体/圆角)保持站点原有设计 —— 与 LUMINA 行为一致。
 */

const PRESETS = [
  { id: 'champagne', name: 'Champagne', primary: '#0D1B2A', primary_deep: '#081220', accent: '#E0A96D', accent_deep: '#C8935B', on_dark: '#F5EFE6', on_accent: '#1A1208' },
  { id: 'rose_gold', name: 'Rose Gold', primary: '#221420', primary_deep: '#150C11', accent: '#DCA7A1', accent_deep: '#C08D86', on_dark: '#F8F0EE', on_accent: '#2A1215' },
  { id: 'emerald', name: 'Emerald', primary: '#0A2018', primary_deep: '#051310', accent: '#8FCBB0', accent_deep: '#6FAF92', on_dark: '#EFF6F1', on_accent: '#0A2018' },
  { id: 'ruby', name: 'Ruby', primary: '#260B12', primary_deep: '#170609', accent: '#DB8199', accent_deep: '#BE6279', on_dark: '#F9EFF2', on_accent: '#2A0A12' },
  { id: 'sapphire', name: 'Sapphire', primary: '#0B1230', primary_deep: '#060A1E', accent: '#93A8E8', accent_deep: '#7188CC', on_dark: '#F0F3FA', on_accent: '#0B1230' },
]

function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/** 加深(系数<1),用于由自定义色推导 -deep 变体 */
function darken(hex, factor) {
  const rgb = hexToRgb(hex)
  return rgb ? rgbToHex(rgb.map((v) => v * factor)) : hex
}

/** 亮度 → accent 底上的文字色(浅 accent 配深字,深 accent 配白字) */
function onColor(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#fff'
  const [r, g, b] = rgb
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1A1208' : '#ffffff'
}

export default function ThemePalette({ baseTokens, value, onChange, onClose }) {
  const [customPrimary, setCustomPrimary] = useState(value?.primary || baseTokens.primary || '#141a24')
  const [customAccent, setCustomAccent] = useState(value?.accent || baseTokens.accent || '#c2570c')
  const bg = baseTokens.bg || '#f7f8fa'

  function applyPreset(p) {
    onChange({
      primary: p.primary, primary_deep: p.primary_deep,
      accent: p.accent, accent_deep: p.accent_deep,
      on_dark: p.on_dark, on_accent: p.on_accent,
    })
  }

  function applyCustom(kind, hex) {
    if (kind === 'primary') {
      setCustomPrimary(hex)
      onChange({ ...(value || {}), primary: hex, primary_deep: darken(hex, 0.62), on_dark: '#F2F5F9' })
    } else {
      setCustomAccent(hex)
      onChange({ ...(value || {}), accent: hex, accent_deep: darken(hex, 0.78), on_accent: onColor(hex) })
    }
  }

  return (
    <div className="tp-root" role="dialog" aria-label="配色方案">
      <div className="tp-backdrop" onClick={onClose} />
      <aside className="tp-drawer">
        <button className="tp-close" onClick={onClose} aria-label="关闭">×</button>
        <h3 className="tp-title">配色方案</h3>

        <div className="tp-label">预设主题</div>
        <div className="tp-presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`tp-preset${value?.primary?.toLowerCase() === p.primary.toLowerCase() ? ' on' : ''}`}
              onClick={() => applyPreset(p)}
            >
              <span className="tp-name">{p.name}</span>
              <span className="tp-dots">
                <i style={{ background: p.primary }} />
                <i style={{ background: p.accent }} />
                <i style={{ background: bg }} />
              </span>
            </button>
          ))}
        </div>

        <div className="tp-label">自定义颜色</div>
        <div className="tp-custom">
          <label>
            <span>Primary</span>
            <input type="color" value={customPrimary} onChange={(e) => applyCustom('primary', e.target.value)} />
          </label>
          <label>
            <span>Accent</span>
            <input type="color" value={customAccent} onChange={(e) => applyCustom('accent', e.target.value)} />
          </label>
        </div>

        <button className="tp-reset" onClick={() => onChange(null)}>恢复默认</button>
        <p className="tp-note">仅演示预览生效(本地记忆),不会改动站点已发布内容。</p>
      </aside>
    </div>
  )
}
