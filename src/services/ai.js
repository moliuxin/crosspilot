// AI 能力 Mock 层：AI 生成产品内容、SEO 优化、Agent 指令
// 后续可替换为真实 LLM 网关，页面只消费结构化结果。
import { marketTemplates } from '../data/marketTemplates'

const delay = (ms = 500) => new Promise((r) => setTimeout(r, ms))

export const ai = {
  // 产品内容生成（标题 / 描述 / 卖点 / FAQ / ALT / 三语言）
  async generateProductContent({ name, model, specs = [], applications = [] }) {
    await delay(650)
    const specText = specs.map((s) => `${s.key} ${s.value}`).join(', ')
    return {
      en: {
        title: `${name} Manufacturer | AQUAFLOW ${model}`,
        description: `Industrial-grade ${name.toLowerCase()} engineered for demanding process conditions. ${specText}. OEM/ODM available with global delivery and commissioning support.`,
        benefits: ['Stable operation under continuous load', 'Low maintenance design', 'Fast global delivery'],
        faq: [
          'What is the lead time?',
          'Do you provide installation support?',
          'Is OEM / ODM available?',
          'What is the warranty period?',
        ],
        imageAlt: [`${name} front view`, `${name} installed on site`],
      },
      zh: {
        title: `${name} 厂家 | AQUAFLOW ${model}`,
        description: `面向工业项目的 ${name}，${specText}。支持 OEM/ODM，全球交付与调试支持。`,
        benefits: ['连续工况下稳定运行', '低维护设计', '全球快速交付'],
        faq: ['交货期多久？', '是否提供安装支持？', '是否支持 OEM/ODM？', '质保期多久？'],
        imageAlt: [`${name} 正面图`, `${name} 现场安装图`],
      },
      ru: {
        title: `${name} от производителя | AQUAFLOW ${model}`,
        description: `Промышленное оборудование ${name} для тяжёлых условий. ${specText}. OEM/ODM, поставка и пусконаладка.`,
        benefits: ['Стабильная работа под нагрузкой', 'Низкие затраты на обслуживание', 'Быстрая доставка'],
        faq: ['Срок поставки?', 'Техническая поддержка?', 'Возможен OEM/ODM?', 'Гарантия?'],
        imageAlt: [`${name} вид спереди`, `${name} на объекте`],
      },
      applications,
    }
  },

  // 单产品 SEO 优化建议（用于 SEO Compare 页的“AI 自动优化”）
  async optimizeSeo(product) {
    await delay(600)
    return {
      productId: product?.id,
      note: 'AI 已依据目标市场搜索意图重新校准本页 SEO（Mock）。',
    }
  },

  // 首次建站生成步骤
  buildSteps: [
    '企业分析',
    '市场策略',
    '页面结构',
    '产品内容',
    '图片建议',
    'SEO 基础配置',
  ],

  async generateSite({ company, industry, products, markets }) {
    // 模拟分步生成；返回结果供后台展示
    await delay(300)
    return {
      ok: true,
      siteName: company || 'Your Brand',
      industry,
      products,
      markets,
      template: marketTemplates[markets?.[0]] || marketTemplates['en-US'],
    }
  },
}
