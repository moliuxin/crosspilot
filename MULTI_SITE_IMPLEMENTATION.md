# MULTI_SITE_IMPLEMENTATION.md — P0-MULTI-SITE + P0-NAV-TEMPLATE-PUBLIC + AI 生成三阶段验收报告

> 日期：2026-10-08
> 执行：ZCode（按 AGENTS.md 工程规则）
> 范围：多站点底层架构 → 导航去重 + 登录 Dashboard → 公共模板商城 → **AI 整站生成 / 三语 Market Profile / 免费额度与 AI 画笔付费**
> 未开始（按指令顺序刻意推迟）：Jev（省赛阶段不接）、真实 GLM/GLM-Image Key 接入（接口已就绪，配置即用）

---

## 1. 完成内容

### 1.1 AGENTS.md（项目长期规则）

已在项目根目录创建，内容与指令第二十节完全一致（Core Product Principle / User Model / Public Access / Free Generation / Multi-Site / Navigation / Templates / Truthfulness / Completion Definition / Development Rule）。

### 1.2 P0-MULTI-SITE：1 tenant : N sites

**数据模型（增量迁移，未重写）**

| 变更 | 说明 |
|---|---|
| 新表 `sites` | Site 一等实体：id / tenant_id / name / slug / industry / product_category / target_markets / status / template_id / public_slug / is_default / language / publish_count / created_at / updated_at |
| 新表 `site_products` | 站点↔产品关联（产品事实保持租户级单一来源，站点复用，**不复制数据**） |
| `pages / inquiries / versions / drafts` 增加 `site_id` | 站点级数据挂到具体站点 |
| 存量迁移 `_migrate_multi_site()` | 每个旧租户自动创建 **Default Site**；旧 Page/Inquiry/Version/Draft 全部回填归属；产品自动关联默认站点；**旧数据零丢失** |

**API（全部租户隔离，跨租户一律 404 不泄露存在性）**

```
GET    /api/sites                     站点列表（新账号为空，站点由用户显式创建）
POST   /api/sites                     创建站点（播种默认页面 + 自动关联租户产品）
GET    /api/sites/{id}                详情（含页面数/询盘数）
PATCH  /api/sites/{id}                改名/行业/市场/发布状态
DELETE /api/sites/{id}                删除（默认站点不可删；询盘保留并解除归属）
GET    /api/sites/{id}/products       站点关联产品
POST   /api/sites/{id}/products       关联（幂等）
DELETE /api/sites/{id}/products/{pid} 解除关联（产品本体不动）
GET/POST /api/pages?site_id=          站点作用域页面（校验归属）
GET  /api/inquiries?site_id=          站点作用域询盘
GET  /api/drafts?site_id= /api/versions/recent?site_id=  站点过滤
GET  /api/public/site?site=<slug>     独立站前台站点级寻址（兼容旧 ?tenant=）
GET  /api/health                      新增 sites 计数（通用概览数据源）
POST /api/site/generate               首次 AI 建站同时落站点实体
```

**前端**

- 登录后落地 **通用概览**（`/`）：欢迎语 + 网站数量/产品数量/询盘数量/免费额度 + AI 经营助手 + 最近网站 + 最近任务。顶部**不显示任何具体网站名称**。
- **我的网站**（`/sites`）：站点卡片（名称/市场/状态/页面与询盘数/更新时间；操作：进入管理/发布/删除）。
- **创建网站**（`/sites/new`）：AI 生成（账号级 1 次免费）/ 模板创建 / 空白创建 三模式。
- **站点作用域**（`/sites/:siteId`）：tabs = 概览 | 页面编辑 | 中/英/俄市场版本 | 版本历史；发布/预览为站点级操作；站点资料编辑 + 关联产品管理。
- 兼容：旧路由 `/editor` 自动跳转第一个站点的编辑器。

### 1.3 P0-NAV-TEMPLATE-PUBLIC：导航去重 + 公共模板商城

**侧栏固定 9 项一级菜单（每个目的一个主路由，无重复入口）**

概览 `/` · 我的网站 `/sites` · 询盘 `/inquiries` · 客户 `/customers` · SEO & GEO `/seo` · AI增长 `/growth` · 数据分析 `/analytics` · 模板商城 `/templates` · 设置 `/settings`

（用户后续指令：侧栏工作区卡片的企业 Logo 图标块已删除；「产品」从一级菜单移除，改为「我的网站 → 某网站 → 产品」页签，站点作用域内管理本站关联产品。）

移除的一级入口去向：产品→站点内部页签；页面编辑→站点内部；AI画笔→页面编辑器（付费门槛保留）；Buyer Persona/Conversion→AI增长；版本历史→站点内部；Agent·MCP→AI增长卡片；使用说明→顶栏帮助；隐私条款→设置。

**新增页面**：客户（询盘按买家聚合视图）/ 数据分析（真实指标+询盘结构分布）/ 设置（企业资料·账户与安全·语言与市场·隐私与条款·套餐与额度）。

**模板商城公开化**

- 未登录可 **浏览 / 筛选 / 打开 Demo 预览**（公开路由 + 公开页壳，无商家侧栏，不强制登录）。
- 点 **使用模板**：未登录 → `intended_template` 存 sessionStorage → 登录成功 → 自动回到 `/sites/new?template=<id>` 继续创建（已实测）。
- **6 个真实模板**（Industrial Pro / Supplier Minimal / Russia Industrial / Food Export / Electronics Global / Building Materials Pro），各自渲染**不同的页面结构**（实测 section 序列互不相同，不只是换色）：
  - industrial-pro: hero→trust→products→applications→capability→cases→cta（7 段）
  - supplier-minimal: hero→products→trust→cta（4 段最短路径）
  - russia-industrial: hero→capability→products→cases→trust→cta（供货能力前置）
  - food-export: hero→trust→products→applications→cta
- **卡片 hover**：整页截图从顶部缓慢滑到底部（7s 线性），移出平滑回顶部（CSS 过渡，无跳动）。
- **预览图来自真实 Demo 截图**（非 AI 概念图）：`public/template-assets/<slug>/{thumbnail,preview-full,preview-01..03}.webp`，卡片优先加载截图、缺失回落结构化骨架。
- Demo 内容全部标注 **DEMO DATA / Demo · Test**（Truthfulness 规则）。

---

## 2. 测试结果

| 套件 | 结果 |
|---|---|
| 后端 pytest（含新增 `test_sites.py` 20 例） | **246 / 246 通过** |
| 前端 `npm run build`（Vite 双入口） | **通过** |
| 浏览器实测（ZCode 内置浏览器，真实注册→建站→隔离→刷新→模板链路） | **全部通过**，见下 |

### 浏览器实测记录（真实账号 browser-e2e@crosspilot-demo.com）

1. 注册新账号 → 落地通用概览：欢迎语、网站数 0、无任何具体网站名 ✅
2. 侧栏恰好 10 项 ✅
3. 我的网站空状态 → 空白创建「工业水泵英文站」（EN+RU）→ 进入站点作用域，自动播种 6 页 ✅
4. 创建「食品出口俄罗斯站」→ 两站 id 不同 ✅
5. **隔离**：A/B 页面集 6v6 且交集为 0；在 A 建页 B 不可见；第二账号（竞争公司）站点数 0、按 site_id 访问他人站点 404 ✅
6. **刷新持久**：重新加载后两站卡片仍在 ✅
7. 站点编辑器（A 作用域）页面列表仅含 A 的页面（含"A 专属页面"）✅
8. 登出 → `/#/templates` 未登录可浏览 6 模板（无商家侧栏）✅
9. Demo 预览（industrial-pro）7 区块 + DEMO DATA 标注；4 个模板结构序列实测互异 ✅
10. 未登录点「使用模板」→ 记录 intended → 跳登录 → 登录后自动回 `/sites/new?template=industrial-pro` 且模板已预选 ✅
11. 商城卡片 6/6 加载真实 webp 截图；hover 滚动 CSS 规则生效 ✅

### Playwright E2E（脚本已备，本机未装 Playwright 浏览器）

- 新增 `test/e2e-multisite.mjs`：注册→建 A→建 B→隔离→刷新仍在（与指令 E2E 定义一致）。
- `test/e2e-navigation.mjs` 更新为 10 项菜单断言 + 匿名商城断言。
- 所有 e2e 脚本 Chrome 路径改为 `CHROME_PATH` 环境变量（原硬编码 Linux 路径，缺省用 Playwright 自带 Chromium）。
- `tools/capture-template-previews.mjs`：CI 可重复生成模板截图资产。
- 本机浏览器验证由 ZCode 内置浏览器完成，覆盖同一链路。

---

## 3. 改动文件清单

**根目录**：`AGENTS.md`（新增）

**后端（backend/）**：`app/models.py`、`app/tenancy.py`、`app/main.py`、`app/schemas.py`、`app/seed.py`、`app/llm.py`（last_error 空消息健壮性）、`app/routers/{sites.py(新), pages.py, inquiries.py, site.py, public.py}`、`tests/test_sites.py`（新，20 例）

**前端（src/）**：`App.jsx`、`services/api.js`、`components/layout/{Sidebar, Topbar, AppLayout}.jsx`、`pages/Login/Login.jsx`（含 422 错误数组致白屏的修复）、`pages/PageEditor/PageEditor.jsx`、`pages/Versions/VersionsPage.jsx`、`pages/AIGrowth/AIGrowth.jsx`；新增 `pages/Overview/`、`pages/Sites/`（4 文件+css）、`pages/Customers/`、`pages/Analytics/`、`pages/Settings/`、`pages/Templates/{templates-data.js, TemplatePreview.jsx, templates.css}`、`pages/Templates/TemplatesPage.jsx`（重写）

**第三批（AI 生成）**：后端新增 `app/prompts/`（7 模块）、`app/image_provider.py`、`app/market_profiles/`（3 JSON）+ `app/market_profiles.py`、`app/services/site_generation.py`、`app/routers/brush.py`、`tests/test_generation_and_entitlements.py`（12 例）；修改 `models.py`（Asset）、`schemas.py`、`config.py`（image 配置）、`main.py`、`routers/sites.py`（/generate + /assets）、`routers/site.py`（/market-profiles）。前端新增 `pages/Sites/AISiteOnboarding.jsx`；修改 `AppContext.jsx`（SET_USAGE/refreshUsage）、`PageEditor.jsx`（AI 画笔 Pro 入口）、`api.js`（generateSite/assets/marketProfiles/brushPreview）。

**资产**：`public/template-assets/<6 模板>/*.webp`（真实 Demo 截图，共 30 张）
**测试/工具**：`test/e2e-multisite.mjs`（新）、`test/e2e-navigation.mjs`、`test/e2e*.mjs`（chrome 路径参数化）、`tools/capture-template-previews.mjs`（新）
**截图**：`docs/screenshots/`（overview / sites / site-detail / site-editor / settings / analytics / templates-public / template-demo）

---

## 4. 第三批阶段：AI 生成 / Market Profile / Entitlement（2026-10-08 追加）

### 4.1 P0-AI-SITE-GENERATION（产品类别 → 整站生成）

**后端**
- `app/prompts/`：7 个专业能力模块（industry_analyzer / buyer_persona / market_localization / site_planner / image_brief / seo_optimizer / buyer_conversion），各自 SYSTEM + 输入构造器 + 输出 schema —— 提示词不再散落前端。
- `app/image_provider.py`：`ImageProvider` 抽象 + `GLMImageProvider`（OpenAI 兼容图像协议，`SITEPILOT_IMAGE_API_KEY/BASE_URL/MODEL` 配置，默认 GLM-Image 端点）+ `MockImageProvider`（确定性 SVG 占位，按市场配色区分）。图像 API 不写死在页面组件。
- `Asset` 模型：site_id / market / section_id / role / **source_type（REAL | AI_GENERATED）** / provider / prompt / url —— 图片全部溯源。
- `POST /api/sites/generate`：结构化生成链（Industry Profile → Buyer Persona → Market Profile → Site Plan → Image Briefs → ImageProvider）→ 落站点 + 6 页面（首页 = plan 的结构决策）+ AI 图片资产；`GET /api/sites/{id}/assets` 按站点/市场查询。
- 图片 prompt 组装必含 product_category / market / buyer / style / composition，并强制 `no fabricated certification marks` —— AI 不伪造证书/铭牌/厂房证据。
- LLM 未配置时全程降级为**类别感知的内置模板**（`_source: template`），配置真实 GLM Key 后自动升级，无需改代码。

**前端**
- `AISiteOnboarding.jsx`：五步引导（基础信息 → 目标客户 → 目标市场 → 网站风格 → 生成），与指令字段一一对应（company_name / product_category / product_description / target_buyer / target_markets / preferred_style）。
- 生成结果页：三市场 hero 对照（可观察差异）+ AI 图片墙（每张带 AI/REAL 溯源标签）+ 一键进入站点管理。

### 4.2 P0-MARKET-PROFILE（三语不是翻译）

- `app/market_profiles/{zh-CN,en-US,ru-RU}.json`：13 个字段全量（content_hierarchy / buyer_focus / hero_strategy / product_card_fields / trust_evidence_priority / cta_style / faq_topics / visual_style / image_style / layout_density / typography_guidance / tone / seo_guidance），明确标注「基于目标市场采购阅读策略，可配置、可用真实数据更新」。
- Fact/Market 分层：`SHARED_FACT_FIELDS`（SKU/参数/认证/MOQ/交期等）共享且不得被市场 AI 改写；`GET /api/market-profiles` 同时下发两层边界。

### 4.3 P0-ENTITLEMENT（免费一次 + AI 画笔付费）

- 免费完整生成 = **账号级 1 次**（Usage 单例）：生成成功落库后才扣（同事务），422 校验失败不扣，免费额度用完 + free 套餐 → 402（带 feature/requiredPlan/upgradeUrl），付费套餐继续。
- AI 画笔：`POST /api/brush/preview` 后端硬校验 —— 无权限一律 **403**（不依赖前端锁）；前端编辑器「✨ AI 画笔 · Pro」按钮**可见**，免费用户点击弹升级墙（符合“看得到才知道为什么付费”）。
- 前端：生成成功后 `refreshUsage()` 即时刷新侧栏额度（服务端为真源）。

### 4.4 本批验证

- pytest：**258 / 258 通过**（新增 `test_generation_and_entitlements.py` 12 例：market profile 字段/差异、生成全链路、三市场 hero 互异、图片溯源与 prompt 类别相关性、额度事务性、402/403/404/401 边界、租户隔离）。
- 浏览器实测：五步表单 → 输入「工业水泵」→ 生成站点（7 板块 / 3 市场版本 / 12 张 AI 图片）→ 三市场 hero 实测互不相同（中「批量制造与定制·获取报价方案」/ 英「Engineered for Your Projects·Get a Quote」/ 俄「для промышленных объектов·Запросить расчёт」）→ 免费额度扣为 0/1 → 二次生成 402 → 编辑器点 AI 画笔弹 Pro 升级墙。

## 5. 遗留事项（按指令顺序，下一阶段处理）

1. ~~P0-AI-SITE-GENERATION~~ **已完成**（见第 4 节）；真实 GLM/GLM-Image 效果需配置 API Key（`SITEPILOT_LLM_*` / `SITEPILOT_IMAGE_*`），当前为类别感知模板链路。
2. Product 仍为租户级（第一阶段方案，符合指令）；站点级产品排序/定价未做。
3. ~~AI 画笔付费墙~~ **已完成**（前端可见入口 + 后端 403 硬校验）；画笔的圈选交互与视觉 Diff 本体属后续迭代。
4. Buyer Conversion / Policy 独立模型未建（buyer_conversion prompt 已就绪，模型随后续阶段引入并直接带 site_id）。
5. 独立站前台（site-preview.html）按 `?site=` 渲染已支持，前台消费 AI 生成资产（Asset.url）的深度整合在下一阶段处理。
6. Playwright E2E 需在装有 Playwright 浏览器的环境（CI / `npx playwright install chromium`）跑通；本机验证由内置浏览器完成同等链路。
7. starter 套餐 5 次/月的精确计数未实现（当前：免费 1 次用完后任何付费套餐不限次）；真实计费接入时一并处理。
8. **GitHub Pages 部署**：代码/工作流/本地仓库已就绪（`.github/workflows/deploy-pages.yml` + `DEPLOYMENT.md`），等待用户完成 GitHub 设备授权后推送并发布公开链接。

## 6. 本机验证环境

- 后端 `uvicorn :8000`（SQLite，启动时自动完成多站点迁移）；前端 `vite :5173`
- Node v22.14.0（便携）、Python 3.14、pytest 246/246
- 演示账号：`demo@aquaflow-demo.com / demo-pass-123`（默认租户含种子数据与 Default Site）
