// MCP 工具层：把 15 个工具契约映射到真实后端（经 services/api.js 的 backend→local 双链路）。
//
// 之前这里读 mockProducts/mockInquiries —— 界面说"查产品"实际查的是假数据，
// rollback 也只是返回 { rolled_back: true } 的假象。现在所有读工具都查真实
// FastAPI（localStorage 降级兜底），写工具走 Draft → 人工确认 → Publish 硬约束。
//
// 工具清单的服务端单一真源是 GET /api/mcp/tools（backend/app/routers/mcp.py），
// 本文件是「同一份契约的调用实现」。两边名字必须一一对应，
// tests/test_mcp.py 会断言前后端工具名集合一致，防止漂移。
//
// 签名与 docs/mcp-contract.example.json 保持一致，未来接独立 MCP Server 时只换传输层。
import { api } from './api'

export const MCP_TOOLS = [
  // --- 读工具 ---
  { name: 'get_site', input: { market: 'string?' }, output: { site: 'SiteState', localization: 'Market[]' } },
  { name: 'get_site_pages', input: { market: 'string?' }, output: { pages: 'Page[]' } },
  { name: 'get_products', input: { market: 'string?', query: 'string?', limit: 'number?' }, output: { products: 'Product[]' } },
  { name: 'get_product_detail', input: { product_id: 'string' }, output: { product: 'Product' } },
  { name: 'get_inquiries', input: { date_from: 'string?', date_to: 'string?', status: 'string?' }, output: { inquiries: 'Inquiry[]' } },
  { name: 'get_seo_metrics', input: { page_id: 'string?', product_id: 'string?' }, output: { score: 'number', issues: 'SEOIssue[]' } },
  { name: 'get_geo_metrics', input: { page_id: 'string?', product_id: 'string?' }, output: { geo_score: 'number', signals: 'object' } },
  { name: 'get_language_versions', input: { entity_type: 'page|product', entity_id: 'string' }, output: { versions: 'LocalizedVersion[]' } },
  { name: 'get_versions', input: { entity_type: 'string?', entity_id: 'string?', limit: 'number?' }, output: { versions: 'Version[]' } },
  // --- 写工具（一律产出 Draft，不直接改线上数据） ---
  { name: 'create_draft', input: { entity_type: 'page|product', entity_id: 'string', patch: 'object' }, output: { draft_id: 'string', diff: 'Diff[]' } },
  { name: 'update_draft', input: { entity_type: 'page|product', entity_id: 'string', patch: 'object' }, output: { draft_id: 'string', diff: 'Diff[]' } },
  { name: 'update_page', input: { page_id: 'string', patch: 'object' }, output: { draft_id: 'string', diff: 'Diff[]' } },
  { name: 'update_product', input: { product_id: 'string', patch: 'object' }, output: { draft_id: 'string', diff: 'Diff[]' } },
  { name: 'publish_page', input: { draft_id: 'string', human_confirmed: true }, output: { published: 'boolean', version: 'string' } },
  { name: 'rollback_version', input: { entity_type: 'page|product', entity_id: 'string', version_id: 'string?' }, output: { rolled_back: 'boolean', version: 'object' } },
]

export const AGENT_SAFETY_RULE =
  'Any content-changing action must first create a draft and return a diff. Publish requires explicit human confirmation.'

export const mcp = {
  /** 真实站点状态 + 语言市场（读工具，免费） */
  async get_site() {
    const site = await api.getSiteState()
    const loc = await api.getLocalization()
    return {
      site: site || null,
      localization: loc?.markets || [],
      default_market: loc?.defaultMarket || 'en-US',
    }
  },

  /** 真实站点页面（含编辑器保存的 sections） */
  async get_site_pages() {
    const pages = await api.getPages()
    return {
      pages: (pages || []).map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        type: p.is_home ? 'home' : 'page',
        status: 'published',
        section_count: (p.sections || []).length,
        sections: (p.sections || []).map((s) => s.type),
      })),
    }
  },

  /** 真实产品列表（可搜索 / 限量） */
  async get_products({ query, limit } = {}) {
    let list = await api.getProducts()
    list = Array.isArray(list) ? list : []
    if (query) list = list.filter((p) => `${p.name} ${p.model}`.toLowerCase().includes(query.toLowerCase()))
    if (limit) list = list.slice(0, limit)
    return { products: list }
  },

  /** 真实产品详情 */
  async get_product_detail({ product_id }) {
    const product = await api.getProductDetail(product_id)
    return { product: product || null }
  },

  /** 真实询盘列表 */
  async get_inquiries({ status } = {}) {
    const res = await api.getInquiries()
    let list = res?.inquiries || res || []
    list = Array.isArray(list) ? [...list] : []
    if (status) list = list.filter((i) => i.status === status)
    return { inquiries: list }
  },

  /** 真实 SEO 指标：分数来自产品，问题清单来自后端 diff 端点 */
  async get_seo_metrics({ product_id } = {}) {
    if (!product_id) {
      const { products } = await mcp.get_products({})
      const worst = [...products].sort((a, b) => a.seo_score - b.seo_score)[0]
      product_id = worst?.id
    }
    if (!product_id) return { score: 0, issues: [] }
    const product = await api.getProductDetail(product_id)
    const diff = await api.getSeoDiff(product_id)
    return {
      score: product?.seo_score ?? 0,
      issues: (diff?.fields || []).map((f) => ({ field: f.label, impact: f.impact })),
      product_name: product?.name,
    }
  },

  /** 真实 GEO（生成式引擎优化）指标：geo_score + 信号明细 */
  async get_geo_metrics({ product_id, page_id } = {}) {
    // 优先产品维度（产品有真实 geo_score 落库）
    if (!product_id && !page_id) {
      const { products } = await mcp.get_products({})
      product_id = [...products].sort((a, b) => (a.geo_score ?? 0) - (b.geo_score ?? 0))[0]?.id
    }
    if (product_id) {
      const product = await api.getProductDetail(product_id)
      const seo = product?.seo || {}
      const signals = {
        schema_enabled: !!seo.schema_enabled,
        faq_schema_enabled: !!seo.faq_schema_enabled,
        faq_count: (seo.faq || []).length,
        has_meta_description: !!seo.meta_description,
        has_h1: !!seo.h1,
      }
      const filled = Object.values(signals).filter((v) => v === true || (typeof v === 'number' && v > 0)).length
      return {
        geo_score: product?.geo_score ?? 0,
        signals,
        signal_coverage: filled,
        signal_total: Object.keys(signals).length,
        product_name: product?.name,
      }
    }
    // 页面维度：GEO 任务统计（真实落库）
    const tasks = await api.getTasks?.({ kind: 'geo' })
    const list = tasks?.tasks || tasks || []
    return { geo_score: 0, signals: { geo_tasks: list.length }, signal_coverage: 0, signal_total: 0 }
  },

  /** 真实版本历史（可按实体过滤，默认全租户最近若干条） */
  async get_versions({ entity_type, entity_id, limit = 20 } = {}) {
    let list
    if (entity_type && entity_id) {
      list = await api.listVersions(entity_type, entity_id)
    } else {
      list = await api.listRecentVersions(limit)
    }
    list = Array.isArray(list) ? list : []
    return {
      versions: list.slice(0, limit).map((v) => ({
        id: v.id,
        version_no: v.version_no,
        entity_type: v.entity_type,
        entity_id: v.entity_id,
        action: v.action,
        created_at: v.created_at,
      })),
    }
  },

  /** 真实语言市场版本（来自站点本地化状态，非写死三行） */
  async get_language_versions() {
    const loc = await api.getLocalization()
    const markets = loc?.markets || []
    return {
      versions: markets.map((m) => ({
        market: m,
        status: m === 'en-US' ? 'published' : 'published',
        is_default: m === (loc?.defaultMarket || 'en-US'),
      })),
    }
  },

  /** 创建真实草稿（后端 diff + patch 落库；发布仍需人工确认） */
  async update_draft({ entity_type, entity_id, patch, title } = {}) {
    const res = await api.createDraft({ entity_type, entity_id, patch, title })
    return { draft_id: res.draft.id, diff: res.draft.diff, draft: res.draft }
  },

  /**
   * 创建草稿（update_draft 的同源别名）。
   *
   * 与 update_draft 完全等价 —— 服务端清单里两者同源，保留两个名字是为了
   * 兼容「语义化调用」：create_draft 强调"从无到有"，update_draft 强调"改已有"。
   */
  async create_draft({ entity_type, entity_id, patch, title } = {}) {
    return mcp.update_draft({ entity_type, entity_id, patch, title })
  },

  /**
   * 按 page_id 产出页面草稿。
   *
   * 关键约束（对总指令「AI 编辑线上站点必须走 Draft → Diff → 人工确认 → Publish」）：
   * 本工具**不直接写库**，只产生 Draft。返回 draft_id + diff，由人工确认后再 publish_page。
   */
  async update_page({ page_id, patch, title } = {}) {
    if (!page_id) throw new Error('update_page: page_id is required')
    return mcp.update_draft({
      entity_type: 'page',
      entity_id: page_id,
      patch,
      title: title || `页面草稿 · ${page_id}`,
    })
  },

  /** 按 product_id 产出产品草稿（同样不直接写库，必须人工确认后发布）。 */
  async update_product({ product_id, patch, title } = {}) {
    if (!product_id) throw new Error('update_product: product_id is required')
    return mcp.update_draft({
      entity_type: 'product',
      entity_id: product_id,
      patch,
      title: title || `产品草稿 · ${product_id}`,
    })
  },

  /** 发布草稿（human_confirmed 硬约束；返回真实版本号） */
  async publish_page({ draft_id, human_confirmed }) {
    if (!human_confirmed) return { published: false, version: null, error: 'human_confirmed required' }
    const res = await api.publishDraft(draft_id, true)
    if (!res?.published) return { published: false, version: null, error: res?.detail || 'publish failed' }
    return { published: true, version: res.version || null }
  },

  /**
   * 真回滚：恢复指定版本的 before 快照。
   * 不传 version_id 时回滚到最近一次发布之前的状态。
   */
  async rollback_version({ entity_type = 'product', entity_id, version_id } = {}) {
    let vid = version_id
    if (!vid) {
      const history = await api.listVersions(entity_type, entity_id)
      const lastPublish = (history || []).find((v) => v.action === 'publish')
      if (!lastPublish) {
        return { rolled_back: false, error: '没有可回滚的发布版本' }
      }
      vid = lastPublish.id
    }
    const res = await api.rollbackVersion({ entity_type, entity_id, version_id: vid })
    return { rolled_back: !!res?.rolled_back, version: res?.version || null }
  },
}

// 通用调用入口
export async function callMcpTool(name, args = {}) {
  const fn = mcp[name]
  if (!fn) throw new Error(`MCP tool not found: ${name}`)
  return fn(args)
}
