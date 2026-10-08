// 领域类型（JSDoc 形式，便于后续替换为 TypeScript）
// 字段严格对齐 docs/data-model.example.json

/**
 * @typedef {'free'|'pro'|'enterprise'} Plan
 * @typedef {'zh-CN'|'en-US'|'ru-RU'} Market
 */

/**
 * @typedef {Object} Company
 * @property {string} id
 * @property {string} name
 * @property {string} industry
 * @property {string[]} primary_products
 * @property {Market[]} target_markets
 * @property {string} website
 * @property {string} contact_name
 * @property {string} phone
 * @property {boolean} verified
 * @property {number} free_full_generation_limit
 * @property {number} free_full_generation_used
 * @property {Plan} plan
 */

/**
 * @typedef {Object} SeoState
 * @property {string} title
 * @property {string} slug
 * @property {string} meta_description
 * @property {string} h1
 * @property {string[]} faq
 * @property {string[]} image_alt
 * @property {boolean} schema_enabled
 */

/**
 * @typedef {Object} Product
 * @property {string} id
 * @property {string} name
 * @property {string} model
 * @property {string} category
 * @property {string[]} images
 * @property {{key:string,value:string}[]} specs
 * @property {string[]} benefits
 * @property {string[]} applications
 * @property {number} seo_score
 * @property {SeoState} seo
 * @property {Record<string, any>} localized_content
 */

/**
 * @typedef {Object} Inquiry
 * @property {string} id
 * @property {string} customer_name
 * @property {string} country
 * @property {string} product_id
 * @property {string} source_page
 * @property {string} created_at
 * @property {'new'|'contacted'|'following'|'done'} status
 * @property {string} message
 */

export const MARKETS = {
  'en-US': { flag: 'EN', label: 'English', region: 'Global / North America' },
  'ru-RU': { flag: 'RU', label: 'Русский', region: 'Russia / CIS' },
  'zh-CN': { flag: '中', label: '简体中文', region: 'Corporate / Supplier' },
}

export const INQUIRY_STATUS = {
  new: '新询盘',
  contacted: '已联系',
  following: '跟进中',
  done: '已完成',
}
