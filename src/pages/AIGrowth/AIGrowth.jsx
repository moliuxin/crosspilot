import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'

// AI 增长：高级能力的统一入口。
// 按总指令「一级菜单固定」，SEO / GEO / 竞品分析 / Buyer Conversion / Skill Center
// 等全部收进本页，不再堆一级菜单。
const DIRECT = [
  { to: '/seo', icon: '↗', label: 'SEO 优化', desc: '标题 / Slug / Meta / H1 / FAQ / ALT / Schema / 内链' },
  { to: '/growth/geo', icon: '◈', label: 'GEO（AI 搜索）', desc: '让 AI 回答里出现你的品牌与产品', isNew: true },
  { to: '/growth/audit', icon: '◎', label: '网站诊断', desc: '可发现性 / 体验 / 说服力 / 转化路径' },
  { to: '/growth/competitor', icon: '⚑', label: '竞品分析', desc: '对标头部，找差异化位置' },
  { to: '/growth/conversion', icon: '◉', label: 'Buyer Conversion', desc: 'AI 买家模拟，找转化阻塞点' },
  { to: '/growth/copy', icon: '✎', label: 'AI 文案', desc: '首屏主张 / 产品描述 / FAQ' },
  { to: '/growth/image', icon: '▣', label: 'AI 图片', desc: '产品主图 / 场景图 / 统一调性' },
  { to: '/agent', icon: '⌘', label: 'AI Agent · MCP', desc: '15 个工具，草稿 → 人工确认 → 发布' },
  { to: '/skills', icon: '⬡', label: 'Skill Center', desc: '全部能力 + 用量与购买记录' },
]

// 有真实任务落库的功能（走 GrowthFeature 页）
const TASK_FEATURES = new Set(['audit', 'competitor', 'copy', 'image', 'conversion'])

export default function AIGrowth() {
  const navigate = useNavigate()
  const { toast } = useApp()
  const [health, setHealth] = useState(null)

  useEffect(() => {
    api.getHealth().then(setHealth)
  }, [])

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">AI GROWTH</div>
          <h1>把复杂优化，变成商家看得懂的增长任务</h1>
          <p>商家只看结果；Canonical、Schema、路由、内链等专业配置由平台后台完成。</p>
        </div>
        <div className="head-actions">
          <button className="primary-btn" onClick={() => navigate('/seo')}>开始全站诊断</button>
        </div>
      </div>

      <div className="growth-grid">
        <article className="growth-score panel">
          <div className="big-score-ring">
            <b>{health?.score ?? '—'}</b>
            <span>网站增长评分</span>
          </div>
          <div className="score-breakdown">
            <div><span>页面体验</span><b>92</b></div>
            <div><span>SEO</span><b>71</b></div>
            <div><span>GEO</span><b>68</b></div>
            <div><span>内容本地化</span><b>84</b></div>
          </div>
        </article>

        <article className="panel task-panel">
          <div className="panel-head">
            <div>
              <strong>全部增长能力</strong>
              <span>点击进入对应能力</span>
            </div>
            <span className="ai-badge">✦ {DIRECT.length} 项</span>
          </div>
          <div className="growth-cap-grid">
            {DIRECT.map((d) => {
              const gated = TASK_FEATURES.has(d.to.split('/').pop())
              return (
                <button key={d.to} className="growth-cap" onClick={() => navigate(d.to)}>
                  <span className="growth-cap-ico">{d.icon}</span>
                  <span className="growth-cap-body">
                    <strong>
                      {d.label}
                      {d.isNew ? <i className="nav-new">NEW</i> : null}
                    </strong>
                    <small>{d.desc}</small>
                  </span>
                  {gated ? <span className="growth-cap-tag">PRO</span> : null}
                </button>
              )
            })}
          </div>
        </article>
      </div>

      <div className="skill-upsell">
        <div>
          <small>PROFESSIONAL SERVICE</small>
          <h2>需要我们直接替你做？</h2>
          <p>提交专业服务任务，由平台团队执行；进度与交付在对应能力页实时可查。</p>
        </div>
        <div className="service-price">
          <span>单产品优化</span>
          <strong>¥ 680 <small>/页起</small></strong>
          <button onClick={() => navigate('/growth/audit')}>查看服务详情</button>
        </div>
      </div>

      {/* 专业字段默认隐藏 */}
      <details className="advanced-detail">
        <summary>高级技术详情（Canonical / Schema / robots / sitemap / llms.txt / Entity Graph 等，默认隐藏）</summary>
        <div className="adv-grid">
          {['Canonical', 'Schema', 'robots', 'sitemap', 'llms.txt', 'Entity Graph', 'H1–H6 结构', 'Internal Link Graph', '结构化数据校验'].map((k) => (
            <div className="adv-item" key={k}>
              <b>{k}</b>
              <span>由平台专业能力维护，商家无需直接配置</span>
            </div>
          ))}
        </div>
      </details>
    </section>
  )
}
