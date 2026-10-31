/**
 * 双赛道演示视频自动录制(无声版)
 * 产出: innovation_demo.webm + theme_demo.webm (可后续转 MP4)
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:8080'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const OUT = 'C:/Users/auro/Desktop'
const FOOD_ID = 'site_1a14521cd43a93d17ab04'

async function login(page) {
  await page.goto(BASE + '/#/login')
  await page.waitForTimeout(1500)
  await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }) })
    const j = await r.json()
    if (j.token) localStorage.setItem('sitepilot.token', j.token)
  })
  console.log('logged in')
}

async function pause(page, ms) {
  await page.waitForTimeout(ms)
}

// ======== 视频一：创新赛 ========
async function recordInnovation() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: false })
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: OUT + '/video_temp/', size: { width: 1600, height: 900 } }
  })
  const page = await context.newPage()
  await login(page)

  // 1. 首页 globe (15s)
  console.log('[innovation] 1. homepage globe')
  await page.goto(BASE + '/#/intro')
  await pause(page, 12000)

  // 2. 我的网站 - 实时缩略图 (15s)
  console.log('[innovation] 2. my websites')
  await page.evaluate(() => { location.hash = '#/sites' })
  await pause(page, 5000)
  await pause(page, 10000) // 让缩略图加载完

  // 3. 市场版本页 - 三市场切换 (30s)
  console.log('[innovation] 3. market variants')
  await page.evaluate((id) => { location.hash = `#/sites/${id}/markets` }, FOOD_ID)
  await pause(page, 6000)
  // 切换到 RU
  const ruTab = await page.locator('.mv-tab').nth(1)
  if (await ruTab.count()) { await ruTab.click(); await pause(page, 4000) }
  // 切换到 EN
  const enTab = await page.locator('.mv-tab').nth(0)
  if (await enTab.count()) { await enTab.click(); await pause(page, 4000) }

  // 4. AI 画笔区域 (15s)
  console.log('[innovation] 4. AI brush')
  const section = await page.locator('.mv-preview .mv-section').first()
  if (await section.count()) {
    await section.click()
    await pause(page, 3000)
    const input = page.locator('.brush-input')
    if (await input.count()) {
      await input.fill('\u6807\u9898\u5b57\u4f53\u53d8\u6210\u91d1\u8272\uff0c\u5b57\u4f53\u5927\u4e00\u70b9')
      await pause(page, 3000)
      const genBtn = page.locator('button:has-text("\u751f\u6210\u8349\u7a3f")')
      if (await genBtn.count() && await genBtn.isEnabled()) {
        await genBtn.click()
        await pause(page, 5000)
      }
    }
  }

  // 5. Buyer Conversion (12s)
  console.log('[innovation] 5. buyer conversion')
  await page.evaluate((id) => { location.hash = `#/sites/${id}/conversion` }, FOOD_ID)
  await pause(page, 10000)

  // 6. 机器人站在线 (12s)
  console.log('[innovation] 6. robot site')
  await page.evaluate(() => { location.hash = '#/site/s-1-b1c8dc/en-US/' })
  await pause(page, 10000)

  await context.close() // 保存视频
  await browser.close()
  console.log('[innovation] DONE')
}

// ======== 视频二：主题赛 ========
async function recordTheme() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: false })
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: OUT + '/video_temp/', size: { width: 1600, height: 900 } }
  })
  const page = await context.newPage()
  await login(page)

  // 1. 首页定位条 (10s)
  console.log('[theme] 1. homepage')
  await page.goto(BASE + '/#/intro')
  await pause(page, 8000)

  // 2. 商机 BI (12s)
  console.log('[theme] 2. business intelligence')
  await page.evaluate(() => { location.hash = '#/growth' })
  await pause(page, 4000)
  const biCard = await page.locator('text=\u5546\u673a BI').first()
  if (await biCard.count()) {
    await biCard.click()
    await pause(page, 6000)
  }

  // 3. 机器人站 英文版 (12s)
  console.log('[theme] 3. robot site EN')
  await page.evaluate(() => { location.hash = '#/site/s-1-b1c8dc/en-US/' })
  await pause(page, 8000)

  // 4. 机器人站 俄语版 (10s)
  console.log('[theme] 4. robot site RU')
  await page.evaluate(() => { location.hash = '#/site/s-1-b1c8dc/ru-RU/' })
  await pause(page, 8000)

  // 5. 询盘中心 (12s)
  console.log('[theme] 5. inquiry center')
  await page.evaluate(() => { location.hash = '#/inquiries' })
  await pause(page, 8000)

  // 6. Agent 工作台 (12s)
  console.log('[theme] 6. agent workspace')
  await page.evaluate(() => { location.hash = '#/agent' })
  await pause(page, 8000)

  // 7. 收尾回到首页 (5s)
  await page.evaluate(() => { location.hash = '#/intro' })
  await pause(page, 4000)

  await context.close() // 保存视频
  await browser.close()
  console.log('[theme] DONE')
}

// ======== 主流程 ========
fs.mkdirSync(OUT + '/video_temp', { recursive: true })

console.log('Recording innovation track...')
await recordInnovation()

console.log('Recording theme track...')
await recordTheme()

// 重命名视频文件
const files = fs.readdirSync(OUT + '/video_temp').filter(f => f.endsWith('.webm'))
if (files.length >= 2) {
  fs.renameSync(`${OUT}/video_temp/${files[0]}`, `${OUT}/创新赛演示视频_无声.webm`)
  fs.renameSync(`${OUT}/video_temp/${files[1]}`, `${OUT}/主题赛演示视频_无声.webm`)
  console.log('Renamed:', files)
} else {
  console.log('Found', files.length, 'video files:', files)
}

console.log('ALL DONE')
