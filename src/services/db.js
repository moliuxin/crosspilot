// 本地持久化数据层（Demo 数据库）。
// 校赛阶段用 localStorage 充当数据库；11 月替换 FastAPI 时，
// 只需让 api.js 的非 mock 分支走 request()，本文件即可整体删除。
//
// 数据键：sitepilot.db.v1（一次性整体读写，结构简单、足够 Demo 用）

const DB_KEY = 'sitepilot.db.v1'

import { mockProducts } from '../data/mockProducts'
import { mockInquiries } from '../data/mockInquiries'
import { mockCompany } from '../data/mockCompany'

// 用户要求的数据结构（对齐指令第五节 / docs/data-model.example.json）：
// Product: { id, name, model, category, attributes, sellingPoints, description, faq, seoScore, geoScore }
//   Demo 中以 specs/benefits/seo_score 命名存储，语义一一对应（attributes=specs,
//   sellingPoints=benefits, faq 在 seo.faq, geoScore=seo.geo_score）。
// Inquiry: { id, customerName, country, productId, sourcePage, message, status, createdAt }
//   Demo 以 snake_case（customer_name/created_at/...）存储，与 data-model.example.json 对齐。
// SiteState: { companyName, industry, targetMarkets, freeGenerationUsed, plan, language, publishStatus }

const SEED = {
  products: mockProducts,
  inquiries: mockInquiries,
  site: {
    companyName: mockCompany.name,
    industry: mockCompany.industryLabel,
    products: mockCompany.primary_products.join(', '),
    targetMarkets: mockCompany.target_markets,
    language: 'zh-CN',
    plan: mockCompany.plan, // 'free' | 'starter' | 'growth' | 'expert'
    publishStatus: 'draft', // 'draft' | 'published'
    publishCount: 0,
    verified: mockCompany.verified,
  },
  usage: {
    freeGenerationLimit: 1,
    freeGenerationUsed: 0, // 本次环境是否已消耗免费完整生成（持久化）
  },
  drafts: [], // Agent / SEO 产生的待确认草稿
  pages: [], // 页面编辑器（首次访问由 api.js 写入默认页面）
  tasks: [], // 跟进 / 增长任务
  credits: { balance: 1860, totalGranted: 1860, used: 0 }, // Skill 额度
  creditLogs: [], // 额度流水
}

function read() {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // 浅合并 seed，保证新增字段有默认值
      return { ...SEED, ...parsed }
    }
  } catch {
    /* 损坏则重置 */
  }
  return null
}

function write(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/** 读取整库（无库时写入 seed） */
export function loadDb() {
  const existing = read()
  if (existing) return existing
  write(SEED)
  return { ...SEED }
}

/** 保存整库片段 */
export function saveDb(patch) {
  const db = read() || SEED
  write({ ...db, ...patch })
  return db
}

/** 重置演示数据（供设置入口 / 调试使用） */
export function resetDb() {
  try {
    localStorage.removeItem(DB_KEY)
  } catch {
    /* ignore */
  }
  write(SEED)
  return { ...SEED }
}

export const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
