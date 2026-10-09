/**
 * 版本历史 E2E（Playwright）
 *
 * 验证链路：
 *   真实产生一次内容变更（发布/编辑） → 后端落一条 Version →
 *   「版本历史」页面能列出该版本 → 打开详情看到 before/after 对比 →
 *   执行回滚 → 后端真实写回旧内容（GET 该实体可见变化）→ 刷新后页面仍显示回滚记录。
 *
 * 这是「toast 假回滚」的回归用例：如果回滚只是弹个提示，本用例会在
 * 「回滚后实体内容确实变了」这一步失败。
 */
import { chromium } from 'playwright'
import { loginViaApi, gotoAuthed, apiGet, API } from './e2e-auth-helper.mjs'

const FE = process.env.FE_URL || 'http://127.0.0.1:5173'

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

/** 带 token 的请求（默认 POST，可指定 method）。 */
async function apiPost(path, body, token = AUTH_TOKEN, method = 'POST') {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  })
  let data = null
  try { data = await res.json() } catch { /* ignore */ }
  return { status: res.status, data }
}

async function run() {
  AUTH_TOKEN = await loginViaApi()

  // ---------- 0. 准备：确保有一个产品可用于产生版本 ----------
  console.log('\n0. 准备测试数据')
  const productsBefore = await apiGet('/products', AUTH_TOKEN)
  const list = Array.isArray(productsBefore) ? productsBefore : productsBefore?.products || []
  ok('已登录且能读取产品列表', Array.isArray(list), `count=${list?.length}`)
  if (!list.length) {
    console.log('  ⚠ 无产品可测，跳过版本用例')
    await finish()
    return
  }

  // 演示账户默认可能是免费版，而「页面编辑」是付费能力。
  // 这里不绕过门禁 —— 走真实的 ServiceOrder 下单 + 审批链路升级套餐，
  // 既让用例自给自足，又顺带回归了统一付费权限体系。
  const ent = await apiGet('/entitlements', AUTH_TOKEN)
  if (ent?.plan === 'free') {
    const order = await apiPost('/service-orders', {
      plan_id: 'growth',
      feature_key: 'page.publish',
      note: 'E2E 版本历史用例：升级以解锁页面编辑',
    })
    const oid = order.data?.id || order.data?.order?.id
    if (oid) {
      const appr = await apiPost(`/service-orders/${oid}/approve`, {})
      ok('通过真实服务订单升级套餐', appr.status === 200, JSON.stringify(appr.data).slice(0, 120))
    } else {
      ok('创建服务订单', false, JSON.stringify(order.data).slice(0, 120))
    }
    const ent2 = await apiGet('/entitlements', AUTH_TOKEN)
    ok('套餐已生效（非 free）', ent2?.plan && ent2.plan !== 'free', `plan=${ent2?.plan}`)
  } else {
    ok('套餐已具备页面编辑能力', ent?.plan !== 'free', `plan=${ent?.plan}`)
  }

  const browser = await chromium.launch(
    chromePath
      ? { executablePath: chromePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
      : { args: ['--no-sandbox'] }
  )
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

  await gotoAuthed(page, '/versions', AUTH_TOKEN)

  // ---------- 1. 版本历史页面可达且渲染 ----------
  console.log('\n1. 版本历史页面')
  await page.waitForSelector('.page-head h1', { timeout: 12000 })
  const title = await page.locator('.page-head h1').textContent()
  ok('页面标题为「版本历史」', /版本历史/.test(title || ''), title)
  ok('侧边栏存在「版本历史」入口', (await page.locator('.nav-item', { hasText: '版本历史' }).count()) > 0)

  // 等待列表加载完成（loading 结束后 .data-table 或空态文案出现）
  await sleep(1200)
  const hasTable = await page.locator('.version-table').count()
  const hasEmpty = await page.locator('text=暂无版本记录').count()
  ok('列表加载完成（表格或空态）', hasTable > 0 || hasEmpty > 0, `table=${hasTable} empty=${hasEmpty}`)

  // ---------- 2. 通过 API 产生一次真实版本（页面编辑 → action=edit） ----------
  console.log('\n2. 真实产生版本记录')
  const pagesResp = await apiGet('/pages', AUTH_TOKEN)
  const pages = Array.isArray(pagesResp) ? pagesResp : pagesResp?.pages || []
  ok('可读取页面列表', pages.length > 0, `count=${pages.length}`)

  let versionProduced = false
  if (pages.length) {
    const target = pages[0]
    const origName = target.name
    // 改标题 → 触发 action=edit 版本
    const upd = await apiPost(`/pages/${target.id}`, { name: `${origName} · 版本测试` }, AUTH_TOKEN, 'PUT')
    ok('页面编辑请求成功', upd.status === 200, `status=${upd.status}`)

    await sleep(400)
    const recent = await apiGet('/versions/recent?limit=50', AUTH_TOKEN)
    const rows = Array.isArray(recent) ? recent : []
    const editVer = rows.find((v) => v.entity_type === 'page' && v.entity_id === target.id && v.action === 'edit')
    ok('后端产生了 action=edit 的版本记录', !!editVer, `actions=${rows.slice(0, 6).map((r) => r.action).join(',')}`)
    versionProduced = !!editVer

    // 还原名称，避免污染演示数据
    await apiPost(`/pages/${target.id}`, { name: origName }, AUTH_TOKEN, 'PUT')
  }

  // ---------- 3. 页面刷新后能看到新版本 ----------
  console.log('\n3. 前端展示新版本')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.page-head h1', { timeout: 10000 })
  await sleep(1200)

  const rowCount = await page.locator('.version-table tbody tr').count()
  ok('列表中至少有一条版本记录', rowCount > 0, `rows=${rowCount}`)
  ok('存在「页面编辑」动作标签', (await page.locator('.ver-tag', { hasText: '页面编辑' }).count()) > 0)

  // ---------- 4. 打开详情 → before/after 对比 ----------
  console.log('\n4. 版本详情对比')
  await page.locator('.version-table tbody tr').first().locator('button', { hasText: '查看对比' }).click()
  await page.waitForSelector('.vdrawer', { timeout: 8000 })
  ok('详情抽屉已打开', (await page.locator('.vdrawer').count()) > 0)
  await sleep(800)
  const diffRows = await page.locator('.diff-table tbody tr').count()
  ok('抽屉内渲染出字段对比行', diffRows > 0, `rows=${diffRows}`)
  ok('存在 before 列内容', (await page.locator('.diff-before').count()) > 0)
  ok('存在 after 列内容', (await page.locator('.diff-after').count()) > 0)
  await page.locator('.vdrawer .icon-btn').click()
  await sleep(300)

  // ---------- 5. 真回滚：改内容 → 发布产版本 → 回滚 → 内容真的变回去 ----------
  console.log('\n5. 真回滚（内容真实写回）')
  let rollbackVerified = false
  if (versionProduced && pages.length) {
    const target = pages[0]
    const baseName = origNameOr(target)

    // 5.1 改成 A（该次编辑的 before 快照 = baseName）
    const nameA = `阶段A · ${Date.now()}`
    const rA = await apiPost(`/pages/${target.id}`, { name: nameA }, AUTH_TOKEN, 'PUT')
    ok('第 1 次编辑成功', rA.status === 200, `status=${rA.status}`)
    await sleep(400)

    // 5.2 改成 B（该次编辑的 before 快照 = nameA）—— 回滚它应回到 nameA
    const nameB = `阶段B · ${Date.now()}`
    const rB = await apiPost(`/pages/${target.id}`, { name: nameB }, AUTH_TOKEN, 'PUT')
    ok('第 2 次编辑成功', rB.status === 200, `status=${rB.status}`)
    await sleep(400)

    // 5.3 该页面最新一条 edit 版本，其 before 快照应为 nameA
    const recent = await apiGet('/versions/recent?limit=50', AUTH_TOKEN)
    const rows = Array.isArray(recent) ? recent : []
    const editVers = rows.filter((v) => v.entity_type === 'page' && v.entity_id === target.id && v.action === 'edit')
    const verToRollback = editVers[0]
    ok('找到可用于回滚的版本', !!verToRollback, verToRollback ? `v${verToRollback.version_no}` : 'none')

    if (verToRollback) {
      // 5.3.1 详情接口必须返回真实快照（不是空对象）
      const full = await apiGet(`/versions/${verToRollback.id}`, AUTH_TOKEN)
      const beforeName = full?.before_snapshot?.name
      ok('版本详情返回真实 before 快照', beforeName === nameA, `before.name="${beforeName}" 期望="${nameA}"`)
      ok('版本详情返回真实 after 快照', full?.after_snapshot?.name === nameB, `after.name="${full?.after_snapshot?.name}"`)

      // 5.4 执行回滚
      const rb = await apiPost('/versions/rollback', {
        entity_type: 'page',
        entity_id: target.id,
        version_id: verToRollback.id,
      })
      ok('回滚接口返回成功', rb.status === 200 && rb.data?.rolled_back === true, JSON.stringify(rb.data).slice(0, 160))

      // 5.5 关键断言：实体内容真的被写回旧值（B → A）
      await sleep(400)
      const afterPages = await apiGet('/pages', AUTH_TOKEN)
      const afterList = Array.isArray(afterPages) ? afterPages : afterPages?.pages || []
      const after = afterList.find((p) => p.id === target.id)
      ok('回滚后页面内容真实写回为 A', after?.name === nameA, `now="${after?.name}" 期望="${nameA}"`)
      ok('回滚后内容确实不再是 B（证明非假回滚）', after?.name !== nameB, `now="${after?.name}"`)

      // 5.6 回滚本身也留痕
      const afterVer = await apiGet('/versions/recent?limit=20', AUTH_TOKEN)
      const rv = (Array.isArray(afterVer) ? afterVer : []).find((v) => v.action === 'rollback')
      ok('回滚产生了 rollback 版本记录', !!rv, `actions=${(Array.isArray(afterVer) ? afterVer : []).slice(0, 6).map((v) => v.action).join(',')}`)

      // 5.7 还原原始名称
      await apiPost(`/pages/${target.id}`, { name: baseName }, AUTH_TOKEN, 'PUT')
      rollbackVerified = true
    }
  } else {
    console.log('  ⚠ 跳过回滚验证（无可用页面）')
  }

  // ---------- 6. 前端触发回滚（二次确认 → 真执行） ----------
  console.log('\n6. 前端回滚交互')

  // 6.0 契约：每条真实版本都必须带 before/after 快照。
  // 没有快照的版本无法回滚，后端应以 409 拒绝而不是假装成功。
  const allVers = await apiGet('/versions/recent?limit=100', AUTH_TOKEN)
  const rowsAll = Array.isArray(allVers) ? allVers : []
  let allHaveSnapshot = rowsAll.length > 0
  for (const r of rowsAll.slice(0, 15)) {
    const full = await apiGet(`/versions/${r.id}`, AUTH_TOKEN)
    const bk = Object.keys(full?.before_snapshot || {}).length
    const ak = Object.keys(full?.after_snapshot || {}).length
    if (bk === 0 || ak === 0) { allHaveSnapshot = false; break }
  }
  ok('所有版本都持久化了 before/after 快照', allHaveSnapshot, `checked=${Math.min(rowsAll.length, 15)}`)

  // 6.1 用不存在的 version_id 请求回滚 → 必须 404（不能静默成功）
  const badRb = await apiPost('/versions/rollback', {
    entity_type: 'page',
    entity_id: 'page_does_not_exist',
    version_id: 'ver_does_not_exist',
  })
  ok('回滚不存在的版本返回 404（非假成功）', badRb.status === 404, `status=${badRb.status}`)

  // 6.2 用「版本与实体不匹配」的组合请求 → 必须 409
  if (rowsAll.length) {
    const mismatch = await apiPost('/versions/rollback', {
      entity_type: 'product',
      entity_id: 'prod_mismatch',
      version_id: rowsAll[0].id,
    })
    ok('版本与实体不匹配返回 409（防止错回滚）', mismatch.status === 409, `status=${mismatch.status}`)
  }

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.page-head h1', { timeout: 10000 })
  await sleep(1400)

  // 6.3 前端：有快照的「页面编辑」版本 → 二次确认框 → 取消
  const editRow = page.locator('.version-table tbody tr', { has: page.locator('.ver-tag', { hasText: '页面编辑' }) }).first()
  if (await editRow.count()) {
    await editRow.locator('button', { hasText: '回滚到此版本' }).click()
    await sleep(1200)
    const dialogOpen = (await page.locator('.confirm-dialog').count()) > 0
    ok('有快照的版本弹出二次确认框', dialogOpen, `dialog=${dialogOpen}`)
    if (dialogOpen) {
      const txt = await page.locator('.confirm-dialog').textContent()
      ok('确认框说明回滚会真实写库', /真实写入数据库/.test(txt || ''), (txt || '').slice(0, 60))
      await page.locator('.confirm-dialog .ghost-btn').click() // 取消，避免误改演示数据
      await sleep(400)
      ok('取消后确认框关闭', (await page.locator('.confirm-dialog').count()) === 0)
    }
  } else {
    ok('列表中存在「页面编辑」版本行', false, 'no edit row')
  }

  // ---------- 7. 筛选交互 ----------
  console.log('\n7. 筛选')
  const selects = page.locator('.filter-row select')
  ok('存在动作/对象筛选器', (await selects.count()) === 2, `count=${await selects.count()}`)
  await selects.nth(0).selectOption('rollback')
  await sleep(500)
  const filteredRows = await page.locator('.version-table tbody tr').count()
  const tags = await page.locator('.version-table .ver-tag').allTextContents()
  const allRollback = tags.length === 0 || tags.every((t) => t.includes('回滚'))
  ok('按「版本回滚」筛选后结果一致', allRollback, `rows=${filteredRows} tags=${tags.slice(0, 4).join(',')}`)

  ok('无未预期 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

  await finish(browser)
}

function origNameOr(p) {
  return (p.name || '').replace(' · 版本测试', '')
}

async function finish(browser) {
  if (browser) await browser.close()
  console.log(`\n${'─'.repeat(52)}`)
  console.log(`版本历史：${pass}/${pass + fail} 通过`)
  if (failures.length) console.log(`失败项：\n  - ${failures.join('\n  - ')}`)
  process.exit(fail ? 1 : 0)
}

run().catch((e) => { console.error('运行异常：', e); process.exit(1) })
