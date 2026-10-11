# PREMIUM_GLOBE_V3_REPORT.md — V3 视觉重设计报告

## 1. 修改文件

| 文件 | 说明 |
|---|---|
| `src/components/globe/EarthTextures.js` | **新建** 程序化地球贴图生成器(冰蓝大陆/城市灯光/底部光面) |
| `src/components/globe/Globe3D.jsx` | **完全重写** 从基础点阵球升级为电影级数字地球 |

## 2. Three.js Scene Graph

```
Scene
├── AmbientLight (0.35)
├── DirectionalLight × 3 (key/rim/fill)
├── GroundGlowPlane (径向渐变光面, y=-2.2)
└── Group (root, position.x=0.4 偏右)
    ├── Earth Mesh (SphereGeometry 128×96, radius=2.2)
    │   └── MeshPhysicalMaterial
    │       ├── map: CanvasTexture (冰蓝大陆)
    │       ├── emissiveMap: CanvasTexture (城市灯光)
    │       ├── clearcoat: 0.25
    │       └── metalness: 0.08
    ├── Atmosphere × 3 (Fresnel Shader, BackSide)
    │   ├── Layer1: r=2.24, cyan, intensity 0.30
    │   ├── Layer2: r=2.30, blue, intensity 0.18
    │   └── Layer3: r=2.44, violet, intensity 0.08
    ├── Grid Lines (经纬网, opacity 0.04)
    ├── City Nodes × 8 (core + glow + pulse)
    ├── Hub Node (中国, amber)
    ├── Arc Lines × 6 (4色: cyan/blue/violet/warm-white)
    │   └── Flow Particles × 3 per arc
    ├── Orbital Rings × 3 (tilted, different radii)
    │   └── Satellite dots × 3 (orbiting)
    └── Platform Rings × 3 (concentric tori)
└── EffectComposer (desktop only)
    ├── RenderPass
    └── UnrealBloomPass (0.8 / 0.7 / 0.65)
```

## 3. 程序化贴图实现(EarthTextures.js)

### Earth Map (2048×1024 / mobile 1024×512)
```
Canvas 绘制流程:
1. 海洋基底: 线性渐变(#020d1f → #042b52 → #020d1f)
2. 大陆填充: 1°精度逐格 isLand() 检测, 冰蓝色(rgba(40-120,120-220,180-240,0.7))
3. 高斯模糊: ctx.filter='blur(2px)' 让大陆轮廓柔和
4. 极地冰盖: 北/南极白色渐变(alpha 0.3-0.35)
```

### Night Lights Map (同尺寸)
```
Canvas 绘制流程:
1. 黑色基底
2. 城市灯光: 只在 isLand && isNearCity 区域, 暖白色(255,220,180)
3. 强度随距离衰减: intensity = max(0.2, 1-dist)
4. 高斯模糊: blur(1.5px) 柔化
5. 用作 MeshPhysicalMaterial.emissiveMap
```

### Ground Glow Map (512×512)
```
径向渐变: 中心 cyan(0.25) → 边缘透明
用作底部 PlaneGeometry 的贴图
```

## 4. Bloom Post-Processing

```javascript
// 桌面端启用, 移动端禁用
composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new UnrealBloomPass(
  new THREE.Vector2(width, height),
  0.8,   // intensity — 让 atmosphere/nodes/arcs 产生 glow
  0.7,   // radius — 柔和扩展
  0.65   // threshold — 只让高亮度元素 bloom, 不影响地球本体
))
```

## 5. 关键升级对比

| 特性 | V2(旧) | V3(新) |
|---|---|---|
| 地球主体 | Points 点阵 | **Mesh + 程序化贴图** |
| 大陆可见性 | 点阵暗示 | **冰蓝色 Canvas 贴图, 1°精度绘制** |
| 城市灯光 | 无 | **emissiveMap, 27 城市聚集区** |
| 大气层 | 3层 Fresnel | 3层 Fresnel(优化参数) |
| Bloom | 无 | **UnrealBloomPass(0.8/0.65)** |
| 轨道环 | 无 | **3 倾斜轨道 + 卫星点** |
| 底部平台 | 3 同心环 | **同心环 + 径向渐变光面** |
| 构图 | 居中 | **Earth 偏右(x=0.4)** |
| 色彩空间 | 默认 | **SRGBColorSpace + ACES** |
| 弧线颜色 | 青/紫/蓝 | **4色(含暖白 #FFDDA0)** |

## 6. Performance

| 平台 | 配置 |
|---|---|
| Desktop | segments 128×96, 6 arcs, 18 flow particles, Bloom ON, DPR≤1.5 |
| Tablet | segments 96×72, 4 arcs, 12 particles, Bloom OFF |
| Mobile | segments 64×48, 3 arcs, 9 particles, Bloom OFF, DPR≤1.0 |
| Reduced Motion | 静帧渲染(不循环) |

## 7. 浏览器验收(1440×900)

```
✅ Canvas 存在(851×720)
✅ WebGL 上下文活跃
✅ 自动旋转(两帧差分 = true)
✅ 无 fallback 触发
✅ Hero 高度 828px
✅ 曲面衔接元素存在
✅ 3 市场浮卡
✅ 5 能力胶囊
✅ npm build 通过(2.62s)
```

## 8. 已知限制

- 推送 faron.git 暂时失败(服务器不可达,代码已本地提交)
- 贴图是程序化生成,不如真实 NASA Earth Texture 精细(但风格统一且零外部依赖)
- Bloom 只在桌面端启用(移动端性能考虑)
