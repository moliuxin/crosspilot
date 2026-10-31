/** 商业模式页配图:渲染 HTML 两张图为高清 PNG 到桌面 */
import { chromium } from 'playwright'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1560, height: 1600 }, deviceScaleFactor: 2 })
await page.goto('file:///C:/Users/auro/Desktop/ppt-bm-figs.html')
await page.waitForTimeout(800)

await page.locator('#ladder').screenshot({ path: 'C:/Users/auro/Desktop/商业模式-四级台阶图.png' })
console.log('OK ladder')
await page.locator('#cost').screenshot({ path: 'C:/Users/auro/Desktop/商业模式-成本对比图.png' })
console.log('OK cost')
await browser.close()
