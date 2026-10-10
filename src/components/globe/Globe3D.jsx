import { useEffect, useRef, useState } from 'react'

/**
 * Premium 3D Earth — Design Competition Grade(P0-1 v3)
 *
 * 技术:Three.js(dynamic import)+ 自定义 Fresnel Shader 大气层 + MeshPhysicalMaterial
 * 视觉:深蓝玻璃地球 / 冰蓝城市灯光 / 青蓝网络节点 / 柔和大气辉光 / 流光弧线
 * 交互:慢自转(25-40s/圈)/ 拖拽(惯性)/ 松手 2.5s 恢复 / 悬停减速 / 视差
 * 降级:移动端减粒子/弧线;reduced-motion 静帧;WebGL 失败 CSS 回退
 */
export default function Globe3D({ markets = 8 }) {
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
        try { cleanup = buildGlobe(THREE, hostRef.current, { reduced, mobile, arcs: mobile ? 3 : markets }) }
        catch { setFailed(true) }
      })
      .catch(() => setFailed(true))
    return () => { disposed = true; if (cleanup) cleanup() }
  }, [markets])

  if (failed) return <div className="g3d-fallback"><div className="g3d-fallback-ball" /></div>
  return <div className="g3d-host" ref={hostRef} aria-label="3D 地球(可拖动旋转)" />
}

/* ============================== Helpers ============================== */

const HUB = ll(23.0, 113.1)
const MARKETS = [
  { lat: 55.75, lon: 37.6 }, { lat: 51.5, lon: -0.12 },
  { lat: 40.7, lon: -74.0 }, { lat: 1.35, lon: 103.8 },
  { lat: 25.2, lon: 55.27 }, { lat: -33.87, lon: 151.2 },
  { lat: 52.5, lon: 13.4 }, { lat: 35.7, lon: 139.7 },
]

function ll(lat, lon, r = 1) {
  const phi = ((90 - lat) * Math.PI) / 180, theta = ((lon + 180) * Math.PI) / 180
  return { x: -r * Math.sin(phi) * Math.cos(theta), y: r * Math.cos(phi), z: r * Math.sin(phi) * Math.sin(theta) }
}

function isLand(lat, lon) {
  const bands = [
    [50,70,60,180],[30,50,-10,60],[20,45,75,135],[5,32,95,125],
    [-10,32,-20,52],[15,60,-130,-55],[-55,15,-85,-30],[-40,-10,110,155],[60,82,-60,-10],
  ]
  return bands.some(([a,b,c,d]) => lat>=a && lat<=b && lon>=c && lon<=d)
}

/* Fresnel Shader(大气层边缘光) */
const FRESNEL_VERT = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRESNEL_FRAG = `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPower;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(-vPosition))), uPower);
    gl_FragColor = vec4(uColor, fresnel * uIntensity);
  }
`

/* ============================== Build ============================== */

function buildGlobe(THREE, host, { reduced, mobile, arcs }) {
  const W = () => host.clientWidth, H = () => host.clientHeight
  const renderer = new THREE.WebGLRenderer({
    antialias: !mobile, alpha: true, powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.0 : 1.5))
  renderer.setSize(W(), H())
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, W() / H(), 0.1, 30)
  camera.position.set(0, 0.5, 3.2)
  camera.lookAt(0, 0, 0)

  const root = new THREE.Group()
  scene.add(root)

  /* ---- 1. Earth Body(MeshPhysicalMaterial 深蓝玻璃) ---- */
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, mobile ? 48 : 96, mobile ? 36 : 72),
    new THREE.MeshPhysicalMaterial({
      color: 0x062659,
      metalness: 0.15,
      roughness: 0.35,
      clearcoat: 0.3,
      clearcoatRoughness: 0.4,
      emissive: 0x020d1f,
    }),
  )
  root.add(earth)

  /* ---- 2. Fresnel Atmosphere(Shader 边缘光,3层) ---- */
  const atmos = [
    { r: 1.02, color: [0.35, 0.78, 1.0], intensity: 0.35, power: 2.5 },
    { r: 1.06, color: [0.2, 0.55, 0.95], intensity: 0.20, power: 3.0 },
    { r: 1.14, color: [0.45, 0.35, 0.85], intensity: 0.08, power: 3.5 }, // 微紫
  ].map(({ r, color, intensity, power }) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: FRESNEL_VERT,
      fragmentShader: FRESNEL_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(...color) },
        uIntensity: { value: intensity },
        uPower: { value: power },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 36), mat)
    root.add(mesh)
    return mesh
  })

  /* ---- 3. City Light Dots(冰蓝城市灯光,多级亮度) ---- */
  const step = mobile ? 4 : 2
  const dotPos = [], dotCol = [], dotSz = []
  const landA = new THREE.Color(0x7ddfff)  // 亮冰蓝
  const landB = new THREE.Color(0x3a8fd0)  // 中蓝
  const seaC = new THREE.Color(0x0d2d4e)   // 暗海
  for (let lat = -84; lat <= 84; lat += step) {
    for (let lon = -180; lon < 180; lon += step) {
      const land = isLand(lat, lon)
      if (!land && Math.random() > 0.12) continue
      const v = ll(lat, lon, 1.003)
      dotPos.push(v.x, v.y, v.z)
      const c = land ? (Math.random() > 0.6 ? landA : landB) : seaC
      dotCol.push(c.r, c.g, c.b)
      dotSz.push(land ? 1.0 + Math.random() * 0.8 : 0.6)
    }
  }
  const dotGeo = new THREE.BufferGeometry()
  dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dotPos, 3))
  dotGeo.setAttribute('color', new THREE.Float32BufferAttribute(dotCol, 3))
  root.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({
    size: 0.010, vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  })))

  /* ---- 4. Network Arcs(流光粒子沿 Bezier 移动) ---- */
  const flowParticles = []
  const pulseNodes = []
  const targets = MARKETS.slice(0, arcs)

  targets.forEach((m, i) => {
    const t = ll(m.lat, m.lon, 1.01)
    const dist = Math.hypot(HUB.x - t.x, HUB.y - t.y, HUB.z - t.z)
    const mid = { x: (HUB.x+t.x)/2, y: (HUB.y+t.y)/2, z: (HUB.z+t.z)/2 }
    const l = Math.hypot(mid.x, mid.y, mid.z) || 1
    const lift = 1 + 0.20 * dist
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(HUB.x, HUB.y, HUB.z),
      new THREE.Vector3(mid.x/l*lift, mid.y/l*lift, mid.z/l*lift),
      new THREE.Vector3(t.x, t.y, t.z),
    )
    // 弧线(渐隐)
    const pts = curve.getPoints(60)
    root.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: i % 3 === 0 ? 0x7cc4f7 : i % 3 === 1 ? 0xa78bfa : 0x5bc8f7,
        transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    ))
    // 流光粒子(3个/弧线,不同速度和相位)
    for (let j = 0; j < 3; j++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.006, 8, 6),
        new THREE.MeshBasicMaterial({
          color: 0xd0f0ff, transparent: true, opacity: 0.8,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      )
      p.userData = { curve, offset: (i * 3 + j) * 0.11, speed: 0.045 + j * 0.012 }
      root.add(p)
      flowParticles.push(p)
    }
    // 目标节点(pulse,不同相位)
    const nodeGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0x4fb8f0, transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    )
    nodeGlow.position.set(t.x, t.y, t.z)
    nodeGlow.userData = { phase: i * 0.73, type: 'pulse' }
    root.add(nodeGlow)
    pulseNodes.push(nodeGlow)

    const nodeCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.011, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0x9be8ff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    )
    nodeCore.position.set(t.x, t.y, t.z)
    root.add(nodeCore)
  })

  // 中国节点(琥珀色,双 glow)
  const hubGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0xf3c98b, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
  hubGlow.position.set(HUB.x, HUB.y, HUB.z)
  hubGlow.userData = { phase: 0, type: 'pulse' }
  root.add(hubGlow)
  pulseNodes.push(hubGlow)

  const hubCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xf8d9a8, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  hubCore.position.set(HUB.x, HUB.y, HUB.z)
  root.add(hubCore)

  /* ---- 5. 星空(极微弱) ---- */
  if (!mobile) {
    const starPos = []
    for (let i = 0; i < 120; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1)
      const r = 10 + Math.random() * 6
      starPos.push(r*Math.sin(ph)*Math.cos(th), r*Math.cos(ph), r*Math.sin(ph)*Math.sin(th))
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({
      size: 0.015, color: 0x7ab0d8, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })))
  }

  /* ---- 6. Lighting(三点布光 + 环境光) ---- */
  scene.add(new THREE.AmbientLight(0x87b6d8, 0.45))
  const key = new THREE.DirectionalLight(0xbfe3ff, 1.4); key.position.set(2.5, 2.2, 3); scene.add(key)
  const rim = new THREE.DirectionalLight(0x8b6cf5, 0.30); rim.position.set(-3, -0.5, -2.5); scene.add(rim)
  const fill = new THREE.DirectionalLight(0x4fb8f0, 0.22); fill.position.set(-1, 2, 1); scene.add(fill)

  /* ---- 7. Interaction(drag + inertia + resume + hover slow + parallax) ---- */
  const AUTO_SPEED = 0.0018  // ~35s/圈(非常慢)
  let vy = AUTO_SPEED, vyTarget = AUTO_SPEED
  let dragging = false, lastX = 0, lastY = 0, inertiaX = 0, inertiaY = 0
  let idleTimer = 0, hovering = false
  let pitch = 0.28
  let mouseX = 0, mouseY = 0 // parallax

  const onDown = (e) => {
    dragging = true; idleTimer = 0
    lastX = e.clientX; lastY = e.clientY
    inertiaX = inertiaY = 0
  }
  const onMove = (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2
    if (!dragging) return
    const dx = e.clientX - lastX, dy = e.clientY - lastY
    lastX = e.clientX; lastY = e.clientY
    root.rotation.y += dx * 0.004
    pitch = Math.max(-0.8, Math.min(0.8, pitch + dy * 0.003))
    inertiaX = dx * 0.004
    inertiaY = dy * 0.003
  }
  const onUp = () => { dragging = false; idleTimer = performance.now() }
  const onEnter = () => { hovering = true }
  const onLeave = () => { hovering = false }

  const el = renderer.domElement
  el.style.touchAction = 'none'; el.style.cursor = 'grab'
  el.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  el.addEventListener('pointerenter', onEnter)
  el.addEventListener('pointerleave', onLeave)

  const onResize = () => {
    camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H())
  }
  const ro = new ResizeObserver(onResize); ro.observe(host)

  /* ---- 8. Render Loop ---- */
  let raf = 0
  const t0 = performance.now()
  const renderFrame = (now) => {
    const t = (now - t0) / 1000
    if (!dragging) {
      const idle = now - (idleTimer || 0)
      const target = hovering ? AUTO_SPEED * 0.35 : AUTO_SPEED
      vy += (target - vy) * 0.05
      root.rotation.y += vy + inertiaX
      pitch = Math.max(-0.8, Math.min(0.8, pitch + inertiaY))
      inertiaX *= 0.95
      inertiaY *= 0.92
    }
    // Pitch smoothing + parallax
    const targetPitch = pitch + mouseY * 0.06
    root.rotation.x += (targetPitch - root.rotation.x) * 0.08
    root.rotation.z = mouseX * 0.02

    // Atmosphere breathing
    atmos[0].material.uniforms.uIntensity.value = 0.32 + 0.04 * Math.sin(t * 0.7)
    atmos[2].material.uniforms.uIntensity.value = 0.07 + 0.02 * Math.sin(t * 0.4 + 2.0)

    // Flow particles
    for (const p of flowParticles) {
      const k = (t * p.userData.speed + p.userData.offset) % 1
      p.position.copy(p.userData.curve.getPoint(k))
      p.material.opacity = 0.5 + 0.4 * Math.sin(k * Math.PI)
    }

    // Node pulses(不同频率/相位 → 自然感)
    for (const n of pulseNodes) {
      if (n.userData.type === 'pulse') {
        const s = 1 + 0.30 * Math.sin(t * 1.4 + n.userData.phase)
        n.scale.setScalar(s)
        n.material.opacity = 0.14 + 0.08 * Math.sin(t * 1.4 + n.userData.phase)
      }
    }

    // Earth subtle float
    root.position.y = Math.sin(t * 0.3) * 0.015

    renderer.render(scene, camera)
    if (!reduced) raf = requestAnimationFrame(renderFrame)
  }
  if (reduced) { renderFrame(t0) }
  else { raf = requestAnimationFrame(renderFrame) }

  return () => {
    cancelAnimationFrame(raf); ro.disconnect()
    el.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointerenter', onEnter)
    el.removeEventListener('pointerleave', onLeave)
    renderer.dispose()
    if (host.contains(el)) host.removeChild(el)
  }
}
