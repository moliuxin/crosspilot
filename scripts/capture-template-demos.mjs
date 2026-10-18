/**
 * 模板示例站截图采集 —— 截 Skill 生成的真实站点(非静态骨架)。
 * 运行:node scripts/capture-template-demos.mjs
 * 产物:public/template-assets/<tpl>/preview-full.webp(整页) + thumbnail.webp(首屏)
 * 零 LLM token:只截已生成的站点。
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE_URL || 'http://localhost:8080'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const OUT = path.resolve('public/template-assets')
fs.mkdirSync(OUT, { recursive: true })

const DEMOS = [
  { tpl: 'industrial-pro', slug: 's-1-b9528a', market: 'en-US' },
  { tpl: 'supplier-minimal', slug: 's-1-18b564', market: 'en-US' },
  { tpl: 'russia-industrial', slug: 's-1-56abdf', market: 'ru-RU' },
  { tpl: 'food-export', slug: 's-1-cca731', market: 'en-US' },
  { tpl: 'electronics-global', slug: 's-1-cd90cb', market: 'en-US' },
  { tpl: 'building-materials-pro', slug: 's-1-0d9eec', market: 'en-US' },
]

const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage()

for (const { tpl, slug, market } of DEMOS) {
  const dir = path.join(OUT, tpl)
  fs.mkdirSync(dir, { recursive: true })
  await page.goto(`${BASE}/#/site/${slug}/${market}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000) // 等图片加载
  // 首屏缩略图
  await page.screenshot({ path: path.join(dir, 'thumbnail.webp'), quality: 82, type: 'webp' })
  // 整页滚动预览
  await page.screenshot({ path: path.join(dir, 'preview-full.webp'), fullPage: true, quality: 80, type: 'webp' })
  console.log('OK', tpl)
}
await browser.close()
console.log('DONE')
