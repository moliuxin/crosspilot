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
  renderer.toneMappingExposure = 2.4
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, W()/H(), 0.1, 100)
  // 完整球体构图(参考图1):相机拉远,地球整体悬浮于画面中,四周透出背景
  // (旧 z=4.5 时地球表面特写占满 canvas,在雪山背景上呈现为一块黑色矩形)
  camera.position.set(0.4, 0.35, 9)
  camera.lookAt(0, 0, 0)

  const root = new THREE.Group()
  root.position.x = 0.4
  scene.add(root)

  const loader = new THREE.TextureLoader()

  /* ---- 1. Earth Mesh(真实贴图) ---- */
  const loadTex = (url, srgb=true) => {
    const t = loader.load(url)
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = renderer.capabilities.getMaxAnisotropy()
    return t
  }
  const dayTex = loadTex(BASE + 'earth-day.webp')
  const nightTex = loadTex(BASE + 'earth-night.webp')
  const normalTex = loadTex(BASE + 'earth-normal.webp', false)
  const specTex = loadTex(BASE + 'earth-specular.webp', false)

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, mobile ? 64 : 128, mobile ? 48 : 96),
    new THREE.MeshStandardMaterial({
      map: dayTex,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: specTex,
      roughness: 0.55,
      metalness: 0.08,
      emissiveMap: nightTex,
      emissive: new THREE.Color(0xffcc88),
      emissiveIntensity: 0.45,
    }),
  )
  // 初始转到「亚洲日面」朝向相机(参考图1:亮蓝日面 + 城市灯共存,而非整球夜面)
  earth.rotation.y = -0.9
  root.add(earth)

  /* ---- 2. Cloud Layer(独立透明球,异速旋转) ---- */
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xcfe8ff,
    transparent: true,
    opacity: mobile ? 0.06 : 0.10,
    roughness: 1, metalness: 0,
    depthWrite: false,
  })
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(2.23, mobile ? 32 : 64, mobile ? 24 : 48),
    cloudMat,
  )
  root.add(clouds)

  /* ---- 3. Atmosphere(3层 Fresnel) ---- */
  const atmos = [
    {r:2.25, color:[0.25,0.65,1.0], intensity:0.32, power:2.4},
    {r:2.32, color:[0.15,0.45,0.95], intensity:0.18, power:2.8},
    {r:2.46, color:[0.35,0.25,0.80], intensity:0.08, power:3.2},
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

  /* ---- 6. Trade Arcs + Flow Particles ---- */
  const flows = []
  const arcColors = [0x37D9FF, 0x4F8FFF, 0x856AFF, 0x37D9FF, 0x4F8FFF, 0xFFDDA0]
  targets.forEach((m, i) => {
    const t = ll(m.lat, m.lon, 2.20)
    const mid = {x:(hubP.x+t.x)/2, y:(hubP.y+t.y)/2, z:(hubP.z+t.z)/2}
    const l = Math.hypot(mid.x, mid.y, mid.z) || 1
    const dist = Math.hypot(hubP.x-t.x, hubP.y-t.y, hubP.z-t.z)
    const lift = 2.2 + (0.15 + i*0.04) * dist
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(hubP.x, hubP.y, hubP.z),
      new THREE.Vector3(mid.x/l*lift, mid.y/l*lift, mid.z/l*lift),
      new THREE.Vector3(t.x, t.y, t.z),
    )
    root.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(50)),
      new THREE.LineBasicMaterial({color:arcColors[i%arcColors.length], transparent:true, opacity:0.10, blending:THREE.AdditiveBlending, depthWrite:false}),
    ))
    for (let j=0; j<3; j++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6),
        new THREE.MeshBasicMaterial({color:0xd0f0ff, transparent:true, opacity:0.85, blending:THREE.AdditiveBlending, depthWrite:false}))
      p.userData = {curve, offset:(i*3+j)*0.13, speed:0.035+j*0.008}
      root.add(p); flows.push(p)
    }
  })

  /* ---- 7. Orbital Rings ---- */
  const orbitRings = []
  ;[{r:2.8,tilt:0.30,rotZ:0.1,op:0.08},{r:3.1,tilt:-0.20,rotZ:-0.15,op:0.05},{r:2.95,tilt:0.50,rotZ:0.25,op:0.06}].forEach(({r,tilt,rotZ,op},i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 8, 120),
      new THREE.MeshBasicMaterial({color:i===1?0x856AFF:0x37D9FF, transparent:true, opacity:op, blending:THREE.AdditiveBlending, depthWrite:false}))
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
  scene.add(new THREE.AmbientLight(0x9cc4e8, 1.6))
  const key = new THREE.DirectionalLight(0xffffff, 4.6); key.position.set(2, 3, 9); scene.add(key)
  const rim = new THREE.DirectionalLight(0x856AFF, 0.4); rim.position.set(-3, -0.5, -2); scene.add(rim)
  const fill = new THREE.DirectionalLight(0x37D9FF, 0.6); fill.position.set(-1, 2, 1); scene.add(fill)

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
