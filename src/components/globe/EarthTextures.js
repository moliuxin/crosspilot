/**
 * Procedural Earth Textures — 生成高级冰蓝科技风格地球贴图
 * 不依赖外部图片,全部 Canvas 绘制,运行时生成。
 *
 * 输出:
 *   createEarthTexture() → THREE.CanvasTexture(冰蓝大陆+深蓝海洋)
 *   createNightTexture() → THREE.CanvasTexture(城市暖白灯光, emissive map)
 *   createCloudTexture() → THREE.CanvasTexture(极淡云层)
 */

// 粗粒度大陆检测(与 Globe3D 共用)
function isLand(lat, lon) {
  const bands = [
    [45,70,30,180],[30,55,60,145],[20,48,70,90],
    [35,60,-10,45],[5,35,-20,52],[15,65,-170,-50],
    [-55,20,-85,-30],[-45,-10,110,155],[60,85,-70,-10],[10,30,75,110],
  ]
  return bands.some(([a,b,c,d]) => lat>=a && lat<=b && lon>=c && lon<=d)
}

// 城市聚集区(暖白灯光)
const CITIES = [
  {lat:40,lon:116,r:6},{lat:31,lon:121,r:5},{lat:23,lon:113,r:4},{lat:39,lon:117,r:4},
  {lat:51,lon:0,r:5},{lat:48,lon:2,r:4},{lat:52,lon:13,r:4},{lat:41,lon:12,r:3},
  {lat:55,lon:37,r:5},{lat:60,lon:30,r:3},
  {lat:40,lon:-74,r:6},{lat:34,lon:-118,r:5},{lat:41,lon:-87,r:4},{lat:29,lon:-95,r:3},
  {lat:37,lon:-122,r:3},{lat:33,lon:-112,r:2},
  {lat:30,lon:31,r:4},{lat:25,lon:55,r:3},{lat:24,lon:46,r:3},
  {lat:1,lon:103,r:3},{lat:13,lon:100,r:2},{lat:-6,lon:106,r:3},
  {lat:35,lon:139,r:5},{lat:35,lon:135,r:3},
  {lat:-23,lon:-46,r:4},{lat:-34,lon:-58,r:3},{lat:-33,lon:151,r:3},
]

function isNearCity(lat, lon) {
  return CITIES.some(c => Math.abs(lat-c.lat)<c.r && Math.abs(lon-c.lon)<c.r*1.4)
}

/**
 * 生成冰蓝科技风格地球贴图(equirectangular)
 * @param {number} size - 宽度像素(2048=desktop, 1024=mobile)
 */
export function createEarthTexture(size = 2048) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size / 2
  const ctx = canvas.getContext('2d')

  const h = canvas.height

  // 1. 海洋基底:深海军蓝,赤道稍亮
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, h)
  oceanGrad.addColorStop(0, '#020d1f')      // 北极深
  oceanGrad.addColorStop(0.25, '#031e3d')   // 中北纬
  oceanGrad.addColorStop(0.5, '#042b52')    // 赤道稍亮
  oceanGrad.addColorStop(0.75, '#031e3d')   // 中南纬
  oceanGrad.addColorStop(1, '#020d1f')      // 南极深
  ctx.fillStyle = oceanGrad
  ctx.fillRect(0, 0, canvas.width, h)

  // 2. 大陆绘制:逐格填充冰蓝色
  const cellSize = canvas.width / 360 // 每度像素
  const step = 1 // 1度精度

  for (let lat = -90; lat < 90; lat += step) {
    for (let lon = -180; lon < 180; lon += step) {
      if (!isLand(lat, lon)) continue
      const x = (lon + 180) / 360 * canvas.width
      const y = (90 - lat) / 180 * h
      // 随机亮度变化(自然感)
      const rand = Math.random()
      // 基础冰蓝,带随机变化
      const brightness = 0.3 + rand * 0.25
      const r = Math.floor(40 + brightness * 80)
      const g = Math.floor(120 + brightness * 100)
      const b = Math.floor(180 + brightness * 60)
      ctx.fillStyle = `rgba(${r},${g},${b},0.7)`
      ctx.fillRect(x, y, cellSize * 1.5, cellSize * 1.5)
    }
  }

  // 3. 大陆边缘模糊(让轮廓柔和)
  ctx.filter = 'blur(2px)'
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  // 4. 极地冰盖
  const polarH = h * 0.06
  const northIce = ctx.createLinearGradient(0, 0, 0, polarH)
  northIce.addColorStop(0, 'rgba(200,230,255,0.3)')
  northIce.addColorStop(1, 'rgba(200,230,255,0)')
  ctx.fillStyle = northIce
  ctx.fillRect(0, 0, canvas.width, polarH)

  const southIce = ctx.createLinearGradient(0, h - polarH, 0, h)
  southIce.addColorStop(0, 'rgba(200,230,255,0)')
  southIce.addColorStop(1, 'rgba(200,230,255,0.35)')
  ctx.fillStyle = southIce
  ctx.fillRect(0, h - polarH, canvas.width, polarH)

  return canvas
}

/**
 * 生成城市夜景灯光贴图(emissive map)
 */
export function createNightTexture(size = 2048) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size / 2
  const ctx = canvas.getContext('2d')
  const h = canvas.height

  // 黑色基底
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvas.width, h)

  const cellSize = canvas.width / 360

  // 城市灯光:只在大陆上的城市区域绘制
  for (let lat = -60; lat < 75; lat += 0.5) {
    for (let lon = -180; lon < 180; lon += 0.5) {
      if (!isLand(lat, lon)) continue
      if (!isNearCity(lat, lon)) continue
      const x = (lon + 180) / 360 * canvas.width
      const y = (90 - lat) / 180 * h
      const dist = Math.random()
      const intensity = Math.max(0.2, 1 - dist)
      const r = Math.floor(255 * intensity)
      const g = Math.floor(220 * intensity)
      const b = Math.floor(180 * intensity)
      ctx.fillStyle = `rgba(${r},${g},${b},${0.4 + intensity * 0.5})`
      const sz = cellSize * (0.8 + Math.random() * 0.6)
      ctx.fillRect(x, y, sz, sz)
    }
  }

  // 模糊让灯光柔和
  ctx.filter = 'blur(1.5px)'
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'

  return canvas
}

/**
 * 生成极淡云层贴图(alpha map)
 */
export function createCloudTexture(size = 1024) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size / 2
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = 'rgba(255,255,255,0)'
  ctx.fillRect(0, 0, size, size/2)

  // 随机云带(水平带状)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  for (let i = 0; i < 8; i++) {
    const y = Math.random() * size / 2
    const height = 10 + Math.random() * 30
    ctx.beginPath()
    ctx.ellipse(size/2, y, size*0.4, height, 0, 0, Math.PI*2)
    ctx.fill()
  }

  return canvas
}

/**
 * 生成底部光平台径向渐变贴图
 */
export function createGlowTexture(size = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
  grad.addColorStop(0, 'rgba(50,180,255,0.25)')
  grad.addColorStop(0.4, 'rgba(30,120,220,0.12)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  return canvas
}
