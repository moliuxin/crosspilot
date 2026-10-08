import { useEffect, useMemo, useState } from 'react'
import { brandInitial } from '../../data/brand'

/**
 * AI 品牌等待页（参考墨刀 Logo 等待体验）
 *
 * 用于所有耗时操作：生成网站 / 重新生成 / AI 优化页面 / 生成多语言版本。
 * 结构：Logo 居中 + Logo 微动画 + 极简进度信息 + 当前 AI 执行步骤
 * 风格：简洁、克制、高级（无 Loading 圈）
 *
 * Logo 优先使用客户自己的 Logo；客户未上传时，回退到传入的 brand（平台后台传平台品牌）。
 *
 * @param {object}   brand     resolveBrand() 结果
 * @param {string}   title     主标题，如「正在生成你的网站」
 * @param {string[]} steps     AI 执行步骤文案
 * @param {number}   stepMs    每步时长（ms）
 * @param {function} onDone    全部完成后回调
 * @param {boolean}  compact   紧凑模式（用于局部，如 AI 优化单页）
 */
export default function AiWaiting({ brand, title = '正在为你生成', steps = [], stepMs = 620, onDone, compact = false }) {
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState(false)
  const list = useMemo(() => (steps.length ? steps : ['正在处理']), [steps])
  const initial = brandInitial(brand)
  const total = list.length
  const percent = Math.round(((index + (done ? 1 : 0)) / total) * 100)

  useEffect(() => {
    if (index >= total) return
    const t = setTimeout(() => {
      if (index === total - 1) {
        setDone(true)
        setTimeout(() => onDone?.(), 420)
      } else {
        setIndex((i) => i + 1)
      }
    }, stepMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, total])

  return (
    <div className={`ai-wait${compact ? ' compact' : ''}`} style={{ '--aw-primary': brand?.primary || '#315efb' }}>
      <div className="ai-wait-inner">
        <div className="ai-logo-wrap">
          <div className="ai-logo-halo" />
          {brand?.logoUrl ? (
            <img className="ai-logo-img" src={brand.logoUrl} alt="" />
          ) : (
            <div className="ai-logo">{initial}</div>
          )}
        </div>

        <h2 className="ai-wait-title">{done ? '即将完成' : title}</h2>

        <div className="ai-wait-steps">
          {list.map((s, i) => (
            <div key={s} className={`ai-step${i < index ? ' done' : i === index ? ' running' : ''}`}>
              <span className="ai-step-dot" />
              <span className="ai-step-text">{s}</span>
            </div>
          ))}
        </div>

        <div className="ai-progress">
          <div className="ai-progress-bar">
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="ai-progress-num">{percent}%</span>
        </div>

        <div className="ai-wait-hint">请稍候，不要关闭页面</div>
      </div>
    </div>
  )
}

// 预置步骤文案（对齐交接包要求的示例）
export const WAIT_STEPS = {
  site: [
    '正在理解企业信息',
    '正在匹配行业模板',
    '正在生成产品结构',
    '正在生成英文内容',
    '正在优化 SEO 结构',
    '正在完成网站',
  ],
  regenerate: [
    '正在读取当前网站结构',
    '正在重新规划页面内容',
    '正在生成新的文案',
    '正在优化搜索结构',
    '正在完成重新生成',
  ],
  optimizePage: [
    '正在分析当前页面',
    '正在匹配采购意图',
    '正在优化标题与结构',
    '正在补全关键信息',
    '正在应用优化',
  ],
  localize: [
    '正在读取源语言内容',
    '正在匹配目标市场模板',
    '正在生成本地化文案',
    '正在调整信任元素与 CTA',
    '正在生成本地化页面',
  ],
}
