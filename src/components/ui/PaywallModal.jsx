import { useMemo, useState } from 'react'
import { useApp } from '../../app/store/AppContext'
import { api } from '../../services/api'

// 全局统一付费门槛弹窗。
// 触发点：完整生成 / 高级 Skill / 专业 SEO·GEO 服务 / 发布 / 多语言版本生成。
//
// 关键改动：套餐清单来自后端 `GET /api/entitlements` 的 plans（不再是前端硬编码），
// 选择套餐写入**真实订单表**（POST /api/service-orders），而不是把一句话塞进询盘。
// 后端审批通过后 Subscription 真实变更、权限立即生效。
const PLAN_COPY = {
  free: { desc: '免费体验，1 次 AI 完整生成', items: ['AI 完整生成 1 次', '中/英/俄三语基础版', '站点预览'] },
  starter: { desc: '适合刚开始做外贸独立站的中小工厂', items: ['AI 完整生成 5 次/月', '产品数量 50 个', '产品 SEO 优化', '多语言市场版本', '页面发布'] },
  growth: { desc: '适合把独立站作为核心获客渠道的企业', featured: true, items: ['AI 完整生成不限次', '产品数量不限', '单产品 SEO/GEO 深度优化', '三语言市场版本', 'AI Agent 自动化', 'AI 画笔编辑'] },
  expert: { desc: '专家代运营，直接对询盘结果负责', items: ['专家代做 SEO / GEO', '多语言落地页托管', '竞品监测与月度复盘', 'SLA 响应保障'] },
}

function formatPrice(p) {
  if (!p.price) return p.id === 'expert' ? '定制' : '免费'
  return `¥${p.price.toLocaleString()}`
}

export default function PaywallModal() {
  const { paywall, dispatch, toast, entitlements, refreshEntitlements } = useApp()
  const [submitting, setSubmitting] = useState(false)

  // 套餐来自后端真源；未就绪时不渲染（避免闪现错误价格）
  const plans = useMemo(() => {
    const list = entitlements?.plans
    if (!list?.length) return []
    const current = entitlements?.plan
    // 只展示可升级的（当前套餐之后的），free 不参与销售
    return list.filter((p) => p.id !== 'free' && p.id !== current)
  }, [entitlements])

  if (!paywall.open) return null

  const close = () => dispatch({ type: 'PAYWALL_CLOSE' })

  // 选择套餐：写入真实 ServiceOrder；featureKey 一并记录，支持单项能力加购
  const applyPlan = async (p) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await api.createServiceOrder({
        plan_id: p.id,
        feature_key: paywall.featureKey || '',
        note: paywall.feature ? `申请来源：${paywall.feature}` : '',
      })
      close()
      toast(`已提交「${p.name}」开通申请（订单已写入服务记录），可在「使用说明 · 我的订单」查看`)
      // 企业侧 Demo：提交即视为已受理，刷新权限以反映最新状态
      refreshEntitlements?.()
    } catch (e) {
      toast(`提交失败：${e?.message || '后端服务不可用'}`, 'warn')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="paywall-overlay" onClick={close}>
      <div className="paywall-modal" onClick={(e) => e.stopPropagation()}>
        <button className="paywall-close" onClick={close}>×</button>
        <div className="paywall-head">
          <div className="eyebrow">UPGRADE PLAN</div>
          <h2>{paywall.feature || '解锁完整能力'}</h2>
          <p>{paywall.reason || '当前为免费体验版，升级后解锁完整能力与更大额度。'}</p>
        </div>

        <div className="paywall-plans">
          {plans.length === 0 && <div className="paywall-empty">套餐信息加载中…</div>}
          {plans.map((p) => {
            const copy = PLAN_COPY[p.id] || {}
            const featured = p.id === 'growth'
            return (
              <div key={p.id} className={`paywall-plan${featured ? ' featured' : ''}`}>
                {featured && <span className="paywall-tag">最受欢迎</span>}
                <b>{p.name}</b>
                <div className="paywall-price">
                  <strong>{formatPrice(p)}</strong>
                  <span>{p.price ? '/月' : ''}</span>
                </div>
                <small>{copy.desc}</small>
                <ul>
                  {(copy.items || []).map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
                <button
                  className={featured ? 'primary-btn' : 'ghost-btn'}
                  disabled={submitting}
                  onClick={() => applyPlan(p)}
                >
                  {submitting ? '提交中…' : `选择 ${p.name}`}
                </button>
              </div>
            )
          })}
        </div>

        <button className="paywall-later" onClick={close}>暂不需要，继续免费体验</button>
      </div>
    </div>
  )
}
