import { useEffect, useRef, useState } from 'react'

/**
 * PREMIUM CINEMATIC 3D GLOBE V4 — 真实冰蓝地球贴图版
 *
 * 贴图来源: NASA/three.js 公开素材,经处理为冰蓝科技风格
 * 视觉栈: 真实 Earth Day/Night/Normal/Specular 贴图 + Fresnel 大气
 *         + Cloud Layer + 城市节点 + 贸易弧线 + 轨道环 + 底部平台 + Bloom
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

/** 贴图掩码处理:fetch 原图 → 离屏 canvas 按亮度二值化 → CanvasTexture。
 *  night 模式提取城市灯(仅最亮部为白),land 模式提取陆地掩码;供 emissiveMap 使用。
 *  阈值取「最大亮度 × keep」的相对值,避免处理过的贴图整体偏亮导致全图点亮。 */
async function makeMaskTexture(file, keep = 0.75) {
  const r = await fetch(BASE + file)
  const bmp = await createImageBitmap(await r.blob())
  const c = document.createElement('canvas')
  c.width = 512; c.height = 256
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0, 512, 256)
  const img = ctx.getImageData(0, 0, 512, 256)
  const px = img.data
  let max = 0
  for (let i = 0; i < px.length; i += 4) {
    const b = (px[i] + px[i + 1] + px[i + 2]) / 3
    if (b > max) max = b
  }
  const thr = max * keep
  for (let i = 0; i < px.length; i += 4) {
    const b = (px[i] + px[i + 1] + px[i + 2]) / 3
    const on = b >= thr ? 255 : 0
    px[i] = on; px[i + 1] = on; px[i + 2] = on; px[i + 3] = on
  }
  ctx.putImageData(img, 0, 0)
  return c
}

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

function buildGlobe(THREE, host, { reduced, mobile, arcs, EffectComposer, RenderPass, UnrealBloomPass, ShaderPass }) {
  const W = () => host.clientWidth, H = () => host.clientHeight
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.0 : 1.5))
  renderer.setSize(W(), H())
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, W()/H(), 0.1, 100)
  // 完整球体构图(参考图1):FOV 放宽 + 相机适中,球体完整且装饰元素(丝线/环/点阵)保持可见
  camera.position.set(0.4, 0.35, 7)
  camera.lookAt(0, 0, 0)

  const root = new THREE.Group()
  root.position.x = 0.4
  // 初始相位:欧亚非大陆(点阵最密区+hub)朝向相机;自转在此基础上继续累加
  root.rotation.y = 1.0
  scene.add(root)

  const loader = new THREE.TextureLoader()

  /* ---- 1. Earth Mesh(图1 风格:真实地表贴图蓝色调 + 城市灯 emissive) ---- */
  const loadTex = (url, srgb=true) => {
    const t = loader.load(url)
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = renderer.capabilities.getMaxAnisotropy()
    return t
  }
  const dayTex = loadTex(BASE + 'earth-day.webp')
  const normalTex = loadTex(BASE + 'earth-normal.webp', false)
  const specTex = loadTex(BASE + 'earth-specular.webp', false)

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, mobile ? 64 : 128, mobile ? 48 : 96),
    new THREE.MeshStandardMaterial({
      // 真实地表 + 蓝色调(color 乘法压住银白,保留大陆轮廓)
      map: dayTex,
      color: new THREE.Color(0x6f9cd8),
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: specTex,
      roughness: 0.5,
      metalness: 0.12,
      emissive: new THREE.Color(0x1e5fd0),
      emissiveIntensity: 0.5,
    }),
  )
  root.add(earth)

  /* ---- 1b. 城市灯层(异步:night 贴图阈值提取灯点 → 金白 emissive) + 大陆蓝光层(day 阈值提取陆地 → 蓝 emissive) ---- */
  makeMaskTexture('earth-night.webp', 0.78).then((c) => {
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    const city = new THREE.Mesh(
      new THREE.SphereGeometry(2.204, mobile ? 48 : 96, mobile ? 36 : 72),
      new THREE.MeshStandardMaterial({
        color: 0x000000, roughness: 1, metalness: 0,      // 光照全黑,只留 emissive
        emissiveMap: t, emissive: new THREE.Color(0xffe0b0), emissiveIntensity: 1.5,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }),
    )
    root.add(city)
    host.dataset.cityOk = '1'
  }).catch((e) => { host.dataset.cityErr = String((e && e.message) || e).slice(0, 160) })

  makeMaskTexture('earth-day.webp', 0.55).then((c) => {
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    const landGlow = new THREE.Mesh(
      new THREE.SphereGeometry(2.202, mobile ? 48 : 96, mobile ? 36 : 72),
      new THREE.MeshStandardMaterial({
        color: 0x000000, roughness: 1, metalness: 0,
        emissiveMap: t, emissive: new THREE.Color(0x2e7fff), emissiveIntensity: 1.15,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }),
    )
    root.add(landGlow)
    host.dataset.landOk = '1'
  }).catch((e) => { host.dataset.landErr = String((e && e.message) || e).slice(0, 160) })

  /* ---- 2. Cloud Layer(独立透明球,异速旋转;低不透明度避免盖过点阵) ---- */
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xcfe8ff,
    transparent: true,
    opacity: mobile ? 0.03 : 0.055,
    roughness: 1, metalness: 0,
    depthWrite: false,
  })
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(2.23, mobile ? 32 : 64, mobile ? 24 : 48),
    cloudMat,
  )
  root.add(clouds)

  /* ---- 3. Atmosphere(3层 Fresnel,图1 亮青色外发光) ---- */
  const atmos = [
    {r:2.25, color:[0.30,0.75,1.0], intensity:0.5, power:2.2},
    {r:2.34, color:[0.20,0.55,1.0], intensity:0.26, power:2.6},
    {r:2.52, color:[0.40,0.35,1.0], intensity:0.12, power:3.0},
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

  /* ---- 4. Surface Network Layer(极淡经纬网) ---- */
  const gridGeo = new THREE.BufferGeometry()
  const gp = []
  for (let lat=-60; lat<=60; lat+=20) {
    for (let lon=0; lon<360; lon+=4) { const a=ll(lat,lon,2.21), b=ll(lat,lon+4,2.21); gp.push(a.x,a.y,a.z,b.x,b.y,b.z) }
  }
  for (let lon=0; lon<360; lon+=20) {
    for (let lat=-80; lat<80; lat+=4) { const a=ll(lat,lon,2.21), b=ll(lat+4,lon,2.21); gp.push(a.x,a.y,a.z,b.x,b.y,b.z) }
  }
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3))
  root.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({color:0x4a90d0, transparent:true, opacity:0.03})))

  /* ---- 5. City Nodes + Hub ---- */
  const pulses = []
  const targets = TARGETS.slice(0, arcs)
  targets.forEach((m, i) => {
    const t = ll(m.lat, m.lon, 2.22)
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10),
      new THREE.MeshBasicMaterial({color:0x9be8ff, transparent:true, opacity:0.95, blending:THREE.AdditiveBlending, depthWrite:false}))
    core.position.set(t.x, t.y, t.z); root.add(core)
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.040, 12, 10),
      new THREE.MeshBasicMaterial({color:0x5bc8f7, transparent:true, opacity:0.15, blending:THREE.AdditiveBlending, depthWrite:false}))
    glow.position.set(t.x, t.y, t.z); glow.userData = {phase:i*0.67, type:'pulse'}; root.add(glow); pulses.push(glow)
  })
  const hubP = ll(HUB.lat, HUB.lon, 2.22)
  const hubGlow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10),
    new THREE.MeshBasicMaterial({color:0xf3c98b, transparent:true, opacity:0.2, blending:THREE.AdditiveBlending, depthWrite:false}))
  hubGlow.position.set(hubP.x, hubP.y, hubP.z); hubGlow.userData={phase:0, type:'pulse'}; root.add(hubGlow); pulses.push(hubGlow)
  const hubCore = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 10),
    new THREE.MeshBasicMaterial({color:0xf8d9a8, blending:THREE.AdditiveBlending, depthWrite:false}))
  hubCore.position.set(hubP.x, hubP.y, hubP.z); root.add(hubCore)

  /* ---- 6. Trade Arcs + Flow Particles(图1 式发光丝线:hub 放射 + 节点互联) ---- */
  const flows = []
  const arcMat = (op) => new THREE.MeshBasicMaterial({
    color: 0x49c6ff, transparent: true, opacity: op,
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
        new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
      p.userData = { curve, offset: (seed * 4 + j) * 0.09, speed: 0.03 + j * 0.007 }
      root.add(p); flows.push(p)
    }
  }
  targets.forEach((m, i) => {
    makeArc(hubP, ll(m.lat, m.lon, 2.20), 1.0, 0.30, i)          // hub 放射
  })
  // 节点互联丝线(图1 的密集网状光弧)
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      if ((i + j) % 2 === 0) makeArc(ll(targets[i].lat, targets[i].lon, 2.20), ll(targets[j].lat, targets[j].lon, 2.20), 1.4, 0.16, i + j * 3)
    }
  }

  /* ---- 7. Orbital Rings(图1:多层光带环绕) ---- */
  const orbitRings = []
  ;[{r:2.75,tilt:0.30,rotZ:0.1,op:0.16,c:0x37D9FF},{r:3.05,tilt:-0.20,rotZ:-0.15,op:0.10,c:0x4F8FFF},
    {r:2.92,tilt:0.50,rotZ:0.25,op:0.12,c:0x856AFF},{r:3.35,tilt:0.08,rotZ:0.4,op:0.07,c:0x37D9FF}].forEach(({r,tilt,rotZ,op,c},i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 8, 140),
      new THREE.MeshBasicMaterial({color:c, transparent:true, opacity:op, blending:THREE.AdditiveBlending, depthWrite:false}))
    ring.rotation.x = Math.PI/2 + tilt; ring.rotation.z = rotZ
    root.add(ring); orbitRings.push(ring)
    const sat = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6),
      new THREE.MeshBasicMaterial({color:0x9be8ff, transparent:true, opacity:0.6, blending:THREE.AdditiveBlending, depthWrite:false}))
    sat.userData = {orbitR:r, orbitTilt:tilt, phase:i*2.1, speed:0.08+i*0.03}
    root.add(sat); pulses.push(sat)
  })

  /* ---- 8. Platform + Ground Glow ---- */
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 256
  const gctx = glowCanvas.getContext('2d')
  const grad = gctx.createRadialGradient(128,128,0,128,128,128)
  grad.addColorStop(0,'rgba(50,180,255,0.25)'); grad.addColorStop(0.4,'rgba(30,120,220,0.12)'); grad.addColorStop(1,'rgba(0,0,0,0)')
  gctx.fillStyle = grad; gctx.fillRect(0,0,256,256)
  const glowTex = new THREE.CanvasTexture(glowCanvas)
  const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({map:glowTex, transparent:true, opacity:0.5, blending:THREE.AdditiveBlending, depthWrite:false}))
  glowPlane.rotation.x = -Math.PI/2; glowPlane.position.y = -2.2; scene.add(glowPlane)

  const platformRings = []
  for (let i=0; i<3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5+i*0.35, 0.006, 8, 100),
      new THREE.MeshBasicMaterial({color:0x4a90d0, transparent:true, opacity:0.10-i*0.02, blending:THREE.AdditiveBlending, depthWrite:false}))
    ring.rotation.x = Math.PI/2 - 0.08; ring.position.y = -2.0 - i*0.06
    root.add(ring); platformRings.push(ring)
  }

  /* ---- 9. Lighting ---- */
  scene.add(new THREE.AmbientLight(0x9cc4e8, 0.5))
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(2, 3, 9); scene.add(key)
  const rim = new THREE.DirectionalLight(0x856AFF, 0.3); rim.position.set(-3, -0.5, -2); scene.add(rim)
  const fill = new THREE.DirectionalLight(0x37D9FF, 0.35); fill.position.set(-1, 2, 1); scene.add(fill)

  /* ---- 10. Bloom(已禁用) ----
   * EffectComposer/UnrealBloomPass 在 alpha canvas 上输出不透明黑底
   * (renderTarget alpha 被 bloom pass 写成 1),把 hero 背景图整块遮死。
   * 辉光改由场景内元素自供:Fresnel 大气壳 + 城市灯 emissive + 辉光 sprite,
   * 直接 renderer.render 保证 canvas 透明融入背景。 */
  const composer = null

  /* ---- 11. Interaction ---- */
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
  const ro=new ResizeObserver(()=>{camera.aspect=W()/H();camera.updateProjectionMatrix();renderer.setSize(W(),H());if(composer)composer.setSize(W(),H())})
  ro.observe(host)

  /* ---- 12. Render ---- */
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
    // Cloud 异速旋转
    clouds.rotation.y += 0.0004
    atmos[0].material.uniforms.uIntensity.value=0.30+0.03*Math.sin(t*0.5)
    atmos[2].material.uniforms.uIntensity.value=0.07+0.015*Math.sin(t*0.3+2)
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
    platformRings.forEach((r,i)=>{r.rotation.z+=0.0004*(i+1);r.material.opacity=(0.08-i*0.02)+0.015*Math.sin(t*0.6+i*1.2)})
    orbitRings.forEach(r=>{r.rotation.y+=0.0008})
    root.position.y=Math.sin(t*0.2)*0.02
    if(composer)composer.render(); else renderer.render(scene,camera)
    if(!reduced)raf=requestAnimationFrame(frame)
  }
  if(reduced)frame(t0); else raf=requestAnimationFrame(frame)

  return()=>{
    cancelAnimationFrame(raf);ro.disconnect()
    el.removeEventListener('pointerdown',onDown)
    window.removeEventListener('pointermove',onMove)
    window.removeEventListener('pointerup',onUp)
    el.removeEventListener('pointerenter',onEnter)
    el.removeEventListener('pointerleave',onLeave)
    dayTex.dispose();nightTex.dispose();normalTex.dispose();specTex.dispose();glowTex.dispose()
    renderer.dispose()
    if(host.contains(el))host.removeChild(el)
  }
}
