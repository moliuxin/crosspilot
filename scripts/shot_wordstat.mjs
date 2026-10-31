import { chromium } from 'playwright'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: 2 })
await page.goto('file:///C:/Users/auro/Desktop/wordstat-demo.html')
await page.waitForTimeout(1000)
await page.screenshot({ path: 'C:/Users/auro/Desktop/Wordstat-搜索热词截图.png', fullPage: true })
console.log('OK')
await browser.close()
