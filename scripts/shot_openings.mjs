import { chromium } from 'playwright'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1300, height: 740 }, deviceScaleFactor: 2 })
await page.goto('file:///C:/Users/auro/Desktop/ppt-openings.html')
await page.waitForTimeout(1000)
await page.locator('#innov').screenshot({ path: 'C:/Users/auro/Desktop/PPT配图_创新赛开场页.png' })
console.log('OK innovation opening')
await page.locator('#theme').screenshot({ path: 'C:/Users/auro/Desktop/PPT配图_主题赛开场页.png' })
console.log('OK theme opening')
await browser.close()
