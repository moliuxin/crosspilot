/** 调试:登录后访问 markets 页,打印 hash/token/API 状态 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:8080'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const FOOD_ID = 'site_1a14521cd43a93d17ab04'

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1680, height: 1100 } })
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('NAV →', f.url().slice(0, 110)) })
await page.goto(BASE + '/#/login')
await page.waitForTimeout(1200)
await page.evaluate(async () => {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }) })
  const j = await r.json()
  if (j.token) localStorage.setItem('sitepilot.token', j.token)
})
await page.goto(`${BASE}/#/sites/${FOOD_ID}/markets`)
await page.waitForTimeout(8000)
const st = await page.evaluate(async () => {
  const t = localStorage.getItem('sitepilot.token')
  const r = await fetch('/api/sites', { headers: { Authorization: 'Bearer ' + t } })
  return { hash: location.hash, tokenLen: (t || '').length, sitesStatus: r.status }
})
console.log(st)
console.log('cards:', await page.locator('.mv-card').count())
await browser.close()
