/** P9 补截:三市场并排卡片 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:8080'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const FOOD_ID = 'site_1a14521cd43a93d17ab04'

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, deviceScaleFactor: 2 })
await page.goto(BASE + '/#/login')
await page.waitForTimeout(1200)
await page.evaluate(async () => {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }) })
  const j = await r.json()
  if (j.token) localStorage.setItem('sitepilot.token', j.token)
})
await page.goto(BASE + '/#/sites')
await page.waitForTimeout(4500)  // 先让登录态水合完成
await page.goto(`${BASE}/#/sites/${FOOD_ID}/markets`)
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1500)
  if (await page.locator('.mv-card').count() >= 3) break
}
const n = await page.locator('.mv-card').count()
console.log('cards:', n)
if (n >= 3) {
  // 三卡并排整体(含语言页签更好:截 .mv-panel 上半)
  const grid = page.locator('.mv-grid')
  await grid.screenshot({ path: 'C:/Users/auro/Desktop/P9-三市场并排.png' })
  console.log('OK P9')
} else {
  console.log('STILL MISS, page text:', (await page.locator('body').innerText()).slice(0, 200))
}
await browser.close()
