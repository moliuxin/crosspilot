// 4K 截图：network_screen.html → 3840×2160 PNG（deviceScaleFactor=2）
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
await page.goto(pathToFileURL('C:/Users/auro/Desktop/ZCode/video_work/network_screen.html').href)
await page.waitForTimeout(1200)
await page.screenshot({ path: 'C:/Users/auro/Desktop/网络运营可视化大屏_跨境电商5G.png' })
await browser.close()
console.log('4K PNG saved')
