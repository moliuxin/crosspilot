/**
 * 预处理俄罗斯 ADM1 边界（geoBoundaries WGS84）→ 前端 SVG 区域模块。
 * 步骤：反经线修正(<-20° 加 360) → RDP 抽稀(0.35°) → 球面 LAEA 投影(lat0=55, lon0=95)
 *      → 生成 src/pages/Growth/russiaRegions.js（区域 path + 质心 + 同参数投影函数）
 * 运行：node scripts/build_russia_map.js  （在 Desktop\ZCode 放置源 geojson）
 */
const fs = require('fs')
const path = require('path')

const SRC = process.argv[2] || 'C:/Users/auro/Desktop/ZCode/rus_adm1_simplified.geojson'
const OUT = path.resolve(__dirname, '../src/pages/Growth/russiaRegions.js')

// ── 球面 LAEA（与生成数据一致，城市点用同一函数）────────────────────
const D = Math.PI / 180
const R = 6371 // 单位用 km，最后统一缩放
const LAT0 = 55 * D, LON0 = 95 * D
function project(lon, lat) {
  const lo = lon * D - LON0, la = lat * D
  const s2 = Math.sin(la) * Math.sin(LAT0) + Math.cos(la) * Math.cos(LAT0) * Math.cos(lo)
  const k = Math.sqrt(2 / (1 + Math.max(-0.9999, Math.min(0.9999, s2))))
  const x = R * k * Math.cos(la) * Math.sin(lo)
  const y = R * k * (Math.cos(LAT0) * Math.sin(la) - Math.sin(LAT0) * Math.cos(la) * Math.cos(lo))
  return [x, -y] // SVG y 向下
}

// ── RDP 抽稀（度容差）────────────────────────────────────────────
function rdp(pts, eps) {
  if (pts.length < 3) return pts
  let idx = -1, dmax = 0
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy || 1e-12
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i]
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    if (d > dmax) { dmax = d; idx = i }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]]
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)]
}

const gj = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const regions = []
let totalPts = 0

for (const f of gj.features) {
  const name = f.properties.shapeName
  if (!name) continue
  const geom = f.geometry
  if (!geom) continue
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  const dParts = []
  let sx = 0, sy = 0, sn = 0
  for (const poly of polys) {
    const ring = poly[0]
    if (!ring || ring.length < 8) continue // 过小环（小岛/飞地）跳过
    // 反经线：俄罗斯东端跨 180°，<-20° 视为东经
    const norm = ring.map(([lo, la]) => [lo < -20 ? lo + 360 : lo, la])
    const bb = norm.reduce((a, [lo, la]) => ({
      x0: Math.min(a.x0, lo), x1: Math.max(a.x1, lo),
      y0: Math.min(a.y0, la), y1: Math.max(a.y1, la),
    }), { x0: 999, x1: -999, y0: 999, y1: -999 })
    if ((bb.x1 - bb.x0) * (bb.y1 - bb.y0) < 0.08) continue // 微小岛跳过
    const simp = rdp(norm, 0.18)
    if (simp.length < 4) continue
    const proj = simp.map(([lo, la]) => project(lo, la))
    proj.forEach(([x, y]) => { sx += x; sy += y; sn++ })
    totalPts += proj.length
    dParts.push('M' + proj.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + 'Z')
  }
  if (dParts.length) regions.push({ name, d: dParts.join(''), cx: +(sx / sn).toFixed(1), cy: +(sy / sn).toFixed(1) })
}

// 归一化到 viewBox 0 0 1000 560（按整体 bbox 等比缩放居中）
let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9
regions.forEach((r) => {
  const nums = r.d.match(/-?[\d.]+/g)
  for (let i = 0; i < nums.length; i += 2) {
    const x = +nums[i], y = +nums[i + 1]
    if (x < x0) x0 = x; if (x > x1) x1 = x
    if (y < y0) y0 = y; if (y > y1) y1 = y
  }
})
const VW = 1000, VH = 560, PAD = 6
const k = Math.min((VW - PAD * 2) / (x1 - x0), (VH - PAD * 2) / (y1 - y0))
const ox = (VW - (x1 - x0) * k) / 2, oy = (VH - (y1 - y0) * k) / 2
const remap = (x, y) => [ox + (x - x0) * k, oy + (y - y0) * k]
regions.forEach((r) => {
  const segs = r.d.slice(1).split('M').map((s) => 'M' + s)
  r.d = segs.map((seg) => {
    const pts = seg.slice(1).split('L')
    const head = pts.shift() // 含 Z 的尾部
    pts.push(head)
    return 'M' + pts.map((p) => {
      const [x, y] = p.replace('Z', '').split(',').map(Number)
      const [nx, ny] = remap(x, y)
      return `${nx.toFixed(1)},${ny.toFixed(1)}`
    }).join('L') + 'Z'
  }).join('')
  const [cx, cy] = remap(r.cx, r.cy)
  r.cx = +cx.toFixed(1); r.cy = +cy.toFixed(1)
})

const out = `/**
 * 俄罗斯 ADM1 真实行政边界（geoBoundaries gbOpen RUS ADM1 简化版预处理产物）。
 * 生成：scripts/build_russia_map.js —— RDP 抽稀 0.35° + 球面 LAEA(55N,95E) → viewBox 1000×560。
 * 版权：geoBoundaries gbOpen（CC BY 4.0，https://www.geoboundaries.org）。
 * project() 与区域数据同参数：城市经纬度 → SVG 坐标。
 */
export const VIEW_W = 1000
export const VIEW_H = 560

export function project(lon, lat) {
  const D = Math.PI / 180, R = 6371
  const LAT0 = 55 * D, LON0 = 95 * D
  const lo = lon * D - LON0, la = lat * D
  const s2 = Math.sin(la) * Math.sin(LAT0) + Math.cos(la) * Math.cos(LAT0) * Math.cos(lo)
  const k = Math.sqrt(2 / (1 + Math.max(-0.9999, Math.min(0.9999, s2))))
  const x = R * k * Math.cos(la) * Math.sin(lo)
  const y = R * k * (Math.cos(LAT0) * Math.sin(la) - Math.sin(LAT0) * Math.cos(la) * Math.cos(lo))
  const X0 = ${x0.toFixed(3)}, Y0 = ${y0.toFixed(3)}, K = ${k.toFixed(6)}, OX = ${ox.toFixed(2)}, OY = ${oy.toFixed(2)}
  return [OX + (x - X0) * K, OY + (-y - Y0) * K]
}

export const REGIONS = ${JSON.stringify(regions)}

export const REGION_COUNT = ${regions.length}
`
fs.writeFileSync(OUT, out)
console.log('regions=', regions.length, 'totalPts=', totalPts, 'outBytes=', out.length, '\n->', OUT)
