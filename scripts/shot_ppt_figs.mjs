/** PPT 三张配图:三市场并排 / 转化诊断界面 / 机器人站在线 —— 存桌面 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:8080'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const FOOD_ID = 'site_1a14521cd43a93d17ab04'
const OUT = 'C:/Users/auro/Desktop/'

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 })

// ---- 登录演示账号(管理页需要) ----
await page.goto(BASE + '/#/login')
await page.waitForTimeout(1200)
const login = await page.evaluate(async () => {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }) })
  const j = await r.json()
  if (j.token) localStorage.setItem('sitepilot.token', j.token)
  return !!j.token
})
console.log('login:', login)

// ---- 找协作机器人已发布站的 public_slug ----
const robot = await page.evaluate(async () => {
  const t = localStorage.getItem('sitepilot.token')
  const r = await fetch('/api/sites', { headers: { Authorization: 'Bearer ' + t } })
  const j = await r.json()
  const s = (j.sites || []).find((x) => (x.name || '').includes('协作机器人') && x.status === 'published')
        || (j.sites || []).find((x) => (x.name || '').includes('协作机器人'))
  return s ? { slug: s.public_slug || s.slug, name: s.name } : null
})
console.log('robot site:', robot)

// ---- ① P9 三市场并排(mv-grid 三卡片) ----
await page.goto(`${BASE}/#/sites/${FOOD_ID}/markets`)
await page.waitForTimeout(5000)
const grid = page.locator('.mv-grid')
if (await grid.count()) {
  await grid.screenshot({ path: OUT + 'P9-三市场并排.png' })
  console.log('OK P9')
} else {
  console.log('MISS P9 grid')
}

// ---- ② P13 转化诊断界面 ----
await page.goto(`${BASE}/#/sites/${FOOD_ID}/conversion`)
await page.waitForTimeout(4500)
// 若有"分析/生成报告"按钮且页面为空,点一次(可能命中缓存报告)
const btn = [...await page.locator('button').all()].find(async (b) => /分析|生成报告/.test((await b.textContent()) || ''))
if (btn) { await btn.click().catch(() => {}); await page.waitForTimeout(6000) }
const conv = page.locator('.view')
if (await conv.count()) {
  await conv.screenshot({ path: OUT + 'P13-转化诊断界面.png' })
  console.log('OK P13')
}

// ---- ③ P14 机器人站在线(EN 版,页头含三语切换即三语在线证明) ----
if (robot && robot.slug) {
  await page.goto(`${BASE}/#/site/${robot.slug}/en-US/`)
  await page.waitForTimeout(6000)
  await page.screenshot({ path: OUT + 'P14-机器人站在线.png' })
  console.log('OK P14', robot.slug)
}

await browser.close()
console.log('DONE')
