import { useEffect, useRef, useState } from 'react'

/**
 * TECH-BLUE GLOWING EARTH V9 — 参考图一比一配色渲染
 *
 * 视觉栈:
 *  1. 海洋 ShaderMaterial:深蓝→宝蓝渐变(受光面亮)+ 青色 Fresnel 边缘光 + 夜面城市灯
 *  2. 陆地点阵粒子层:从陆地掩码采样球面点,青白发光小点 + 逐点闪烁(参考图核心特征)
 *  3. 大气 Fresnel 双壳(加强)+ 球后大尺寸柔光晕板(additive,替代被禁用的 bloom)
 *  4. 保留:城市节点/贸易弧线/轨道环/底部平台/拖拽与自转动态
 *  bloom 仍禁用:UnrealBloomPass 在 alpha canvas 上会写 alpha=1 遮死 hero 背景。
 */
export default function Globe3D({ markets = 6 }) {
  const hostRef = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    let cleanup = null
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const mobile = window.matchMedia('(max-width: 768px)').matches

    Promise.all([
      import('three'),
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      import('three/examples/jsm/postprocessing/ShaderPass.js'),
    ]).then(([THREE, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }]) => {
      if (disposed || !hostRef.current) return
      try { cleanup = buildGlobe(THREE, hostRef.current, { reduced, mobile, arcs: mobile ? 3 : markets, EffectComposer, RenderPass, UnrealBloomPass, ShaderPass }) }
      catch (e) { console.warn('[Globe3D] init failed:', e); setFailed(true) }
    }).catch(() => setFailed(true))

    return () => { disposed = true; if (cleanup) cleanup() }
  }, [markets])

  if (failed) return (
    <div className="g3d-fallback"><div className="g3d-fallback-ball" /><div className="g3d-fallback-ring r1" /><div className="g3d-fallback-ring r2" /></div>
  )
  return <div className="g3d-host" ref={hostRef} aria-label="3D 数字地球(可拖动旋转)" />
}

const BASE = `${import.meta.env.BASE_URL}assets/globe/`

const HUB = ll(30, 105)
const TARGETS = [
  {lat:55.75,lon:37.6},{lat:51.5,lon:-0.1},{lat:40.7,lon:-74},{lat:1.35,lon:103.8},
  {lat:25.2,lon:55.3},{lat:-33.9,lon:151.2},{lat:52.5,lon:13.4},{lat:64.2,lon:-21.9},
]

function ll(lat, lon, r=1) {
  const phi=((90-lat)*Math.PI)/180, theta=((lon+180)*Math.PI)/180
  return {x:-r*Math.sin(phi)*Math.cos(theta), y:r*Math.cos(phi), z:r*Math.sin(phi)*Math.sin(theta)}
}

const FRESNEL_VERT = `
  varying vec3 vNormal; varying vec3 vPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const FRESNEL_FRAG = `
  uniform vec3 uColor; uniform float uIntensity; uniform float uPower;
  varying vec3 vNormal; varying vec3 vPos;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(-vPos))), uPower);
    gl_FragColor = vec4(uColor, f * uIntensity);
  }`

/* 陆地表面着色器:深蓝发光海洋 + 青色边缘光 + 夜面城市灯 */
const OCEAN_VERT = `
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vPos;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const OCEAN_FRAG = `
  uniform sampler2D uSpec; uniform sampler2D uNight;
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vPos;
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(-vPos);
    // 键盘光:左上前(与场景 key 灯同向),夜面留深
    vec3 L = normalize(vec3(0.35, 0.55, 0.85));
    float light = clamp(dot(N, L), 0.0, 1.0);
    float ocean = texture2D(uSpec, vUv).r;          // 高光图:海洋=白,陆地=黑
    // 深蓝(暗部)→ 宝蓝(受光面):参考图海洋是通透的亮蓝
    vec3 deep = vec3(0.012, 0.075, 0.22);
    vec3 vivid = vec3(0.055, 0.36, 0.88);
    vec3 col = mix(deep, vivid, 0.22 + 0.78 * light);
    // 陆地基底压暗(亮青点阵叠在上面,参考图陆地由点阵表达)
    col *= mix(0.32, 1.0, ocean);
    // Fresnel 边缘:亮青色包边(参考图球体边缘的发光轮廓)
    float fr = pow(1.0 - abs(dot(N, V)), 2.2);
    col += vec3(0.25, 0.72, 1.0) * fr * 1.15;
    // 夜面城市灯(冷白蓝)
    vec3 night = texture2D(uNight, vUv).rgb;
    col += night * vec3(0.45, 0.75, 1.0) * (1.0 - light) * 1.1;
    gl_FragColor = vec4(col, 1.0);
  }`

/* 陆地点阵:逐点闪烁的青白发光小点 */
const DOTS_VERT = `
  attribute float aPhase; attribute float aSize;
  uniform float uTime; uniform float uPx;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vA = 0.58 + 0.42 * sin(uTime * 1.5 + aPhase);
    gl_PointSize = aSize * uPx / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`
const DOTS_FRAG = `
  uniform vec3 uColA; uniform vec3 uColB;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.06, d) * vA;
    vec3 col = mix(uColA, uColB, clamp(vA * 0.9, 0.0, 1.0));
    gl_FragColor = vec4(col, a);
  }`

/** 从高光图采样陆地点阵:海洋=白(跳过),陆地=黑(生成球面点) */
async function buildLandDots(THREE, { mobile }) {
  const r = await fetch(BASE + 'earth-specular.webp')
  const bmp = await createImageBitmap(await r.blob())
  const W = mobile ? 512 : 1024, Hh = W / 2
  const c = document.createElement('canvas')
  c.width = W; c.height = Hh
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0, W, Hh)
  const px = ctx.getImageData(0, 0, W, Hh).data

  const R = 2.213
  const pos = [], phase = [], size = []
  const step = mobile ? 2 : 1
  for (let y = 0; y < Hh; y += step) {
    const lat = 90 - (y / Hh) * 180
    if (lat < -58 || lat > 82) continue            // 极地冰盖不铺点
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4
      if (px[i] > 70) continue                      // 高光图亮=海洋
      // 越亮的陆地贴图区越密/越大,模拟参考图“成簇的点阵”
      const lon = (x / W) * 360 - 180
      const p = ll(lat, lon, R)
      pos.push(p.x, p.y, p.z)
      phase.push(Math.random() * Math.PI * 2)
      size.push(0.55 + Math.random() * 0.75)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1))
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1))
  const mat = new THREE.ShaderMaterial({
    vertexShader: DOTS_VERT, fragmentShader: DOTS_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPx: { value: 20 },
      uColA: { value: new THREE.Color(0x45b5ff) },
      uColB: { value: new THREE.Color(0xeafaff) },
    },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  })
  return new THREE.Points(geo, mat)
}

function buildGlobe(THREE, host, { reduced, mobile, arcs, EffectComposer, RenderPass, UnrealBloomPass, ShaderPass }) {
  const W = () => host.clientWidth, H = () => host.clientHeight
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, alpha: true, powerPreference: 'high-performance' })
  const DPR = Math.min(window.devicePixelRatio, mobile ? 1.0 : 1.5)
  renderer.setPixelRatio(DPR)
  renderer.setSize(W(), H())
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.35
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, W()/H(), 0.1, 100)
  camera.position.set(0.4, 0.35, 7)
  camera.lookAt(0, 0, 0)

  const root = new THREE.Group()
  root.position.x = 0.4
  root.rotation.y = 4.2
  scene.add(root)

  const loader = new THREE.TextureLoader()
  const loadTex = (url, srgb=true) => {
    const t = loader.load(url)
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = renderer.capabilities.getMaxAnisotropy()
    return t
  }
  const specTex = loadTex(BASE + 'earth-specular.webp', false)
  const nightTex = loadTex(BASE + 'earth-night.webp', false)

  /* ---- 1. Earth:深蓝发光海洋(自写 shader,陆地由点阵表达) ---- */
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, mobile ? 64 : 128, mobile ? 48 : 96),
    new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG,
      uniforms: { uSpec: { value: specTex }, uNight: { value: nightTex } },
    }),
  )
  root.add(earth)

  /* ---- 2. 陆地点阵(异步采样,完成后挂载;清理竞态用 killed 标志) ---- */
  let killed = false
  let dots = null
  buildLandDots(THREE, { mobile }).then((pts) => {
    if (killed || !pts) return
    dots = pts
    pts.material.uniforms.uPx.value = 24 * DPR
    root.add(pts)
  }).catch(() => {})

  /* ---- 3. 球后大柔光晕(替代 bloom 的外围辉光) ---- */
  const haloCanvas = document.createElement('canvas'); haloCanvas.width = haloCanvas.height = 512
  const hctx = haloCanvas.getContext('2d')
  const hg = hctx.createRadialGradient(256, 256, 40, 256, 256, 256)
  hg.addColorStop(0, 'rgba(40,150,255,0.50)')
  hg.addColorStop(0.35, 'rgba(18,90,200,0.30)')
  hg.addColorStop(0.7, 'rgba(8,45,120,0.12)')
  hg.addColorStop(1, 'rgba(0,0,0,0)')
  hctx.fillStyle = hg; hctx.fillRect(0, 0, 512, 512)
  const haloTex = new THREE.CanvasTexture(haloCanvas)
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(9.5, 9.5),
    new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  halo.position.set(0.4, 0, -2.9)
  scene.add(halo)

  /* ---- 4. 内层加力蓝壳(海洋底部透出的蓝) ---- */
  const blueGlow = new THREE.Mesh(
    new THREE.SphereGeometry(2.201, mobile ? 48 : 96, mobile ? 36 : 72),
    new THREE.MeshBasicMaterial({
      color: 0x0d3f86, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
  root.add(blueGlow)

  /* ---- 5. Cloud Layer ---- */
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(2.23, mobile ? 32 : 64, mobile ? 24 : 48),
    new THREE.MeshStandardMaterial({
      color: 0xbfe2ff, transparent: true, opacity: mobile ? 0.03 : 0.05,
      roughness: 1, metalness: 0, depthWrite: false,
    }),
  )
  root.add(clouds)

  /* ---- 6. Atmosphere:加强 Fresnel 青蓝双壳(参考图强光晕) ---- */
  const atmos = [
    {r:2.26, color:[0.45,0.83,1.0], intensity:0.85, power:2.2},
    {r:2.46, color:[0.30,0.65,1.0], intensity:0.30, power:2.9},
  ].map(({r,color,intensity,power}) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: FRESNEL_VERT, fragmentShader: FRESNEL_FRAG,
      uniforms: { uColor:{value:new THREE.Color(...color)}, uIntensity:{value:intensity}, uPower:{value:power} },
      transparent:true, blending:THREE.AdditiveBlending, side:THREE.BackSide, depthWrite:false,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 36), mat)
    root.add(mesh)
    return mesh
  })

  /* ---- 7. Surface Grid(青色经纬网,略提亮) ---- */
  const gridGeo = new THREE.BufferGeometry()
  const gp = []
  for (let lat=-60; lat<=60; lat+=20) {
    for (let lon=0; lon<360; lon+=4) { const a=ll(lat,lon,2.21), b=ll(lat,lon+4,2.21); gp.push(a.x,a.y,a.z,b.x,b.y,b.z) }
  }
  for (let lon=0; lon<360; lon+=20) {
    for (let lat=-80; lat<80; lat+=4) { const a=ll(lat,lon,2.21), b=ll(lat+4,lon,2.21); gp.push(a.x,a.y,a.z,b.x,b.y,b.z) }
  }
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3))
  root.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({color:0x3fa0e8, transparent:true, opacity:0.05})))

  /* ---- 8. City Nodes + Hub ---- */
  const pulses = []
  const targets = TARGETS.slice(0, arcs)
  targets.forEach((m, i) => {
    const t = ll(m.lat, m.lon, 2.22)
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10),
      new THREE.MeshBasicMaterial({color:0xc9f2ff, transparent:true, opacity:0.95, blending:THREE.AdditiveBlending, depthWrite:false}))
    core.position.set(t.x, t.y, t.z); root.add(core)
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10),
      new THREE.MeshBasicMaterial({color:0x54c8ff, transparent:true, opacity:0.16, blending:THREE.AdditiveBlending, depthWrite:false}))
    glow.position.set(t.x, t.y, t.z); glow.userData = {phase:i*0.67, type:'pulse'}; root.add(glow); pulses.push(glow)
  })
  const hubP = ll(HUB.lat, HUB.lon, 2.22)
  const hubGlow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10),
    new THREE.MeshBasicMaterial({color:0xf3c98b, transparent:true, opacity:0.2, blending:THREE.AdditiveBlending, depthWrite:false}))
  hubGlow.position.set(hubP.x, hubP.y, hubP.z); hubGlow.userData={phase:0, type:'pulse'}; root.add(hubGlow); pulses.push(hubGlow)
  const hubCore = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 10),
    new THREE.MeshBasicMaterial({color:0xf8d9a8, blending:THREE.AdditiveBlending, depthWrite:false}))
  hubCore.position.set(hubP.x, hubP.y, hubP.z); root.add(hubCore)

  /* ---- 9. Trade Arcs + Flow Particles(青蓝发光丝线) ---- */
  const flows = []
  const arcMat = (op) => new THREE.MeshBasicMaterial({
    color: 0x6fc4ff, transparent: true, opacity: op,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const makeArc = (a, b, liftScale, op, seed) => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
    const l = Math.hypot(mid.x, mid.y, mid.z) || 1
    const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    const lift = 2.2 + liftScale * (0.12 + (seed % 5) * 0.035) * dist
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(mid.x / l * lift, mid.y / l * lift, mid.z / l * lift),
      new THREE.Vector3(b.x, b.y, b.z),
    )
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, 0.009 + (seed % 3) * 0.003, 6, false),
      arcMat(op),
    )
    root.add(tube)
    for (let j = 0; j < 4; j++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xd6f4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
      p.userData = { curve, offset: (seed * 4 + j) * 0.09, speed: 0.03 + j * 0.007 }
      root.add(p); flows.push(p)
    }
  }
  targets.forEach((m, i) => {
    makeArc(hubP, ll(m.lat, m.lon, 2.20), 1.0, 0.32, i)
  })
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      if ((i + j) % 2 === 0) makeArc(ll(targets[i].lat, targets[i].lon, 2.20), ll(targets[j].lat, targets[j].lon, 2.20), 1.4, 0.17, i + j * 3)
    }
  }

  /* ---- 10. Orbital Rings(青蓝丝带) ---- */
  const orbitRings = []
  ;[{r:2.75,tilt:0.30,rotZ:0.1,op:0.30,c:0x7fc4f5},{r:3.05,tilt:-0.20,rotZ:-0.15,op:0.18,c:0x93d2fa},
    {r:2.92,tilt:0.50,rotZ:0.25,op:0.22,c:0xa4dcff},{r:3.35,tilt:0.08,rotZ:0.4,op:0.11,c:0x86c8f2}].forEach(({r,tilt,rotZ,op,c},i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 8, 140),
      new THREE.MeshBasicMaterial({color:c, transparent:true, opacity:op, blending:THREE.AdditiveBlending, depthWrite:false}))
    ring.rotation.x = Math.PI/2 + tilt; ring.rotation.z = rotZ
    root.add(ring); orbitRings.push(ring)
    const sat = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6),
      new THREE.MeshBasicMaterial({color:0xbdeaff, transparent:true, opacity:0.6, blending:THREE.AdditiveBlending, depthWrite:false}))
    sat.userData = {orbitR:r, orbitTilt:tilt, phase:i*2.1, speed:0.08+i*0.03}
    root.add(sat); pulses.push(sat)
  })

  /* ---- 11. Platform + Ground Glow ---- */
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 256
  const gctx = glowCanvas.getContext('2d')
  const grad = gctx.createRadialGradient(128,128,0,128,128,128)
  grad.addColorStop(0,'rgba(50,180,255,0.28)'); grad.addColorStop(0.4,'rgba(30,120,220,0.13)'); grad.addColorStop(1,'rgba(0,0,0,0)')
  gctx.fillStyle = grad; gctx.fillRect(0,0,256,256)
  const glowTex = new THREE.CanvasTexture(glowCanvas)
  const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({map:glowTex, transparent:true, opacity:0.55, blending:THREE.AdditiveBlending, depthWrite:false}))
  glowPlane.rotation.x = -Math.PI/2; glowPlane.position.y = -2.2; scene.add(glowPlane)

  const platformRings = []
  for (let i=0; i<3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5+i*0.35, 0.006, 8, 100),
      new THREE.MeshBasicMaterial({color:0x4aa5e0, transparent:true, opacity:0.11-i*0.02, blending:THREE.AdditiveBlending, depthWrite:false}))
    ring.rotation.x = Math.PI/2 - 0.08; ring.position.y = -2.0 - i*0.06
    root.add(ring); platformRings.push(ring)
  }

  /* ---- 12. Lighting(云层 Standard 材质仍需灯光;海洋是 shader 自供) ---- */
  scene.add(new THREE.AmbientLight(0x9cc4ee, 1.1))
  const key = new THREE.DirectionalLight(0xcfe4ff, 1.3); key.position.set(2, 3, 9); scene.add(key)
  const rim = new THREE.DirectionalLight(0x5a9de8, 0.6); rim.position.set(-3, -0.5, -2); scene.add(rim)
  const fill = new THREE.DirectionalLight(0x3f7fd0, 0.5); fill.position.set(-1, 2, 1); scene.add(fill)

  /* ---- 13. Interaction ---- */
  const AUTO = 0.0014
  let vy=AUTO, dragging=false, lastX=0, lastY=0, inertiaX=0, inertiaY=0, idleTimer=0, hovering=false
  let pitch=0.18, mouseX=0, mouseY=0
  const onDown=(e)=>{dragging=true;idleTimer=0;lastX=e.clientX;lastY=e.clientY;inertiaX=inertiaY=0}
  const onMove=(e)=>{
    mouseX=(e.clientX/window.innerWidth-0.5)*2; mouseY=(e.clientY/window.innerHeight-0.5)*2
    if(!dragging)return
    const dx=e.clientX-lastX,dy=e.clientY-lastY; lastX=e.clientX;lastY=e.clientY
    root.rotation.y+=dx*0.003
    pitch=Math.max(-0.6,Math.min(0.6,pitch+dy*0.002))
    inertiaX=dx*0.003;inertiaY=dy*0.002
  }
  const onUp=()=>{dragging=false;idleTimer=performance.now()}
  const onEnter=()=>{hovering=true}; const onLeave=()=>{hovering=false}
  const el=renderer.domElement
  el.style.touchAction='none'; el.style.cursor='grab'
  el.addEventListener('pointerdown',onDown)
  window.addEventListener('pointermove',onMove)
  window.addEventListener('pointerup',onUp)
  el.addEventListener('pointerenter',onEnter)
  el.addEventListener('pointerleave',onLeave)
  const ro=new ResizeObserver(()=>{camera.aspect=W()/H();camera.updateProjectionMatrix();renderer.setSize(W(),H())})
  ro.observe(host)

  /* ---- 14. Render ---- */
  let raf=0; const t0=performance.now()
  const frame=(now)=>{
    const t=(now-t0)/1000
    if(!dragging){
      const idle=now-(idleTimer||0)
      const target=hovering?AUTO*0.35:AUTO
      vy+=(target-vy)*0.04
      root.rotation.y+=vy+inertiaX
      pitch=Math.max(-0.6,Math.min(0.6,pitch+inertiaY))
      inertiaX*=0.95;inertiaY*=0.92
    }
    root.rotation.x+=((pitch+mouseY*0.03)-root.rotation.x)*0.07
    root.rotation.z=mouseX*0.012
    clouds.rotation.y += 0.0004
    if (dots) dots.material.uniforms.uTime.value = t
    atmos[0].material.uniforms.uIntensity.value = 0.80 + 0.08 * Math.sin(t * 0.5)
    atmos[1].material.uniforms.uIntensity.value = 0.27 + 0.04 * Math.sin(t * 0.3 + 2)
    halo.material.opacity = 0.78 + 0.10 * Math.sin(t * 0.4)
    for(const p of flows){
      const k=(t*p.userData.speed+p.userData.offset)%1
      p.position.copy(p.userData.curve.getPoint(k))
      p.material.opacity=0.4+0.4*Math.sin(k*Math.PI)
    }
    for(const n of pulses){
      if(n.userData.type==='pulse'){
        const s=1+0.22*Math.sin(t*1.2+n.userData.phase); n.scale.setScalar(s)
        n.material.opacity=0.10+0.06*Math.sin(t*1.2+n.userData.phase)
      }else if(n.userData.orbitR){
        const ang=t*n.userData.speed+n.userData.phase; const r=n.userData.orbitR
        n.position.set(Math.cos(ang)*r, Math.sin(ang)*r*Math.sin(n.userData.orbitTilt), Math.sin(ang)*r*Math.cos(n.userData.orbitTilt))
      }
    }
    platformRings.forEach((r,i)=>{r.rotation.z+=0.0004*(i+1);r.material.opacity=(0.09-i*0.02)+0.015*Math.sin(t*0.6+i*1.2)})
    orbitRings.forEach(r=>{r.rotation.y+=0.0008})
    root.position.y=Math.sin(t*0.2)*0.02
    renderer.render(scene,camera)
    if(!reduced)raf=requestAnimationFrame(frame)
  }
  if(reduced)frame(t0); else raf=requestAnimationFrame(frame)

  return()=>{
    killed = true
    cancelAnimationFrame(raf);ro.disconnect()
    el.removeEventListener('pointerdown',onDown)
    window.removeEventListener('pointermove',onMove)
    window.removeEventListener('pointerup',onUp)
    el.removeEventListener('pointerenter',onEnter)
    el.removeEventListener('pointerleave',onLeave)
    specTex.dispose();nightTex.dispose();haloTex.dispose();glowTex.dispose()
    if (dots) { dots.geometry.dispose(); dots.material.dispose() }
    renderer.dispose()
    if(host.contains(el))host.removeChild(el)
  }
}
