import { chromium } from 'playwright'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 820, height: 620 }, deviceScaleFactor: 2 })
await page.goto('file:///C:/Users/auro/Desktop/pie-chart.html')
await page.waitForTimeout(800)
await page.locator('#pie').screenshot({ path: 'C:/Users/auro/Desktop/PPT配图_资金配置饼图.png' })
console.log('OK pie chart')
await browser.close()
