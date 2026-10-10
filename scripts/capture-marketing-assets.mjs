/**
 * P0-3 营销截图自动采集 —— 全部来自真实 CrossPilot UI(Docker 栈 http://localhost:8080)。
 * 运行:node scripts/capture-marketing-assets.mjs
 * 产物:public/marketing/*.webp(产品更新后可重跑刷新)
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE_URL || 'http://localhost:8080'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const OUT = path.resolve('public/marketing')
fs.mkdirSync(OUT, { recursive: true })

const DEMO = { email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }

async function api(page, p, body, token) {
  return page.evaluate(async ({ p, body, token }) => {
    const h = { 'Content-Type': 'application/json' }
    if (token) h.Authorization = 'Bearer ' + token
    const r = await fetch('/api' + p, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, data: await r.json().catch(() => ({})) }
  }, { p, body, token })
}

async function shot(page, name, { fullPage = false, clip, viewport = { width: 1440, height: 900 } } = {}) {
  await page.setViewportSize(viewport)
  await page.waitForTimeout(1400)
  await page.screenshot({ path: path.join(OUT, name + '.webp'), fullPage, clip, quality: 82, type: 'webp' })
  console.log('✓', name + '.webp')
}

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()

// ---- 登录演示账号 ----
await page.goto(BASE + '/#/login')
await page.waitForTimeout(2600)
const login = await api(page, '/auth/login', DEMO)
if (!login.data.token) { console.error('登录失败', login); process.exit(1) }
const TOKEN = login.data.token
await page.evaluate((t) => localStorage.setItem('sitepilot.token', t), TOKEN)

// ---- 确保演示站点:生成(或复用)一个协作机器人站 + 变体 + 发布 ----
const sites = (await api(page, '/sites')).data.sites || []
let site = sites.find((s) => (s.product_category || '').includes('协作机器人')) || sites[0]
if (!site) {
  const g = await api(page, '/sites/generate', { company_name: '协作机器人源头厂', product_category: '六轴协作机器人', target_markets: ['zh-CN', 'en-US', 'ru-RU'] }, TOKEN)
  site = g.data.site
}
await api(page, '/sites/' + site.id + '/market-variants/generate', {}, TOKEN).catch(() => {})
await page.evaluate(async ({ id }) => {
  const t = localStorage.getItem('sitepilot.token')
  await fetch('/api/sites/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ status: 'published' }) })
}, { id: site.id })
const slug = site.public_slug

// ---- ① AI 生成(建站向导) ----
await page.goto(`${BASE}/#/sites/new`)
await shot(page, 'mk-generate')

// ---- ② 三市场公开站(结构互异) ----
for (const m of ['zh-CN', 'en-US', 'ru-RU']) {
  await page.goto(`${BASE}/#/site/${slug}/${m}/`)
  await page.evaluate(() => window.scrollTo(0, 500))
  await shot(page, 'mk-site-' + m.split('-')[0].toLowerCase())
}

// ---- ③ SEO/GEO 报告(工作台真实页) ----
await page.goto(`${BASE}/#/seo/geo`)
await shot(page, 'mk-seo')

// ---- ④ 市场变体面板(含画笔选择态) ----
await page.goto(`${BASE}/#/sites/${site.id}/markets`)
await page.evaluate(() => {
  const sec = document.querySelector('.mv-section')
  if (sec) sec.click()
  const input = document.querySelector('.brush-input')
  if (input) {
    input.value = '更适合俄罗斯系统集成商,突出 10kg 负载、稳定供货和技术支持'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
})
await shot(page, 'mk-brush')

// ---- ⑤ Agent(MCP 工具面板) ----
await page.goto(`${BASE}/#/agent`)
await shot(page, 'mk-agent')

// ---- ⑥ RFQ:公开站询盘区块 + 后台询盘列表 ----
await page.goto(`${BASE}/#/site/${slug}/en-US/`)
await page.evaluate(() => {
  const rfq = [...document.querySelectorAll('.sb-rfq, .sb-block')].find((el) => (el.querySelector('h2') || {}).textContent?.includes('quote') || el.className.includes('rfq'))
  if (rfq) rfq.scrollIntoView({ block: 'center' })
})
await shot(page, 'mk-rfq-public')
await page.goto(`${BASE}/#/inquiries`)
await shot(page, 'mk-rfq-backend')

// ---- ⑦ Skill Center 真运行 ----
await page.goto(`${BASE}/#/skills`)
await shot(page, 'mk-skills')

await browser.close()
console.log('DONE →', OUT)
