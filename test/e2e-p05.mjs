/**
 * P0-5 专项 E2E：清除 Demo 假反馈
 *
 * 断言：
 *   A. 用户可见文案中不再出现「（Demo）」「模拟进入」等假反馈字样
 *   B. 付费弹窗「选择套餐」→ 真实写入询盘线索（询盘中心可见 + 刷新后仍在 = 落库）
 *   C. 侧栏用户行显示公司名（不再虚构 Demo Admin）
 */
import { chromium } from 'playwright'
import { loginViaApi, gotoAuthed, apiGet } from './e2e-auth-helper.mjs'

const FE = process.env.FE_URL || 'http://127.0.0.1:5173'
const API = process.env.API_URL || 'http://127.0.0.1:8000'

// 多租户后所有工作台页面都需要登录：E2E 统一注入真实登录 token
let AUTH_TOKEN = null

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
  // 多租户后所有业务 API 都需要凭证：先真实登录一次，页面注入与基准查询共用
  AUTH_TOKEN = await loginViaApi()

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  // ---------- A. 全站扫描假反馈文案 ----------
  console.log('\nA. 用户可见文案：无 Demo 假反馈')
  const routes = ['/', '/products', '/inquiries', '/growth', '/skills', '/agent', '/seo', '/localization']
  const offenders = []
  for (const r of routes) {
    await gotoAuthed(page, `/${r}`)
    await sleep(900)
    const text = await page.locator('body').innerText()
    // 检查可见文本（不含代码注释）；Onboarding 的「演示环境」诚实说明允许
    const m = text.match(/[^\n]*（Demo）[^\n]*|[^\n]*Demo 中[^\n]*|[^\n]*模拟进入[^\n]*|Demo Admin/g)
    if (m) offenders.push(`${r}: ${m.slice(0, 2).join(' / ')}`)
  }
  ok('8 个工作台页面无假反馈文案', offenders.length === 0, offenders.join(' | '))

  // Onboarding 页诚实说明（允许：「当前为演示环境：验证码不做真实短信下发」）
  await gotoAuthed(page, '/onboarding')
  await sleep(900)
  const obText = await page.locator('body').innerText()
  ok('Onboarding 的短信说明是诚实降级描述（非假反馈）', !/（Demo）/.test(obText) && !/Demo Admin/.test(obText))

  // ---------- B. 付费弹窗 → 真实订单落库 ----------
  // 注意：统一付费权限体系落地后，点套餐写的是 **ServiceOrder**，
  // 不再往 inquiries 里塞一条假线索。本节断言随之改为订单口径。
  console.log('\nB. 付费弹窗「选择套餐」写入真实服务订单')

  const fetchOrders = async () => {
    const res = await fetch(`${API}/api/service-orders`, {
      headers: AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {},
    }).then((r) => r.json())
    return Array.isArray(res) ? res : res.orders || []
  }

  await gotoAuthed(page, '/skills')
  await sleep(1200)
  // 触发一个付费墙（点击任意付费能力按钮）
  let opened = false
  const paywallBtn = page.locator('button', { hasText: /开通|充值|升级/ }).first()
  if (await paywallBtn.count()) {
    try {
      await paywallBtn.click({ timeout: 3000 })
      opened = true
    } catch {
      opened = false
    }
  }
  if (!opened) {
    await gotoAuthed(page, '/agent')
    await sleep(800)
  }
  await page.waitForSelector('.paywall-modal', { timeout: 8000 })
  ok('付费弹窗打开', true)

  const beforeOrders = await fetchOrders()
  const beforeCount = beforeOrders.length

  await page.locator('.paywall-plan .primary-btn, .paywall-plan button').first().click()
  await page.waitForSelector('.paywall-modal', { state: 'detached', timeout: 8000 })
  await sleep(1400)

  const afterOrders = await fetchOrders()
  const added = afterOrders.length - beforeCount
  ok(`服务订单 +1（${beforeCount} → ${afterOrders.length}）`, added === 1, `实际 +${added}`)

  // 刷新后订单仍在（真落库，不是前端内存态）
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(1400)
  const afterReload = await fetchOrders()
  ok('刷新后订单数不变（真落库非内存态）', afterReload.length === afterOrders.length, `${afterOrders.length} → ${afterReload.length}`)

  const latest = afterReload[0]
  ok('订单记录了套餐与来源', !!(latest?.plan_id || latest?.feature_key), JSON.stringify(latest || {}).slice(0, 120))

  // 订单在「模板商城 · 我的购买记录」可见
  await gotoAuthed(page, '/templates')
  await page.waitForSelector('.tpl-grid', { timeout: 10000 })
  await sleep(1200)
  const orderRows = await page.locator('.version-table tbody tr').count()
  ok('模板商城页可见购买/订单记录', orderRows > 0, `rows=${orderRows}`)

  // ---------- C. 侧栏用户行 ----------
  console.log('\nC. 侧栏：不再虚构 Demo Admin')
  const userRow = await page.locator('.user-row').innerText()
  ok('用户行显示公司名（AQUAFLOW）', /AQUAFLOW/.test(userRow), userRow.replace(/\n/g, ' '))
  ok('用户行无 Demo Admin', !/Demo Admin/.test(userRow))

  // ---------- 汇总 ----------
  console.log(`\n${'─'.repeat(52)}`)
  ok('运行期无页面错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  console.log(`\n结果：${pass}/${pass + fail} 通过`)
  if (failures.length) console.log(`失败项：\n  - ${failures.join('\n  - ')}`)

  await browser.close()
  process.exit(fail ? 1 : 0)
}

run().catch((e) => {
  console.error('运行异常：', e)
  process.exit(1)
})
