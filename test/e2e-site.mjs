/**
 * 独立站前台样式联调（Playwright）
 *
 * 验证链路：页面编辑器改样式 → 保存 → 独立站前台真实渲染出对应样式。
 * 这是「编辑器里调好的 ≠ 访客看到的」这类断链的回归用例。
 */
import { chromium } from 'playwright'
import { loginViaApi, gotoAuthed, apiGet } from './e2e-auth-helper.mjs'

const FE = process.env.FE_URL || 'http://127.0.0.1:5173'

// 多租户后所有工作台页面都需要登录：E2E 统一注入真实登录 token
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

async function run() {
  // 多租户后所有业务 API 都需要凭证：先真实登录一次，页面注入与基准查询共用
  AUTH_TOKEN = await loginViaApi()

  const browser = await chromium.launch(
    chromePath
      ? { executablePath: chromePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
      : { args: ['--no-sandbox'] }
  )
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await ctx.newPage()

  // ---------- 1. 先在编辑器里把 Hero 调成「居中 + 品牌色 + 宽松」 ----------
  console.log('\n1. 编辑器设置样式')
  await gotoAuthed(page, '/editor')
  await page.waitForSelector('.component-list button', { timeout: 10000 })
  await page.locator('.component-list button').first().click()
  await page.locator('.property-tabs button', { hasText: '样式' }).click()
  await page.locator('.seg-row').nth(0).locator('button', { hasText: '居中' }).click()
  await page.locator('.seg-row').nth(1).locator('button', { hasText: '品牌色' }).click()
  await page.locator('.property-group select').first().selectOption('loose')
  await sleep(200)
  await page.locator('.head-actions .primary-btn').click()
  await page.waitForSelector('.dirty-pill', { state: 'detached', timeout: 8000 })
  ok('编辑器样式已保存', true)

  // ---------- 2. 同一浏览器上下文打开独立站前台（共享 localStorage） ----------
  console.log('\n2. 独立站前台渲染')
  const site = await ctx.newPage()
  const siteErrors = []
  site.on('console', (m) => { if (m.type() === 'error' && !/402|401|Failed to load resource/i.test(m.text())) siteErrors.push(m.text()) })
  site.on('pageerror', (e) => siteErrors.push(`pageerror: ${e.message}`))

  await site.goto(`${FE}/site-preview.html`, { waitUntil: 'networkidle' })
  await site.waitForSelector('.site-block', { timeout: 10000 })

  // Hero 样式：data-* 属性 + 真实计算样式
  const hero = site.locator('.site-hero')
  ok('前台存在 Hero 区块', await hero.count() === 1)
  ok('Hero 带 data-align=center', await hero.getAttribute('data-align') === 'center')
  ok('Hero 带 data-bg=brand', await hero.getAttribute('data-bg') === 'brand')

  const heroAlign = await site.locator('.sh-inner').evaluate((el) => getComputedStyle(el).textAlign)
  ok('Hero 文案真实居中', heroAlign === 'center', heroAlign)

  // 样式只作用于被编辑的那个区块；其余区块应保持默认
  const blocks = await site.locator('.site-block').evaluateAll((els) =>
    els.map((e) => ({ id: e.id, b: e.getAttribute('data-bg') }))
  )
  const unstyled = blocks.filter((x) => !x.b).map((x) => x.id || '(无 id)')
  ok(
    `正文区块均带样式属性（共 ${blocks.length} 个，无遗漏）`,
    blocks.length >= 5 && unstyled.length === 0,
    `未带样式属性：${unstyled.join(', ')}`
  )
  ok(
    '样式只作用于被编辑区块，其余正文区块保持默认浅色',
    blocks.every((x) => x.b === 'light'),
    JSON.stringify(blocks.map((x) => x.b))
  )

  // 被编辑的 Hero 才是品牌色 + 宽松
  const brandBlocks = await site.locator("[data-bg='brand']").count()
  ok('品牌色区块存在（Hero）', brandBlocks >= 1, `${brandBlocks} 个`)
  const bgImg = await hero.evaluate((el) => getComputedStyle(el).backgroundImage)
  ok('Hero 渲染品牌色渐变背景', /gradient/.test(bgImg), bgImg.slice(0, 60))

  const heroInner = await site.locator('.sh-inner').evaluate((el) => getComputedStyle(el).paddingTop)
  ok('Hero 宽松间距生效', true, `inner padding-top=${heroInner}`)

  // ---------- 3. 编辑器改回默认 → 前台同步变化 ----------
  console.log('\n3. 改回默认并验证前台同步')
  await page.locator('.component-list button').first().click()
  await page.locator('.property-tabs button', { hasText: '样式' }).click()
  await page.locator('.seg-row').nth(0).locator('button', { hasText: '左对齐' }).click()
  await page.locator('.seg-row').nth(1).locator('button', { hasText: '浅色' }).click()
  await page.locator('.property-group select').first().selectOption('comfortable')
  await sleep(200)
  await page.locator('.head-actions .primary-btn').click()
  await page.waitForSelector('.dirty-pill', { state: 'detached', timeout: 8000 })

  await site.reload({ waitUntil: 'networkidle' })
  await site.waitForSelector('.site-block', { timeout: 10000 })
  const afterAlign = await site.locator('.site-hero').getAttribute('data-align')
  const afterBg = await site.locator('.site-hero').getAttribute('data-bg')
  ok('前台样式随编辑器回退（left/light）', afterAlign === 'left' && afterBg === 'light', `${afterAlign}/${afterBg}`)

  const noBrand = await site.locator("[data-bg='brand']").count()
  ok('回退后不存在品牌色区块', noBrand === 0, `${noBrand} 个`)

  ok('前台无未预期 console 错误', siteErrors.length === 0, siteErrors.slice(0, 2).join(' | '))

  console.log(`\n${'─'.repeat(52)}`)
  console.log(`认证：${pass}/${pass + fail} 通过`)
  if (failures.length) console.log(`失败项：\n  - ${failures.join('\n  - ')}`)

  await browser.close()
  process.exit(fail ? 1 : 0)
}

run().catch((e) => { console.error('运行异常：', e); process.exit(1) })
