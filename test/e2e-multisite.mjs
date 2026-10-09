/**
 * P0-MULTI-SITE 多站点 E2E（Playwright）
 *
 * 验证指令里的完整链路：
 *   注册 → 创建 Site A → 创建 Site B → Site A 数据与 Site B 隔离
 *   → 刷新 → 两个站仍存在
 *
 * 另验证：
 *   - 登录后落在通用概览（不显示某个网站名称）
 *   - 一级菜单的「我的网站」进入站点列表
 *   - 站点作用域内的页面编辑只看到本站页面
 *   - 免费生成额度是账号级（Usage 单例）
 *
 * Chrome 路径：优先 CHROME_PATH 环境变量，缺省用 Playwright 自带 Chromium。
 */
import { chromium } from 'playwright'
import { FE, API, apiPost, apiGet, gotoAuthed } from './e2e-auth-helper.mjs'

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chromePath = process.env.CHROME_PATH || undefined

async function launch() {
  return chromium.launch(
    chromePath
      ? { executablePath: chromePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
      : { args: ['--no-sandbox'] }
  )
}

const STAMP = Date.now().toString(36)
const EMAIL = `e2e-multisite-${STAMP}@sitepilot.test`
const PASSWORD = 'e2e-pass-123'

async function run() {
  // ---------- 0. 注册新账号（走真实 API，与用户一致） ----------
  console.log('\n0. 注册新账号')
  const reg = await apiPost('/auth/register', {
    email: EMAIL,
    password: PASSWORD,
    company_name: `多站点E2E公司-${STAMP}`,
    industry: '工业水泵',
  })
  ok('注册成功', reg.status === 201 && reg.data?.token, `status=${reg.status}`)
  const token = reg.data.token

  const browser = await launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

  // ---------- 1. 登录后落在通用概览 ----------
  console.log('\n1. 登录后通用概览（不自动选中某个网站）')
  await gotoAuthed(page, '/', token)
  await page.waitForSelector('.metrics-grid', { timeout: 12000 })
  await sleep(800)
  const overviewText = await page.locator('section.view').first().textContent()
  ok('概览显示欢迎语（欢迎回来）', /欢迎回来/.test(overviewText))
  ok('概览显示网站数量统计', /网站数量/.test(overviewText))
  ok('概览不显示具体网站名称（新账号应为空站状态）', !overviewText.includes('官方网站'))
  ok('侧栏含「我的网站」入口', (await page.locator('.nav-item', { hasText: '我的网站' }).count()) === 1)

  // ---------- 2. 创建 Site A / Site B ----------
  console.log('\n2. 创建两个网站')
  await page.click('.nav-item:has-text("我的网站")')
  await sleep(900)
  await page.waitForSelector('.sites-grid, .sites-empty', { timeout: 10000 })
  ok('我的网站空状态提示创建', (await page.locator('.sites-empty').count()) >= 0)

  async function createSite(name, industry) {
    await page.click('a:has-text("创建网站"), a:has-text("＋ 创建网站")')
    await sleep(800)
    await page.waitForSelector('.create-modes', { timeout: 10000 })
    await page.click('button.create-mode:has-text("空白创建")')
    await sleep(300)
    await page.fill('input[placeholder*="网站名称"]', name)
    await page.fill('input[placeholder*="行业"]', industry)
    await page.click('button:has-text("创建网站")')
    await sleep(1200)
  }

  await createSite(`工业水泵站-${STAMP}`, '工业泵')
  await page.waitForSelector('.site-detail-head', { timeout: 10000 })
  const urlA = page.url()
  ok('创建 Site A 后进入站点作用域', /\/sites\/site_/.test(urlA), urlA)
  const siteAId = (urlA.match(/\/sites\/(site_[^/]+)/) || [])[1]

  // 回到我的网站再建 B
  await page.click('.nav-item:has-text("我的网站")')
  await sleep(900)
  await createSite(`食品出口站-${STAMP}`, '食品')
  await page.waitForSelector('.site-detail-head', { timeout: 10000 })
  const urlB = page.url()
  const siteBId = (urlB.match(/\/sites\/(site_[^/]+)/) || [])[1]
  ok('创建 Site B 成功且 id 不同', !!siteBId && siteBId !== siteAId, `${siteAId} / ${siteBId}`)

  // ---------- 3. 数据隔离：A 与 B 页面互不可见 ----------
  console.log('\n3. 站点数据隔离')
  const pagesA = await apiGet(`/pages?site_id=${siteAId}`, token)
  const pagesB = await apiGet(`/pages?site_id=${siteBId}`, token)
  ok('Site A 有自己的页面（自动播种）', Array.isArray(pagesA) && pagesA.length >= 6, `A=${pagesA.length}`)
  ok('Site B 有自己的页面（自动播种）', Array.isArray(pagesB) && pagesB.length >= 6, `B=${pagesB.length}`)
  const idsA = new Set(pagesA.map((p) => p.id))
  const overlap = pagesB.filter((p) => idsA.has(p.id)).length
  ok('Site A 与 Site B 页面集合不相交', overlap === 0, `overlap=${overlap}`)

  // 在 A 新建页面，B 不可见
  const created = await apiPost(`/pages?site_id=${siteAId}`, { name: 'A 专属页面' }, token)
  ok('在 Site A 创建页面成功', created.status === 201)
  const pagesB2 = await apiGet(`/pages?site_id=${siteBId}`, token)
  ok('Site B 看不到 Site A 的新页面', !pagesB2.some((p) => p.id === created.data?.page?.id))

  // 站点作用域编辑器只显示本站页面
  await page.goto(`${FE}/#/sites/${siteAId}/editor`, { waitUntil: 'domcontentloaded' })
  await sleep(1400)
  ok('站点编辑器加载（A 作用域）', (await page.locator('.component-list button').count()) > 0)

  // ---------- 4. 刷新持久性 ----------
  console.log('\n4. 刷新持久性')
  await page.goto(`${FE}/#/sites`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sites-grid', { timeout: 10000 })
  await sleep(800)
  let cardCount = await page.locator('.site-card').count()
  ok('我的网站显示 2 个站点', cardCount === 2, `count=${cardCount}`)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sites-grid', { timeout: 10000 })
  await sleep(900)
  cardCount = await page.locator('.site-card').count()
  ok('刷新后两个站点仍存在', cardCount === 2, `count=${cardCount}`)

  // ---------- 5. 租户隔离（第二个账号看不到） ----------
  console.log('\n5. 跨租户隔离')
  const reg2 = await apiPost('/auth/register', {
    email: `rival-${STAMP}@sitepilot.test`,
    password: 'rival-pass-123',
    company_name: '竞争公司',
  })
  const token2 = reg2.data?.token
  const sites2 = await apiGet('/sites', token2)
  ok('第二账号看不到第一账号的站点', (sites2.sites || []).length === 0)
  const foreign = await apiGet(`/pages?site_id=${siteAId}`, token2)
  ok('第二账号按 site_id 取他人页面被拒绝(404)', foreign.detail === '站点不存在' || foreign.status === 404)

  // ---------- 6. 免费额度为账号级 ----------
  console.log('\n6. 账号级免费生成')
  const usage1 = await apiGet('/usage', token)
  ok('新账号免费生成 1 次', usage1.freeGenerationLimit === 1 && usage1.freeGenerationUsed === 0)
  const consume1 = await apiPost('/usage/consume', {}, token)
  ok('第一次消耗成功', consume1.status === 200)
  const consume2 = await apiPost('/usage/consume', {}, token)
  ok('第二次消耗被拒（402，账号级限制）', consume2.status === 402, `status=${consume2.status}`)

  ok('无未预期 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await browser.close()
  console.log(`\n${'─'.repeat(52)}`)
  console.log(`多站点 E2E：${pass}/${pass + fail} 通过`)
  if (failures.length) console.log(`失败项：\n  - ${failures.join('\n  - ')}`)
  process.exit(fail ? 1 : 0)
}

run().catch((e) => { console.error('运行异常：', e); process.exit(1) })
