/**
 * Component Registry 前端映射(PHASE 5)。
 *
 * 后端 backend/app/skills/component_registry.py 是元数据真源;
 * 这里按 type 提供 React 渲染器。GLM / LayoutPlanningSkill 只输出
 * {type, variant, props},PageRenderer 按 Schema 渲染,绝不注入 HTML。
 */
import HeroIndustrial from './HeroIndustrial'
import ProductGrid from './ProductGrid'
import SpecsTable from './SpecsTable'
import BenefitsGrid from './BenefitsGrid'
import Applications from './Applications'
import CertGrid from './CertGrid'
import CasesGrid from './CasesGrid'
import Faq from './Faq'
import RfqBlock from './RfqBlock'

const REGISTRY = {
  hero: { render: HeroIndustrial, label: '首屏' },
  benefits: { render: BenefitsGrid, label: '利益点' },
  factory: { render: BenefitsGrid, label: '制造能力' }, // zh 专用语义,渲染复用网格
  solutions: { render: Applications, label: '解决方案' },
  key_specs: { render: SpecsTable, label: '关键参数' },
  applications: { render: Applications, label: '应用场景' },
  products: { render: ProductGrid, label: '产品系列' },
  supply_capability: { render: SpecsTable, label: '供货能力' },
  technical_details: { render: SpecsTable, label: '技术细节' },
  certifications: { render: CertGrid, label: '认证' },
  cases: { render: CasesGrid, label: '案例' },
  services: { render: BenefitsGrid, label: '服务承诺' },
  faq: { render: Faq, label: 'FAQ' },
  fast_quote: { render: RfqBlock, label: '快速询价' },
  rfq: { render: RfqBlock, label: '询盘表单' },
  trust: { render: CertGrid, label: '信任条' },
}

export function renderSection(sec, ctx) {
  const entry = REGISTRY[sec?.type]
  if (!entry) return null
  // ctx 必须以「ctx」键整包传入:组件签名解构 { props, ctx } ——
  // 仅展开(...ctx)会让 ctx 在组件内为 undefined(tokens/产品数据全部失效)
  return entry.render({ ...sec, ...ctx, ctx })
}

export function renderLayout(sections, ctx) {
  return (sections || [])
    .map((sec) => renderSection(sec, ctx))
    .filter(Boolean)
}

export const SECTION_LABELS = Object.fromEntries(
  Object.entries(REGISTRY).map(([t, v]) => [t, v.label])
)

export default REGISTRY
