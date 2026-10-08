// 严格对齐 docs/data-model.example.json → company
export const mockCompany = {
  id: 'company_demo_001',
  name: 'AQUAFLOW Industrial',
  short: 'AQUAFLOW',
  industry: 'industrial equipment',
  industryLabel: '工业水处理设备',
  primary_products: ['centrifugal pump', 'process pump', 'RO system', 'ultrafiltration unit'],
  target_markets: ['en-US', 'ru-RU', 'zh-CN'],
  website: 'aquaflow-global.com',
  contact_name: '',
  phone: '+86 000 0000 0000',
  verified: true,
  free_full_generation_limit: 1,
  free_full_generation_used: 1,
  plan: 'free',
}

// 工作台概览指标（Mock）
export const mockMetrics = {
  visits30d: { value: '12,846', delta: '+18.6%' },
  inquiries: { value: '86', delta: '+24.1%' },
  organicClicks: { value: '3,218', delta: '+31.8%' },
  aiCitations: { value: '42', delta: '+9 本周' },
}

// 网站健康度
export const mockHealth = {
  score: 82,
  status: '整体表现良好',
  opportunities: 6,
  items: [
    { label: '页面结构', score: 92, level: 'good' },
    { label: '移动端体验', score: 88, level: 'good' },
    { label: 'SEO 完整度', score: 71, level: 'warn' },
    { label: 'GEO 可抓取性', score: 68, level: 'warn' },
  ],
}
