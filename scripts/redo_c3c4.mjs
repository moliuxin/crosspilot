// 补录 c3(三市场) c4(AI画笔) —— 首轮 SITE_ID 为空跳了坏地址
import { chromium } from 'playwright'

const API = 'http://localhost:8080/api'
const OUT_DIR = '../video_work/rec'
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }) }).then((r) => r.json())
const TOKEN = login.token
const s = await fetch(`${API}/sites`, { headers: { Authorization: `Bearer ${TOKEN}` } }).then((r) => r.json())
const arr = Array.isArray(s) ? s : (s.sites || s.data || Object.values(s).find(Array.isArray) || [])
const SITE = arr[0].id
console.log('site =', SITE)
const CINEMA = '.sidebar,.topbar,.sidebar-bottom{display:none!important}.app-shell{display:block!important}::-webkit-scrollbar{width:0;height:0}html{scrollbar-width:none}'

const browser = await chromium.launch({ channel: 'msedge' })
const mk = async () => {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: { width: 1920, height: 1080 } },
  })
  await ctx.addInitScript((t) => localStorage.setItem('sitepilot.token', t), TOKEN)
  return ctx
}

// c3
let ctx = await mk()
let page = await ctx.newPage()
await page.goto(`http://localhost:8080/#/sites/${SITE}/markets`)
await page.addStyleTag({ content: CINEMA })
await page.waitForTimeout(2400)
await page.evaluate(() => { const el = [...document.querySelectorAll('button,[role=tab],[class*=tab]')].find((e) => e.textContent.trim() === 'EN'); el?.click() })
await page.waitForTimeout(1500)
await page.evaluate(() => { const el = [...document.querySelectorAll('button,[role=tab],[class*=tab]')].find((e) => e.textContent.trim() === '中文'); el?.click() })
await page.waitForTimeout(1500)
await ctx.close()
console.log('c3 done')

// c4
ctx = await mk()
page = await ctx.newPage()
await page.goto(`http://localhost:8080/#/sites/${SITE}/editor`)
await page.addStyleTag({ content: CINEMA })
await page.waitForTimeout(2800)
await page.evaluate(() => { const sec = document.querySelector('[class*=section],[data-section],[class*=block]'); sec?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
await page.waitForTimeout(1400)
await page.evaluate(async () => { for (let i = 0; i < 2; i++) { window.scrollBy({ top: 130, behavior: 'smooth' }); await new Promise((r) => setTimeout(r, 260)) } })
await page.waitForTimeout(500)
await ctx.close()
console.log('c4 done')
await browser.close()
console.log('REDO OK')
