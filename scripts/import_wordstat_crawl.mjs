// Wordstat 官网直爬数据 → 合并去重 → 导入网站（source=wordstat）
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const API = 'http://localhost:8080/api'
const crawl = JSON.parse(readFileSync('C:/Users/auro/Desktop/ZCode/video_work/wordstat_crawl.json', 'utf8'))
const LABELS = {
  robot: '真实数据 · 协作机器人（Wordstat官网）',
  industrial: '真实数据 · 工业设备（Wordstat官网）',
  building: '真实数据 · 建材出口（Wordstat官网）',
}

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@aquaflow-demo.com', password: 'demo-pass-123' }) }).then((r) => r.json())
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }

// 清掉旧 bukvarix 数据集（官网直采数据取代镜像数据）
execSync('docker exec crosspilot-faron-db-1 psql -U crosspilot -d crosspilot -c "DELETE FROM wordstat_datasets;"')
console.log('cleared old datasets')

const results = []
for (const [industry, seedTables] of Object.entries(crawl.data)) {
  const uniq = new Map()
  for (const { rows } of seedTables) {
    rows.forEach(({ kw, vol }) => { if (!uniq.has(kw) || uniq.get(kw) < vol) uniq.set(kw, vol) })
  }
  const ranked = [...uniq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
  const content = 'Ключевые фразы\n' + ranked.map(([kw, vol]) => `${kw}\t${vol}`).join('\n')
  const res = await fetch(`${API}/growth/wordstat/import`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ label: LABELS[industry], content, source: 'wordstat' }),
  })
  if (!res.ok) { console.log(`✕ ${industry}: HTTP ${res.status}`, (await res.text()).slice(0, 150)); continue }
  const d = await res.json()
  results.push({ label: d.label, kw: d.keywords.length, top: d.keywords[0] })
  console.log(`✓ ${d.label}: ${d.keywords.length} 词 TOP1=${d.keywords[0].kw} ${d.keywords[0].vol}`)
}
writeFileSync('C:/Users/auro/Desktop/ZCode/video_work/wordstat_import_result.json', JSON.stringify(results, null, 1))
console.log('DONE')
