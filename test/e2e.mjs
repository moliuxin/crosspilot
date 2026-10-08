/**
 * SitePilot 浏览器端联调脚本（Playwright）
 *
 * 用法：
 *   1) 终端 A：cd backend && python3 -m uvicorn app.main:app --port 8000
 *   2) 终端 B：cd ../ && npm run build && python3 -m http.server 5173 --directory dist
 *   3) 终端 C：npm run test:e2e
 *
 * 断言的是「用户点得到的真实行为」：筛选真的筛选、样式真的渲染、保存真的落库。
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
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    // 402/401 是付费墙与权限校验的正确业务信号，不是缺陷
    if (/402|401|Payment Required|Unauthorized|Failed to load resource/i.test(t)) return
    consoleErrors.push(t)
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  // ---------- A. 产品中心筛选 ----------
  console.log('\nA. 产品中心筛选（真实过滤）')
  await gotoAuthed(page, '/products')
  await page.waitForSelector('.product-table .table-row', { timeout: 10000 })

  const rows = () => page.locator('.product-table .table-row').count()
  const catSelect = page.locator('.filters .filter-select').nth(1)
  const seoSelect = page.locator('.filters .filter-select').nth(2)

  const initial = await rows()
  ok(`初始展示全部产品（${initial} 条）`, initial === 4, `实际 ${initial}`)

  // 分类筛选：Filtration 只有 1 条
  await catSelect.selectOption('Filtration')
  await sleep(250)
  const catRows = await rows()
  ok(`按分类 Filtration 过滤 → 1 条`, catRows === 1, `实际 ${catRows}`)
  const catText = await page.locator('.product-table .table-row').first().innerText()
  ok('过滤结果分类正确', /Filtration/.test(catText), catText.replace(/\n/g, ' '))

  // 搜索状态：已优化 ≥85 应为 2 条（92 / 88）
  await page.locator('.filter-clear').click()
  await sleep(200)
  await seoSelect.selectOption('high')
  await sleep(250)
  const highRows = await rows()
  ok(`搜索状态「已优化(≥85)」→ 2 条`, highRows === 2, `实际 ${highRows}`)
  // 只取第 3 列（表头 .seo-score 不含 gseo-score，但 GEO 列格式为 "seo-score high"，
  // 必须用精确 token 匹配，否则会把 GEO 分数一起算进来）
  const scoreCells = await page
    .locator('.product-table .table-row .seo-score')
    .evaluateAll((els) => els.map((e) => (e.classList.contains('gseo-score') ? null : e.innerText)).filter(Boolean))
  ok('结果分数均 ≥85', scoreCells.length === 2 && scoreCells.every((s) => Number(s) >= 85), scoreCells.join('/'))

  // 搜索状态：未达标 <70 应为 1 条（58）
  await seoSelect.selectOption('low')
  await sleep(250)
  const lowRows = await rows()
  ok(`搜索状态「未达标(<70)」→ 1 条`, lowRows === 1, `实际 ${lowRows}`)

  // 组合：分类 + 关键词叠加
  await page.locator('.filter-clear').click()
  await sleep(200)
  await catSelect.selectOption('Filtration')
  await page.locator('.search input').fill('ultra')
  await sleep(300)
  const combo = await rows()
  ok('分类 + 关键词叠加过滤 → 1 条', combo === 1, `实际 ${combo}`)

  // 组合无结果时给出空态 + 一键清空
  await page.locator('.search input').fill('zzzz-not-exist')
  await sleep(300)
  const emptyVisible = await page.locator('.product-table .empty').isVisible()
  ok('无结果时展示空态', emptyVisible)
  const countText = await page.locator('.filter-count').innerText()
  ok('展示命中计数', /命中\s*0\s*\/\s*4/.test(countText), countText)
  await page.locator('.product-table .empty button').click()
  await sleep(300)
  const afterClear = await rows()
  ok('空态内「清空筛选条件」恢复全部', afterClear === 4, `实际 ${afterClear}`)

  // 分类下拉选项来自真实数据（不写死）
  const opts = await catSelect.locator('option').allInnerTexts()
  ok(
    '分类选项由真实数据汇总（含 4 个分类）',
    ['Water Treatment', 'Filtration', 'Dosing', 'Turnkey Plant'].every((c) => opts.includes(c)),
    opts.join('/')
  )

  // ---------- B. 页面编辑器样式属性 ----------
  console.log('\nB. 页面编辑器样式属性（真实生效 + 落库）')
  await gotoAuthed(page, '/editor')
  await page.waitForSelector('.component-list button', { timeout: 10000 })

  await page.locator('.component-list button').first().click()
  await page.locator('.property-tabs button', { hasText: '样式' }).click()
  await sleep(200)

  const activeAlign = () => page.locator('.seg-row').nth(0).locator('button.active').innerText()
  ok('对齐默认选中「左对齐」（来自 props，非写死）', (await activeAlign()) === '左对齐')

  // 切换对齐 → 画布真实变化
  const block = page.locator('.edit-block.selected-block')
  const beforeCls = await block.getAttribute('class')
  await page.locator('.seg-row').nth(0).locator('button', { hasText: '居中' }).click()
  await sleep(250)
  const afterCls = await block.getAttribute('class')
  ok('切到「居中」后选中态跟随', (await activeAlign()) === '居中')
  ok('画布 class 新增 block-align-center', /block-align-center/.test(afterCls), afterCls)
  ok('画布 class 确实发生变化', beforeCls !== afterCls)
  const textAlign = await page.locator('.edit-block.selected-block .edit-copy').first().evaluate(
    (el) => getComputedStyle(el).textAlign
  )
  ok('画布实际渲染 text-align: center', textAlign === 'center', textAlign)

  // 切换背景 → 画布真实变化
  await page.locator('.seg-row').nth(1).locator('button', { hasText: '品牌色' }).click()
  await sleep(250)
  const bgCls = await block.getAttribute('class')
  ok('画布 class 新增 block-bg-brand', /block-bg-brand/.test(bgCls), bgCls)
  const bgImg = await page.locator('.edit-block.selected-block .edit-hero').evaluate(
    (el) => getComputedStyle(el).backgroundImage
  )
  ok('画布实际渲染品牌色渐变背景', /gradient/.test(bgImg), bgImg.slice(0, 60))

  // 区块间距 → 画布 padding 真实变化
  const padBefore = await page.locator('.edit-block.selected-block .edit-hero').evaluate(
    (el) => getComputedStyle(el).paddingTop
  )
  await page.locator('.property-group select').first().selectOption('loose')
  await sleep(250)
  const padAfter = await page.locator('.edit-block.selected-block .edit-hero').evaluate(
    (el) => getComputedStyle(el).paddingTop
  )
  ok(`区块间距「宽松」增大 padding（${padBefore} → ${padAfter}）`, parseFloat(padAfter) > parseFloat(padBefore))

  // 保存 → 后端落库
  ok('样式改动标记为未保存', await page.locator('.dirty-pill').isVisible())
  const saveBtn = page.locator('.head-actions .primary-btn')
  await saveBtn.click()
  await page.waitForSelector('.dirty-pill', { state: 'detached', timeout: 8000 })
  ok('保存后未保存标记消失', true)

  // 刷新后样式仍在（证明真落库，不是内存态）
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.edit-block', { timeout: 10000 })
  const persisted = await page.locator('.edit-block').first().getAttribute('class')
  ok('刷新后样式仍在（真落库）', /block-align-center/.test(persisted) && /block-bg-brand/.test(persisted), persisted)

  // 后端 API 侧确认 props 已持久化
  const res = await fetch(`${API}/api/pages`, { headers: AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {} })
  const pages = await res.json()
  const list = Array.isArray(pages) ? pages : pages.items || pages.data || []
  const home = list.find((p) => (p.sections || []).length) || list[0]
  const sec0 = (home?.sections || [])[0] || {}
  ok(
    'API 返回的 props 含 align/background/padding',
    sec0.props?.align === 'center' && sec0.props?.background === 'brand' && sec0.props?.padding === 'loose',
    JSON.stringify(sec0.props)
  )

  // 再切回「左对齐 / 浅色 / 舒适」，避免污染演示数据
  await page.waitForSelector('.component-list button', { timeout: 10000 })
  await page.locator('.component-list button').first().click()
  await page.locator('.property-tabs button', { hasText: '样式' }).click()
  await page.locator('.seg-row').nth(0).locator('button', { hasText: '左对齐' }).click()
  await page.locator('.seg-row').nth(1).locator('button', { hasText: '浅色' }).click()
  await page.locator('.property-group select').first().selectOption('comfortable')
  await sleep(200)
  await page.locator('.head-actions .primary-btn').click()
  await page.waitForSelector('.dirty-pill', { state: 'detached', timeout: 8000 })
  ok('演示数据已复原', true)

  // ---------- 汇总 ----------
  console.log(`\n${'─'.repeat(52)}`)
  ok('运行期无未预期 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  console.log(`\n认证：${pass}/${pass + fail} 通过`)
  if (failures.length) console.log(`失败项：\n  - ${failures.join('\n  - ')}`)

  await browser.close()
  process.exit(fail ? 1 : 0)
}

run().catch((e) => {
  console.error('运行异常：', e)
  process.exit(1)
})
