import { useEffect, useRef, useState } from 'react'

/**
 * Premium 3D Digital Earth — Reference Image Grade
 * 大型发光数字地球,融入 Hero 背景(不是装在方框里)。
 * 技术:Three.js dynamic import + Fresnel Shader + MeshPhysicalMaterial
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
        try { cleanup = buildGlobe(THREE, hostRef.current, { reduced, mobile, arcs: mobile ? 3 : markets }) }
        catch { setFailed(true) }
      })
      .catch(() => setFailed(true))
    return () => { disposed = true; if (cleanup) cleanup() }
  }, [markets])

  if (failed) return (
    <div className="g3d-fallback">
      <div className="g3d-fallback-ball" />
      <div className="g3d-fallback-ring r1" />
      <div className="g3d-fallback-ring r2" />
    </div>
  )
  return <div className="g3d-host" ref={hostRef} aria-label="3D 数字地球(可拖动旋转)" />
}

/* ==================== Helpers ==================== */

const HUB = ll(30.0, 110.0)
const TARGETS = [
  { lat: 55.75, lon: 37.6 },  // Moscow
  { lat: 51.5, lon: -0.1 },   // London
  { lat: 40.7, lon: -74.0 },  // New York
  { lat: 1.35, lon: 103.8 },  // Singapore
  { lat: 25.2, lon: 55.3 },   // Dubai
  { lat: -33.9, lon: 151.2 }, // Sydney
]

function ll(lat, lon, r = 1) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180
  return {
    x: -r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi),
    z: r * Math.sin(phi) * Math.sin(theta),
  }
}

/** 粗粒度陆地检测 */
function isLand(lat, lon) {
  const bands = [
    [45, 70, 30, 180],    // Russia/Siberia
    [30, 55, 60, 145],    // China/Central Asia
    [20, 48, 70, 90],     // India/Middle East
    [35, 60, -10, 45],    // Europe
    [5, 35, -20, 52],     // Africa
    [15, 65, -170, -50],  // North America
    [-55, 20, -85, -30],  // South America
    [-45, -10, 110, 155], // Australia
    [60, 85, -70, -10],   // Greenland
    [10, 30, 75, 110],    // SE Asia
  ]
  return bands.some(([a, b, c, d]) => lat >= a && lat <= b && lon >= c && lon <= d)
}

/** 城市聚集区(高密度灯光) */
const CITY_CLUSTERS = [
  { lat: 40, lon: 116, r: 5 },   // Beijing
  { lat: 31, lon: 121, r: 4 },   // Shanghai
  { lat: 23, lon: 113, r: 4 },   // Guangzhou
  { lat: 51, lon: 0, r: 4 },     // London
  { lat: 48, lon: 2, r: 3 },     // Paris
  { lat: 52, lon: 13, r: 3 },    // Berlin
  { lat: 55, lon: 37, r: 4 },    // Moscow
  { lat: 40, lon: -74, r: 5 },   // New York
  { lat: 34, lon: -118, r: 4 },  // LA
  { lat: 41, lon: -87, r: 3 },   // Chicago
  { lat: 30, lon: 31, r: 3 },    // Cairo
  { lat: 25, lon: 55, r: 3 },    // Dubai
  { lat: 1, lon: 103, r: 3 },    // Singapore
  { lat: 35, lon: 139, r: 5 },   // Tokyo
]

function isNearCity(lat, lon) {
  return CITY_CLUSTERS.some(c =>
    Math.abs(lat - c.lat) < c.r && Math.abs(lon - c.lon) < c.r * 1.5
  )
}

/* Fresnel Shader */
const FRESNEL_VERT = `
  varying vec3 vNormal;
  varying vec3 vPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const FRESNEL_FRAG = `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPower;
  varying vec3 vNormal;
  varying vec3 vPos;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(-vPos))), uPower);
    gl_FragColor = vec4(uColor, f * uIntensity);
  }
`

/* ==================== Build ==================== */

function buildGlobe(THREE, host, { reduced, mobile, arcs }) {
  const W = () => host.clientWidth
  const H = () => host.clientHeight
  const renderer = new THREE.WebGLRenderer({
    antialias: !mobile, alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.0 : 1.5))
  renderer.setSize(W(), H())
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, W() / H(), 0.1, 50)
  camera.position.set(0.3, 0.4, 3.0)
  camera.lookAt(0, 0, 0)

  const root = new THREE.Group()
  scene.add(root)

  /* ---- 1. Earth Body (可见大陆/海洋层次) ---- */
  const earthGeo = new THREE.SphereGeometry(1, mobile ? 64 : 128, mobile ? 48 : 96)
  const earthMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a2a4a,          // 深海军蓝海洋
    metalness: 0.12,
    roughness: 0.42,
    clearcoat: 0.28,
    clearcoatRoughness: 0.5,
    emissive: 0x020812,
  })
  const earth = new THREE.Mesh(earthGeo, earthMat)
  root.add(earth)

  /* ---- 2. 大陆板块(冰蓝色 Mesh 层) ---- */
  const landPos = [], landCol = []
  const step = mobile ? 4 : 2
  const cLand = new THREE.Color(0x3a8fc8)   // 冰蓝大陆
  const cLand2 = new THREE.Color(0x5bb8e8)  // 亮冰蓝高原
  const cCity = new THREE.Color(0xffe8c0)   // 暖白城市灯光
  const cSea = new THREE.Color(0x0d3050)    // 深蓝海洋微点
  const cityPos = [], cityCol = []

  for (let lat = -85; lat <= 85; lat += step) {
    for (let lon = -180; lon < 180; lon += step) {
      const v = ll(lat, lon, 1.002)
      const land = isLand(lat, lon)
      const city = land && isNearCity(lat, lon)

      if (city) {
        cityPos.push(v.x, v.y, v.z)
        cityCol.push(cCity.r, cCity.g, cCity.b)
        // 城市周围也加点
        cityPos.push(v.x * 1.004, v.y * 1.004, v.z * 1.004)
        cityCol.push(cCity.r * 0.7, cCity.g * 0.7, cCity.b * 0.7)
      } else if (land) {
        landPos.push(v.x, v.y, v.z)
        const c = Math.random() > 0.5 ? cLand : cLand2
        landCol.push(c.r, c.g, c.b)
      } else if (Math.random() > 0.88) {
        // 海洋稀疏微点
        landPos.push(v.x, v.y, v.z)
        landCol.push(cSea.r, cSea.g, cSea.b)
      }
    }
  }

  // 大陆点阵
  const landGeo = new THREE.BufferGeometry()
  landGeo.setAttribute('position', new THREE.Float32BufferAttribute(landPos, 3))
  landGeo.setAttribute('color', new THREE.Float32BufferAttribute(landCol, 3))
  root.add(new THREE.Points(landGeo, new THREE.PointsMaterial({
    size: 0.008, vertexColors: true, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  })))

  // 城市灯光(更亮,独立渲染)
  if (cityPos.length > 0) {
    const cityGeo = new THREE.BufferGeometry()
    cityGeo.setAttribute('position', new THREE.Float32BufferAttribute(cityPos, 3))
    cityGeo.setAttribute('color', new THREE.Float32BufferAttribute(cityCol, 3))
    root.add(new THREE.Points(cityGeo, new THREE.PointsMaterial({
      size: 0.012, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    })))
  }

  /* ---- 3. Atmosphere (Fresnel Shader,3层) ---- */
  const atmos = [
    { r: 1.015, color: [0.3, 0.7, 1.0], intensity: 0.38, power: 2.2 },
    { r: 1.05, color: [0.2, 0.5, 0.9], intensity: 0.22, power: 2.8 },
    { r: 1.12, color: [0.4, 0.3, 0.8], intensity: 0.10, power: 3.2 },
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

  /* ---- 4. 经纬网(极淡) ---- */
  const gridGeo = new THREE.BufferGeometry()
  const gp = []
  for (let lat = -60; lat <= 60; lat += 20) {
    for (let lon = 0; lon < 360; lon += 4) {
      const a = ll(lat, lon, 1.001), b = ll(lat, lon + 4, 1.001)
      gp.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  for (let lon = 0; lon < 360; lon += 20) {
    for (let lat = -80; lat < 80; lat += 4) {
      const a = ll(lat, lon, 1.001), b = ll(lat + 4, lon, 1.001)
      gp.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3))
  root.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
    color: 0x4a90d0, transparent: true, opacity: 0.06,
  })))

  /* ---- 5. Global Arcs(流光粒子) ---- */
  const flows = []
  const pulses = []
  const targets = TARGETS.slice(0, arcs)

  targets.forEach((m, i) => {
    const t = ll(m.lat, m.lon, 1.008)
    const dist = Math.hypot(HUB.x - t.x, HUB.y - t.y, HUB.z - t.z)
    const mid = { x: (HUB.x+t.x)/2, y: (HUB.y+t.y)/2, z: (HUB.z+t.z)/2 }
    const l = Math.hypot(mid.x, mid.y, mid.z) || 1
    const lift = 1 + (0.18 + i * 0.02) * dist
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(HUB.x, HUB.y, HUB.z),
      new THREE.Vector3(mid.x/l*lift, mid.y/l*lift, mid.z/l*lift),
      new THREE.Vector3(t.x, t.y, t.z),
    )
    // 弧线
    const pts = curve.getPoints(60)
    root.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: i % 3 === 0 ? 0x6cc6f7 : i % 3 === 1 ? 0xa78bfa : 0x5bc8f7,
        transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    ))
    // 流光粒子
    for (let j = 0; j < 3; j++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.005, 8, 6),
        new THREE.MeshBasicMaterial({
          color: 0xd0f0ff, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      )
      p.userData = { curve, offset: (i * 3 + j) * 0.13, speed: 0.04 + j * 0.01 }
      root.add(p)
      flows.push(p)
    }
    // 目标节点
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0x5bc8f7, transparent: true, opacity: 0.15,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    )
    glow.position.set(t.x, t.y, t.z)
    glow.userData = { phase: i * 0.67, type: 'pulse' }
    root.add(glow)
    pulses.push(glow)

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.009, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0x9be8ff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    )
    core.position.set(t.x, t.y, t.z)
    root.add(core)
  })

  // 中国节点(琥珀)
  const hubGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0xf3c98b, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
  hubGlow.position.set(HUB.x, HUB.y, HUB.z)
  hubGlow.userData = { phase: 0, type: 'pulse' }
  root.add(hubGlow)
  pulses.push(hubGlow)

  const hubCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xf8d9a8, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  hubCore.position.set(HUB.x, HUB.y, HUB.z)
  root.add(hubCore)

  /* ---- 6. 底部光环(平台感) ---- */
  const platformRings = []
  const ringColors = [0x4a90d0, 0x2a6aa8, 0x1a4a78]
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.25 + i * 0.18, 0.003, 8, 100),
      new THREE.MeshBasicMaterial({
        color: ringColors[i], transparent: true, opacity: 0.10 - i * 0.02,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    )
    ring.rotation.x = Math.PI / 2 - 0.12
    ring.position.y = -0.65 - i * 0.04
    root.add(ring)
    platformRings.push(ring)
  }

  /* ---- 7. 灯光 ---- */
  scene.add(new THREE.AmbientLight(0x87b6d8, 0.40))
  const key = new THREE.DirectionalLight(0xc0e0ff, 1.35); key.position.set(2.5, 2, 3); scene.add(key)
  const rim = new THREE.DirectionalLight(0x8b6cf5, 0.25); rim.position.set(-3, -0.5, -2); scene.add(rim)
  const fill = new THREE.DirectionalLight(0x4fb8f0, 0.20); fill.position.set(-1, 2, 1); scene.add(fill)

  /* ---- 8. 交互 ---- */
  const AUTO = 0.0016  // ~39s/圈
  let vy = AUTO, dragging = false, lastX = 0, lastY = 0
  let inertiaX = 0, inertiaY = 0, idleTimer = 0, hovering = false
  let pitch = 0.22, mouseX = 0, mouseY = 0

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
    pitch = Math.max(-0.7, Math.min(0.7, pitch + dy * 0.003))
    inertiaX = dx * 0.004; inertiaY = dy * 0.003
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

  const ro = new ResizeObserver(() => {
    camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H())
  })
  ro.observe(host)

  /* ---- 9. 渲染循环 ---- */
  let raf = 0
  const t0 = performance.now()
  const frame = (now) => {
    const t = (now - t0) / 1000
    if (!dragging) {
      const idle = now - (idleTimer || 0)
      const target = hovering ? AUTO * 0.35 : AUTO
      vy += (target - vy) * 0.05
      root.rotation.y += vy + inertiaX
      pitch = Math.max(-0.7, Math.min(0.7, pitch + inertiaY))
      inertiaX *= 0.95; inertiaY *= 0.92
    }
    const targetPitch = pitch + mouseY * 0.04
    root.rotation.x += (targetPitch - root.rotation.x) * 0.08
    root.rotation.z = mouseX * 0.015

    // Atmosphere breathing
    atmos[0].material.uniforms.uIntensity.value = 0.35 + 0.04 * Math.sin(t * 0.6)
    atmos[2].material.uniforms.uIntensity.value = 0.09 + 0.02 * Math.sin(t * 0.35 + 2)

    // Flow particles
    for (const p of flows) {
      const k = (t * p.userData.speed + p.userData.offset) % 1
      p.position.copy(p.userData.curve.getPoint(k))
      p.material.opacity = 0.5 + 0.4 * Math.sin(k * Math.PI)
    }

    // Node pulses
    for (const n of pulses) {
      if (n.userData.type === 'pulse') {
        const s = 1 + 0.25 * Math.sin(t * 1.3 + n.userData.phase)
        n.scale.setScalar(s)
        n.material.opacity = 0.12 + 0.06 * Math.sin(t * 1.3 + n.userData.phase)
      }
    }

    // Platform rings breathing
    platformRings.forEach((r, i) => {
      r.material.opacity = (0.08 - i * 0.02) + 0.02 * Math.sin(t * 0.8 + i * 1.2)
      r.rotation.z += 0.0003 * (i + 1)
    })

    // Earth subtle float
    root.position.y = Math.sin(t * 0.25) * 0.012

    renderer.render(scene, camera)
    if (!reduced) raf = requestAnimationFrame(frame)
  }
  if (reduced) frame(t0)
  else raf = requestAnimationFrame(frame)

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
