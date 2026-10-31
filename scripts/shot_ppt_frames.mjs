/** PPT 配图:从平台直接截取高质量关键帧 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:8080'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const OUT = 'C:/Users/auro/Desktop/'
const FOOD_ID = 'site_1a14521cd43a93d17ab04'

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })

// 登录
await page.goto(BASE + '/#/login')
await page.waitForTimeout(1500)
await page.evaluate(async () => {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }) })
  const j = await r.json()
  if (j.token) localStorage.setItem('sitepilot.token', j.token)
})

// 1. 首页 globe
await page.goto(BASE + '/#/intro')
await page.waitForTimeout(5000)
await page.screenshot({ path: OUT + 'PPT配图_首页Globe.png' })
console.log('OK globe')

// 2. 站点列表(实时缩略图)
await page.goto(BASE + '/#/sites')
await page.waitForTimeout(6000)
await page.screenshot({ path: OUT + 'PPT配图_站点列表.png' })
console.log('OK sites')

// 3. 三市场并排
await page.goto(BASE + `/#/sites/${FOOD_ID}/markets`)
await page.waitForTimeout(6000)
await page.evaluate(() => document.querySelector('.mv-grid')?.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(3000)
await page.screenshot({ path: OUT + 'PPT配图_三市场并排.png' })
console.log('OK markets')

// 4. AI 画笔(选中状态)
await page.evaluate(() => document.querySelectorAll('.mv-preview .mv-section')[0]?.click())
await page.waitForTimeout(2000)
const input = page.locator('.brush-input')
if (await input.count()) {
  await input.fill('标题字体变成金色，字体大一点')
  await page.waitForTimeout(1500)
}
await page.screenshot({ path: OUT + 'PPT配图_AI画笔.png' })
console.log('OK brush')

// 5. Buyer Conversion
await page.goto(BASE + `/#/sites/${FOOD_ID}/conversion`)
await page.waitForTimeout(5000)
await page.screenshot({ path: OUT + 'PPT配图_转化诊断.png' })
console.log('OK conversion')

// 6. 机器人站 英文版
await page.goto(BASE + '/#/site/s-1-b1c8dc/en-US/')
await page.waitForTimeout(6000)
await page.screenshot({ path: OUT + 'PPT配图_机器人站EN.png' })
console.log('OK robot')

// 7. 机器人站 俄语版
await page.goto(BASE + '/#/site/s-1-b1c8dc/ru-RU/')
await page.waitForTimeout(6000)
await page.screenshot({ path: OUT + 'PPT配图_机器人站RU.png' })
console.log('OK robot RU')

// 8. 询盘中心
await page.goto(BASE + '/#/inquiries')
await page.waitForTimeout(5000)
await page.screenshot({ path: OUT + 'PPT配图_询盘中心.png' })
console.log('OK inquiries')

// 9. 商机 BI
await page.goto(BASE + '/#/growth')
await page.waitForTimeout(4000)
await page.screenshot({ path: OUT + 'PPT配图_商机BI.png' })
console.log('OK BI')

// 10. Agent 工作台
await page.goto(BASE + '/#/agent')
await page.waitForTimeout(5000)
await page.screenshot({ path: OUT + 'PPT配图_Agent工作台.png' })
console.log('OK agent')

await browser.close()
console.log('ALL DONE')
