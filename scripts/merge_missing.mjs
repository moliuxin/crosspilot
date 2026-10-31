/** 补爬：拉上次 429 失败的种子 → 与现有数据集内存合并 → 全删 → 全量重导入。 */
import { execSync } from 'node:child_process'

const API = 'http://localhost:8080/api'
const EMAIL = 'demo@aquaflow-demo.com', PASSWORD = 'demo-pass-123'
const MISSING = {
  '真实数据 · 协作机器人（Wordstat库）': ['робот манипулятор', 'промышленный робот', 'сварочный робот', 'коллаборативный робот', 'робот паллетайзер'],
  '真实数据 · 建材出口（Wordstat库）': ['мрамор плита', 'spc пол'],
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchSeed(seed, num = 25) {
  const url = `http://api.bukvarix.com/v1/keywords/?q=${encodeURIComponent(seed)}&api_key=free&num=${num}&format=json`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { data } = await res.json()
  return data.filter((r) => Array.isArray(r) && r.length >= 5 && r[3] > 0).map((r) => ({ kw: String(r[0]), vol: r[3] }))
}

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }).then((r) => r.json())
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token || login.access_token}` }

// 1) 全部数据集内容先取到内存
const list = await fetch(`${API}/growth/wordstat/datasets`, { headers: H }).then((r) => r.json())
const sets = []
for (const ds of list) {
  const detail = await fetch(`${API}/growth/wordstat/datasets/${ds.id}`, { headers: H }).then((r) => r.json())
  sets.push({ label: ds.label, words: new Map((detail.keywords || []).map((k) => [k.kw, k.vol])) })
}

// 2) 补爬缺失种子并合并
for (const set of sets) {
  const missing = MISSING[set.label]
  if (!missing) continue
  let ok = 0
  for (const seed of missing) {
    try {
      const rows = await fetchSeed(seed)
      rows.forEach((r) => { if (!set.words.has(r.kw)) set.words.set(r.kw, r.vol) })
      ok++
      console.log(`  ✓ ${seed}: ${rows.length} 行`)
    } catch (e) { console.log(`  ✕ ${seed}: ${e.message}`) }
    await sleep(8000)
  }
  console.log(`${set.label}: 补种 ${ok}/${missing.length}，共 ${set.words.size} 词`)
}

// 3) 全删 + 全量重导入
execSync('docker exec crosspilot-faron-db-1 psql -U crosspilot -d crosspilot -c "DELETE FROM wordstat_datasets;"')
for (const set of sets) {
  const ranked = [...set.words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
  if (!ranked.length) continue
  const content = 'Ключевые фразы\n' + ranked.map(([kw, vol]) => `${kw}\t${vol}`).join('\n')
  const res = await fetch(`${API}/growth/wordstat/import`, { method: 'POST', headers: H, body: JSON.stringify({ label: set.label, content, source: 'bukvarix' }) })
  console.log(res.ok ? `✓ 重新导入 ${set.label}（${ranked.length} 词）` : `✕ ${set.label}: HTTP ${res.status}`)
}
console.log('done')
