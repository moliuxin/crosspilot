/**
 * 「购买冲动」专项 E2E：门户叙事（#77）+ WhatsApp（#78）+ 证言（#79）+ AI 徽章（#75 前端侧）
 *
 * 断言的是「老王（外贸工厂老板）第一眼能看到什么」：
 *   - Onboarding 首屏：结果导向标题 + 价格锚定 + 三步流程
 *   - 证言区块：3 条示例商家证言，且明确标注示例数据（不冒充真实客户）
 *   - 独立站前台：WhatsApp 浮动按钮真实 wa.me 跳转 + 预填文案
 *   - 工作台顶栏：AI Provider 徽章显示 real 模型
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

  // ---------- A. Onboarding 首屏叙事（老王第一眼） ----------
  console.log('\nA. Onboarding 首屏：结果导向叙事 + 价格锚定')
  await gotoAuthed(page, '/onboarding')
  await page.waitForSelector('.onboard-card h1', { timeout: 20000 })

  const h1 = await page.locator('.onboard-card h1').innerText()
  ok('标题是结果导向（带来询盘的英文独立站）', /30 分钟拥有带来询盘的英文独立站/.test(h1), h1)

  const lead = await page.locator('.onboard-card > p').innerText()
  ok('价格锚定：出现传统建站公司 ¥50,000 对照', /¥50,000/.test(lead) && /免费/.test(lead), lead.slice(0, 100))
  ok('强调「现场生成不是套模板」', /现场生成/.test(lead) && /不是套模板/.test(lead))

  const steps = await page.locator('.onboard-steps li').count()
  ok('三步流程可视化（3 步）', steps === 3, `实际 ${steps}`)

  // ---------- B. 证言区块 ----------
  console.log('\nB. 证言区块：示例商家证言')
  const ot = page.locator('.onboard-testimonials')
  ok('证言区块存在', (await ot.count()) > 0)
  const quotes = await ot.locator('blockquote').count()
  ok('3 条证言', quotes === 3, `实际 ${quotes}`)
  const otText = await ot.innerText()
  ok('标注「示例客户场景 · 演示数据」（不冒充真实客户）', /示例客户场景/.test(otText) && /演示数据/.test(otText))
  ok('证言含效果数字（询盘量/SEO 分数）', /月询盘 6 → 20\+/.test(otText) && /SEO 58 → 83/.test(otText))
  ok('证言覆盖多行业多地区', /五金工具.*宁波|工业泵阀.*温州|水处理设备.*佛山/.test(otText.replace(/\n/g, ' ')))

  // ---------- C. 独立站前台 WhatsApp ----------
  console.log('\nC. 独立站前台：WhatsApp 一键联系')
  await page.goto(`${FE}/site-preview.html#/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.site-page', { timeout: 20000 })
  await sleep(1200)

  const wa = page.locator('.wa-float')
  ok('WhatsApp 浮动按钮存在', (await wa.count()) === 1)
  const href = await wa.getAttribute('href')
  ok('真实 wa.me 跳转链接（含号码）', /^https:\/\/wa\.me\/\d+/.test(href || ''), href)
  ok('新标签页打开（target=_blank）', (await wa.getAttribute('target')) === '_blank')
  const decoded = decodeURIComponent(href || '')
  ok('预填询盘文案（英文市场）', /Hello.*interested/i.test(decoded), decoded.slice(0, 80))
  const title = await wa.getAttribute('title')
  ok('号码可见于 tooltip（不是假按钮）', /\+\d[\d\s]+/.test(title || ''), title)

  // 切俄语市场 → 预填文案跟随市场
  await page.selectOption('.market-switch', 'ru-RU')
  await sleep(400)
  const hrefRu = await page.locator('.wa-float').getAttribute('href')
  ok('切俄语市场后预填文案跟随', /Здравствуйте/i.test(decodeURIComponent(hrefRu || '')))

  // ---------- D. 工作台 AI Provider 徽章（#75 前端侧） ----------
  console.log('\nD. 工作台顶栏：AI Provider 徽章')
  await gotoAuthed(page, '/')
  await page.waitForSelector('.top-actions .data-mode', { timeout: 20000 })
  await sleep(1500) // 等 detectBackend → /api/health → aiStatus

  const badges = await page.locator('.top-actions .data-mode').allInnerTexts()
  const aiBadge = badges.find((b) => /AI:/.test(b))
  ok('顶栏存在 AI 徽章', !!aiBadge, badges.join(' | '))
  ok('徽章显示 real + 模型名（fake-llm-test）', /AI: real · fake-llm-test/.test(aiBadge || ''), aiBadge)

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
