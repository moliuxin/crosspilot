import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import './globe.css'

/**
 * 3D 交互地球入场页（纯 Canvas，无三方依赖）。
 *
 * 视觉：深空背景 + 星点；线框数字地球（经纬网点阵）；
 * 从中国制造带出发的出海光线（动画弧线）与目标市场脉冲点。
 * 交互：按住拖动旋转（带惯性），空闲后自动恢复旋转。
 */
const HUB = { name: '中国 · 制造带', lat: 23.0, lon: 113.1 }
const MARKETS = [
  { name: 'Moscow 莫斯科', lat: 55.75, lon: 37.6 },
  { name: 'London 伦敦', lat: 51.5, lon: -0.12 },
  { name: 'Hamburg 汉堡', lat: 53.55, lon: 9.99 },
  { name: 'Dubai 迪拜', lat: 25.2, lon: 55.27 },
  { name: 'Singapore 新加坡', lat: 1.35, lon: 103.8 },
  { name: 'Los Angeles 洛杉矶', lat: 34.05, lon: -118.24 },
]

const D2R = Math.PI / 180
function ll2v(lat, lon) {
  const phi = (90 - lat) * D2R
  const theta = (lon + 180) * D2R
  return { x: -Math.sin(phi) * Math.cos(theta), y: Math.cos(phi), z: Math.sin(phi) * Math.sin(theta) }
}
function norm(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / l, y: v.y / l, z: v.z / l }
}

function buildWire() {
  const pts = []
  for (let lat = -75; lat <= 75; lat += 15) {
    for (let lon = 0; lon < 360; lon += 4) pts.push(ll2v(lat, lon))
  }
  for (let lon = 0; lon < 360; lon += 15) {
    for (let lat = -88; lat <= 88; lat += 4) pts.push(ll2v(lat, lon))
  }
  return pts
}
function buildArcs() {
  const a = ll2v(HUB.lat, HUB.lon)
  return MARKETS.map((m, mi) => {
    const b = ll2v(m.lat, m.lon)
    const pts = []
    for (let i = 0; i <= 48; i++) {
      const t = i / 48
      const lift = 1 + 0.22 * Math.sin(Math.PI * t)
      const raw = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
      const n = norm(raw)
      pts.push({ x: n.x * lift, y: n.y * lift, z: n.z * lift })
    }
    return { pts, offset: mi * 0.17, speed: 0.11 + mi * 0.013, market: m }
  })
}

export default function GlobeIntro() {
  const navigate = useNavigate()
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    const ctx = canvas.getContext('2d')

    const wire = buildWire()
    const arcs = buildArcs()
    const hubV = ll2v(HUB.lat, HUB.lon)
    const stars = Array.from({ length: 110 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.4 + Math.random() * 1.2,
      tw: Math.random() * Math.PI * 2,
    }))

    let W = 0, H = 0, dpr = 1
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = wrap.clientWidth
      H = wrap.clientHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = W + 'px'
      canvas.style.height = H + 'px'
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    // 旋转状态：yaw 自转，pitch 俯仰；拖动带惯性，空闲后回到自转
    let yaw = -1.2, pitch = 0.32
    let dragging = false, lastX = 0, lastY = 0, vyaw = 0, vpitch = 0, idle = 0
    const AUTO = 0.0022

    function onDown(e) {
      dragging = true
      idle = 0
      lastX = e.clientX
      lastY = e.clientY
      vyaw = vpitch = 0
    }
    function onMove(e) {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      yaw += dx * 0.005
      pitch += dy * 0.004
      pitch = Math.max(-1.1, Math.min(1.1, pitch))
      vyaw = dx * 0.005
      vpitch = dy * 0.004
    }
    function onUp() {
      dragging = false
      idle = 0
    }
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    function rot(v) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw)
      const x1 = v.x * cy + v.z * sy
      const z1 = -v.x * sy + v.z * cy
      const cp = Math.cos(pitch), sp = Math.sin(pitch)
      const y2 = v.y * cp - z1 * sp
      const z2 = v.y * sp + z1 * cp
      return { x: x1, y: y2, z: z2 }
    }

    let raf = 0
    const t0 = performance.now()
    function frame(now) {
      try {
        drawFrame(now)
      } catch (e) {
        console.error('[globe]', e)
        return
      }
      raf = requestAnimationFrame(frame)
    }
    function drawFrame(now) {
      const t = (now - t0) / 1000
      if (!dragging) {
        idle += 1 / 60
        yaw += vyaw
        pitch += vpitch
        pitch = Math.max(-1.1, Math.min(1.1, pitch))
        vyaw *= 0.94
        vpitch *= 0.9
        if (idle > 140) yaw += AUTO // 空闲约 2.3s 后恢复自转
      }
      const cx = W / 2, cy = H / 2
      const R = Math.min(W, H) * 0.34

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // 星点背景
      for (const s of stars) {
        const a = 0.25 + 0.35 * Math.sin(t * 0.8 + s.tw)
        ctx.fillStyle = `rgba(190,215,255,${a})`
        ctx.beginPath()
        ctx.arc(s.x * W, s.y * H, s.r, 0, 6.283)
        ctx.fill()
      }

      // 地球辉光（青 + 品红双色）
      const glowC = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.2, R * 0.55, cx, cy, R * 1.5)
      glowC.addColorStop(0, 'rgba(34,211,238,0.16)')
      glowC.addColorStop(1, 'rgba(34,211,238,0)')
      ctx.fillStyle = glowC
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.5, 0, 6.283)
      ctx.fill()
      const glowM = ctx.createRadialGradient(cx + R * 0.35, cy + R * 0.25, R * 0.4, cx, cy, R * 1.35)
      glowM.addColorStop(0, 'rgba(232,121,249,0.12)')
      glowM.addColorStop(1, 'rgba(232,121,249,0)')
      ctx.fillStyle = glowM
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.35, 0, 6.283)
      ctx.fill()

      // 球体底盘
      ctx.fillStyle = 'rgba(6,12,28,0.94)'
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, 6.283)
      ctx.fill()
      // 霓虹描边（青主品红辅，随呼吸微动）
      ctx.lineWidth = 1.4
      ctx.strokeStyle = `rgba(34,211,238,${0.5 + 0.18 * Math.sin(t * 1.6)})`
      ctx.beginPath()
      ctx.arc(cx, cy, R + 1, 0, 6.283)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(232,121,249,0.28)'
      ctx.beginPath()
      ctx.arc(cx, cy, R + 6, 0, 6.283)
      ctx.stroke()

      // 经纬线框（只画正面，亮度随深度）—— 霓虹青
      for (const p of wire) {
        const q = rot(p)
        if (q.z <= 0) continue
        const a = 0.12 + q.z * 0.55
        ctx.fillStyle = `rgba(34,211,238,${a})`
        const size = 0.7 + q.z * 1.2
        ctx.fillRect(cx + q.x * R - size / 2, cy - q.y * R - size / 2, size, size)
      }

      // 出海弧线 + 动画光点（青/品红交替）
      for (let ai = 0; ai < arcs.length; ai++) {
        const arc = arcs[ai]
        const neon = ai % 2 === 0 ? '56,189,248' : '232,121,249'
        let prev = null
        ctx.lineWidth = 1.2
        for (let i = 0; i < arc.pts.length; i++) {
          const q = rot(arc.pts[i])
          const sx = cx + q.x * R, sy = cy - q.y * R
          if (prev && q.z > -0.05 && prev.z > -0.05) {
            const zz = Math.max(0, (q.z + prev.z) / 2)
            ctx.strokeStyle = `rgba(${neon},${0.10 + zz * 0.55})`
            ctx.beginPath()
            ctx.moveTo(prev.sx, prev.sy)
            ctx.lineTo(sx, sy)
            ctx.stroke()
          }
          prev = { sx, sy, z: q.z }
        }
        // 流动光点
        const head = (t * arc.speed + arc.offset) % 1
        const idx = Math.min(arc.pts.length - 1, Math.max(0, Math.floor(head * (arc.pts.length - 1))))
        const hq = rot(arc.pts[idx])
        if (hq.z > 0) {
          const hx = cx + hq.x * R, hy = cy - hq.y * R
          ctx.fillStyle = `rgba(${neon},0.95)`
          ctx.beginPath()
          ctx.arc(hx, hy, 2.2, 0, 6.283)
          ctx.fill()
          ctx.fillStyle = `rgba(${neon},0.22)`
          ctx.beginPath()
          ctx.arc(hx, hy, 5.5, 0, 6.283)
          ctx.fill()
        }
      }

      // 出发地：中国制造带（霓虹黄核心 + 品红脉冲环）
      const hq = rot(hubV)
      if (hq.z > 0) {
        const hx = cx + hq.x * R, hy = cy - hq.y * R
        ctx.fillStyle = 'rgba(253,224,71,0.95)'
        ctx.beginPath()
        ctx.arc(hx, hy, 3.4, 0, 6.283)
        ctx.fill()
        ctx.strokeStyle = 'rgba(232,121,249,0.55)'
        ctx.beginPath()
        ctx.arc(hx, hy, 7 + Math.sin(t * 2.4) * 2, 0, 6.283)
        ctx.stroke()
      }

      // 目标市场脉冲点 + 标签（品红点 · 青标签）
      ctx.font = '11px ui-monospace, "Cascadia Mono", Consolas, "Microsoft YaHei", monospace'
      for (const m of MARKETS) {
        const q = rot(ll2v(m.lat, m.lon))
        if (q.z <= 0.05) continue
        const mx = cx + q.x * R, my = cy - q.y * R
        const a = 0.35 + q.z * 0.65
        ctx.fillStyle = `rgba(232,121,249,${a})`
        ctx.beginPath()
        ctx.arc(mx, my, 2.6, 0, 6.283)
        ctx.fill()
        ctx.strokeStyle = `rgba(34,211,238,${a * 0.5})`
        ctx.beginPath()
        ctx.arc(mx, my, 5 + Math.sin(t * 2 + m.lon) * 1.6, 0, 6.283)
        ctx.stroke()
        ctx.fillStyle = `rgba(165,243,252,${a})`
        ctx.fillText(m.name, mx + 9, my + 3.5)
      }
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  return (
    <div className="globe-page" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label="可拖动旋转的 3D 地球" />
      <div className="gp-grid-floor" aria-hidden="true" />
      <div className="gp-scanlines" aria-hidden="true" />
      <div className="globe-overlay">
        <div className="globe-brand">
          <span className="mark">C</span>
          <div>
            <strong>CrossPilot</strong>
            <span>AI 出海建站与获客平台 · 中 / 英 / 俄</span>
          </div>
        </div>
        <div className="gp-hud" aria-hidden="true">
          <span className="gp-chip"><i className="gp-blink" />SYS.ONLINE</span>
          <span className="gp-chip">HUB <b>23.0N · 113.1E</b></span>
          <span className="gp-chip">MARKETS <b>06</b></span>
        </div>
        <div className="globe-copy">
          <div className="globe-eyebrow">// GLOBAL · AI SITE BUILDER</div>
          <h1 data-text="让世界找到你">让世界找到你</h1>
          <p>
            从中国制造带到全球市场：AI 生成中 / 英 / 俄独立站，
            SEO &amp; GEO 让你在搜索引擎与 AI 回答里被找到、被信任、被询价。
          </p>
          <div className="globe-actions">
            <button className="g-btn g-primary" onClick={() => navigate('/templates')}>
              免登录看模板商城
            </button>
            <button className="g-btn g-ghost" onClick={() => navigate('/login')}>
              登录 / 注册
            </button>
          </div>
          <div className="globe-hint">DRAG TO ROTATE · 按住地球拖动旋转 · 松手自动巡航</div>
        </div>
        <div className="globe-foot">© {new Date().getFullYear()} CROSSPILOT · SITEPILOT // NEON EDITION</div>
      </div>
    </div>
  )
}
