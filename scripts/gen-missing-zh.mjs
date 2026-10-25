/** 补生成 3 个 demo 站的 zh-CN 变体:PATCH target_markets → POST generate(演示账号) */
const BASE = 'http://localhost:8080/api'
const SITES = ['s-1-56abdf', 's-1-cd90cb', 's-1-0d9eec']

const login = await fetch(BASE + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }),
}).then(r => r.json())
if (!login.token) { console.error('login failed', login); process.exit(1) }
const h = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' }

for (const slug of SITES) {
  const site = await fetch(BASE + '/public/site?site=' + slug + '&market=en-US').then(r => r.json())
  const id = site?.site?.id
  if (!id) { console.error(slug, 'no site id'); continue }
  const patch = await fetch(BASE + '/sites/' + id, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ target_markets: ['zh-CN', 'en-US', 'ru-RU'] }),
  }).then(r => r.json()).catch(e => ({ err: String(e) }))
  console.log(slug, 'patched:', patch?.ok === true || patch?.site?.id === id)
  const gen = await fetch(BASE + '/sites/' + id + '/market-variants/generate?priority_market=zh-CN', {
    method: 'POST', headers: h,
  }).then(r => r.json()).catch(e => ({ err: String(e) }))
  console.log(slug, 'generate:', gen?.ok === true ? 'STARTED' : JSON.stringify(gen).slice(0, 160))
}
console.log('DONE')
