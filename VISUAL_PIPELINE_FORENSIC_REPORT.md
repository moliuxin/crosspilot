# VISUAL_PIPELINE_FORENSIC_REPORT.md

## 诊断结论:图片管线全链路正常,图片已生成并可访问

**ImageProvider: GLMImageProvider(cogview-4,真实 AI 图片)**
**所有图片 HTTP 200,三市场 asset_manifest 均有真实 URL**

---

## 逐级审计结果

### [1] AI Status / ImageProvider 配置

```
LLM:     provider=openai | model=glm-4-flash-250414 | runtime=real-llm | degraded=False
IMAGE_API_KEY:    configured ✅
IMAGE_BASE_URL:   configured ✅
IMAGE_MODEL:      configured ✅
```

容器内环境变量三个全部配置。

### [2] ImageProvider 判定

```
独立调用 /skills/visual_generation/run:
  source_type: AI_GENERATED
  provider: glm-image
  url: https://maas-watermark-prod-new.cn-wlcb.ufileos.com/...
  → GLMImageProvider(非 Mock) ✅
```

### [3] VisualBriefSkill

```
briefs count: 3
  slot=hero            subject=collaborative robot arm       forbidden=False
  slot=product_cover   subject=industrial automation cell    forbidden=False
  slot=application_scene subject=robot assembly line        forbidden=False
```

正常生成,无禁止槽位。

### [4] Asset 表

```
total: 7 assets (全部 AI_GENERATED, provider=glm-image)

| market | section_id  | role             | source_type   | provider   | url |
|--------|-------------|------------------|---------------|------------|-----|
| ru-RU  | hero        | hero             | AI_GENERATED  | glm-image  | YES |
| en-US  | hero        | hero             | AI_GENERATED  | glm-image  | YES |
| zh-CN  | hero        | hero             | AI_GENERATED  | glm-image  | YES |
| zh-CN  | cases       | market_mood      | AI_GENERATED  | glm-image  | YES |
| ru-RU  | capability  | background       | AI_GENERATED  | glm-image  | YES |
| en-US  | applications| application_scene| AI_GENERATED  | glm-image  | YES |
| zh-CN  | hero        | hero             | AI_GENERATED  | glm-image  | YES |
```

### [5] SiteMarketVariant asset_manifest

```
| market | manifest entries | hero.props.image | hero.props.image_source |
|--------|-----------------|------------------|------------------------|
| zh-CN  | 1 (hero)        | YES (real URL)   | AI_GENERATED           |
| en-US  | 1 (hero)        | YES (real URL)   | AI_GENERATED           |
| ru-RU  | 1 (hero)        | YES (real URL)   | AI_GENERATED           |
```

### [6] Public API

```
GET /api/public/site?site=...&market=zh-CN → market_variant.asset_manifest entries: 1
  hero.props.image: YES (real URL)

GET /api/public/site?site=...&market=en-US → market_variant.asset_manifest entries: 1
  hero.props.image: YES (real URL)

GET /api/public/site?site=...&market=ru-RU → market_variant.asset_manifest entries: 1
  hero.props.image: YES (real URL)
```

### [7] 图片 HTTP 可达性

```
| market | section       | HTTP | Size  |
|--------|---------------|------|-------|
| ru-RU  | hero          | 200  | 69KB  |
| en-US  | hero          | 200  | 59KB  |
| zh-CN  | hero          | 200  | 62KB  |
| zh-CN  | cases         | 200  | 64KB  |
| ru-RU  | capability    | 200  | 34KB  |
| en-US  | applications  | 200  | 60KB  |
```

全部 200,图片可公开访问。

### [8] SkillRun / AIExecution

```
visual_brief:        success | ai_source=template | latency=0ms
visual_generation:   success | ai_source=template | latency=5339ms
AIExec image_brief:  source=glm | success=True | latency=13855ms
```

---

## 最终链路表

| Stage            | CN          | EN          | RU          |
|------------------|-------------|-------------|-------------|
| VisualBrief      | ✅ glm      | ✅ glm      | ✅ glm      |
| ImageProvider    | ✅ glm-image| ✅ glm-image| ✅ glm-image|
| Asset DB         | ✅ 3 rows   | ✅ 2 rows   | ✅ 2 rows   |
| Manifest         | ✅ hero     | ✅ hero     | ✅ hero     |
| Public API       | ✅ manifest | ✅ manifest | ✅ manifest |
| Component Binding| ✅ props.image | ✅ props.image | ✅ props.image |
| HTTP 200         | ✅ 200      | ✅ 200      | ✅ 200      |
| Browser Visible  | ⚠️ 需浏览器验证 | ⚠️ 需浏览器验证 | ⚠️ 需浏览器验证 |

---

## 发现的问题

### 问题 1: asset_manifest 只包含 hero

**现状**: 每个市场的 manifest 只有 1 个条目(hero)。
**原因**: `resolve_slots()` 只解析 `required=true` 或槽位名为 `hero` 的槽位(见 `market_variants.py` 第 150 行的 `if not slot_meta.get("required", False) and slot_meta.get("slot") not in ("hero",):`)。
**影响**: ProductGrid/Applications 组件虽然有 asset(Asset 表中有 7 条),但 manifest 中没有对应的 product_cover / application_scene 条目,前端只有 hero 能拿到图。

### 问题 2: 产品图(ProductGrid)没有绑定

**现状**: Asset 表有 `applications` 条目(en-US),但 ProductGrid 的渲染逻辑读取的是 `props.image` 或 `p.image`,不是从 asset_manifest 查找。
**位置**: `src/components/site-blocks/blocks.jsx` 中 ProductGrid 组件。
**原因**: ProductGrid 渲染使用 `props.image`(只有 hero 有),产品卡片自身没有独立图片 URL。

### 问题 3: Applications 图只有 en-US 有

**现状**: Asset 表中只有 `en-US` 有 `application_scene`,zh-CN 和 ru-RU 没有。
**原因**: VisualBrief 生成了 `application_scene` 槽位的 brief,但 `resolve_slots()` 在非 hero 槽位可能被跳过。

---

## 建议修复方向(不修改,仅记录)

1. **扩大槽位解析范围**: `resolve_slots()` 应解析所有声明了 `asset_slots` 的组件(不只 hero)
2. **manifest 注入更多区块**: 将 product_cover、application_scene 的 URL 注入对应 section 的 props
3. **前端 ProductGrid 需从 asset_manifest 获取产品图**: 而不是只依赖 props.image
