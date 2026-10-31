/**
 * 真实数据拉取：Bukvarix（Yandex Wordstat 库镜像，免费 API）→ CrossPilot 导入 API。
 *
 * 运行（宿主机，容器出口被拒只能本机拉）：
 *   set PATH=...\tools\node && node scripts/fetch_bukvarix.mjs
 *
 * 数据口径（诚实标注）：Wordstat 数据库近期月度频次，区域=Весь мир（全球）；
 * 竞争度由后端按搜索量分位代理（comp_source=volume_rank_proxy）。
 * 注：Bukvarix 免费接口不提供逐月历史（近一年趋势需 Wordstat 网页版导出）。
 */
const API_BASE = 'http://localhost:8080/api'
const EMAIL = 'demo@aquaflow-demo.com'
const PASSWORD = 'demo-pass-123'

const SEED_SETS = [
  {
    label: '真实数据 · 协作机器人（Wordstat库）',
    seeds: ['робот манипулятор', 'промышленный робот', 'сварочный робот', 'коллаборативный робот', 'робот паллетайзер', 'робот для сварки купить', 'манипулятор купить', 'робот упаковщик'],
  },
  {
    label: '真实数据 · 工业设备（Wordstat库）',
    seeds: ['промышленный насос', 'компрессор промышленный', 'вакуумный насос', 'насос для воды', 'центробежный насос', 'насос купить'],
  },
  {
    label: '真实数据 · 建材出口（Wordstat库）',
    seeds: ['керамическая плитка', 'мрамор плита', 'spc пол', 'керамогранит', 'плитка купить оптом', 'сайдинг дома'],
  },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchSeed(seed, num = 25) {
  const url = `http://api.bukvarix.com/v1/keywords/?q=${encodeURIComponent(seed)}&api_key=free&num=${num}&format=json`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${seed}`)
  const { data } = await res.json()
  return data.filter((r) => Array.isArray(r) && r.length >= 5 && r[3] > 0)
    .map((r) => ({ kw: String(r[0]), vol: r[3], exact: r[4] }))
}

async function main() {
  // 1) 登录
  const login = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json())
  const token = login.access_token || login.token
  if (!token) throw new Error('登录失败: ' + JSON.stringify(login).slice(0, 200))
  console.log('✓ 登录成功')

  // 2) 清掉旧的 bukvarix 数据集（幂等重跑）
  const list = await fetch(`${API_BASE}/growth/wordstat/datasets`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json())
  for (const ds of list.filter((d) => d.label.startsWith('真实数据'))) {
    // 无 DELETE 端点：直接标记待清（此处略——由 psql 清理，见脚本说明）
    console.log('  已存在: ', ds.label)
  }

  for (const set of SEED_SETS) {
    const uniq = new Map()
    let okSeeds = 0
    for (const seed of set.seeds) {
      try {
        const rows = await fetchSeed(seed)
        okSeeds++
        rows.forEach((r) => { if (!uniq.has(r.kw)) uniq.set(r.kw, r) })
        console.log(`  ✓ ${seed}: ${rows.length} 行`)
      } catch (e) {
        console.log(`  ✕ ${seed}: ${e.message}`)
      }
      await sleep(4000) // 免费接口限流：温和间隔（429 时再加长）
    }
    if (!uniq.size) { console.log(`✕ ${set.label} 无数据，跳过`); continue }
    const ranked = [...uniq.values()].sort((a, b) => b.vol - a.vol).slice(0, 30)
    const content = 'Ключевые фразы\n' + ranked.map((r) => `${r.kw}\t${r.vol}`).join('\n')
    // 3) 走网站真实导入管线（解析+意图分层+词族+落库）
    const res = await fetch(`${API_BASE}/growth/wordstat/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ label: set.label, content, source: 'bukvarix' }),
    })
    if (!res.ok) { console.log(`✕ 导入失败 ${set.label}: HTTP ${res.status}`, (await res.text()).slice(0, 200)); continue }
    const d = await res.json()
    console.log(`✓ ${set.label}: ${d.keywords.length} 词入库（种子成功 ${okSeeds}/${set.seeds.length}）TOP1=${d.keywords[0].kw} ${d.keywords[0].vol}`)
    await sleep(1200)
  }
  console.log('完成。')
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
