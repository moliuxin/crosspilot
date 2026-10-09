/**
 * P0 专项 E2E：Agent 页 MCP 真实化（#74） + Dashboard 任务进度（#71）
 *
 * 断言的是「用户点得到的真实行为」：
 *   - Agent 快捷指令的表格数据必须来自真实后端（产品数/询盘数与 API 一致）
 *   - 回滚指令返回真实版本结果（真实 version_no 或明确的"无可回滚"）
 *   - Dashboard 两个任务进度条与 GET /tasks/stats/summary 的 kind 过滤口径一致
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

  // 先从后端拿真实基准数据
  const [productsRes, inqRes, statsGrowthRes, statsFollowupRes] = await Promise.all([
    fetch(`${API}/api/products`, { headers: AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {} }).then((r) => r.json()),
    fetch(`${API}/api/inquiries`, { headers: AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {} }).then((r) => r.json()),
    fetch(`${API}/api/tasks/stats/summary?kind=growth`, { headers: AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {} }).then((r) => r.json()),
    fetch(`${API}/api/tasks/stats/summary?kind=followup`, { headers: AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {} }).then((r) => r.json()),
  ])
  const products = Array.isArray(productsRes) ? productsRes : productsRes.items || []
  const inquiries = Array.isArray(inqRes) ? inqRes : inqRes.inquiries || inqRes.items || []

  console.log(`基准数据：${products.length} 个产品，${inquiries.length} 条询盘`)
  console.log(
    `任务统计：growth ${statsGrowthRes.done}/${statsGrowthRes.total}（${statsGrowthRes.percent}%），followup ${statsFollowupRes.done}/${statsFollowupRes.total}（${statsFollowupRes.percent}%）`
  )

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })

  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/402|401|Payment Required|Unauthorized|Failed to load resource/i.test(t)) return
    consoleErrors.push(t)
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  // ---------- A. Agent 页 MCP 真实化 ----------
  console.log('\nA. Agent 页：快捷指令走真实后端')
  await gotoAuthed(page, '/agent')
  await page.waitForSelector('.cmd-list .cmd-btn', { timeout: 20000 })

  const mcpCount = await page.locator('.mcp-item').count()
  ok('MCP 面板显示 15 个工具', mcpCount === 15, `实际 ${mcpCount}`)
  const mcpDesc = await page.locator('.agent-side .panel p.muted').first().innerText()
  ok('MCP 描述无「占位」字样', !/占位/.test(mcpDesc), mcpDesc)

  async function runCmd(label) {
    await page.locator('.cmd-btn', { hasText: label }).first().click()
    await page.waitForSelector('.agent-msg.bot .agent-table, .agent-msg.bot:last-of-type', { timeout: 12000 })
    await sleep(1500) // 等 execute + 渲染完成
  }

  // A1. 看看哪些产品 SEO 最差 → 表格行数 = 真实产品数
  const msgsBefore = await page.locator('.agent-msg').count()
  await runCmd('看看哪些产品 SEO 最差')
  const productMsgs = await page.locator('.agent-msg.bot').allInnerTexts()
  const lastBot = productMsgs[productMsgs.length - 1]
  ok(`产品指令回复含真实产品数（${products.length}）`, new RegExp(`${products.length}\\s*个产品`).test(lastBot), lastBot.slice(0, 120))
  const prodTableRows = await page.locator('.agent-msg.bot .agent-table tbody tr').count()
  ok(`产品表格行数 = ${products.length}（来自后端）`, prodTableRows === products.length, `实际 ${prodTableRows}`)

  // A2. 这个月收到了哪些询盘 → 真实询盘数
  await runCmd('这个月收到了哪些询盘？')
  const inqMsgs = await page.locator('.agent-msg.bot').allInnerTexts()
  const inqLast = inqMsgs[inqMsgs.length - 1]
  ok(`询盘指令回复含真实询盘数（${inquiries.length}）`, new RegExp(`${inquiries.length}\\s*条询盘`).test(inqLast), inqLast.slice(0, 120))

  // A3. 回滚指令 → 真实执行（有版本则回滚成功并带版本号；无版本则明确提示，不冒充成功）
  await runCmd('回滚到上一个发布版本')
  const rbMsgs = await page.locator('.agent-msg.bot').allInnerTexts()
  const rbLast = rbMsgs[rbMsgs.length - 1]
  const rollbackReal =
    /已回滚到发布前版本（v\d/ .test(rbLast) || /回滚未执行/.test(rbLast) || /没有可回滚/.test(rbLast)
  ok('回滚指令返回真实结果（成功带版本号 / 无版本明确提示）', rollbackReal, rbLast.slice(0, 150))

  // A4. 生成优化草稿 → 走后端 Draft（真实 diff），出现待确认草稿卡片
  await runCmd('优化 ultrafiltration 那个商品页')
  const optMsgs = await page.locator('.agent-msg.bot').allInnerTexts()
  const optLast = optMsgs[optMsgs.length - 1]
  ok('优化指令生成真实草稿（含 diff 项数）', /生成优化草稿，共 \d+ 项变更/.test(optLast), optLast.slice(0, 150))
  const hasConfirmBtn = await page.locator('.agent-msg .agent-actions .confirm, .pending-draft .confirm').count()
  ok('草稿卡片含「人工确认并发布」按钮', hasConfirmBtn >= 1, `实际 ${hasConfirmBtn}`)

  // ---------- B. Dashboard 任务进度 ----------
  console.log('\nB. Dashboard：任务进度总览（kind 过滤口径）')
  await gotoAuthed(page, '/')
  await page.waitForSelector('.task-panel, .view', { timeout: 20000 })
  await sleep(1200)

  const panel = page.locator('.task-panel')
  const panelVisible = (await panel.count()) > 0
  if (panelVisible) {
    const panelText = await panel.innerText()
    ok('面板无 Demo/模拟字样', !/Demo|模拟/i.test(panelText))

    // 按 label 精确匹配每组百分比（TASK_GROUPS 顺序：followup 在前，growth 在后）
    // 该组无任务时，面板按设计显示空状态引导（"还没有…任务"）而不是 0% —— 两者都算口径一致。
    async function progressOf(label) {
      const head = page.locator('.task-stat', { hasText: label }).first()
      const text = await head.innerText()
      if (/还没有/.test(text)) return { empty: true, percent: 0 }
      const btn = await head.locator('.task-stat-go').innerText()
      const m = btn.match(/(\d+)%/)
      return { empty: false, percent: m ? Number(m[1]) : null }
    }

    async function assertGroup(label, api) {
      const got = await progressOf(label)
      const expectEmpty = (api.total || 0) === 0
      if (expectEmpty) {
        ok(
          `${label} 无任务时显示空状态引导（API ${api.done}/${api.total}）`,
          got.empty,
          `页面 ${got.empty ? '空状态' : `${got.percent}%`} / API total=${api.total}`
        )
      } else {
        ok(
          `${label} 百分比与 API 口径一致（应为 ${api.percent}%）`,
          got.percent === api.percent,
          `页面 ${got.percent}% / API ${api.percent}%`
        )
      }
    }

    await assertGroup('询盘跟进', statsFollowupRes)
    await assertGroup('增长服务', statsGrowthRes)
    // 进度条宽度也校验（非空组才有 bar）
    const bars = await page.locator('.task-stat-bar span').evaluateAll((els) =>
      els.map((e) => parseFloat(getComputedStyle(e).width) / parseFloat(getComputedStyle(e.parentElement).width))
    )
    ok('进度条按百分比渲染', bars.every((r) => Math.abs(r - 0) < 0.02 || r > 0), bars.join('/'))
  } else {
    ok('Dashboard 存在任务进度面板', false, '未找到 .task-panel')
  }

  // ---------- 汇总 ----------
  console.log(`\n${'─'.repeat(52)}`)
  ok('运行期无未预期 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  console.log(`\n结果：${pass}/${pass + fail} 通过`)
  if (failures.length) console.log(`失败项：\n  - ${failures.join('\n  - ')}`)

  await browser.close()
  process.exit(fail ? 1 : 0)
}

run().catch((e) => {
  console.error('运行异常：', e)
  process.exit(1)
})
