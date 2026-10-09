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
    <div className="globe-home">
      {/* ---------- 首屏：3D 地球（可拖动） ---------- */}
      <section className="globe-page" ref={wrapRef}>
        <canvas ref={canvasRef} aria-label="可拖动旋转的 3D 地球" />
        <div className="gp-grid-floor" aria-hidden="true" />
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
          <button
            className="gp-scroll-cue"
            aria-label="向下查看核心优势与功能"
            onClick={() => document.getElementById('gp-advantages')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <span>向下查看核心优势 · 功能 · 案例</span>
            <i>▼</i>
          </button>
        </div>
      </section>
      <div className="gp-scanlines" aria-hidden="true" />

      {/* ---------- 核心优势 ---------- */}
      <section className="gp-section" id="gp-advantages">
        <div className="gp-sec-head">
          <span className="gp-sec-eyebrow">// 01 · CORE ADVANTAGES</span>
          <h2>核心优势</h2>
          <p>为什么选择 CrossPilot —— 四条被工程化的差异点，而不是口号。</p>
        </div>
        <div className="gp-adv-grid">
          {[
            { icon: '🌐', t: '三语市场独立表达', d: '中 / 英 / 俄不是翻译：信任元素、CTA、信息详略按市场重构，买家看到的是"本地公司"的表达。' },
            { icon: '🎯', t: 'SEO + GEO 双引擎', d: '搜索引擎可收录，AI 回答可引用。结构化数据与可抓取性一并优化，让采购商问 AI 时也找得到你。' },
            { icon: '📥', t: '询盘直连工作台', d: '独立站 RFQ 表单直接落库，不依赖邮箱。按状态跟进、建任务、导出交接，一条不漏。' },
            { icon: '🛡', t: '人工确认安全线', d: '所有 AI 产出先出 Draft + Diff，你确认才发布；每次发布留版本，随时可回滚。Agent 永不直接改线上。' },
          ].map((a) => (
            <article className="gp-adv-card" key={a.t}>
              <span className="gp-adv-icon">{a.icon}</span>
              <h3>{a.t}</h3>
              <p>{a.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- 核心功能 ---------- */}
      <section className="gp-section gp-section-alt" id="gp-features">
        <div className="gp-sec-head">
          <span className="gp-sec-eyebrow">// 02 · FEATURES</span>
          <h2>核心功能</h2>
          <p>从建站到获客的完整闭环 —— 每一项都在工作台里真实可用（标注 PRO 的为付费能力）。</p>
        </div>
        <div className="gp-feat-grid">
          {[
            { icon: '✦', t: 'AI 完整建站', d: '输入产品类别 → 结构/文案/视觉一次生成，含首页、产品、方案、案例等 6+ 页面', tag: '1 次免费' },
            { icon: '▩', t: '行业模板商城', d: '6 套不同结构的行业模板，免登录悬停预览整页，一键套用', tag: '公开' },
            { icon: '◫', t: '多站点管理', d: '一个账号 N 个网站，产品、页面、版本按站点隔离管理', tag: '' },
            { icon: '✨', t: 'AI 画笔编辑', d: '自然语言圈选区块改内容，所见即所得', tag: 'PRO' },
            { icon: '⚓', t: '市场版本', d: '中 / 英 / 俄三市场独立版本，逐页核对本地表达', tag: '' },
            { icon: '⟲', t: '版本历史回滚', d: '发布 / 编辑 / 优化全留痕，逐字段对比，真回滚', tag: '' },
            { icon: '🤖', t: 'Agent 草稿', d: 'MCP 工具读真实数据出优化草稿，人工确认后生效', tag: '' },
            { icon: '↗', t: '数据分析', d: '询盘来源、页面表现、SEO/GEO 分数一屏看清', tag: '' },
          ].map((f) => (
            <article className="gp-feat-card" key={f.t}>
              <div className="gp-feat-top">
                <span className="gp-feat-icon">{f.icon}</span>
                {f.tag && <span className={`gp-feat-tag${f.tag === 'PRO' ? ' pro' : f.tag === '公开' ? ' pub' : ''}`}>{f.tag}</span>}
              </div>
              <h3>{f.t}</h3>
              <p>{f.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- 案例 ---------- */}
      <section className="gp-section" id="gp-cases">
        <div className="gp-sec-head">
          <span className="gp-sec-eyebrow">// 03 · CASES</span>
          <h2>案例</h2>
          <p>不同行业的出海路径（以下为演示数据 · Demo / Test，真实案例待商家授权后上线）。</p>
        </div>
        <div className="gp-case-grid">
          {[
            { market: '俄语区', industry: '工业水泵制造商', story: '强化 EAC 认证墙与交付说明，俄语版本按本地信任习惯重构', metric: [['62', '上线 60 天询盘'], ['3', '市场版本']] },
            { market: '英语区', industry: 'LED 照明出口商', story: '规格对比页 + Schema 结构化数据，AI 检索与比价场景可见', metric: [['48h', '询盘响应'], ['1.8x', 'GEO 可见度']] },
            { market: '中英俄并行', industry: '食品机械工厂', story: '一次生成三市场版本，FAQ 按市场常见问题分别组织', metric: [['3', '语言版本'], ['12', '产品页']] },
          ].map((c) => (
            <article className="gp-case-card" key={c.industry}>
              <div className="gp-case-top">
                <span className="gp-case-market">{c.market}</span>
                <span className="gp-case-demo">DEMO DATA</span>
              </div>
              <h3>{c.industry}</h3>
              <p>{c.story}</p>
              <div className="gp-case-metrics">
                {c.metric.map(([v, l]) => (
                  <div key={l}><b>{v}</b><span>{l}</span></div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="gp-cta">
        <h2>像这样，把你的产品卖向全球</h2>
        <p>免登录逛模板商城，或注册开始 1 次免费 AI 完整生成。</p>
        <div className="globe-actions gp-center">
          <button className="g-btn g-primary" onClick={() => navigate('/templates')}>免登录看模板商城</button>
          <button className="g-btn g-ghost" onClick={() => navigate('/login')}>登录 / 注册</button>
        </div>
      </section>

      <footer className="gp-foot">
        <span>© {new Date().getFullYear()} CROSSPILOT · SITEPILOT // NEON EDITION</span>
        <span>客户买的不是网站，是海外询盘与可信的生意机会</span>
      </footer>
    </div>
  )
}
