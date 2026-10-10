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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(W(), H())
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, W() / H(), 0.1, 20)
  camera.position.set(0, 0.55, 3.15)
  camera.lookAt(0, 0, 0)

  const root = new THREE.Group()
  scene.add(root)

  // ---- 球体(深蓝冰青) ----
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, mobile ? 48 : 80, mobile ? 36 : 60),
    new THREE.MeshPhongMaterial({
      color: 0x0d2440, emissive: 0x0a1a30, shininess: 18,
      specular: new THREE.Color(0x3a6fa8),
    }),
  )
  root.add(sphere)

  // ---- 大气 Glow(外层加法混合球) ----
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(1.16, 48, 36),
    new THREE.MeshBasicMaterial({
      color: 0x4fd8ff, transparent: true, opacity: 0.1,
      blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
    }),
  )
  root.add(glow)
  const glow2 = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 48, 36),
    new THREE.MeshBasicMaterial({
      color: 0x7ce7ff, transparent: true, opacity: 0.07,
      blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
    }),
  )
  root.add(glow2)

  // ---- 经纬网(细线) ----
  const gridMat = new THREE.LineBasicMaterial({ color: 0x3fd0ff, transparent: true, opacity: 0.13 })
  const gridGeo = new THREE.BufferGeometry()
  const gp = []
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = 0; lon < 360; lon += 3) {
      const a = latLon(lat, lon, 1.002), b = latLon(lat, lon + 3, 1.002)
      gp.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  for (let lon = 0; lon < 360; lon += 30) {
    for (let lat = -84; lat < 84; lat += 3) {
      const a = latLon(lat, lon, 1.002), b = latLon(lat + 3, lon, 1.002)
      gp.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3))
  root.add(new THREE.LineSegments(gridGeo, gridMat))

  // ---- 陆地点阵(Points;陆地亮青、海洋微点) ----
  const step = mobile ? 5 : 3
  const dotPos = [], dotCol = [], dotSize = []
  const cLand = new THREE.Color(0x67e8f9)
  const cSea = new THREE.Color(0x1e4d73)
  for (let lat = -84; lat <= 84; lat += step) {
    for (let lon = -180; lon < 180; lon += step) {
      const v = latLon(lat, lon, 1.004)
      const land = isLand(lat, lon)
      if (!land && Math.random() > 0.24) continue // 海洋稀疏
      dotPos.push(v.x, v.y, v.z)
      const c = land ? cLand : cSea
      dotCol.push(c.r, c.g, c.b)
      dotSize.push(land ? 2.4 : 1.3)
    }
  }
  const dotGeo = new THREE.BufferGeometry()
  dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dotPos, 3))
  dotGeo.setAttribute('color', new THREE.Float32BufferAttribute(dotCol, 3))
  const dotMat = new THREE.PointsMaterial({
    size: 0.016, vertexColors: true, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  })
  root.add(new THREE.Points(dotGeo, dotMat))

  // ---- 中国 → 市场弧线 + 流动脉冲 + 节点 ----
  const pulses = []
  const arcGroup = new THREE.Group()
  root.add(arcGroup)
  const mkArcMat = (op) => new THREE.LineBasicMaterial({
    color: 0x9be8ff, transparent: true, opacity: op,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const targets = MARKETS.slice(0, arcs)
  targets.forEach((m, i) => {
    const t = latLon(m.lat, m.lon, 1.01)
    const mid = {
      x: (HUB.x + t.x) / 2, y: (HUB.y + t.y) / 2, z: (HUB.z + t.z) / 2,
    }
    const lift = 1 + 0.28 * Math.hypot(HUB.x - t.x, HUB.y - t.y, HUB.z - t.z)
    const midN = (() => { const l = Math.hypot(mid.x, mid.y, mid.z) || 1; return { x: mid.x / l * lift, y: mid.y / l * lift, z: mid.z / l * lift } })()
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(HUB.x, HUB.y, HUB.z),
      new THREE.Vector3(midN.x, midN.y, midN.z),
      new THREE.Vector3(t.x, t.y, t.z),
    )
    const pts = curve.getPoints(64)
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    arcGroup.add(new THREE.Line(g, mkArcMat(0.34)))

    // 流动脉冲(小球沿弧线)
    const pulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xd9f6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    pulse.userData = { curve, offset: i * 0.17, speed: 0.1 + i * 0.013 }
    arcGroup.add(pulse)
    pulses.push(pulse)

    // 目标节点 + pulse 环
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x8be9ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    node.position.set(t.x, t.y, t.z)
    node.userData = { phase: i * 1.1, ring: true }
    arcGroup.add(node)
    pulses.push(node)
  })
  // 中国节点(琥珀)
  const hubNode = new THREE.Mesh(
    new THREE.SphereGeometry(0.026, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xf3c98b, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  hubNode.position.set(HUB.x, HUB.y, HUB.z)
  arcGroup.add(hubNode)
  pulses.push(hubNode)

  // ---- 灯光 ----
  scene.add(new THREE.AmbientLight(0xbfe3ff, 0.85))
  const key = new THREE.DirectionalLight(0x9fd8ff, 1.1)
  key.position.set(2.5, 2.2, 3)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6a8bff, 0.5)
  rim.position.set(-3, -1, -2)
  scene.add(rim)

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
    glow.material.opacity = 0.09 + 0.02 * Math.sin(t * 1.2)
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
