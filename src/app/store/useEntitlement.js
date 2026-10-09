import { useCallback } from 'react'
import { useApp } from './AppContext'

/**
 * 统一付费权限入口。
 *
 * 总指令要求「不要在每个页面单独写死收费判断」—— 各页面不再自己判断套餐、
 * 不再硬编码收费文案与弹窗理由，一律调用这里的 ``can`` / ``requireFeature``，
 * 权限数据由 AppContext 从 ``GET /api/entitlements`` 一次性取回。
 */

// feature_key → 弹窗文案（与后端 FEATURE_LABELS 对应，文案面向用户）
export const FEATURE_REASON = {
  'site.generate': '免费版包含 1 次完整生成。升级后可不限次重新生成网站。',
  'site.publish': '免费版可发布 1 个站点。升级后可发布多个站点与更多页面。',
  'page.publish': '页面发布属于付费能力，升级套餐后可保存并发布任意页面。',
  'seo.optimize': '产品 SEO 智能优化属于付费能力，升级后可按产品规模化优化。',
  'market.localize': '免费版含 1 个新增市场版本。升级后可解锁全部语言市场版本。',
  'geo.publish': 'GEO（生成式引擎优化）属于付费能力，升级后可被 AI 搜索引用。',
  'agent.run': 'AI 智能体自动化属于付费能力，升级后可让 Agent 自动执行优化。',
  'brush.edit': 'AI 画笔编辑属于付费能力，升级后可在预览上圈选并让 AI 改写。',
  'seo.expert': '专家代优化服务由平台专业运营人员完成，需开通对应服务。',
  'skill.product_seo': '该 Skill 为付费能力，开通后可直接在此调用。',
  'skill.geo': '该 Skill 为付费能力，开通后可直接在此调用。',
  'skill.competitor': '该 Skill 为付费能力，开通后可直接在此调用。',
  'skill.visual_scene': '该 Skill 为付费能力，开通后可直接在此调用。',
  'skill.redesign': '该 Skill 为付费能力，开通后可直接在此调用。',
  'skill.localization': '该 Skill 为付费能力，开通后可直接在此调用。',
}

const FALLBACK_REASON = '当前套餐不包含该能力，升级或单独开通后即可使用。'

export const FEATURE_NAMES = {
  'site.generate': '解锁更多完整生成',
  'site.publish': '站点发布',
  'page.publish': '页面发布',
  'seo.optimize': '产品 SEO 优化',
  'market.localize': '多语言市场版本',
  'geo.publish': 'GEO 优化',
  'agent.run': 'AI 智能体自动化',
  'brush.edit': 'AI 画笔编辑',
  'seo.expert': '专家代优化服务',
}

export function useEntitlement() {
  const { entitlements, openPaywall } = useApp()

  const can = useCallback(
    (featureKey) => {
      // 权限数据未就绪时不误判为「无权限」，避免首屏误弹付费墙
      if (!entitlements) return true
      return !!entitlements.features?.[featureKey]
    },
    [entitlements]
  )

  /** 有权限返回 true；无权限则弹出付费墙并返回 false（调用方据此中断）。 */
  const requireFeature = useCallback(
    (featureKey, reason) => {
      if (can(featureKey)) return true
      openPaywall(
        FEATURE_NAMES[featureKey] || featureKey,
        reason || FEATURE_REASON[featureKey] || FALLBACK_REASON,
        featureKey
      )
      return false
    },
    [can, openPaywall]
  )

  const plan = entitlements?.plan || 'free'
  const isFree = plan === 'free'

  return { can, requireFeature, plan, isFree, entitlements }
}
