/**
 * 导航结构 + 模板商城（公开）+ 使用说明 E2E（Playwright）
 *
 * 验证 P0-NAV-TEMPLATE-PUBLIC 的硬要求：
 *   - 一级菜单固定为 9 项：概览/我的网站/询盘/客户/SEO & GEO/AI增长/数据分析/模板商城/设置
 *   - 产品按键在「我的网站 → 某网站 → 产品」页签下，不再占一级菜单
 *   - 任何两个一级菜单不跳到同一路由；不再出现 页面编辑/网站/版本历史 等重复一级入口
 *   - SEO/GEO/竞品分析/Skill Center/Agent 收进「AI 增长」内部
 *   - 模板商城未登录可浏览/预览；「使用模板」才要求登录（intended_template 回跳）
 *   - 登录后模板购买必须产生真实数据库记录，刷新后仍在
 *
 * Chrome 路径：优先 CHROME_PATH 环境变量，缺省用 Playwright 自带 Chromium。
 */
import { chromium } from 'playwright'
import { loginViaApi, gotoAuthed, apiGet, apiPost, API } from './e2e-auth-helper.mjs'

let AUTH_TOKEN = null
let pass = 0
let fail = 0
const failures = []

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chromePath = process.env.CHROME_PATH || undefined
const PRIMARY = ['概览', '我的网站', '询盘', '客户', 'SEO & GEO', 'AI 增长', '数据分析', '模板商城', '设置']

async function launch() {
  return chromium.launch(
    chromePath
      ? { executablePath: chromePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
      : { args: ['--no-sandbox'] }
  )
}

async function run() {
  AUTH_TOKEN = await loginViaApi()

  const browser = await launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

  // ---------- 1. 一级菜单结构（最终 10 项） ----------
  console.log('\n1. 一级菜单结构（P0-NAV 最终版）')
  await gotoAuthed(page, '/', AUTH_TOKEN)
  await page.waitForSelector('.sidebar', { timeout: 12000 })
  await sleep(600)

  const navLinks = page.locator('.nav-list.nav-primary .nav-item')
  const hrefs = []
  const n = await navLinks.count()
  for (let i = 0; i < n; i++) hrefs.push(await navLinks.nth(i).getAttribute('href'))
  const primaryTexts = (await navLinks.allInnerTexts())
    .map((s) =>
      s
        .split('\n')
        .map((x) => x.trim())
        .filter((x) => x && !/^(PRO|NEW)$/.test(x))
        .slice(1)
        .join(' ')
        .trim()
    )
  ok('一级菜单项数量为 9', primaryTexts.length === 9, `实际 ${primaryTexts.length}: ${primaryTexts.join(' / ')}`)
  for (const label of PRIMARY) {
    ok(`一级菜单包含「${label}」`, primaryTexts.includes(label))
  }
  const uniqueHrefs = new Set(hrefs.map((h) => (h || '').replace(/\/$/, '') || '/'))
  ok('任何两个一级菜单不指向同一路由', uniqueHrefs.size === hrefs.length, `${hrefs.join(',')} vs ${[...uniqueHrefs].join(',')}`)
  for (const banned of ['产品', '产品中心', '页面编辑', '页面内容', '网站', '版本历史', '使用说明']) {
    ok(`一级菜单不含重复入口「${banned}」`, !primaryTexts.some((t) => t === banned))
  }

  // 产品按键在「我的网站 → 某网站 → 产品」页签下
  const sites = await apiGet('/sites', AUTH_TOKEN)
  const firstSite = (sites.sites || [])[0]
  if (firstSite) {
    await gotoAuthed(page, `/sites/${firstSite.id}`, AUTH_TOKEN)
    await page.waitForSelector('.site-tabs', { timeout: 10000 })
    const tabText = await page.locator('.site-tabs').textContent()
    ok('站点页签包含「产品」', tabText.includes('产品'), tabText)
    await page.locator('.site-tab', { hasText: '产品' }).click()
    await sleep(900)
    ok('点击产品页签进入站点产品页', page.url().includes(`/sites/${firstSite.id}/products`), page.url())
    await page.waitForSelector('.site-products-panel', { timeout: 8000 }).catch(() => {})
    ok('站点产品面板渲染', (await page.locator('.site-products-panel').count()) === 1)
  }

  // ---------- 2. AI 增长页内部承载高级能力 ----------
  console.log('\n2. AI 增长承载高级能力')
  await gotoAuthed(page, '/growth', AUTH_TOKEN)
  await page.waitForSelector('.growth-cap-grid', { timeout: 10000 })
  await sleep(500)
  const caps = (await page.locator('.growth-cap').allTextContents()).join(' | ')
  for (const k of ['SEO 优化', 'GEO', '竞品分析', 'Buyer Conversion', 'Skill Center', 'AI Agent']) {
    ok(`AI 增长内含「${k}」`, caps.includes(k))
  }
  await page.locator('.growth-cap', { hasText: 'SEO 优化' }).click()
  await sleep(900)
  ok('点击能力卡片跳转到 /seo', page.url().includes('/seo'), page.url())

  // ---------- 3. 模板商城：匿名公开浏览 ----------
  console.log('\n3. 模板商城公开访问（未登录）')
  const anonCtx = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const anonPage = await anonCtx.newPage()
  await anonPage.goto(`${process.env.FE_URL || 'http://127.0.0.1:5173'}/#/templates`, { waitUntil: 'domcontentloaded' })
  await anonPage.waitForSelector('.tpl-grid', { timeout: 12000 })
  await sleep(700)
  const anonCards = await anonPage.locator('.tpl-card').count()
  ok('未登录可浏览模板商城', anonCards >= 6, `count=${anonCards}`)
  ok('匿名页面不出现商家侧栏', (await anonPage.locator('.sidebar').count()) === 0)

  // 匿名打开模板预览（公开 demo 页）
  await anonPage.locator('.tpl-card .ghost-btn', { hasText: '预览' }).first().click()
  await sleep(1200)
  ok('匿名可打开模板 Demo 预览', anonPage.url().includes('/templates/'), anonPage.url())
  ok('模板 Demo 渲染出页面结构区块', (await anonPage.locator('.demo-hero').count()) >= 1)
  ok('模板 Demo 标注 DEMO DATA', (await anonPage.locator('.tpl-demo-topbar').textContent()).includes('DEMO'))
  await anonCtx.close()

  // ---------- 4. 模板商城真实购买（登录态） ----------
  console.log('\n4. 模板商城真实购买')
  const beforeOrders = await apiGet('/service-orders', AUTH_TOKEN)
  const beforeList = Array.isArray(beforeOrders) ? beforeOrders : beforeOrders?.orders || []
  const beforeCount = beforeList.length

  await gotoAuthed(page, '/templates', AUTH_TOKEN)
  await page.waitForSelector('.tpl-grid', { timeout: 10000 })
  await sleep(700)

  const cards = await page.locator('.tpl-card').count()
  ok('模板商城渲染出模板卡片', cards >= 6, `count=${cards}`)
  const tplText = await page.locator('.tpl-grid').textContent()
  ok('模板标注市场（zh-CN / en-US / ru-RU）', /zh-CN/.test(tplText) && /en-US/.test(tplText) && /ru-RU/.test(tplText))

  const buyable = page.locator('.tpl-card').filter({ has: page.locator('button', { hasText: '立即购买' }) }).first()
  let bought = false
  if (await buyable.count()) {
    const tplName = (await buyable.locator('.tpl-head strong').textContent())?.trim()
    await buyable.locator('button', { hasText: '立即购买' }).click()
    await sleep(1600)
    bought = true
    console.log(`     已点击购买：${tplName}`)
  } else {
    console.log('     ⚠ 所有模板均已购买，跳过点击')
  }

  await sleep(500)
  const afterOrders = await apiGet('/service-orders', AUTH_TOKEN)
  const afterList = Array.isArray(afterOrders) ? afterOrders : afterOrders?.orders || []
  if (bought) {
    ok('购买后后端订单数增加（真实落库）', afterList.length > beforeCount, `${beforeCount} → ${afterList.length}`)
    const tplOrder = afterList.find((o) => String(o.feature_key || '').startsWith('template.'))
    ok('存在 feature_key = template.* 的订单', !!tplOrder, tplOrder?.feature_key || 'none')
  } else {
    ok('已存在模板购买记录', afterList.some((o) => String(o.feature_key || '').startsWith('template.')))
  }

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tpl-grid', { timeout: 10000 })
  await sleep(1000)
  const orderRows = await page.locator('.version-table tbody tr').count()
  ok('刷新后「我的购买记录」仍显示订单', orderRows > 0, `rows=${orderRows}`)
  const hasTemplateOrder = (await page.locator('.version-table').textContent()).includes('template.')
  ok('购买记录里能看到模板订单 key', hasTemplateOrder)

  // ---------- 5. 使用说明：步骤可真实跳转 ----------
  console.log('\n5. 使用说明')
  await gotoAuthed(page, '/help', AUTH_TOKEN)
  await page.waitForSelector('.help-layout', { timeout: 10000 })
  await sleep(700)
  ok('使用说明渲染出流程导航', (await page.locator('.help-nav-item').count()) >= 5)
  ok('使用说明渲染出步骤列表', (await page.locator('.help-steps li').count()) >= 3)
  ok('使用说明渲染出 FAQ', (await page.locator('.help-faq details').count()) >= 4)

  await page.locator('.help-nav-item', { hasText: '上架产品' }).click()
  await sleep(600)
  await page.locator('.help-steps li').first().locator('button').click()
  await sleep(900)
  ok('步骤按钮真实跳转到对应功能页', page.url().includes('/products'), page.url())

  ok('无未预期 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(`\n${'─'.repeat(52)}`)
  console.log(`导航/模板商城/使用说明：${pass}/${pass + fail} 通过`)
  if (failures.length) console.log(`失败项：\n  - ${failures.join('\n  - ')}`)
  process.exit(fail ? 1 : 0)
}

run().catch((e) => { console.error('运行异常：', e); process.exit(1) })
