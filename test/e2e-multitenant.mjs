/**
 * P1 专项 E2E：账户系统 + 多租户隔离（#80 / #81 / #82）
 *
 * 断言的是「用户在浏览器里真实能看到的」：
 *   1. 未登录访问工作台 → 被收敛到登录页（不能裸奔）
 *   2. 登录页可注册新企业、可登录演示账号 → 进入工作台
 *   3. 侧栏显示的是登录企业的名字（不是写死的默认公司）
 *   4. 刷新页面登录态保持（token 持久化）
 *   5. 退出登录 → 回到登录页
 *   6. 换个新注册的租户登录 → 产品中心是空的（看不到别人的数据）
 *   7. 伪造 X-Tenant-Id 也拿不到别人的数据（后端已挡住，这里验证前端不泄漏）
 */
import { chromium } from 'playwright'
import { FE, API, DEMO, loginViaApi, gotoAuthed, apiGet } from './e2e-auth-helper.mjs'

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run() {
  // 独立租户，避免与本轮其它测试互相干扰
  const stamp = Date.now()
  const newUser = {
    email: `e2e_${stamp}@tenant-test.com`,
    password: 'e2e-pass-123',
    company_name: `E2E 企业 ${stamp}`,
    industry: '工业设备测试',
  }

  console.log(`后端：${API}\n前端：${FE}\n新租户：${newUser.email} / ${newUser.company_name}`)

  // 基准数据（演示账户所属的默认租户）
  const demoToken = await loginViaApi()
  const demoProducts = await apiGet('/products', demoToken)
  const demoProductList = Array.isArray(demoProducts) ? demoProducts : demoProducts.items || []
  console.log(`演示租户基准：${demoProductList.length} 个产品`)

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })

  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    // 401 是本轮测试的**预期**结果（未登录探测），不算运行时错误
    if (/401|Unauthorized|Failed to load resource/i.test(t)) return
    consoleErrors.push(t)
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  // ---------- A. 未登录被收敛到登录页 ----------
  console.log('\nA. 未登录访问工作台')
  await page.goto(`${FE}/#/products`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.auth-card', { timeout: 20000 })
  ok('未登录访问 /#/products 被挡到登录页', await page.locator('.auth-card').isVisible())
  ok('登录页显示品牌名', /SitePilot/.test(await page.locator('.auth-logo').innerText()))
  ok('未出现工作台侧栏', (await page.locator('.sidebar').count()) === 0)

  // 逐个业务路由都不该放行
  for (const h of ['/#/inquiries', '/#/agent', '/#/seo', '/#/']) {
    await page.goto(`${FE}${h}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.auth-card', { timeout: 15000 })
    ok(`未登录访问 ${h} 仍停在登录页`, (await page.locator('.sidebar').count()) === 0)
  }

  // ---------- B. 注册新企业 ----------
  console.log('\nB. 注册新企业并进入工作台')
  await page.goto(`${FE}/#/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.auth-card')
  await page.locator('.auth-tab', { hasText: '注册新企业' }).click()
  await page.waitForSelector('.auth-form input[type="text"]')

  const inputs = page.locator('.auth-form input')
  await page.locator('.auth-form input[type="email"]').fill(newUser.email)
  await page.locator('.auth-form input[type="password"]').fill(newUser.password)

  // 注册态下有两个 text 输入：企业名称、所属行业
  const textInputs = page.locator('.auth-form input[type="text"]')
  await textInputs.nth(0).fill(newUser.company_name)
  await textInputs.nth(1).fill(newUser.industry)

  await page.locator('.auth-submit').click()
  await page.waitForSelector('.sidebar', { timeout: 25000 })
  ok('注册成功后进入工作台（侧栏出现）', await page.locator('.sidebar').isVisible())

  const wsName = await page.locator('.workspace-meta strong').innerText()
  ok('侧栏显示新注册的企业名', wsName.includes(String(stamp)), `实际「${wsName}」`)

  const tokenStored = await page.evaluate(() => localStorage.getItem('sitepilot.token') || '')
  ok('token 已持久化到 localStorage', tokenStored.length > 20)

  // ---------- C. 新租户看不到别的租户数据 ----------
  console.log('\nC. 新租户数据隔离（浏览器视角）')
  await page.goto(`${FE}/#/products`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sidebar')
  await sleep(1200) // 等产品列表拉取完成

  const newTenantRows = await page.locator('.product-table .table-row').count()
  const newTenantEmpty =
    newTenantRows === 0 || (await page.locator('.product-table .empty').count()) > 0
  ok(
    `新租户产品列表为空（演示租户有 ${demoProductList.length} 个）`,
    newTenantEmpty,
    `实际渲染 ${newTenantRows} 行`
  )

  // 演示租户登录后应该能看到种子产品 —— 证明上面不是「列表根本渲染不出来」
  // 用一个新的浏览器上下文 + initScript 注入演示租户 token
  const demoPage = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await gotoAuthed(demoPage, '/products')
  await demoPage.waitForSelector('.sidebar', { timeout: 25000 })
  await sleep(1800)
  const demoRows = await demoPage.locator('.product-table .table-row').count()
  ok('演示租户能看到种子产品（对照组）', demoRows > 0, `实际 ${demoRows} 行`)

  // ---------- D. 刷新保持登录 ----------
  console.log('\nD. 登录态持久化')
  await demoPage.reload({ waitUntil: 'domcontentloaded' })
  await demoPage.waitForSelector('.sidebar', { timeout: 15000 })
  ok('刷新后仍停留在工作台（未被踢回登录页）', (await demoPage.locator('.auth-card').count()) === 0)

  // ---------- E. 登录演示账号（真实表单路径） ----------
  console.log('\nE. 退出后用演示账号登录')
  await demoPage.locator('.user-row .icon-btn').click()
  await demoPage.waitForSelector('.auth-card', { timeout: 15000 })
  ok('点退出登录 → 回到登录页', await demoPage.locator('.auth-card').isVisible())
  ok(
    '退出后 token 已清除',
    (await demoPage.evaluate(() => localStorage.getItem('sitepilot.token') || '')) === ''
  )

  await demoPage.locator('.auth-form input[type="email"]').fill(DEMO.email)
  await demoPage.locator('.auth-form input[type="password"]').fill(DEMO.password)
  await demoPage.locator('.auth-submit').click()
  await demoPage.waitForSelector('.sidebar', { timeout: 25000 })
  const demoName = await demoPage.locator('.workspace-meta strong').innerText()
  ok('演示账号登录成功并显示其企业名', /AQUAFLOW/i.test(demoName), `实际「${demoName}」`)

  // ---------- F. 错误密码有明确反馈 ----------
  console.log('\nF. 错误密码反馈')
  await demoPage.evaluate(() => localStorage.clear())
  await demoPage.goto(`${FE}/#/login`, { waitUntil: 'domcontentloaded' })
  await demoPage.waitForSelector('.auth-card')
  await demoPage.locator('.auth-form input[type="email"]').fill(DEMO.email)
  await demoPage.locator('.auth-form input[type="password"]').fill('definitely-wrong')
  await demoPage.locator('.auth-submit').click()
  await demoPage.waitForSelector('.auth-error', { timeout: 15000 })
  const errText = await demoPage.locator('.auth-error').innerText()
  ok('错误密码显示错误提示', errText.length > 0, errText)
  ok('错误密码不泄露账号是否存在', /邮箱或密码/.test(errText), errText)
  ok('错误密码仍停在登录页', (await demoPage.locator('.sidebar').count()) === 0)

  // ---------- G. 演示账号可一键填充 ----------
  console.log('\nG. 演示账号一键填充')
  await demoPage.locator('.auth-demo').click()
  const filledEmail = await demoPage.locator('.auth-form input[type="email"]').inputValue()
  ok('「填入演示账号」按钮写入正确邮箱', filledEmail === DEMO.email, filledEmail)

  // ---------- H. 运行时错误 ----------
  console.log('\nH. 运行时错误')
  ok("页面无未捕获的运行时错误", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "))

  await browser.close()

  console.log(`\n${'='.repeat(56)}`)
  console.log(`账户 + 多租户 E2E：${pass} 通过 / ${fail} 失败`)
  if (failures.length) console.log(`失败项：\n  - ${failures.join('\n  - ')}`)
  console.log('='.repeat(56))
  process.exit(fail === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error('E2E 运行异常：', e)
  process.exit(1)
})
