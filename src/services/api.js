// 统一 API adapter 层。
//
// 运行模式（优先级从高到低）：
//   1) backend  —— 连接 FastAPI 后端（默认，启动时自动探测 /api/health）
//   2) local    —— 后端不可用时降级到 localStorage（离线也能演示，数据不丢）
//
// 页面组件只调用 api.*，完全不感知当前走的是哪条链路。
import { mockCompany, mockMetrics, mockHealth } from '../data/mockCompany'
import { inquiryStats } from '../data/mockInquiries'
import { marketTemplates } from '../data/marketTemplates'
import { skills } from '../data/skills'
import { loadDb, saveDb, uid } from './db'

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000'
const API_PREFIX = '/api'
const TIMEOUT = 8000

const TOKEN_KEY = 'sitepilot.token'

/** 读取本地保存的登录凭证（JWT）。 */
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* 隐私模式下 localStorage 不可用：仅内存会话 */
  }
}

export function clearToken() {
  setToken('')
}

/** 登录状态失效时广播，供上层跳回登录页。 */
const authListeners = new Set()
export function onUnauthorized(fn) {
  authListeners.add(fn)
  return () => authListeners.delete(fn)
}
function emitUnauthorized() {
  clearToken()
  authListeners.forEach((fn) => fn())
}

// 'unknown' | 'backend' | 'local'
export let MODE = 'unknown'

const listeners = new Set()
export function onModeChange(fn) {
  listeners.add(fn)
  fn(MODE)
  return () => listeners.delete(fn)
}

function setMode(next) {
  if (MODE === next) return
  MODE = next
  listeners.forEach((fn) => fn(next))
}

/** 探测后端是否可用（应用启动时调用一次）。
 *
 * 注意：多租户改造后 /api/health 也需要登录，未登录会返回 401 ——
 * 这依然说明**后端是活的**，只是当前没有凭证。只有网络层失败
 * （超时 / 连接被拒）才算后端不可用，才降级到 local。
 */
export async function detectBackend() {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2500)
    const token = getToken()
    const res = await fetch(`${API_BASE}${API_PREFIX}/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (res.ok || res.status === 401) {
      setMode('backend')
      return true
    }
  } catch {
    /* 网络层失败，走本地 */
  }
  setMode('local')
  return false
}

const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms))

class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : `请求失败（${status}）`)
    this.status = status
    this.detail = detail
  }
}

/**
 * 统一请求：带超时、错误解析；后端不可用时自动降级到 local。
 * @returns {Promise<{ok:boolean, data:any|null, error:Error|null}>}
 */
async function http(method, path, body, extraHeaders) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const token = getToken()
    const res = await fetch(`${API_BASE}${API_PREFIX}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(extraHeaders || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(timer)

    if (res.status === 204) return { ok: true, data: null, error: null }

    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }

    if (!res.ok) {
      // 401：凭证失效 → 清理并通知上层回登录页（不降级成 local，避免假装已登录）
      if (res.status === 401) emitUnauthorized()
      const detail = data?.detail ?? `HTTP ${res.status}`
      return { ok: false, data: null, error: new ApiError(res.status, detail) }
    }
    if (MODE !== 'backend') setMode('backend')
    return { ok: true, data, error: null }
  } catch (err) {
    clearTimeout(timer)
    // 网络层失败 → 降级本地模式（保持演示不中断）
    setMode('local')
    return { ok: false, data: null, error: err }
  }
}

/**
 * 双链路包装：优先后端，失败（网络层）时用 fallback（localStorage 实现）。
 * 注意：业务错误（4xx）不降级，直接抛出，避免掩盖真实问题。
 */
async function withFallback(httpCall, localCall) {
  if (MODE === 'local') {
    return localCall()
  }
  const { ok, data, error } = await httpCall()
  if (ok) return data
  if (error && error.status) {
    // 业务错误：抛给调用方
    throw error
  }
  // 网络错误：降级
  return localCall()
}

export const api = {
  /* ---------------- 账户 ---------------- */

  /** 登录：成功后本地保存 token。401 时抛出业务错误（不降级）。 */
  async login(email, password) {
    const { ok, data, error } = await http('POST', '/auth/login', { email, password })
    if (!ok) throw error
    setToken(data.token)
    setMode('backend')
    return data
  },

  /** 注册：同时创建租户与 owner 账户。 */
  async register(payload) {
    const { ok, data, error } = await http('POST', '/auth/register', payload)
    if (!ok) throw error
    setToken(data.token)
    setMode('backend')
    return data
  },

  async me() {
    const { ok, data } = await http('GET', '/auth/me')
    return ok ? data.user : null
  },

  async logout() {
    clearToken()
  },

  /** 当前是否有本地凭证（不代表仍然有效，需 /auth/me 校验）。 */
  get hasToken() {
    return !!getToken()
  },

  /* ---------------- 付费权限（统一真源） ---------------- */

  /** 一次性拉取本租户的全量权限。所有付费判断统一读它的 features。 */
  async getEntitlements() {
    const { ok, data } = await http('GET', '/entitlements')
    return ok ? data : null
  },

  /** 套餐/能力开通申请（点击购买 → 真实落库）。 */
  async createServiceOrder(payload) {
    const { ok, data, error } = await http('POST', '/service-orders', payload)
    if (!ok) throw error
    return data
  },

  async listServiceOrders() {
    const { ok, data } = await http('GET', '/service-orders')
    return ok ? data.orders || [] : []
  },

  async approveServiceOrder(id) {
    const { ok, data, error } = await http('POST', `/service-orders/${encodeURIComponent(id)}/approve`)
    if (!ok) throw error
    return data
  },

  /* ---------------- 多站点（sites） ---------------- */

  /** 站点列表（本租户）。 */
  async getSites() {
    const { ok, data } = await http('GET', '/sites')
    return ok ? data.sites || [] : []
  },

  async createSite(payload) {
    const { ok, data, error } = await http('POST', '/sites', payload)
    if (!ok) throw error
    return data.site
  },

  async getSiteDetail(id) {
    const { ok, data } = await http('GET', `/sites/${encodeURIComponent(id)}`)
    return ok ? data.site : null
  },

  async updateSite(id, patch) {
    const { ok, data, error } = await http('PATCH', `/sites/${encodeURIComponent(id)}`, patch)
    if (!ok) throw error
    return data.site
  },

  async deleteSite(id) {
    const { ok, error } = await http('DELETE', `/sites/${encodeURIComponent(id)}`)
    if (!ok) throw error
    return true
  },

  /** 站点关联的产品（产品事实仍是租户级）。 */
  async getSiteProducts(id) {
    const { ok, data } = await http('GET', `/sites/${encodeURIComponent(id)}/products`)
    return ok ? data.products || [] : []
  },

  async linkSiteProduct(siteId, productId) {
    const { ok, error } = await http('POST', `/sites/${encodeURIComponent(siteId)}/products`, { product_id: productId })
    if (!ok) throw error
    return true
  },

  async unlinkSiteProduct(siteId, productId) {
    const { ok, error } = await http('DELETE', `/sites/${encodeURIComponent(siteId)}/products/${encodeURIComponent(productId)}`)
    if (!ok) throw error
    return true
  },

  /* ---------------- 独立站前台（匿名只读） ---------------- */

  /** 按租户 slug 读取已发布站点（无需登录；失败返回 null 由调用方兜底）。 */
  async getPublicSite(tenantSlug) {
    const { ok, data } = await http('GET', `/public/site?tenant=${encodeURIComponent(tenantSlug)}`)
    return ok ? data : null
  },

  /* ---------------- MCP 工具清单（服务端真源） ---------------- */

  async getMcpTools() {
    const { ok, data } = await http('GET', '/mcp/tools')
    return ok ? data.tools || [] : []
  },

  /* ---------------- 系统 ---------------- */

  async health() {
    const { ok, data } = await http('GET', '/health')
    return ok ? data : null
  },

  /** 当前运行模式：backend | local */
  get mode() {
    return MODE
  },

  /* ---------------- company / metrics ---------------- */

  getCompany() {
    return withFallback(
      () => http('GET', '/company'),
      async () => {
        await delay()
        return { ...mockCompany, ...loadDb().site }
      }
    )
  },

  verifyCompany(payload) {
    return withFallback(
      () => http('POST', '/company/verify', payload),
      async () => {
        await delay(500)
        saveDb({ site: { ...loadDb().site, verified: true } })
        return { ok: true, verified: true, ...payload }
      }
    )
  },

  getMetrics() {
    return withFallback(
      () => http('GET', '/metrics'),
      async () => {
        await delay()
        return mockMetrics
      }
    ).catch(() => mockMetrics)
  },

  getHealth() {
    return withFallback(
      () => http('GET', '/health/site'),
      async () => {
        await delay()
        return mockHealth
      }
    ).catch(() => mockHealth)
  },

  /* ---------------- products ---------------- */

  getProducts() {
    return withFallback(
      () => http('GET', '/products'),
      async () => {
        await delay()
        return dbProducts()
      }
    )
  },

  getProductDetail(id) {
    return withFallback(
      () => http('GET', `/products/${id}`),
      async () => {
        await delay()
        return dbProducts().find((p) => p.id === id)
      }
    )
  },

  async createProduct(payload) {
    return withFallback(
      () => http('POST', '/products', payload),
      async () => {
        await delay(300)
        const product = normalizeProduct({
          id: uid('prod'),
          images: [],
          seo_score: 60,
          geo_score: 42,
          inquiries: 0,
          updated_at: '刚刚',
          localized_content: { 'zh-CN': {}, 'en-US': {}, 'ru-RU': {} },
          ...payload,
        })
        persistProducts([product, ...dbProducts()])
        return { ok: true, product }
      }
    ).then((res) => res?.product || res)
  },

  async updateProduct(id, patch) {
    return withFallback(
      () => http('PUT', `/products/${id}`, patch),
      async () => {
        await delay(300)
        persistProducts(dbProducts().map((p) => (p.id === id ? { ...p, ...patch, updated_at: '刚刚' } : p)))
        return { ok: true, id, patch }
      }
    )
  },

  async deleteProduct(id) {
    return withFallback(
      () => http('DELETE', `/products/${id}`),
      async () => {
        await delay(240)
        persistProducts(dbProducts().filter((p) => p.id !== id))
        return { ok: true, id }
      }
    )
  },

  /* ---------------- inquiries ---------------- */

  getInquiries(siteId) {
    const qs = siteId ? `?site_id=${encodeURIComponent(siteId)}` : ''
    return withFallback(
      () => http('GET', `/inquiries${qs}`),
      async () => {
        await delay()
        return { inquiries: loadDb().inquiries, stats: inquiryStats }
      }
    )
  },

  async updateInquiryStatus(id, status) {
    return withFallback(
      () => http('PUT', `/inquiries/${id}`, { status }),
      async () => {
        await delay(200)
        saveDb({ inquiries: loadDb().inquiries.map((i) => (i.id === id ? { ...i, status } : i)) })
        return { ok: true, id, status }
      }
    )
  },

  /** 独立站 RFQ 表单提交。
   *
   * 前台访客没有账号，是唯一允许匿名写入的端点 —— 租户由站点绑定的
   * tenantId（写入 siteContent / URL 参数）通过 X-Tenant-Id 头声明；
   * 缺省由后端落到默认租户。若当前浏览器已登录，后端会优先用登录租户。
   */
  /** 提交 RFQ。tenantRef 可为租户 slug（独立站前台，走 X-Tenant-Slug）。 */
  async createInquiry(payload, tenantRef) {
    return withFallback(
      () => http('POST', '/inquiries', payload, tenantRef ? { 'X-Tenant-Slug': String(tenantRef) } : undefined),
      async () => {
        await delay(420)
        const products = dbProducts()
        const matched = products.find(
          (p) => payload.message && payload.message.toLowerCase().includes(p.name.split(' ')[0].toLowerCase())
        )
        const inquiry = {
          id: uid('rfq'),
          customer_name: payload.name,
          email: payload.email,
          company: payload.company || '—',
          country: payload.country || '—',
          product_id: matched?.id || 'prod_001',
          product_name: matched?.name || 'General RFQ',
          source_page: '/site-preview.html#rfq',
          source_channel: 'Website RFQ',
          created_at: new Date().toISOString(),
          status: 'new',
          intent: /quote|price|urgent|project/i.test(payload.message || '') ? 'hot' : 'warm',
          message: payload.message,
        }
        saveDb({ inquiries: [inquiry, ...loadDb().inquiries] })
        return { ok: true, inquiry }
      }
    )
  },

  /* ---------------- site state / usage ---------------- */

  getSiteState() {
    return withFallback(
      () => http('GET', '/site/state'),
      async () => {
        await delay(80)
        return loadDb().site
      }
    )
  },

  async updateSiteState(patch) {
    return withFallback(
      () => http('PUT', '/site/state', patch),
      async () => {
        saveDb({ site: { ...loadDb().site, ...patch } })
        return { ok: true, site: loadDb().site }
      }
    )
  },

  /* ---------------- 市场本地化版本 ---------------- */
  getLocalization() {
    return withFallback(
      () => http('GET', '/localization'),
      async () => {
        await delay(90)
        return localLocalization()
      }
    )
  },

  /** 生成市场版本；免费额度用尽时为新增市场返回 402（业务错误，不降级） */
  async generateMarket(market) {
    return withFallback(
      () => http('POST', '/localization/generate', { market }),
      async () => {
        await delay(360)
        const state = localLocalization()
        if (state.markets.includes(market)) {
          return { ok: true, already: true, market, ...state }
        }
        if (state.requiresPayment) {
          const err = new Error('免费市场版本额度已用完，升级套餐后可解锁全部语言市场版本')
          err.status = 402
          throw err
        }
        const next = [...state.markets, market]
        saveDb({ site: { ...loadDb().site, targetMarkets: next } })
        return { ok: true, already: false, market, ...localLocalization() }
      }
    )
  },

  getUsage() {
    return withFallback(
      () => http('GET', '/usage'),
      async () => {
        await delay(60)
        return loadDb().usage
      }
    )
  },

  async consumeFreeGeneration() {
    return withFallback(
      () => http('POST', '/usage/consume'),
      async () => {
        const db = loadDb()
        const usage = { ...db.usage, freeGenerationUsed: db.usage.freeGenerationUsed + 1 }
        saveDb({ usage })
        return usage
      }
    )
  },

  async generateSiteInput(input) {
    return withFallback(
      () => http('POST', '/site/generate', input),
      async () => {
        await delay(500)
        const db = loadDb()
        saveDb({
          site: {
            ...db.site,
            companyName: input.company || db.site.companyName,
            industry: input.industry || db.site.industry,
            targetMarkets: input.markets || db.site.targetMarkets,
          },
        })
        return { ok: true, ...input }
      }
    )
  },

  /* ---------------- SEO / GEO ---------------- */

  getSeoDiff(productId) {
    return withFallback(
      () => http('GET', `/seo/diff/${productId}`),
      async () => {
        await delay()
        return buildLocalSeoDiff(productId)
      }
    )
  },

  /** 生成优化草稿（不直接改线上，等待人工确认发布） */
  async optimizeProduct(productId) {
    const res = await withFallback(
      () => http('POST', '/seo/optimize', { productId }),
      async () => {
        await delay(600)
        const diff = buildLocalSeoDiff(productId)
        const draft = {
          id: uid('draft'),
          title: `SEO/GEO 优化草稿 · ${diff.productName}`,
          entity_type: 'product',
          entity_id: productId,
          diff: diff.fields.map((f) => ({ field: f.label, before: f.before, after: f.after })),
          seoScoreBefore: diff.scoreBefore,
          seoScoreAfter: diff.scoreAfter,
          geoScoreBefore: diff.geoBefore,
          geoScoreAfter: diff.geoAfter,
          createdAt: new Date().toISOString(),
          confirmed: false,
          status: 'draft',
        }
        saveDb({ drafts: [draft, ...loadDb().drafts] })
        return { ok: true, draft, diff }
      }
    )
    // 后端返回 { ok, draft, diff }
    return { draft: res.draft, diff: res.diff }
  },

  /* ---------------- 市场模板 / Skill ---------------- */

  async getMarketTemplate(market) {
    await delay(120)
    return marketTemplates[market]
  },

  async getSkills() {
    await delay()
    return skills
  },

  /* ---------------- Agent ---------------- */

  /** Agent 指令：自然语言字符串或结构化 patch */
  async agentRun(payload) {
    const body = typeof payload === 'object' && payload !== null ? payload : { command: String(payload) }
    // 结构化 form（前端传 {entity_type, entity_id, patch, market}）需要包成后端 AgentRunRequest
    const normalized =
      body.entity_type && body.patch
        ? { entity_type: body.entity_type, entity_id: body.entity_id, market: body.market, patch: body.patch }
        : { command: typeof payload === 'string' ? payload : payload.command || '' }

    return withFallback(
      () => http('POST', '/agent/run', normalized),
      async () => {
        await delay(650)
        return buildLocalAgentResult(payload)
      }
    )
  },

  /**
   * 人工确认后发布。human_confirmed 必须为 true（后端强制校验，否则 403）。
   * 发布动作：草稿置为已确认 + diff 应用到产品（分数变化）+ 站点置为已发布。
   */
  async publishDraft(draftId, humanConfirmed = true) {
    return withFallback(
      () => http('POST', '/publish', { draft_id: draftId, human_confirmed: humanConfirmed }),
      async () => {
        await delay(400)
        if (!humanConfirmed) return { ok: false, published: false, draft_id: draftId }
        const db = loadDb()
        const draft = db.drafts.find((d) => d.id === draftId)
        const drafts = db.drafts.map((d) =>
          d.id === draftId ? { ...d, confirmed: true, status: 'published' } : d
        )
        let products = db.products
        if (draft && draft.entity_type === 'product' && draft.seoScoreAfter != null) {
          products = db.products.map((p) =>
            p.id === draft.entity_id
              ? { ...p, seo_score: draft.seoScoreAfter, geo_score: draft.geoScoreAfter ?? p.geo_score, updated_at: '刚刚' }
              : p
          )
        }
        saveDb({
          drafts,
          products,
          site: { ...db.site, publishStatus: 'published', publishCount: (db.site.publishCount || 0) + 1 },
        })
        return { ok: true, published: true, draft_id: draftId }
      }
    )
  },

  getDrafts() {
    return withFallback(
      () => http('GET', '/drafts'),
      async () => loadDb().drafts
    )
  },

  /**
   * 创建内容修改草稿（MCP update_draft 落点）。
   * patch 为结构化写回数据；后端生成 diff 供人工审阅。
   * 本地降级：直接保存草稿（diff 由 patch 与当前值对比生成）。
   */
  async createDraft({ entity_type, entity_id, patch, title }) {
    return withFallback(
      () => http('POST', '/drafts', { entity_type, entity_id, patch, title }),
      async () => {
        await delay(260)
        const brief = (v) => (Array.isArray(v) ? `${v.length} 条` : typeof v === 'object' && v ? `${Object.keys(v).length} 项配置` : v)
        const draft = {
          id: uid('draft'),
          title: title || `内容修改草稿 · ${entity_id}`,
          entity_type,
          entity_id,
          diff: Object.entries(patch || {})
            .filter(([, v]) => !Object.is(v, NaN))
            .map(([k, v]) => ({ field: k, after: brief(v) })),
          patch: patch || {},
          market: '',
          status: 'draft',
          confirmed: false,
        }
        saveDb({ drafts: [draft, ...(loadDb().drafts || [])] })
        return { ok: true, draft }
      }
    )
  },

  /** 版本历史（发布/回滚记录）。本地降级返回空（真回滚需后端）。 */
  listVersions(entityType, entityId) {
    return withFallback(
      () => http('GET', `/versions?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`),
      async () => loadDb().versions || []
    )
  },

  /** 全租户版本流（版本历史列表页用）；带 siteId 时只看该站点。 */
  listRecentVersions(limit = 50, siteId) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (siteId) params.set('site_id', siteId)
    return withFallback(
      () => http('GET', `/versions/recent?${params.toString()}`),
      async () => loadDb().versions || []
    )
  },

  /** 版本详情：含 before/after 快照，供对比视图。 */
  getVersion(versionId) {
    return withFallback(
      () => http('GET', `/versions/${encodeURIComponent(versionId)}`),
      async () => loadDb().versions?.find((v) => v.id === versionId) || null
    )
  },

  /** 真回滚：恢复指定版本的 before 快照。本地模式明确报错，不假装成功。 */
  async rollbackVersion({ entity_type, entity_id, version_id }) {
    return withFallback(
      () => http('POST', '/versions/rollback', { entity_type, entity_id, version_id }),
      async () => {
        throw Object.assign(new Error('回滚需要后端支持（本地模式不提供版本快照）'), { status: 501 })
      }
    )
  },

  /* ---------------- 页面编辑器（pages） ---------------- */

  getPages(siteId) {
    const qs = siteId ? `?site_id=${encodeURIComponent(siteId)}` : ''
    return withFallback(
      () => http('GET', `/pages${qs}`),
      async () => {
        await delay()
        return dbPages()
      }
    )
  },

  async updatePage(id, patch) {
    return withFallback(
      () => http('PUT', `/pages/${id}`, patch),
      async () => {
        await delay(200)
        persistPages(
          dbPages().map((p) => {
            if (p.id !== id) return p
            const next = { ...p, ...patch, updated_at: '刚刚' }
            // 与后端同一套合并语义：sections 按 id 合并，未提交的区块不丢
            if (patch.sections) next.sections = mergeSections(p.sections || [], patch.sections)
            return next
          })
        )
        return { ok: true, page: dbPages().find((p) => p.id === id) }
      }
    )
  },

  async createPage(payload, siteId) {
    const qs = siteId ? `?site_id=${encodeURIComponent(siteId)}` : ''
    return withFallback(
      () => http('POST', `/pages${qs}`, payload),
      async () => {
        await delay(250)
        const page = { id: uid('page'), site_id: siteId || '', sections: [], is_home: false, order_index: dbPages().length, updated_at: '刚刚', ...payload }
        persistPages([...dbPages(), page])
        return { ok: true, page }
      }
    ).then((res) => res?.page || res)
  },

  async deletePage(id) {
    return withFallback(
      () => http('DELETE', `/pages/${id}`),
      async () => {
        await delay(200)
        persistPages(dbPages().filter((p) => p.id !== id))
        return { ok: true, id }
      }
    )
  },

  /** 页面区块文案 AI 改写（返回建议值，前端确认后保存） */
  async rewritePageCopy(pageId, payload) {
    return withFallback(
      () => http('POST', `/pages/${pageId}/ai-rewrite`, payload),
      async () => {
        await delay(700)
        const market = payload.market || 'en-US'
        const tpl = {
          'ru-RU': 'Стабильный поток. Предсказуемая работа.',
          'zh-CN': '稳定流量，可靠运行',
          'en-US': 'Engineered Flow. Predictable Operations.',
        }
        return { ok: true, section_id: payload.section_id, field: payload.field, before: '', after: tpl[market] || tpl['en-US'], ai_source: 'template' }
      }
    )
  },

  /* ---------------- 任务（跟进 / 增长） ---------------- */

  getTasks(params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
    return withFallback(
      () => http('GET', `/tasks${qs ? `?${qs}` : ''}`),
      async () => {
        await delay(180)
        return loadDb().tasks || []
      }
    )
  },

  /**
   * 任务进度汇总（kind 可选：followup | growth）。
   * 统计在后端做，前端不再自己算 —— 避免「只有当前页加载到的任务」被当全集。
   */
  getTaskStats(kind) {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : ''
    return withFallback(
      () => http('GET', `/tasks/stats/summary${qs}`),
      async () => {
        await delay(160)
        const all = loadDb().tasks || []
        const list = kind ? all.filter((t) => t.kind === kind) : all
        const done = list.filter((t) => t.status === 'done').length
        const doing = list.filter((t) => t.status === 'doing').length
        return {
          kind: kind || 'all',
          total: list.length,
          done,
          doing,
          todo: Math.max(list.length - done - doing, 0),
          percent: list.length ? Math.round((done / list.length) * 100) : 0,
        }
      }
    )
  },

  async createTask(payload) {
    return withFallback(
      () => http('POST', '/tasks', payload),
      async () => {
        await delay(260)
        const task = { id: uid('task'), status: 'todo', progress: 0, steps: [], owner: '我', updated_at: '刚刚', ...payload }
        saveDb({ tasks: [task, ...(loadDb().tasks || [])] })
        return { ok: true, task }
      }
    ).then((res) => res?.task || res)
  },

  async updateTask(id, patch) {
    return withFallback(
      () => http('PUT', `/tasks/${id}`, patch),
      async () => {
        await delay(160)
        const tasks = (loadDb().tasks || []).map((t) => (t.id === id ? { ...t, ...patch } : t))
        saveDb({ tasks })
        return { ok: true, task: tasks.find((t) => t.id === id) }
      }
    )
  },

  /** 推进任务：勾选下一个子步骤 / 循环状态 */
  async advanceTask(id) {
    return withFallback(
      () => http('POST', `/tasks/${id}/advance`),
      async () => {
        await delay(280)
        const tasks = (loadDb().tasks || []).map((t) => {
          if (t.id !== id) return t
          const steps = [...(t.steps || [])]
          if (steps.length) {
            let done = false
            for (const s of steps) if (!s.done) { s.done = true; done = true; break }
            if (!done) steps.forEach((s) => { s.done = false })
            const cnt = steps.filter((s) => s.done).length
            const progress = Math.round((cnt / steps.length) * 100)
            return { ...t, steps, progress, status: cnt === steps.length ? 'done' : cnt > 0 ? 'doing' : 'todo' }
          }
          const nxt = { todo: 'doing', doing: 'done', done: 'todo' }
          const status = nxt[t.status] || 'doing'
          return { ...t, status, progress: { todo: 0, doing: 50, done: 100 }[status] }
        })
        saveDb({ tasks })
        return { ok: true, task: tasks.find((t) => t.id === id) }
      }
    )
  },

  async deleteTask(id) {
    return withFallback(
      () => http('DELETE', `/tasks/${id}`),
      async () => {
        await delay(160)
        saveDb({ tasks: (loadDb().tasks || []).filter((t) => t.id !== id) })
        return { ok: true, id }
      }
    )
  },

  /* ---------------- 额度（Skill 用量） ---------------- */

  getCredits() {
    return withFallback(
      () => http('GET', '/credits'),
      async () => {
        await delay(120)
        return loadDb().credits || { balance: 1860, totalGranted: 1860, used: 0 }
      }
    )
  },

  getCreditLogs(limit = 20) {
    return withFallback(
      () => http('GET', `/credits/logs?limit=${limit}`),
      async () => {
        await delay(120)
        return loadDb().creditLogs || []
      }
    )
  },

  /** 消耗额度（使用 Skill）；余额不足后端返回 402 */
  async consumeCredits(payload) {
    return withFallback(
      () => http('POST', '/credits/consume', payload),
      async () => {
        await delay(240)
        const db = loadDb()
        const credits = db.credits || { balance: 1860, totalGranted: 1860 }
        if (credits.balance < (payload.cost || 0)) {
          const err = new Error('Credits 余额不足，请充值或升级套餐')
          err.status = 402
          throw err
        }
        const next = { ...credits, balance: credits.balance - (payload.cost || 0), used: (credits.used || 0) + (payload.cost || 0) }
        const log = {
          id: uid('cl'),
          skill: payload.skill,
          cost: payload.cost,
          balance_after: next.balance,
          note: payload.note || '',
          created_at: new Date().toISOString(),
          time: '刚刚',
        }
        saveDb({ credits: next, creditLogs: [log, ...(db.creditLogs || [])] })
        return { ok: true, credits: next, log }
      }
    )
  },

  /** 充值额度 */
  async grantCredits(amount, note = '套餐充值') {
    return withFallback(
      () => http('POST', '/credits/grant', { amount, note }),
      async () => {
        await delay(240)
        const db = loadDb()
        const credits = db.credits || { balance: 1860, totalGranted: 1860 }
        const next = { ...credits, balance: credits.balance + amount, totalGranted: (credits.totalGranted || 0) + amount }
        const log = { id: uid('cl'), skill: note, cost: -amount, balance_after: next.balance, note, created_at: new Date().toISOString(), time: '刚刚' }
        saveDb({ credits: next, creditLogs: [log, ...(db.creditLogs || [])] })
        return { ok: true, credits: next, log }
      }
    )
  },

  /* ---------------- 批量导入产品 ---------------- */

  async bulkImportProducts(items) {
    return withFallback(
      () => http('POST', '/products/bulk-import', { items }),
      async () => {
        const created = []
        const failed = []
        for (let i = 0; i < items.length; i++) {
          const it = items[i]
          try {
            await delay(160)
            const product = normalizeProduct({
              id: uid('prod'),
              name: it.name,
              model: it.model || '',
              category: it.category || 'General',
              specs: (it.specs || []).map((s) => {
                const [k, v] = String(s).split(':')
                return { key: (k || '').trim(), value: (v || '').trim() }
              }),
              benefits: [],
              applications: it.applications || [],
              images: [],
              seo: {},
              seo_score: 60,
              geo_score: 42,
              localized_content: {},
              inquiries: 0,
              updated_at: '刚刚',
            })
            persistProducts([product, ...dbProducts()])
            created.push({ index: i + 1, name: it.name, id: product.id })
          } catch (e) {
            failed.push({ index: i + 1, name: it.name, error: e.message })
          }
        }
        return { ok: true, created, failed, created_count: created.length, failed_count: failed.length }
      }
    )
  },

  /**
   * 解析 .xlsx（base64）→ 待导入产品清单。
   * 后端用 openpyxl 解析，前端不引 sheetjs，避免约 400KB 的包体积。
   * @returns {Promise<{items, errors, skippedHeader, sheet, count}>}
   */
  async parseXlsx({ filename = '', contentBase64, commit = false, items = null }) {
    return withFallback(
      () => http('POST', '/products/parse-xlsx', {
        filename,
        content_base64: contentBase64,
        commit,
        items,
      }),
      async () => {
        // 后端不可用：无法在浏览器内解析 xlsx（刻意不引 sheetjs），明确告知
        const err = new Error('Excel 导入需要后端支持，当前处于本地模式。请改用 CSV 或粘贴方式。')
        err.status = 400
        throw err
      }
    )
  },
}

/* ================= 指令要求的命名空间别名 ================= */
api.products = {
  list: () => api.getProducts(),
  create: (data) => api.createProduct(data),
  update: (id, data) => api.updateProduct(id, data),
  delete: (id) => api.deleteProduct(id),
}
api.inquiries = {
  list: () => api.getInquiries(),
  updateStatus: (id, status) => api.updateInquiryStatus(id, status),
  create: (data) => api.createInquiry(data),
}
api.site = {
  generate: (input) => api.generateSiteInput(input),
  publish: (draftId) => api.publishDraft(draftId, true),
  getState: () => api.getSiteState(),
  updateState: (patch) => api.updateSiteState(patch),
}
api.seo = { optimizeProduct: (productId) => api.optimizeProduct(productId) }
api.agent = { run: (command) => api.agentRun(command) }
api.pages = {
  list: () => api.getPages(),
  create: (data) => api.createPage(data),
  update: (id, data) => api.updatePage(id, data),
  delete: (id) => api.deletePage(id),
  aiRewrite: (id, payload) => api.rewritePageCopy(id, payload),
}
api.tasks = {
  list: (params) => api.getTasks(params),
  stats: (kind) => api.getTaskStats(kind),
  create: (data) => api.createTask(data),
  update: (id, data) => api.updateTask(id, data),
  advance: (id) => api.advanceTask(id),
  delete: (id) => api.deleteTask(id),
}
api.credits = {
  get: () => api.getCredits(),
  logs: (limit) => api.getCreditLogs(limit),
  consume: (payload) => api.consumeCredits(payload),
  grant: (amount, note) => api.grantCredits(amount, note),
}
api.localization = {
  get: () => api.getLocalization(),
  generate: (market) => api.generateMarket(market),
}

/* ================= 批量导入文本解析（CSV / TSV） =================
 * 供 Products 页面「批量导入」使用，纯函数、无副作用，便于单测。
 * 约定列顺序：名称, 型号, 分类, 参数, 应用场景（后四列可留空）
 * 支持：逗号 / 制表符 / 中文逗号分隔；双引号包裹含分隔符的字段；跳过表头行；忽略空行与 # 注释行。
 */

/** 把一行按分隔符切分，正确处理双引号包裹的字段与转义引号 ""。 */
export function splitCsvLine(line, delimiter) {
  const out = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuote = false }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuote = true
    } else if (ch === delimiter) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/** 自动识别分隔符：制表符优先，其次英文逗号，最后中文逗号。 */
export function detectDelimiter(sampleLine) {
  if (sampleLine.includes('\t')) return '\t'
  if (sampleLine.includes(',')) return ','
  if (sampleLine.includes('，')) return '，'
  return ','
}

/** 名称/型号/分类这些"看起来像表头"的列名，用于自动跳过表头行。 */
const HEADER_HINTS = ['名称', '名字', '产品', 'name', 'title', 'model', '型号', 'category', '分类']

/**
 * 解析批量导入文本 → 结构化产品数组。
 * @returns {{items: Array<{name:string,model:string,category:string,specs:string[],applications:string[]}>, errors: string[], skippedHeader: boolean}}
 */
export function parseBulkText(text) {
  const errors = []
  const items = []
  const rawLines = String(text || '').split(/\r?\n/)
  const lines = rawLines.filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.trim())
  if (!lines.length) return { items, errors: ['内容为空，请粘贴产品清单'], skippedHeader: false }

  const delimiter = detectDelimiter(lines[0])
  let start = 0
  let skippedHeader = false
  const first = splitCsvLine(lines[0], delimiter)
  const firstCell = (first[0] || '').toLowerCase()
  if (first.length > 1 && HEADER_HINTS.includes(firstCell)) {
    start = 1
    skippedHeader = true
  }

  lines.slice(start).forEach((line, i) => {
    const rowNo = i + start + 1
    const cols = splitCsvLine(line, delimiter)
    const name = (cols[0] || '').trim()
    if (!name) {
      errors.push(`第 ${rowNo} 行：名称为空，已跳过`)
      return
    }
    const specsRaw = (cols[3] || '').trim()
    const appsRaw = (cols[4] || '').trim()
    items.push({
      name,
      model: (cols[1] || '').trim(),
      category: (cols[2] || '').trim(),
      // 参数与应用场景支持用 ; / ｜ 分隔多个条目
      specs: specsRaw ? specsRaw.split(/[;；|｜]/).map((s) => s.trim()).filter(Boolean) : [],
      applications: appsRaw ? appsRaw.split(/[;；|｜]/).map((s) => s.trim()).filter(Boolean) : [],
    })
  })

  if (!items.length) errors.push('未解析出任何有效产品行')
  if (items.length > 200) {
    errors.push(`共 ${items.length} 行，超出单次 200 条上限，仅导入前 200 条`)
    items.length = 200
  }
  return { items, errors, skippedHeader }
}

/** 生成一份可直接粘贴到导入框的示例文本。 */
export function bulkSampleText() {
  return [
    '名称,型号,分类,参数,应用场景',
    '便携式储能电源,AF-PS600,储能,容量: 600Wh; 输出: 600W; 电芯: 磷酸铁锂,露营; 应急备电; 户外作业',
    '太阳能折叠板,AF-SP120,光伏,功率: 120W; 转换率: 23%; 折叠尺寸: 420x300mm,户外充电; 房车供电',
    '户外防水插座盒,AF-OB16,配件,防护等级: IP66; 额定电流: 16A; 材质: ABS,工地; 庭院; 码头',
  ].join('\n')
}

/* ================= ================= ================= */
/* 本地降级实现（后端不可用时使用）                      */
/* ================= ================= ================= */

function normalizeProduct(p) {
  if (p.geo_score == null) p.geo_score = Math.max(30, p.seo_score - 18)
  return p
}

/* ---------------- 市场本地化（本地降级） ----------------
 * 与后端保持同一套规则：除默认 en-US 外免费多生成 1 个市场版本。
 */
const LOCAL_MARKETS = ['en-US', 'ru-RU', 'zh-CN']
const FREE_EXTRA_MARKETS = 1

function localLocalization() {
  const site = loadDb().site || {}
  let markets = Array.isArray(site.targetMarkets) ? site.targetMarkets.slice() : []
  if (!markets.includes('en-US')) markets.unshift('en-US')
  markets = LOCAL_MARKETS.filter((m) => markets.includes(m))

  const extraUsed = Math.max(0, markets.length - 1)
  const freeExtraLeft = Math.max(0, FREE_EXTRA_MARKETS - extraUsed)
  return {
    markets,
    available: LOCAL_MARKETS.slice(),
    defaultMarket: 'en-US',
    freeExtraLimit: FREE_EXTRA_MARKETS,
    freeExtraLeft,
    requiresPayment: freeExtraLeft <= 0,
  }
}

function dbProducts() {
  return loadDb().products.map(normalizeProduct)
}

function persistProducts(products) {
  saveDb({ products })
}

/* ---- 页面（本地降级） ---- */

const DEFAULT_SECTIONS = [
  { id: 'sec_hero', type: 'hero', label: 'Hero 首屏', props: { eyebrow: 'INDUSTRIAL WATER SOLUTIONS', title: 'Smarter Flow. Stronger Operations.', description: 'Reliable treatment systems engineered for global industrial projects.', cta: 'Explore Products' } },
  { id: 'sec_trust', type: 'trust', label: '信任背书', props: { items: ['ISO 9001', 'CE CERTIFIED', 'OEM / ODM', '24H RESPONSE'] } },
  { id: 'sec_products', type: 'products', label: '核心产品', props: { eyebrow: 'CORE PRODUCTS', title: 'Engineered for Reliable Performance' } },
  { id: 'sec_applications', type: 'applications', label: '应用场景', props: { eyebrow: 'APPLICATIONS', title: 'Built for Demanding Environments' } },
  { id: 'sec_capability', type: 'capability', label: '企业能力', props: { eyebrow: 'CAPABILITY', title: 'From Design to Commissioning' } },
  { id: 'sec_cases', type: 'cases', label: '项目案例', props: { eyebrow: 'CASE STUDIES', title: 'Delivered Worldwide' } },
  { id: 'sec_cta', type: 'cta', label: '询盘 CTA', props: { title: 'Get a Quote in 24 Hours', cta: 'Send Inquiry' } },
]

function defaultPages() {
  return [
    ['首页', '/', true],
    ['产品中心', '/products', false],
    ['解决方案', '/solutions', false],
    ['案例', '/cases', false],
    ['关于我们', '/about', false],
    ['联系我们', '/contact', false],
  ].map(([name, slug, is_home], i) => ({
    id: `page_${i + 1}`,
    name,
    slug,
    sections: is_home ? DEFAULT_SECTIONS : DEFAULT_SECTIONS.slice(0, 3),
    is_home,
    order_index: i,
    seo_title: `${name} | AQUAFLOW`,
    seo_description: '',
    updated_at: '刚刚',
  }))
}

function dbPages() {
  const db = loadDb()
  if (!db.pages || !db.pages.length) {
    saveDb({ pages: defaultPages() })
    return defaultPages()
  }
  return db.pages
}

function persistPages(pages) {
  saveDb({ pages })
}

/**
 * 按 id 合并区块（与后端 _merge_sections 同一语义）。
 * 提交顺序为准；同 id 用新值并深合并 props；未提交的旧区块追加在末尾。
 * 目的：只改一个区块时，不会把其余区块删掉。
 */
export function mergeSections(existing, incoming) {
  const list = Array.isArray(existing) ? existing : []
  const next = Array.isArray(incoming) ? incoming : []
  const byId = new Map(list.filter((s) => s && s.id).map((s) => [s.id, s]))
  const merged = []
  const seen = new Set()
  for (const s of next) {
    if (!s) continue
    const old = s.id && byId.get(s.id)
    if (old) merged.push({ ...old, ...s, props: { ...(old.props || {}), ...(s.props || {}) } })
    else merged.push(s)
    if (s.id) seen.add(s.id)
  }
  for (const s of list) {
    if (s && !seen.has(s.id)) merged.push(s)
  }
  return merged
}

/**
 * 前台站点预览的只读数据源。
 *
 * 优先读后端（与商家后台同一份数据，保证「编辑器里调好的 = 访客看到的」）；
 * 后端不可用时退回本地 localStorage；两者都没有则返回空，前台沿用内置内容兜底。
 *
 * 注意：这里必须自己探一次后端。site-main 是不经过 AppContext 的独立入口，
 * 没有人替它调用 detectBackend，否则 MODE 会一直是 unknown，
 * getPages() 就会静默走本地降级 —— 于是「用后端存、用本地读」永远对不上。
 */
export async function getSitePreviewData() {
  // 1) 优先走「按租户渲染」的公开只读接口：URL 带 ?tenant=<slug> 时，
  //    匿名访客也能拿到该企业自己的站点内容（每家企业一套独立站）。
  const tenantSlug = readTenantSlug()
  if (tenantSlug) {
    try {
      if (MODE === 'unknown') await detectBackend()
    } catch {
      /* 忽略 */
    }
    try {
      const site = await api.getPublicSite(tenantSlug)
      if (site) {
        const page = site.home || null
        return {
          page,
          products: site.products || [],
          tenant: site.tenant || null,
          brand: site.brand || null,
          markets: site.markets || null,
          source: 'backend',
        }
      }
    } catch {
      /* 落到下方兜底 */
    }
  }

  // 2) 无租户参数时（商家后台自带登录态），退回已登录链路
  try {
    if (MODE === 'unknown') await detectBackend()
  } catch {
    /* 忽略，走下方降级 */
  }

  try {
    const pages = await api.getPages()
    const page = (pages || []).find((p) => p.is_home) || (pages || [])[0] || null
    let products = []
    try {
      products = await api.getProducts()
    } catch {
      products = []
    }
    // 后端已连通却拿不到产品 → 就是真的没有，绝不偷偷用 mock 冒充
    if (!products?.length && MODE !== 'backend') {
      products = readLocalProducts()
    }
    return { page, products, source: MODE }
  } catch {
    // 后端不可用（离线演示）：才允许读本地兜底
    return { page: null, products: readLocalProducts(), source: 'fallback' }
  }
}

/** 从 URL 读取租户标识（独立站前台按租户渲染的唯一入口）。 */
function readTenantSlug() {
  try {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('tenant') || ''
  } catch {
    return ''
  }
}

/** 只读本地库里的产品（仅离线演示兜底，绝不用于 backend 模式冒充真数据） */
function readLocalProducts() {
  try {
    const db = loadDb()
    return db.products && db.products.length ? db.products : []
  } catch {
    return []
  }
}

function buildLocalSeoDiff(productId) {
  const p = dbProducts().find((x) => x.id === productId)
  if (!p) {
    // 本地兜底也不再读 mock：直接给出结构完整的空壳 diff，字段照常可渲染
    return {
      productId,
      productName: 'Unknown',
      scoreBefore: 60,
      scoreAfter: 85,
      geoBefore: 40,
      geoAfter: 70,
      fields: [],
    }
  }
  const before = p.seo || {}
  const name = p.name || 'Product'
  const model = p.model || ''
  const scoreBefore = p.seo_score
  const geoBefore = p.geo_score ?? Math.max(30, scoreBefore - 18)
  return {
    productId,
    productName: name,
    scoreBefore,
    scoreAfter: Math.min(97, scoreBefore + 25),
    geoBefore,
    geoAfter: Math.min(95, geoBefore + 30),
    fields: [
      { key: 'title', label: '页面标题', impact: 'high', before: before.title || name, after: `${name} Manufacturer & Supplier | AQUAFLOW ${model}` },
      { key: 'slug', label: 'URL / 搜索路由', impact: 'high', before: before.slug || `/product?id=${p.id}`, after: `/${name.toLowerCase().replace(/\s+/g, '-')}/` },
      { key: 'meta_description', label: 'Meta Description', impact: 'mid', before: before.meta_description || '（无）', after: `Industrial ${name.toLowerCase()} for global B2B projects. ${model}. OEM/ODM, global delivery.` },
      { key: 'h1', label: 'H1 主标题', impact: 'mid', before: before.h1 || name, after: name },
      { key: 'attributes', label: '产品属性', impact: 'mid', before: `${(p.specs || []).length} 个基础属性`, after: `${(p.specs || []).length + 12} 个采购属性 · Capacity / Material / Pressure / Connection / Control…` },
      { key: 'faq', label: 'FAQ 搜索意图', impact: 'mid', before: (before.faq || []).length ? `${before.faq.length} 条 FAQ` : '无 FAQ', after: '8 个采购问题 · Installation / Cleaning / Lead Time / OEM / Warranty…' },
      { key: 'image_alt', label: '图片 ALT', impact: 'low', before: (before.image_alt || []).length ? '部分图片无 ALT' : '无图片 ALT', after: '8 张图片含采购关键词 ALT' },
      { key: 'internal_links', label: '内部链接', impact: 'low', before: '0 条内链', after: '12 条内链 · 关联产品 / 应用场景 / 案例' },
      { key: 'product_schema', label: 'Product Schema', impact: 'mid', before: before.schema_enabled ? '已启用' : '未启用', after: 'Product + Offer + AggregateRating' },
      { key: 'faq_schema', label: 'FAQ Schema', impact: 'mid', before: '未启用', after: 'FAQPage 结构化数据' },
    ],
  }
}

function buildLocalAgentResult(payload) {
  if (payload && typeof payload === 'object') {
    const { entity_type, entity_id, patch = {}, market } = payload
    const draft = {
      id: uid('draft'),
      entity_type,
      entity_id,
      market,
      title: `${entity_type === 'product' ? '产品' : '页面'} ${entity_id} 优化草稿`,
      diff: Object.entries(patch).map(([field, after]) => ({ field, after })),
      confirmed: false,
      status: 'draft',
      createdAt: new Date().toISOString(),
    }
    saveDb({ drafts: [draft, ...loadDb().drafts] })
    return {
      ok: true,
      summary: '已生成修改草稿（本地），等待人工确认后发布。',
      draft,
      requiresConfirmation: true,
    }
  }

  const c = String(payload || '').toLowerCase()
  let summary = '已完成查询并生成修改草稿（本地）。'
  let rows = []
  if (c.includes('英文') || c.includes('seo') || c.includes('不完整')) {
    summary = '找到 SEO 不完整的产品，已生成补全草稿。'
    rows = [
      { field: 'Ultrafiltration Unit · AF-UF-600', before: 'SEO 58 分', after: '补全 Title/Slug/FAQ/Schema' },
      { field: 'Automatic Dosing System · AF-DS-320', before: 'SEO 74 分', after: '补全 Meta/ALT/Schema' },
    ]
  } else if (c.includes('询盘') || c.includes('30')) {
    summary = '最近询盘最多的产品已统计。'
    rows = [
      { field: 'Industrial RO System', before: '—', after: '24 条询盘' },
      { field: 'Containerized Plant', before: '—', after: '21 条询盘' },
    ]
  } else if (c.includes('俄语') || c.includes('中文') || c.includes('缺失')) {
    summary = '对比中文站与俄语站，发现参数缺失项，已生成补齐草稿。'
    rows = [
      { field: 'Containerized Plant', before: '俄语站缺 3 项参数', after: '补齐 Climate / Footprint / Power' },
    ]
  }
  const draft = {
    id: uid('draft'),
    entity_type: 'product',
    entity_id: 'prod_002',
    title: '批量优化草稿',
    diff: rows.map((r) => ({ field: r.field, before: r.before, after: r.after })),
    confirmed: false,
    status: 'draft',
    createdAt: new Date().toISOString(),
  }
  saveDb({ drafts: [draft, ...loadDb().drafts] })
  return { ok: true, summary, draft, requiresConfirmation: true }
}
