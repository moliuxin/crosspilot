// 批量录制 BI 大屏 + 7 个功能演示片段（Playwright Edge 无头录屏，无光标）。
// 输出: video_work/rec/*.webm → 由 convert_recs.py 转 mp4 parts。
// 运行: node scripts/record_clips.mjs  （须在 crosspilot-faron 目录下）
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'

const API = 'http://localhost:8080/api'
const OUT_DIR = '../video_work/rec'
mkdirSync(OUT_DIR, { recursive: true })

// 1) 拿登录 token（无头新上下文没有登录态）
const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }),
}).then((r) => r.json())
const TOKEN = login.token || login.access_token
if (!TOKEN) throw new Error('login failed')
// 第一个站点 id（画笔/三市场页要用）
const sites = await fetch(`${API}/sites`, { headers: { Authorization: `Bearer ${TOKEN}` } }).then((r) => r.json())
const SITE_ID = (sites[0] && sites[0].id) || ''
console.log('token ok, site:', SITE_ID)

const browser = await chromium.launch({ channel: 'msedge' })

const CINEMA = `.sidebar,.topbar,.sidebar-bottom{display:none!important}
.app-shell{display:block!important}::-webkit-scrollbar{width:0;height:0}
html{scrollbar-width:none}
.bd-screen{padding:18px 22px!important}`

async function record(name, durationMs, fn) {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: { width: 1920, height: 1080 } },
  })
  await ctx.addInitScript((t) => localStorage.setItem('sitepilot.token', t), TOKEN)
  const page = await ctx.newPage()
  await fn(page)
  const wait = Math.max(0, durationMs)
  await page.waitForTimeout(wait)
  await ctx.close()
  // 找最新 webm 改名
  const { readdirSync, statSync } = await import('node:fs')
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith('.webm'))
  const newest = files.map((f) => ({ f, t: statSync(`${OUT_DIR}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t)[0]
  writeFileSync(`${OUT_DIR}/${name}.done`, String(Date.now()))
  console.log(`recorded ${name} (${newest.f})`)
  return newest.f
}

const smoothScroll = (page, px, steps = 4) => page.evaluate(async ({ px, steps }) => {
  for (let i = 0; i < steps; i++) {
    window.scrollBy({ top: px / steps, behavior: 'smooth' })
    await new Promise((r) => setTimeout(r, 260))
  }
}, { px, steps })

// ---- c7 / BI 大屏（也是 3'41" 的 d7 素材，录 13s）----
await record('bi', 1300, async (page) => {
  await page.goto('http://localhost:8080/#/growth/bi-map')
  await page.addStyleTag({ content: CINEMA })
  await page.waitForTimeout(3200) // 入场动画
  const sel = (label) => page.evaluate((label) => {
    const s = document.querySelector('.bd-select')
    const o = [...s.options].find((o) => o.textContent.includes(label))
    s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }))
  }, label)
  await sel('建材出口'); await page.waitForTimeout(1800)
  await sel('协作机器人（Wordstat'); await page.waitForTimeout(2200)
  await page.evaluate(() => document.querySelectorAll('.bd-mx-bubble')[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await page.waitForTimeout(1700)
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.bd-region')].find((x) => x.querySelector('title')?.textContent.includes('Novosibirsk'))
    p?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForTimeout(2300)
})

// ---- c1 AI 建站向导 ----
await record('c1', 0, async (page) => {
  await page.goto('http://localhost:8080/#/sites/new')
  await page.addStyleTag({ content: CINEMA })
  await page.waitForTimeout(1500)
  await smoothScroll(page, 420, 3)
  await page.waitForTimeout(700)
  await smoothScroll(page, -420, 2)
})

// ---- c2 模板商城 ----
await record('c2', 0, async (page) => {
  await page.goto('http://localhost:8080/#/templates')
  await page.waitForTimeout(1800)
  await smoothScroll(page, 900, 5)
  await page.waitForTimeout(500)
  await smoothScroll(page, -500, 2)
})

// ---- c3 三市场 ----
await record('c3', 0, async (page) => {
  await page.goto(`http://localhost:8080/#/sites/${SITE_ID}/markets`)
  await page.addStyleTag({ content: CINEMA })
  await page.waitForTimeout(2200)
  const tab = (t) => page.evaluate((t) => {
    const el = [...document.querySelectorAll('button, [role=tab], .tab, [class*=tab]')].find((e) => e.textContent.trim() === t)
    el?.click()
  }, t)
  await tab('EN'); await page.waitForTimeout(1400)
  await tab('中文'); await page.waitForTimeout(1400)
})

// ---- c4 AI 画笔（编辑器）----
await record('c4', 0, async (page) => {
  await page.goto(`http://localhost:8080/#/sites/${SITE_ID}/editor`)
  await page.addStyleTag({ content: CINEMA })
  await page.waitForTimeout(2600)
  await page.evaluate(() => {
    const sec = document.querySelector('[class*=section], [data-section]')
    sec?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForTimeout(1200)
  await smoothScroll(page, 260, 2)
})

// ---- c5 询盘中心 ----
await record('c5', 0, async (page) => {
  await page.goto('http://localhost:8080/#/inquiries')
  await page.addStyleTag({ content: CINEMA })
  await page.waitForTimeout(1600)
  await smoothScroll(page, 360, 3)
})

// ---- c6 SEO & GEO ----
await record('c6', 0, async (page) => {
  await page.goto('http://localhost:8080/#/seo')
  await page.addStyleTag({ content: CINEMA })
  await page.waitForTimeout(2000)
  await smoothScroll(page, 520, 4)
})

// ---- c8 产品库（事实层）----
await record('c8', 0, async (page) => {
  await page.goto('http://localhost:8080/#/products')
  await page.addStyleTag({ content: CINEMA })
  await page.waitForTimeout(1800)
  await smoothScroll(page, 480, 4)
})

await browser.close()
console.log('ALL RECORDED')
