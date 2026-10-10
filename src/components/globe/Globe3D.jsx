import { useEffect, useRef, useState } from 'react'

/**
 * P0-1 高质量 3D 地球(Three.js,动态 import,不阻塞首屏)。
 *
 * 交互:慢速自转 / 拖拽自由旋转(惯性)/ 松手 ~2.5s 后平滑恢复自转 / 悬停减速。
 * 视觉:深蓝-冰青数字地球、经纬点阵(陆地点更亮)、大气 Glow(加法混合辉光)、
 *       中国 → 全球市场弧线 + 流动脉冲 + 节点 pulse。
 * 降级:移动端减点减弧;prefers-reduced-motion 静帧;WebGL 失败回退 CSS 球。
 */
export default function Globe3D({ markets = 6 }) {
  const hostRef = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    let cleanup = null
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const mobile = window.matchMedia('(max-width: 768px)').matches

    import('three')
      .then((THREE) => {
        if (disposed || !hostRef.current) return
        try {
          cleanup = buildGlobe(THREE, hostRef.current, { reduced, mobile, arcs: mobile ? 3 : markets })
        } catch {
          setFailed(true)
        }
      })
      .catch(() => setFailed(true))

    return () => {
      disposed = true
      if (cleanup) cleanup()
    }
  }, [markets])

  if (failed) {
    // WebGL 不可用:高质量 CSS 静态球(保持同一视觉语言)
    return (
      <div className="g3d-fallback" aria-label="全球网络示意">
        <div className="g3d-fallback-ball" />
        <span className="g3d-fallback-node n1" /><span className="g3d-fallback-node n2" />
        <span className="g3d-fallback-node n3" />
      </div>
    )
  }
  return <div className="g3d-host" ref={hostRef} aria-label="3D 地球(可拖动旋转)" />
}

/* ------------------------------------------------------------------ */

const HUB = latLon(23.0, 113.1)
const MARKETS = [
  { lat: 55.75, lon: 37.6 },   // Moscow
  { lat: 51.5, lon: -0.12 },   // London
  { lat: 40.7, lon: -74.0 },   // New York
  { lat: 1.35, lon: 103.8 },   // Singapore
  { lat: 25.2, lon: 55.27 },   // Dubai
  { lat: -33.87, lon: 151.2 }, // Sydney
]

function latLon(lat, lon, r = 1) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180
  return {
    x: -r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi),
    z: r * Math.sin(phi) * Math.sin(theta),
  }
}

/** 粗粒度陆地掩膜(2° 网格,仅用于点阵亮度;不追求地理精度)。 */
function isLand(lat, lon) {
  // 极简洲块盒集合(纬度带 × 经度带);数字地球风格下粗略即可
  const bands = [
    [50, 70, 60, 180],    // 欧亚北
    [30, 50, -10, 60],    // 欧洲/中东
    [20, 45, 75, 135],    // 中国/南亚
    [5, 32, 95, 125],     // 东南亚/华南
    [-10, 32, -20, 52],   // 非洲
    [15, 60, -130, -55],  // 北美
    [-55, 15, -85, -30],  // 南美
    [-40, -10, 110, 155], // 澳洲
    [60, 82, -60, -10],   // 格陵兰
  ]
  return bands.some(([la0, la1, lo0, lo1]) => lat >= la0 && lat <= la1 && lon >= lo0 && lon <= lo1)
}

function buildGlobe(THREE, host, { reduced, mobile, arcs }) {
  const W = () => host.clientWidth
  const H = () => host.clientHeight
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2))
  renderer.setSize(W(), H())
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.06
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(36, W() / H(), 0.1, 30)
  camera.position.set(0, 0.55, 3.2)
  camera.lookAt(0, 0, 0)

  const root = new THREE.Group()
  scene.add(root)

  // ---- 内核球体(多层深蓝冰青体积感) ----
  // 内暗球(地核感)
  const inner = new THREE.Mesh(
    new THREE.SphereGeometry(0.985, mobile ? 32 : 64, mobile ? 24 : 48),
    new THREE.MeshBasicMaterial({ color: 0x050d1e }),
  )
  root.add(inner)
  // 主球面(Phong 体积感)
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, mobile ? 48 : 96, mobile ? 36 : 72),
    new THREE.MeshPhongMaterial({
      color: 0x0b1e3c, emissive: 0x071428, shininess: 32,
      specular: new THREE.Color(0x5b9fd8),
    }),
  )
  root.add(sphere)
  // 边缘菲涅尔亮层(RimLight 感)
  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(1.005, 64, 48),
    new THREE.MeshBasicMaterial({
      color: 0x2a6fd4, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
    }),
  )
  root.add(rim)

  // ---- 大气 Glow(三层渐进:内→中→外) ----
  const glowLayers = [
    { r: 1.03, c: 0x6ee7ff, o: 0.10 },
    { r: 1.09, c: 0x3aa0ff, o: 0.06 },
    { r: 1.18, c: 0x8b6cf5, o: 0.028 }, // 外层微紫
  ].map(({ r, c, o }) => {
    const g = new THREE.Mesh(
      new THREE.SphereGeometry(r, 48, 36),
      new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: o,
        blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      }),
    )
    root.add(g)
    return g
  })

  // ---- 经纬网(更精致:密纬+经线,低透明度) ----
  const gridMat = new THREE.LineBasicMaterial({ color: 0x4fb8f0, transparent: true, opacity: 0.08 })
  const gridGeo = new THREE.BufferGeometry()
  const gp = []
  const latStep = mobile ? 15 : 10
  const lonStep = mobile ? 15 : 10
  for (let lat = -80; lat <= 80; lat += latStep) {
    for (let lon = 0; lon < 360; lon += 3) {
      const a = latLon(lat, lon, 1.001), b = latLon(lat, lon + 3, 1.001)
      gp.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  for (let lon = 0; lon < 360; lon += lonStep) {
    for (let lat = -84; lat < 84; lat += 3) {
      const a = latLon(lat, lon, 1.001), b = latLon(lat + 3, lon, 1.001)
      gp.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3))
  root.add(new THREE.LineSegments(gridGeo, gridMat))

  // ---- 陆地点阵(更细腻:多级渐变色彩 + 近距离点更亮) ----
  const step = mobile ? 4 : 2
  const dotPos = [], dotCol = []
  const landColors = [new THREE.Color(0x8befff), new THREE.Color(0x5bc8f7), new THREE.Color(0x3a9fd8)]
  const seaColor = new THREE.Color(0x1a3a5c)
  for (let lat = -84; lat <= 84; lat += step) {
    for (let lon = -180; lon < 180; lon += step) {
      const v = latLon(lat, lon, 1.003)
      const land = isLand(lat, lon)
      if (!land && Math.random() > 0.18) continue // 海洋更稀疏(高级感)
      dotPos.push(v.x, v.y, v.z)
      if (land) {
        // 陆地多级:极地/温带/热带渐变
        const idx = Math.min(2, Math.floor((Math.abs(lat) / 90) * 2.4))
        const c = landColors[idx]
        dotCol.push(c.r, c.g, c.b)
      } else {
        dotCol.push(seaColor.r, seaColor.g, seaColor.b)
      }
    }
  }
  const dotGeo = new THREE.BufferGeometry()
  dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dotPos, 3))
  dotGeo.setAttribute('color', new THREE.Float32BufferAttribute(dotCol, 3))
  const dotMat = new THREE.PointsMaterial({
    size: 0.011, vertexColors: true, transparent: true, opacity: 0.88,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  })
  root.add(new THREE.Points(dotGeo, dotMat))

  // ---- 弧线(更自然:渐变透明度、慢速脉冲) ----
  const pulses = []
  const arcGroup = new THREE.Group()
  root.add(arcGroup)
  const targets = MARKETS.slice(0, arcs)
  targets.forEach((m, i) => {
    const t = latLon(m.lat, m.lon, 1.008)
    const dist = Math.hypot(HUB.x - t.x, HUB.y - t.y, HUB.z - t.z)
    const lift = 1 + 0.22 * dist
    const mid = { x: (HUB.x + t.x) / 2, y: (HUB.y + t.y) / 2, z: (HUB.z + t.z) / 2 }
    const l = Math.hypot(mid.x, mid.y, mid.z) || 1
    const midN = { x: mid.x / l * lift, y: mid.y / l * lift, z: mid.z / l * lift }
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(HUB.x, HUB.y, HUB.z),
      new THREE.Vector3(midN.x, midN.y, midN.z),
      new THREE.Vector3(t.x, t.y, t.z),
    )
    // 弧线:渐变透明度(两端亮、中间淡)
    const pts = curve.getPoints(80)
    const positions = []
    const alphas = []
    for (let j = 0; j < pts.length; j++) {
      positions.push(pts[j].x, pts[j].y, pts[j].z)
      const edge = Math.min(j, pts.length - 1 - j) / (pts.length * 0.3)
      alphas.push(Math.min(1, edge) * 0.28)
    }
    // 用 BufferGeometry + LineBasicMaterial(简化:单色低透明度)
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    arcGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({
      color: i % 2 === 0 ? 0x7cc4f7 : 0xa78bfa,
      transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })))

    // 流动脉冲(更小的光点,更慢)
    const pulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xe8f6ff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    )
    pulse.userData = { curve, offset: i * 0.14, speed: 0.06 + i * 0.008 }
    arcGroup.add(pulse)
    pulses.push(pulse)

    // 目标节点(带 glow 环)
    const nodeGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0x4fb8f0, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    )
    nodeGlow.position.set(t.x, t.y, t.z)
    nodeGlow.userData = { phase: i * 0.9, ring: true }
    arcGroup.add(nodeGlow)
    pulses.push(nodeGlow)

    const node = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0x9be8ff, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    )
    node.position.set(t.x, t.y, t.z)
    arcGroup.add(node)
  })

  // 中国节点(琥珀 + 双层 glow)
  const hubGlow1 = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0xf3c98b, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
  hubGlow1.position.set(HUB.x, HUB.y, HUB.z)
  hubGlow1.userData = { phase: 0, ring: true }
  root.add(hubGlow1)
  pulses.push(hubGlow1)

  const hubNode = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0xf8d9a8, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
  hubNode.position.set(HUB.x, HUB.y, HUB.z)
  root.add(hubNode)

  // ---- 星空背景(极微弱) ----
  const starGeo = new THREE.BufferGeometry()
  const starPos = []
  for (let i = 0; i < (mobile ? 80 : 160); i++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const r = 8 + Math.random() * 8
    starPos.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta))
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 0.02, color: 0x8ab8d8, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }))
  scene.add(stars)

  // ---- 灯光(更立体的三点布光) ----
  scene.add(new THREE.AmbientLight(0x87b6d8, 0.55))
  const key = new THREE.DirectionalLight(0x9fd8ff, 1.3)
  key.position.set(2.5, 2.2, 3)
  scene.add(key)
  const rim2 = new THREE.DirectionalLight(0x8b6cf5, 0.35)
  rim2.position.set(-3, -0.5, -2.5)
  scene.add(rim2)
  const fill = new THREE.DirectionalLight(0x4fb8f0, 0.25)
  fill.position.set(-1, 2, 1)
  scene.add(fill)

  // ---- 交互:拖拽 + 惯性 + 恢复自转 + 悬停减速 ----
  let vy = 0.0022, vyTarget = 0.0022        // 自转速度(慢)
  let dragging = false, lastX = 0, lastY = 0, inertiaX = 0, inertiaY = 0
  let idleTimer = 0, hovering = false
  let pitch = 0.32

  const onDown = (e) => {
    dragging = true; idleTimer = 0
    lastX = e.clientX; lastY = e.clientY
    inertiaX = inertiaY = 0
  }
  const onMove = (e) => {
    if (!dragging) return
    const dx = e.clientX - lastX, dy = e.clientY - lastY
    lastX = e.clientX; lastY = e.clientY
    root.rotation.y += dx * 0.005
    pitch = Math.max(-1.1, Math.min(1.1, pitch + dy * 0.004))
    inertiaX = dx * 0.005
    inertiaY = dy * 0.004
  }
  const onUp = () => { dragging = false; idleTimer = performance.now() }
  const onEnter = () => { hovering = true }
  const onLeave = () => { hovering = false }

  const el = renderer.domElement
  el.style.touchAction = 'none'
  el.style.cursor = 'grab'
  el.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  el.addEventListener('pointerenter', onEnter)
  el.addEventListener('pointerleave', onLeave)

  const onResize = () => {
    camera.aspect = W() / H()
    camera.updateProjectionMatrix()
    renderer.setSize(W(), H())
  }
  const ro = new ResizeObserver(onResize)
  ro.observe(host)

  // ---- 渲染循环 ----
  let raf = 0
  const t0 = performance.now()
  const renderFrame = (now) => {
    const t = (now - t0) / 1000
    if (!dragging) {
      // 惯性衰减 → 空闲 2.5s 平滑恢复自转
      const idle = now - (idleTimer || 0)
      const resume = idle > 2500 ? 1 : 0
      const ease = resume * 0.04
      vy += (vyTarget * (hovering ? 0.25 : 1) - vy) * (dragging ? 0 : 0.06 + ease)
      root.rotation.y += vy + inertiaX
      pitch = Math.max(-1.1, Math.min(1.1, pitch + inertiaY))
      inertiaX *= 0.94
      inertiaY *= 0.9
    }
    root.rotation.x += (pitch - root.rotation.x) * 0.12
    // 脉冲动画
    for (const p of pulses) {
      if (p.userData.curve) {
        const k = (t * p.userData.speed + p.userData.offset) % 1
        const pos = p.userData.curve.getPoint(k)
        p.position.copy(pos)
      } else if (p.userData.ring !== undefined) {
        const s = 1 + 0.35 * Math.sin(t * 2 + p.userData.phase)
        p.scale.setScalar(s)
        p.material.opacity = 0.75 + 0.25 * Math.sin(t * 2 + p.userData.phase)
      }
    }
    glowLayers[0].material.opacity = 0.085 + 0.02 * Math.sin(t * 0.8)
    glowLayers[2].material.opacity = 0.024 + 0.006 * Math.sin(t * 0.5 + 1.5)
    renderer.render(scene, camera)
    if (!reduced) raf = requestAnimationFrame(renderFrame)
  }
  if (reduced) {
    renderFrame(t0) // 静帧
  } else {
    raf = requestAnimationFrame(renderFrame)
  }

  // ---- 清理 ----
  return () => {
    cancelAnimationFrame(raf)
    ro.disconnect()
    el.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointerenter', onEnter)
    el.removeEventListener('pointerleave', onLeave)
    renderer.dispose()
    if (host.contains(el)) host.removeChild(el)
  }
}
