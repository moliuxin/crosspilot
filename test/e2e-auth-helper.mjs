/**
 * E2E 公共辅助：多租户改造后，所有工作台页面都需要登录。
 *
 * 历史 E2E 用例的意图是「验证业务行为」，不是「验证登录」，
 * 所以统一在 navigation 之前把 token 注入 localStorage 直接进工作台。
 *
 * 注入前会先用 API 真实登录一次拿 token —— 不是伪造 JWT，
 * 走的是和用户一样的 /api/auth/login 路径。
 */
export const FE = process.env.FE_URL || 'http://127.0.0.1:5173'
export const API = process.env.API_URL || 'http://127.0.0.1:8000'

export const DEMO = { email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }

const TOKEN_KEY = 'sitepilot.token'

/** 调用后端登录接口拿真实 token。 */
export async function loginViaApi(creds = DEMO) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  })
  if (!res.ok) {
    throw new Error(`登录失败 ${res.status}：${await res.text()}`)
  }
  const body = await res.json()
  return body.token
}

/**
 * 让页面以已登录状态进入。
 *
 * 必须用 addInitScript 而不是 goto 后再 evaluate 写 token：
 * React 应用在首次挂载时就会读 localStorage 判定登录态，
 * 页面脚本之后再写已经太晚（会被判成 anon 并踢回登录页）。
 * addInitScript 保证 token 在任何页面脚本执行**之前**就已就位。
 */
export async function gotoAuthed(page, hash = '/', token = null) {
  const tok = token || (await loginViaApi())
  await page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        /* ignore */
      }
    },
    [TOKEN_KEY, tok]
  )
  await page.goto(`${FE}/#${hash}`, { waitUntil: 'domcontentloaded' })
  return tok
}

/** 带 token 的 API 请求（供 E2E 里做基准数据比对）。 */
export async function apiGet(path, token) {
  const res = await fetch(`${API}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return res.json()
}

/** 带 token 的写请求。method 默认 POST（写用例多为创建）。 */
export async function apiPost(path, body = {}, token = null, method = 'POST') {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  let data = null
  try { data = await res.json() } catch { /* ignore */ }
  return { status: res.status, data }
}
