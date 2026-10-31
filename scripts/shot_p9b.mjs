/** P9 三市场并排:先整页加载(让鉴权态水合,可能弹回 intro),再 SPA 内部改 hash 进市场页 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:8080'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const FOOD_ID = 'site_1a14521cd43a93d17ab04'

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1720, height: 1150 }, deviceScaleFactor: 2 })
await page.goto(BASE + '/#/login')
await page.waitForTimeout(1200)
await page.evaluate(async () => {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }) })
  const j = await r.json()
  if (j.token) localStorage.setItem('sitepilot.token', j.token)
})
// 第一次整页加载:无论落点,应用此刻完成 token→用户态水合
await page.goto(`${BASE}/#/sites/${FOOD_ID}/markets`)
await page.waitForTimeout(4000)
// SPA 内部改 hash(不触发整页刷新,鉴权态已就绪,不再弹回)
await page.evaluate((id) => { location.hash = `#/sites/${id}/markets` }, FOOD_ID)
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1500)
  if (await page.locator('.mv-card').count() >= 3) break
}
const n = await page.locator('.mv-card').count()
console.log('cards:', n, 'hash:', await page.evaluate('location.hash'))
if (n >= 3) {
  // 滚到三卡区并等图片
  await page.evaluate(() => document.querySelector('.mv-grid')?.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(2500)
  await page.locator('.mv-grid').screenshot({ path: 'C:/Users/auro/Desktop/P9-三市场并排.png' })
  console.log('OK P9')
} else {
  console.log('MISS again')
}
await browser.close()
