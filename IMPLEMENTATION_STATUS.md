# IMPLEMENTATION STATUS — 全栈版逐条对照

> 对照《下一轮开发指令》逐条标注：DONE（完成并经实测）/ PARTIAL（可用但简化）/ TODO（未做）。
>
> **已完成升级：① localStorage 演示 → FastAPI 真后端全栈；② 7 处 Demo 占位 → 真功能；③ 外部审计 P0 清单整改（本文第十一节）；④ 账户系统 + 多租户数据隔离（本文第十二节）；⑤ 统一付费权限体系 + 版本历史真回滚 + 独立站按租户渲染 + MCP 15 工具 + 固定一级菜单（本文第十三节）。**
>
> **当前验证基线：后端 `pytest` 226 passed；8 套 Playwright E2E 共 159 项断言全通过、运行时错误 0；`npm run build` 通过。**
> 每一项 P0 / P1 均按「API 路径 + 前端入口 + DB 变化 + 自动化测试 + 真实点击 + 刷新持久」六要素记录（见第十一、十二、十三节），**供独立复核，不以此文档自判 DONE**。

---

## 十三、P0 真功能整改（统一付费权限 / 版本历史 / 租户前台 / MCP / 一级菜单）

> 本轮要解决的不是「再加几个页面」，而是把三类**结构性造假**堵死：
> ① 付费判断散落在 20 个前端按钮里（改一处漏一处）；② 版本回滚只弹 toast 不改数据库；③ 独立站前台所有企业都渲染同一个演示品牌。
>
> 本轮交付后，**权限只有一个真源、回滚真的写库、前台按租户渲染**，全部有自动化断言兜底。

### 13.1 统一付费权限体系（Plan / Subscription / Entitlement / ServiceOrder）

| 维度 | 内容 |
| --- | --- |
| 数据表 | `plans`（套餐字典）、`subscriptions`（PK = tenant_id，租户当前套餐）、`entitlements`（按能力授权，可带 quota）、`service_orders`（开通/购买申请） |
| 单一真源 | `backend/app/entitlements.py`。`PLAN_FEATURES` 定义套餐→能力；`PLAN_FEATURES["growth"] = ["*"]` 表示含全部当前与未来能力 |
| 后端 API | `GET /api/entitlements`（返回 plan / features / quotas / plans / upgradeUrl）；`POST GET /api/service-orders`；`POST /api/service-orders/{id}/approve`（真实改写 Subscription 或 Entitlement，并同步 `Tenant.plan` 展示字段） |
| 服务端门禁 | `require_feature(db, tid, "site.generate")` 等，注入 6 条路由：`site.generate` / `site.publish` / `page.publish` / `seo.optimize` / `agent.run` / `version.restore` / `template.purchase` / `market.localize` |
| 402 结构 | `{"detail": {"message", "feature", "requiredPlan", "upgradeUrl"}}` — 前端据此渲染统一付费墙，不用在每个页面写死文案 |
| 前端收口 | 新增 `src/app/store/useEntitlement.js`（`can` / `requireFeature` / `plan` / `isFree`）；原先散落在 9 个页面的 **~20 处** `openPaywall(...)` 全部替换为 `requireFeature(featureKey)` |
| 付费墙 | `PaywallModal` 套餐清单来自 `entitlements.plans`（不再硬编码）；点「选择套餐」调 `api.createServiceOrder(...)` → **真实落库为 ServiceOrder**，不是 toast |
| 输入示例 | `POST /api/service-orders` body `{"plan_id":"growth","feature_key":"page.publish","note":"E2E 用例"}` |
| 输出示例 | `{"ok":true,"order":{"id":"so_...","tenant_id":1,"plan_id":"growth","feature_key":"page.publish","status":"pending","amount":1280}}` |
| 刷新持久 | ServiceOrder 落 SQLite；刷新「模板商城 → 我的购买记录」仍在（E2E 断言） |
| 权限判断 | 免费版调 `POST /api/seo/optimize` → 402 + structured detail；Growth 版 → 200 |
| 错误处理 | 402 结构化详情；`service-orders` 无 plan/feature → 400 |
| 自动测试 | `tests/test_entitlements.py`（25 项） |
| 状态 | **DONE** |

### 13.2 版本历史 + 真回滚（Preview / Compare / Restore）

| 维度 | 内容 |
| --- | --- |
| 数据表 | `versions`：`version_no` / `entity_type` / `entity_id` / `before_snapshot` / `after_snapshot` / `action` / `published_by`；`action` 从 `publish\|rollback` 扩到 `publish\|rollback\|edit\|brush\|template\|seo\|geo` |
| 后端 API | `GET /api/versions/recent?limit=`（本租户全实体聚合，新→旧）、`GET /api/versions?entity_type=&entity_id=`、`GET /api/versions/{id}`（含 before/after 快照）、`POST /api/versions/rollback` |
| 真回滚证据 | `_restore_snapshot()` 把快照字段**写回实体**，并新增一条 `action="rollback"` 版本；回滚后 `GET` 该实体可见旧值（E2E 断言 B→A 真实生效） |
| 留痕范围 | 页面编辑（`PUT /api/pages/{id}`，`action="edit"`）、SEO 优化、GEO、发布、回滚各产一条版本 |
| 前端入口 | 侧栏「站点工具 → 版本历史」`/#/versions`；列：版本 / 时间 / 动作 / 对象 / 内容 / 操作 |
| 对比 | 详情抽屉逐字段 before/after 对比，变化行高亮；`before` 划线、`after` 高亮 |
| 回滚交互 | 二次确认框明确写「此操作会真实写入数据库，并生成一条新的回滚版本记录」 |
| 输入示例 | `POST /api/versions/rollback` body `{"entity_type":"page","entity_id":"page_xxx","version_id":"ver_xxx"}` |
| 输出示例 | `{"ok":true,"rolled_back":true,"version":{"id":"ver_...","version_no":17,"action":"rollback"}}` |
| 刷新持久 | 版本与回滚记录落库；刷新页面列表仍在 |
| 权限判断 | `require_feature(db, tid, "version.restore")`（免费版亦可回滚，属数据安全能力） |
| 错误处理 | 版本不存在 → 404；版本与实体不匹配 → 409；无可恢复快照 → 409（E2E 断言三者） |
| 自动测试 | `tests/test_versions_list.py`（14 项）、`tests/test_publish_versions.py`、`test/e2e-versions.mjs`（32 项） |
| 状态 | **DONE** |

### 13.3 独立站前台按租户渲染 + 匿名只读接口

| 维度 | 内容 |
| --- | --- |
| 数据字段 | `tenants.public_slug`（不可猜标识 `t-<id>-<hex6>`，用于匿名访问）；`Tenant.to_dict()` 暴露 `publicSlug` |
| 后端 API | `GET /api/public/site?tenant=<slug>` — **无需登录**；仅返回 `publish_status == "published"` 的租户；字段白名单（不含 seo_score / geo_score / inquiries / User / Credit / Draft / Version） |
| 匿名写例外 | `POST /api/inquiries` 按 token → `X-Tenant-Id` → `X-Tenant-Slug` → 默认租户 解析归属 |
| 前端 | `src/site-main.jsx` 移除 `mockProducts` / `SITE_BRAND`；品牌取自 `saved.brand`，产品取自 `saved.products`；RFQ 提交带租户 slug |
| 输入示例 | `GET /api/public/site?tenant=t-1-seed01`（无 Authorization 头） |
| 输出示例 | `{"ok":true,"tenant":{"slug":"t-1-seed01","name":"..."},"brand":{...},"products":[...],"pages":[...]}` |
| 刷新持久 | 站点内容落库；前台刷新后一致 |
| 权限判断 | 未发布租户 → 404（不泄露存在性）；白名单外字段不返回 |
| 错误处理 | slug 不存在 → 404；未发布 → 404 |
| 自动测试 | `tests/test_public_site.py`（9 项） |
| 状态 | **DONE** |

### 13.4 MCP / Tool 层 9 → 15 工具

| 维度 | 内容 |
| --- | --- |
| 服务端真源 | `GET /api/mcp/tools` — 15 条（11 读 + 4 写），每条标注 `input` / `output` / `paid_feature` / `mutates` |
| 新增 6 工具 | `get_site`、`get_geo_metrics`、`get_versions`、`create_draft`、`update_page`、`update_product` |
| 写工具硬约束 | `create_draft` / `update_draft` / `update_page` / `update_product` 的 `mutates == "draft"` —— **只产 Draft，不直接改线上内容**；`publish_page`(`publish`) / `rollback_version`(`rollback`) 单独标注 |
| 前端实现 | `src/services/mcp.js` 15 个工具全部落地，读工具查真实 FastAPI，写工具产出 Draft + Diff |
| 防漂移 | `tests/test_mcp.py` 新增 3 项**前后端一致性**断言：名字集合相等 / 声明必有实现 / 实现必有声明 |
| 前端入口 | AI Agent 页侧栏「MCP 工具 15 tools」；工具高亮随调用切换 |
| 自动测试 | `tests/test_mcp.py`（11 项）、`test/e2e-agent.mjs` 断言面板显示 15 |
| 状态 | **DONE** |

### 13.5 一级菜单固定 + 模板商城 + 使用说明

| 维度 | 内容 |
| --- | --- |
| 一级菜单 | 按要求固定为 **我的网站 / 产品中心 / 页面编辑 / 询盘中心 / AI 增长 / 模板商城 / 使用说明**（7 项，E2E 断言） |
| 收敛 | SEO / GEO / 竞品分析 / Buyer Conversion / Skill Center / AI 文案 / AI 图片 全部收进「AI 增长」页内，不再占一级位（E2E 断言一级不含 SEO/GEO/Skill） |
| 站点工具 | 版本历史、AI Agent 收进第二分组「站点工具」 |
| 模板商城 | `/#/templates`；4 个行业模板（Industrial Pro / Clean Energy / Supplier Minimal / Chemical RU Focus），默认标注 zh-CN / en-US / ru-RU；「立即购买」→ `POST /api/service-orders`（`feature_key = template.<id>`）真实落库 |
| 我的购买记录 | 展示服务订单（订单号/类型/内容/状态/金额），刷新后仍在 |
| 使用说明 | `/#/help`；5 条真实流程（从零建站 / 上架产品 / 处理询盘 / 多语言市场 / 版本与回滚），**每个步骤按钮真实跳转到对应功能页**（E2E 断言）；5 条 FAQ |
| 新建能力 | `template.purchase`（starter 起）已进统一权限层，不在页面里散写收费判断 |
| 输入示例 | `POST /api/service-orders` body `{"feature_key":"template.industrial-pro","note":"购买模板 Industrial Pro"}` |
| 输出示例 | `{"ok":true,"order":{"id":"so_...","feature_key":"template.industrial-pro","status":"pending"}}` |
| 刷新持久 | 订单落库；刷新 `/templates` 购买记录仍在（E2E 断言订单数增加且刷新不变） |
| 权限判断 | 免费版点「立即购买」→ 走 `requireFeature('template.purchase')` 弹统一付费墙 |
| 错误处理 | 无 plan/feature → 400；402 → 结构化付费墙 |
| 自动测试 | `test/e2e-navigation.mjs`（28 项） |
| 状态 | **DONE**（模板「一键应用到站点」应用动作属 P1，本轮为 **PARTIAL**，见下） |

### 13.6 本轮真实修复的缺陷（顺手发现的存量 bug）

| # | 缺陷 | 影响 | 修复 |
| --- | --- | --- | --- |
| 1 | `pages.create_page` 未设 `tenant_id` | 新建页面落到默认租户 → 其他租户 404 | 补 `tenant_id=tid` |
| 2 | `api.js` 引用未 import 的 `mockProducts` | `readLocalProducts()` 抛 ReferenceError | 移除 mock 引用，改真实数据 |
| 3 | `site-main.jsx` 引用未 import 的 `SITE_BRAND` | 独立站前台渲染直接崩（`ReferenceError`） | 改为按租户 `brand`，两处引用全部修掉 |
| 4 | `AppContext` `ADD_DRAFT` 不去重 | 同一 draft 重复入列 → React key 冲突 + 侧栏重复草稿卡片 | 按 id 去重并提到最前；`SET_DRAFTS` 同样按 id 去重 |
| 5 | 新页面复用全局 `.drawer` 类名 | 与 `UsageDrawer` 冲突、抽屉被压成 0 宽不可见 | 改名 `.vdrawer-*`，避免污染既有样式 |
| 6 | `AgentPage` 硬编码 `prod_002` | 回滚指令永远指向固定演示产品 | 改为取真实数据中 SEO 最低的产品 |
| 7 | `PUT /api/pages/{id}` 门禁在写库前抛出 | 402 时留下半截脏写风险 | 门禁移到 `db.flush()` 后、`commit` 前，回滚整个事务 |

### 13.7 本轮仍未做完（如实标注）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| AI 画笔（圈选区域 → 自然语言 → 定位组件 → Draft → Diff → 确认 → 新版本） | **TODO（P0 剩余）** | `brush.edit` 已在权限层注册，但交互与组件定位链路尚未实现 |
| 模板「一键应用到站点」 | **PARTIAL** | 购买链路真实；应用动作待接整站改版流程 |
| Template Intelligence / Competitor Intelligence（真实联网） | **TODO（P1）** | 当前竞品分析为已落库的专业服务任务，非联网采集 |
| Buyer Persona / Buyer Conversion 真实模型 | **PARTIAL** | Buyer Conversion 页与任务落库已接通，人设模拟基于模板非联网实证 |
| AI 真实图片生成 | **TODO（P1）** | 现为专业服务任务入口 |
| GEO 任务后台 / 使用统计 / 转化数据 | **TODO（P2）** | — |
| 真实在线支付 | **TODO** | 当前为 ServiceOrder 真实落库 + 人工审批链路 |

### 13.8 本轮验证记录

```
后端单测（全量）        226 passed（+59：entitlements 25 / public_site 9 / versions_list 14 / mcp 11）
npm run build           通过（main 173.13 kB / gzip 62.20 kB）
Playwright E2E 8 套     159 项断言全通过
  e2e.mjs               25/25
  e2e-site.mjs          13/13
  e2e-agent.mjs         13/13
  e2e-p05.mjs           10/10
  e2e-multitenant.mjs   21/21
  e2e-marketing.mjs     18/18
  e2e-versions.mjs      32/32
  e2e-navigation.mjs    28/28
```

---

## 十二、P1 账户系统 + 多租户隔离（本轮）

> 改造前的状态是：**没有任何鉴权**，45 个业务端点全部裸奔，谁都能读到全部数据；数据模型里也不存在「这家公司 / 那家公司」的概念。
> 本轮把「一个部署服务多个商家」这件事真正做实 —— 不是加一个登录页，而是让每个查询都带上租户约束。

### 12.1 数据模型：Tenant / User + 全表 tenant_id

| 要素 | 内容 |
| --- | --- |
| 新增表 | `tenants`（id/name/industry/plan/created_at）；`users`（id/email 唯一/password_hash/display_name/role/tenant_id） |
| 角色 | `owner`（企业管理员，注册即此角色）/ `staff`（企业员工）/ `operator`（平台运营，不绑定租户，可跨租户） |
| 隔离列 | `products / inquiries / pages / tasks / drafts / versions / credit_logs` 各加 `tenant_id`（索引），默认 1 |
| 单例表改造 | `site_state / usage / credits` 原本全站一行（`id=1`），改为**主键即 tenant_id** —— 一家企业一行站点状态、一份免费额度 |
| 存量迁移 | 启动时 `_migrate_sqlite()`：`PRAGMA table_info` 探测 + `ALTER TABLE ADD COLUMN tenant_id`，创建默认租户，`UPDATE ... SET tenant_id = 1 WHERE tenant_id IS NULL` —— **老数据不丢，全部归入默认租户** |
| 代码位置 | `backend/app/models.py`、`backend/app/main.py` 的 `_migrate_sqlite()` |

### 12.2 鉴权：JWT + bcrypt

| 要素 | 内容 |
| --- | --- |
| API 路径 | `POST /api/auth/register`（建租户 + owner 账户 + 三张单例行，重名 409）、`POST /api/auth/login`（成功返回 JWT）、`GET /api/auth/me` |
| 密码存储 | passlib + bcrypt 哈希（实测 `$2b$` 前缀），明文绝不落库；超长密码按 72 字节截断 |
| Token | PyJWT HS256，载荷 `{sub: user_id, tenant_id, role, iat, exp}`，默认 72 小时；密钥 `SITEPILOT_JWT_SECRET`（生产必须覆盖默认值） |
| 依赖注入 | `current_user`（未登录 → 401）、`tenant_scope`（返回当前租户 id；账户未绑定企业 → 403） |
| 防账号枚举 | 登录失败时「邮箱不存在」与「密码错误」返回**完全相同**的 文案「邮箱或密码不正确」 |
| 代码位置 | `backend/app/security.py` |

### 12.3 隔离：依赖注入式过滤 + scoped_get

| 要素 | 内容 |
| --- | --- |
| 核心工具 | `backend/app/tenancy.py`：`scoped_query`（按租户过滤的查询起点）、`scoped_get`（按主键取实体并校验归属）、`scoped_get_or_none`、`singleton`（每租户单例行） |
| 404 而非 403 | 跨租户访问他人资源返回 **404 不存在**，而不是 403 无权限 —— 不泄露「这条数据存在」 |
| 覆盖范围 | `products / inquiries / pages / tasks / credits / company / site / seo / agent` 全部路由文件；列表查询加 `filter(tenant_id == tid)`，单条查询改 `scoped_get`，创建时注入 `tenant_id=tid` |
| 统计口径 | `/api/health`、`/api/metrics`、`/api/health/site`、`/api/tasks/stats/summary` 的计数/均值全部按当前租户计算（不再泄露全站规模） |
| 匿名写入例外 | 独立站 RFQ（`POST /api/inquiries`）是**唯一**允许匿名写入的端点：带有效 token → 落登录租户；匿名 + `X-Tenant-Id` → 落该租户；匿名无头 → 落默认租户 |
| 越权防护 | 普通商家伪造 `X-Tenant-Id` 头会被忽略（`tenant_scope` 只认账户上的 tenant_id）；只有 `operator` 角色可跨租户 |

### 12.4 前端：登录页 + 路由守卫 + token 注入

| 要素 | 内容 |
| --- | --- |
| 登录页 | `src/pages/Login/Login.jsx`（+ `auth.css`）：登录 / 注册新企业双 tab、错误提示、**一键填入演示账号**、左侧隔离承诺说明 |
| 路由守卫 | `src/App.jsx`：`authState = 'checking'` 时显示过渡屏（不闪现）；`'anon'` 时**所有业务路由收敛到 `/login`**；`'authed'` 才挂载工作台 |
| token 生命周期 | `src/services/api.js`：`http()` 自动带 `Authorization: Bearer`；收到 401 → `emitUnauthorized()` 清 token 并通知 `AppContext` 踢回登录页；`detectBackend()` 把 401 视作「后端活着，只是没凭证」（**不降级 local**，否则会假装离线可用） |
| 状态管理 | `AppContext` 新增 `authState / user / tenant / login / register / logout`；启动时若本地有 token 则调 `/api/auth/me` 确认真实有效 |
| 公司身份 | 侧栏工作区卡片与用户行改为显示**登录租户**的名称/行业/邮箱，退出按钮落在用户行 |
| 演示账号 | `backend/app/seed.py::_seed_demo_account()` 预置 `demo@aquaflow-demo.com / demo-pass-123`，归属默认租户（含完整种子数据），全新环境打开即可直接看到成品 |

### 12.5 验证记录（六要素）

| 验证方式 | 结果 |
| --- | --- |
| 后端单元/集成 | `backend/tests/test_auth_tenant.py` **17 用例全过**（含跨租户隔离 5 项、越权 3 项、鉴权边界 2 项）；全量 `pytest` **167 passed**（改造前 150，本轮净增 17） |
| 跨租户隔离（API 实测） | A 建 1 个产品 → A 看到 1 个、**B 看到 0 个**；B 按 id 直取 A 的产品 → **404**；B 伪造 `X-Tenant-Id: 1` → **仍为 0** |
| 未登录（API 实测） | `GET /api/products` → **401** `{"detail":"未登录：缺少访问凭证"}` |
| 浏览器 E2E | `test/e2e-multitenant.mjs` **21 项断言全过**：未登录 4 条路由均被挡到登录页；注册新企业 → 工作台侧栏显示新企业名；新租户产品列表为空而演示租户有 4 个（对照组）；刷新保持登录；退出登录清 token 回登录页；错误密码提示不泄露账号存在性 |
| 刷新持久 | token 存 localStorage，刷新后 `AppContext` 调 `/api/auth/me` 复验，仍在工作台 |
| 存量 E2E 回归 | 原有 5 套 E2E 通过共享 helper（`test/e2e-auth-helper.mjs`，用 `addInitScript` 在页面脚本前注入真实登录 token）全部重跑通过：25 + 13 + 10 + 18 + 13 = **79 项**；加上多租户 21 项，**共 100 项断言全过、运行时错误 0** |
| 构建 | `npm run build` 通过（81 modules，无警告阻断） |

### 12.6 已知边界（诚实说明）

- **多人协作邀请未做**：`staff` 角色已建模但暂无邀请流程，注册只能建 `owner`。多租户隔离已完整，缺的只是「同一租户内多账号」的分发入口。
- **operator 跨租户切换未做 UI**：后端 `resolve_tenant_id` 支持 `X-Tenant-Id` 覆盖（仅 operator 生效），前端暂无租户切换器。
- **SQLite 行级无 RLS**：隔离靠应用层 `tenant_id` 过滤 + 依赖注入，不是数据库级 Row Level Security。换 Postgres 后建议叠加 RLS 做第二道防线。
- **JWT 无刷新/吊销**：72 小时过期即需重新登录，没有 refresh token 与黑名单。

---

## 十一、P0 审计整改（按验收式标准记录）

> 外部审计指出 5 个 P0：真实 LLM、SEO 发布写真字段、Mock MCP、真实版本管理、Demo 假反馈。
> 以下每项均列出：API 路径 / 前端入口 / DB 变化 / 自动化测试 / 真实点击验证 / 刷新持久验证。

### P0-1 真实 LLM 链路

| 要素 | 内容 |
| --- | --- |
| API 路径 | `GET /api/health` 返回 `ai: {provider, enabled, model, degraded, calls_total, calls_ok, calls_failed, runtime, last_error}`；`POST /api/pages/{id}/ai-rewrite` 走真实 LLM，返回 `ai_source: "llm" \| "template"` |
| Provider 实现 | `backend/app/llm.py` 的 `OpenAICompatProvider`（httpx 调 `/chat/completions`，Bearer 鉴权 + `response_format: json_object`，OpenAI/DeepSeek/vLLM 通用）；配置 `SITEPILOT_LLM_PROVIDER=openai` + `SITEPILOT_LLM_API_KEY/BASE_URL/MODEL` 即切换 |
| 前端入口 | 工作台顶栏 AI 徽章：`AI: real · <model>`（绿）/ `AI: degraded（降级模板）`（橙）/ `AI: 内置模板`（灰）——`AppContext` 拉 `/api/health` 的 `ai` 字段驱动 |
| 降级语义 | LLM 调用失败 → 结果降级模板（`ai_source=template`）**且** `health.ai.degraded=true` + `last_error` 记录真实错误；后端失联时前端清空 AI 徽章不冒充可用 |
| 本地验证 | `backend/tools/fake_llm_server.py`（OpenAI 协议兼容 server，端口 8100）：curl 改写接口返回 `ai_source:"llm"`、文案含用户指令内容、fake server 调用计数 +1；杀掉 fake server 再调用 → `ai_source:"template"` + `degraded:true` + `last_error:"All connection attempts failed"`；重启后恢复 `runtime:"real-llm"` |
| 自动化测试 | `backend/tests/test_llm_provider.py` 3 用例：health 显示 openai/enabled/real-llm；改写走真实协议链路（fake server 收到请求 + 采纳结果落库）；宕机降级 template + degraded 标记 |
| 真实点击 | Playwright `e2e-marketing.mjs` D 节：工作台顶栏徽章显示 `AI: real · aquaflow-gpt` |
| 说明 | 沙箱无外部 API Key，用本地 OpenAI 协议兼容 server 验证完整链路；`base_url` 换成真实端点即接真模型，代码路径零改动 |

### P0-2 SEO 发布真实修改内容（不再只改分数）

| 要素 | 内容 |
| --- | --- |
| API 路径 | `GET /api/seo/diff/{id}` 返回 `write` 结构化补丁；`POST /api/drafts`（创建带 patch 的草稿）；`POST /api/publish` 执行 patch 真实写库 |
| 写入内容 | title / slug / meta_description / h1 / 8 条结构化 FAQ（q+a）/ 8 条 image_alt / schema_enabled / faq_schema_enabled —— 均写入 `products.seo` JSON 列，发布后 `GET /api/products/{id}` 可见 |
| DB 变化 | `drafts` 表新增 `patch` 列（结构化补丁，与展示用 diff 分离）；启动时 `_migrate_sqlite()` 自动 `ALTER TABLE`（旧库兼容） |
| 前端入口 | SEO 优化页（SEOCompare）生成 Diff → 确认发布；Agent 页「优化 … 商品页」快捷指令 |
| 自动化测试 | `backend/tests/test_publish_versions.py`（7 用例）：`test_seo_publish_writes_content_not_just_scores` 锁定「发布必须写真字段」；未确认 403 / 重复发布 409 / noop patch 409 |
| 真实点击 | 发布前后 `GET /api/products/prod_002`：title `UF Water Filter Machine` → `Ultrafiltration Unit Manufacturer & Supplier \| AQUAFLOW AF-UF-600`；faq 0 → 8 条；seo 58→83、geo 40→70 |

### P0-3 移除 Mock MCP

| 要素 | 内容 |
| --- | --- |
| 改造内容 | `src/services/mcp.js` 整文件重写：删除 `mockProducts`/`mockInquiries` 数据源，9 个工具全部经 `api.js` 走真实 FastAPI（读工具查站点/产品/询盘/版本，写工具产出 Draft+Diff，发布与回滚由后端执行落库） |
| 前端入口 | Agent 页（`/#/agent`）：6 条快捷指令全部由真实查询驱动；MCP 面板显示 9 个工具与「全部对接真实数据层」说明 |
| 自动化测试 | Playwright `e2e-agent.mjs` A 节 8 项：产品指令表格行数=后端产品数（4）、询盘指令数字=后端询盘数（5）、回滚返回真实版本结果或明确「无可回滚」（不冒充成功）、优化指令产出带 diff 的真实草稿卡片 |
| 刷新持久 | 草稿来自后端 `GET /api/drafts`，刷新后侧栏「待确认草稿」仍在 |

### P0-4 真实版本管理（快照 + 回滚）

| 要素 | 内容 |
| --- | --- |
| API 路径 | `GET /api/versions?entity_type=&entity_id=`（新→旧列表）、`GET /api/versions/{id}`（含 before/after 快照）、`POST /api/versions/rollback`（真回滚，回滚本身也落一条版本记录） |
| DB 变化 | 新增 `versions` 表：`entity_type/entity_id/version_no/before_snapshot/after_snapshot/draft_id/action(publish\|rollback)/published_by/created_at` |
| 回滚语义 | 恢复 `before_snapshot` 全量字段到实体并落库 —— 回滚后 `GET /api/products/{id}` 恢复旧内容（实测 title/faq/分数全部还原） |
| 自动化测试 | `test_publish_versions.py`：`test_publish_creates_version_snapshot`、`test_rollback_restores_previous_content`、`test_rollback_missing_version_404` |
| 前端入口 | Agent 页「回滚到上一个发布版本」指令 → `callMcpTool('rollback_version')` → 返回真实 version_no 或明确错误 |

### P0-5 清除 Demo 假反馈

| 原假反馈 | 现状 |
| --- | --- |
| `AppLayout` 「网站已发布（Demo）」 | 付费用户发布走真实检查（产品数/首页区块数）→ `updateSiteState` 真实落库 → toast 报真实检查结果 |
| `AppLayout` 「已记录：Demo 中模拟进入商务咨询」 | 「对接客服」真实 `POST /api/inquiries` 写入线索，询盘中心可见、可跟进 |
| `AppLayout` 「已确认并发布（Demo）」 | toast 如实描述真实已发生的发布结果（内容写库 + 分数更新） |
| `PaywallModal` 「顾问将在 1 个工作日内联系你（Demo）」 | 「选择套餐」真实写【套餐开通申请】线索落库，询盘中心可见 |
| `Onboarding` contact 默认 `Demo Admin` / 短信「Demo 中不接真实短信」 | 联系人默认空（用户自填）；短信说明改为诚实降级描述（演示环境不下发真实短信，输入任意 4 位数字通过）；后端 `/api/company` 不再虚构联系人名，侧栏显示公司名 |
| 全站扫描 | Playwright `e2e-p05.mjs` A 节：8 个工作台页面 + Onboarding 无「（Demo）/ Demo 中 / 模拟进入 / Demo Admin」用户可见字样 |

**P0-5 线索闭环验证（e2e-p05.mjs B 节，10/10 通过）**：付费弹窗「选择 Starter」→ 询盘 API 数量 7→8 → 最新线索 message 含【套餐开通申请】→ 询盘中心详情可见 → **刷新后仍在（真落库非内存态）**。

### 本轮交付物与验证汇总

| 项 | 结果 |
| --- | --- |
| 后端 `pytest`（含 10 个新用例：LLM 3 + 发布版本 7） | **150 passed** |
| `test/e2e-agent.mjs`（P0-3 + Dashboard 任务进度 #71） | **13/13** |
| `test/e2e-marketing.mjs`（门户叙事/WhatsApp/证言 + AI 徽章） | **18/18** |
| `test/e2e-p05.mjs`（P0-5 假反馈清除 + 线索落库） | **10/10** |
| `test/e2e.mjs` / `test/e2e-site.mjs`（既有回归） | **25/25 + 13/13** |
| `npm run build` | 通过（双入口） |
| 附带交付（老王视角获客增强，#77/#78/#79） | Onboarding 结果导向叙事 + ¥50,000 价格锚定 + 三步流程；独立站前台 WhatsApp 浮动按钮（真实 wa.me 跳转 + 分市场预填文案）；示例客户证言区块（明确标注演示数据） |

---

## 〇、本轮新增（四）：筛选按钮与编辑器样式真实化 + 区块保存语义修正

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 产品中心筛选真实化 | DONE | 三个装饰按钮改为真实下拉：分类（从产品数据动态汇总去重）+ 搜索状态（按 `seo_score` 分 ≥85 / 70–84 / <70 三档），与关键词搜索叠加过滤；新增命中计数与「清空筛选」，空态可一键恢复 |
| 编辑器样式属性真实化 | DONE | 「文字对齐 / 背景 / 区块间距」原来**写死 `active` 在 index 0**（看着已选中、点了没反应），现改为真实写入 `props.{align,background,padding}`，画布按 props 渲染 `block-align-*` / `block-bg-*` / `block-pad-*` 类名 |
| 样式贯通独立站前台 | DONE | 前台不再是「编辑器里调好、访客看不到」：区块带 `data-align` / `data-bg` / `data-pad`，同一份 props 同时驱动画布与前台 |
| 前台数据源与后台同源 | DONE | `site-main.jsx` 是**不经 AppContext** 的独立入口，现自行调用 `detectBackend()` 再取页面，避免「后台用后端存、前台用本地读」的错位 |

**本轮修掉的 3 个真实缺陷**（均由实测/测试驱动暴露，非事后猜测）：

1. **页面保存整体替换导致区块被静默删除**（最严重）：`PUT /api/pages/{id}` 原来直接把 `sections` 整体赋值。编辑器「样式」面板只把样式写进**当前选中区块**，一旦提交的数组不含其他区块，其余区块就会被永久删除 —— 首页从 7 个区块缩到 1 个，独立站前台只剩一个 Hero。已改为**合并语义**（按 id 覆盖 + 未提交区块保留 + props 深合并），前后端同一套实现，并补 3 个单测锁定。

2. **前台样式恒不生效**：`SiteHero` 渲染的是 `.site-hero` 而非 `.site-block`，样式规则只写在 `.site-block` 上，导致 Hero 的「品牌色 / 深色」背景永远不渲染。已补 `.site-hero[data-bg=...]` 规则。

3. **前台读不到编辑器保存的数据**：`getSitePreviewData()` 原来同步读 `localStorage`，但后台在探测到后端后是**写后端**的，两边永远对不上。已改为优先读后端、失败再降级本地。

> 另有 2 处「测试写错而非产品 bug」已如实修正：一是断言把 GEO 分数当 SEO 分数（表格里两列共用 `seo-score` 类名，已给 GEO 独立类名 `gseo-score`）；二是误以为「所有区块都应继承同一样式」——实际上样式按区块独立，只应作用于被编辑的那个。

---

## 〇、本轮新增（三）：Excel 原生导入 + 本地化额度上收服务端

| 项 | 状态 | 说明 |
| --- | --- | --- |
| Excel(.xlsx) 原生导入 | DONE | `xlsx_service.py`（openpyxl，纯函数）+ `POST /api/products/parse-xlsx`（base64 上传，`commit` 可选预览/直导）；前端 `BulkImportModal` 支持选 .xlsx，**不引前端 sheetjs**（省约 400KB 包体积） |
| 自动跳过表头 | DONE | 多列需 ≥2 个表头词、单列需首格命中，避免把正常产品名误判为表头 |
| 参数多分隔符兼容 | DONE | 参数/应用场景支持 `;` `；` `|` `｜` 分隔多条 |
| 本地化额度上收服务端 | DONE | 新增 `GET /api/localization`、`POST /api/localization/generate`；免费额度判定从 `localStorage`（可被绕过）移到后端，用尽返回 **402** |
| 种子数据对齐业务规则 | DONE | 原来种子把三个市场全部预置（与 `plan=free` 矛盾，付费门槛永远不触发），改为初始仅 `en-US` |

**顺手修掉的 1 处真实不一致**：`seed.py` 预置 `target_markets=["en-US","ru-RU","zh-CN"]`，但站点 `plan="free"` —— 免费站点却已解锁全部市场，导致「生成新市场版本」与付费门槛在演示中根本无法触发。已改为 `["en-US"]`，与「免费版含 1 个新增市场版本」规则一致。

---

## 〇、本轮新增（二）：把 Demo 占位变成真功能

上一轮扫描出 7 处「点了只弹 toast」的占位，本轮全部替换为真功能：

| 原占位 | 现状 | 实现位置 |
| --- | --- | --- |
| 产品中心「批量导入」 | DONE | `BulkImportModal.jsx` + `POST /api/products/bulk-import`：粘贴 CSV/TSV 或选文件、自动识别分隔符/跳过表头、实时进度、逐行成功失败汇总、只重试失败项 |
| 询盘中心「导出 CSV」 | DONE | `Inquiries.jsx::exportCsv()`：真实 Blob 下载（BOM + 引号转义 + 按筛选导出 + 文件名含日期） |
| 页面编辑器「保存」 | DONE | `PageEditor.jsx` + `PUT /api/pages/{id}`：组件树落库，`dirty` 标记 + 切换页面二次确认 |
| AI 改写落库 | DONE | `POST /api/pages/{id}/ai-rewrite`：返回 `before`/`after` 建议，**不污染线上**，人工确认后随保存落库 |
| 询盘「跟进任务」 | DONE | `POST /api/tasks`（`kind=followup`）：关联询盘时自动把询盘 new→contacted |
| GEO 任务持久化 | DONE | GEO 清单映射为一条 growth 任务，勾选即 `PUT /api/tasks/{id}`，**刷新后状态保留** |
| Skill Center「用量 1,860」 | DONE | `GET /api/credits` + `UsageDrawer.jsx`：真实余额、消耗流水、按能力统计、三档充值 |

**过程中修掉的 2 个真实缺陷**（不是测试写错，是产品 bug）：

1. **任务子步骤勾选丢失**：`advance_task` 用 `list(t.steps)` 做浅拷贝后原地改嵌套 dict，再赋回等值列表 → SQLAlchemy 判定无变更并跳过 UPDATE，导致 `progress` 变了但 `steps` 没落库。已改为构造全新 dict 列表，并给所有 JSON 列启用 `MutableList`/`MutableDict` 变更追踪。
2. **AI 改写忽略用户指令**：模板降级分支里 `if instruction:` 与无指令分支返回同一句模板，用户填了要求却看不到差异。已改为把指令要点并入改写结果（超 90 字回退纯模板）。

---

## 〇、本轮新增（一）：全栈真后端

| 项 | 状态 | 实现位置 |
| --- | --- | --- |
| FastAPI + SQLAlchemy + SQLite 真后端 | DONE | `backend/app/main.py`、`database.py`、`models.py`（9 ORM 模型） |
| 45 个 REST 端点 + Pydantic 校验 | DONE | `backend/app/routers/`（company/products/inquiries/pages/tasks/credits/site/seo/agent） |
| 前端双链路 adapter（backend→local 降级） | DONE | `src/services/api.js`（`detectBackend()` 探测 + `withFallback()`） |
| 顶栏后端连接状态徽章 | DONE | `src/components/layout/Topbar.jsx`（`.data-mode`，已连接后端 / 本地模式） |
| LLM adapter 抽象（mock / openai 兼容） | DONE | `backend/app/llm.py`、`services/ai_service.py`（失败自动降级并标注 `ai_source`） |
| 后端单测 | DONE | `backend/tests/`（137 用例，含 403/409/402 安全规则） |
| 前后端联调 E2E | DONE | Playwright 88/88（新增功能真落库后端，运行时错误 0） |

---

## 一、总目标逐条对照

| # | 要求 | 状态 | 实现位置 |
| --- | --- | --- | --- |
| 1 | 有真实路由 | DONE | `src/App.jsx`（HashRouter，15 条路由） |
| 2 | 有表单校验 | DONE | 产品表单 `ProductForm.jsx`（名称/型号必填）；RFQ 表单 `src/site-main.jsx`（必填+邮箱格式）；建站表单 `Onboarding.jsx`；**后端 Pydantic 二次校验**（`backend/app/schemas.py`） |
| 3 | 有数据状态 | DONE | `src/app/store/AppContext.jsx`（useReducer）+ 各页面本地 state |
| 4 | 有本地持久化 | DONE | 主链路：**后端 SQLite 落库**；降级链路：`src/services/db.js`（localStorage `sitepilot.db.v1`） |
| 5 | 有 Mock API adapter | DONE | `src/services/api.js`：**统一 adapter 双链路**，`api.products.*` / `api.inquiries.*` / `api.site.*` / `api.seo.*` / `api.agent.*` 命名空间全部实现 |
| 6 | 产品/询盘/页面增删改查 | DONE | 产品：`Products.jsx` + `POST/PUT/DELETE /api/products`；询盘：`Inquiries.jsx` + `PUT /api/inquiries/{id}`；页面：`PageEditor.jsx` |
| 7 | AI 生成流程状态机 | DONE | `Onboarding.jsx`（form→hero→verify→generating→done）；`AiWaiting.jsx` 6 步推进 |
| 8 | 免费 1 次限制 | DONE | 前端 `AppContext.remainingGenerations` + 后端 `POST /api/usage/consume`（超限 **402**），双端一致 |
| 9 | 付费门槛 | DONE | `PaywallModal.jsx` 三套餐；6 个触发点；后端 402 兜底 |
| 10 | SEO/GEO 优化前后 Diff | DONE | `SEOCompare.jsx`（10 字段）+ `GET /api/seo/diff/{id}`；发布后分数真实落库（prod_002 58→83） |
| 11 | Agent 草稿→Diff→人工确认→发布 | DONE | `AgentPage.jsx`（聊天卡 + 侧栏 PendingDraftCard）+ `POST /api/publish`（`human_confirmed≠true` → **403**，重复发布 → **409**） |
| 12 | `npm run build` 通过 | DONE | 77 modules transformed，无报错 |

## 二、不做清单（自查）

| 要求 | 状态 |
| --- | --- |
| 不做纯视觉展示/空按钮/“功能开发中” | DONE — 高频动作全部真实可用；外围按钮已全部真实化（批量导入/导出 CSV/任务/用量） |
| 不做无关视觉重设计 | DONE — 沿用既有设计令牌与视觉基线 |
| 不加购物车/支付/物流 | DONE — 仅 RFQ |
| AI 不直接发布，必须人工确认 | DONE — 前端 + 后端双重强制 `human_confirmed` |
| SEO/GEO 不是普通按钮 | DONE — 诊断 + 任务 + 前后 Diff 完整链路 |

## 三、P0 逐条对照

| 要求 | 状态 | 说明与文件 |
| --- | --- | --- |
| React + Vite 工程化 | DONE | `package.json` / `vite.config.js` 双入口 |
| 左侧导航 6 项 | DONE | `Sidebar.jsx`：我的网站/产品中心/页面编辑/询盘中心/AI增长/Skill Center（一级） |
| 完整首次建站流程 | DONE | `Onboarding.jsx` 五步；企业认证 `POST /api/company/verify` |
| 免费 1/1 次 + 付费弹窗 | DONE | 见总目标 #8/#9 |
| 产品中心增删改查 + AI 生成 | DONE | `Products.jsx` + `POST /api/products`（自动 AI 生成，返回 `ai_source`） |
| 询盘中心列表/详情/状态 | DONE | `Inquiries.jsx` + `PUT /api/inquiries/{id}`（枚举校验） |
| 单产品 SEO 优化 Diff | DONE | `SEOCompare.jsx` + `POST /api/seo/optimize`（生成草稿，不改线上） |
| Agent 完整流程 | DONE | `AgentPage.jsx` + `POST /api/agent/run`（自然语言/结构化双模式） |
| 数据保存 | DONE | 后端 SQLite（重启后仍在）；降级时 localStorage |

## 四、P1 逐条对照

| 要求 | 状态 | 说明与文件 |
| --- | --- | --- |
| 三语言市场模板（非直译） | DONE | `marketTemplates.js`；后端 `localized_content` 三语言生成 |
| 页面编辑器 左树+中画布+右面板 | DONE | `PageEditor.jsx` |
| Skill Center 8 个卡片 | DONE | `skills.js` + `SkillCenter.jsx` |
| 网站预览 PC/移动切换 | DONE | `PageEditor.jsx` 设备切换（实测 536→360px 生效） |

## 五、数据结构对照

| 指令要求 | 实现字段映射 | 状态 |
| --- | --- | --- |
| `Product` | 后端 ORM 直接对齐：`specs`=attributes、`benefits`=sellingPoints、`seo.faq`=faq、`seo_score`、`geo_score` `backend/app/models.py` | DONE |
| `Inquiry` | snake_case 对齐 `docs/data-model.example.json` | DONE |
| `SiteState` | `site_state` 表 + `usage` 表（计数独立） | DONE |

## 六、验收标准对照

| 要求 | 状态 | 位置 |
| --- | --- | --- |
| 完整源码 ZIP（含前后端） | DONE | `sitepilot-fullstack.zip`（源码 + dist + docs，不含 node_modules） |
| README 运行说明 | DONE | `README.md`（前后端分别启动说明） |
| `npm install` 成功 | DONE | `package-lock.json` 锁定 |
| `npm run dev` 成功 | DONE | Vite dev server 正常 |
| `npm run build` 成功 | DONE | 双入口产物 |
| 后端启动 + 单测 | DONE | `uvicorn app.main:app`；`pytest` 150 passed |
| IMPLEMENTATION_STATUS.md 逐条标注 | DONE | 本文件 |
| 每个功能对应文件路径 | DONE | 见各表“实现位置/文件”列 |
| 不给聊天记录 HTML，不只给部署链接 | DONE | 交付物为源码 ZIP + 文档 |

## 七、演示路径实测记录

**A. 前端（Playwright，28/28 通过）** — localStorage 降级链路
**B. 前后端联调（Playwright，32/32 通过，运行时错误 0）** — 真后端链路（含 7 项占位真实化）

```
0  /api/health 可访问 + 顶栏显示「已连接后端」........... OK
1a 进入首次建站表单 ................................... OK
1b 填写企业资料 ....................................... OK
1c 生成首屏预览 ....................................... OK
1d 进入企业认证 → 获取验证码 → 提交 ................... OK
1e AI 生成等待页 → 完成页 ............................. OK
1f 进入网站后台 ....................................... OK
1g 站点信息已写入后端（companyName=TESTCO）............ OK
2a 产品列表来自后端 ................................... OK
2b 新增产品（空提交触发校验 → 填写 → AI 生成）......... OK
2c 新产品已落库后端（4→5）............................. OK
3a 打开询盘详情抽屉 ................................... OK
3b 修改询盘状态为已完成并落库 ......................... OK
4a 独立站 RFQ 表单校验（必填）......................... OK
4b RFQ 提交写入后端询盘（5→6，意向 hot）.............. OK
5a SEO 优化前后 Diff（10 字段）........................ OK
5b 勾选确认 → 生成待确认草稿 .......................... OK
6a Agent 生成待确认草稿 ............................... OK
6b 发布前分数未变（Agent 不直接改线上，58）............ OK
6c 人工确认并发布草稿 ................................. OK
6d 发布后产品分数真实提升 ............................. OK
6e 站点状态变为 published ............................. OK
7  免费额度用尽后返回 402（付费门槛）................. OK
8  5 条关键路由可达（我的网站/页面编辑/AI增长/Skill/多语言）OK
```

**C. 本轮新功能联调（Playwright，32/32 通过，运行时错误 0）** — 真后端链路

```
1  顶栏徽章显示「已连接后端」............................ OK
2a 产品页「批量导入」不再弹 toast，打开真实弹窗 ......... OK
2b 填入示例 → 解析出 3 条有效产品（自动跳过表头）........ OK
2c 导入完成 → 3 成功 / 0 失败，列表出现新行 ............. OK
3a 页面编辑器渲染区块，选中后切 AI tab 出现改写输入框 ... OK
3b AI 改写返回 before/after，且体现用户指令 ............. OK
3c 一键「应用到编辑器」采纳建议（面板关闭）.............. OK
4a 能力中心额度概览条显示后端真实余额（非硬编码）........ OK
4b 用量抽屉：真实流水 6 条 / 按能力统计 / 三档充值 ...... OK
5a GEO 任务清单 7 项渲染 ............................... OK
5b 勾选可切换并写入后端 ................................ OK
5c 刷新页面后勾选状态仍保留（已落库）................... OK
6a AI 增长提交服务任务 → 生成真实任务卡 ............... OK
6b 任务卡含进度条 + 4 个子步骤，进度可推进 ............. OK
7a 询盘中心导出触发真实文件下载（inquiries-all-*.csv）.. OK
```

**D. Excel 导入 + 本地化额度联调（Playwright，18/18 通过，运行时错误 0）**

```
A1 文件选择框 accept 含 .xlsx .......................... OK
A2 上传真实 .xlsx 后显示文件卡片（文件名 + 工作表名）... OK
A3 解析出 3 条产品，表头已自动跳过并提示 ................ OK
A4 预览列出 3 个产品，含真实名称与参数数量 ............. OK
A5 选用文件时粘贴框自动禁用 ........................... OK
A6 从 Excel 导入 3 个产品成功（3 成功 / 0 失败）........ OK
A7 参数解析为键值对并真落库（容量=900Wh）.............. OK
B1 本地化额度条显示（初始 1/3）........................ OK
B2 未生成市场标记为「未生成」.......................... OK
B3 生成 ru-RU 后变为 2/3 .............................. OK
B4 刷新后仍为 2/3（已落库后端）........................ OK
B5 第三个市场触发付费引导（402）....................... OK
B6 被拒后市场数未变（状态未被污染）.................... OK
```

## 八、本轮验证记录（E）：筛选 / 编辑器样式 / 前台渲染

**后端 `pytest` 137 passed**（本轮 P0 整改后更新为 150 passed，见第十一节），`npm run build` 通过。

**商家后台联调（`test/e2e.mjs`，25/25，运行时错误 0）**

```
A. 产品中心筛选（真实过滤）
A1 初始展示全部产品（4 条）............................. OK
A2 按分类 Filtration 过滤 → 1 条 ....................... OK
A3 过滤结果分类正确 .................................... OK
A4 搜索状态「已优化(≥85)」→ 2 条 ....................... OK
A5 结果分数均 ≥85（仅统计 SEO 列，排除 GEO）............ OK
A6 搜索状态「未达标(<70)」→ 1 条 ....................... OK
A7 分类 + 关键词叠加过滤 → 1 条 ........................ OK
A8 无结果时展示空态 .................................... OK
A9 展示命中计数（命中 0 / 4）........................... OK
A10 空态内「清空筛选条件」恢复全部 ..................... OK
A11 分类选项由真实数据汇总（含 4 个分类）............... OK

B. 页面编辑器样式属性（真实生效 + 落库）
B1 对齐默认选中「左对齐」（来自 props，非写死）......... OK
B2 切到「居中」后选中态跟随 ............................ OK
B3 画布 class 新增 block-align-center ................... OK
B4 画布 class 确实发生变化 ............................. OK
B5 画布实际渲染 text-align: center ..................... OK
B6 画布 class 新增 block-bg-brand ....................... OK
B7 画布实际渲染品牌色渐变背景 .......................... OK
B8 区块间距「宽松」增大 padding（22px → 32px）.......... OK
B9 样式改动标记为未保存 ................................ OK
B10 保存后未保存标记消失 ............................... OK
B11 刷新后样式仍在（真落库）............................ OK
B12 API 返回的 props 含 align/background/padding ........ OK
B13 演示数据已复原 ..................................... OK
```

**独立站前台联调（`test/e2e-site.mjs`，13/13，运行时错误 0）**

```
1. 编辑器设置样式
S1 编辑器样式已保存 .................................... OK

2. 独立站前台渲染（验证「编辑器里调好的 = 访客看到的」）
S2 前台存在 Hero 区块 .................................. OK
S3 Hero 带 data-align=center ........................... OK
S4 Hero 带 data-bg=brand ............................... OK
S5 Hero 文案真实居中（computed text-align: center）..... OK
S6 正文区块均带样式属性（共 8 个，无遗漏）............... OK
S7 样式只作用于被编辑区块，其余保持默认浅色 ............ OK
S8 品牌色区块存在（Hero）............................... OK
S9 Hero 渲染品牌色渐变背景 ............................. OK
S10 Hero 宽松间距生效 .................................. OK

3. 改回默认并验证前台同步
S11 前台样式随编辑器回退（left/light）.................. OK
S12 回退后不存在品牌色区块 ............................. OK
S13 前台无未预期 console 错误 .......................... OK
```

**本轮新增后端单测（3 个，锁定合并语义）**

```
test_update_page_sections_persisted ................... 提交区块写入 + 未提交区块保留
test_update_page_merges_props_without_losing_existing . 只改 title 时 eyebrow/cta 不丢
test_update_page_preserves_existing_sections_when_styling_one  只调样式时区块数不变
test_section_style_props_persisted .................... padding/align/background 真落库
test_section_style_props_default_when_absent .......... 未设置样式不凭空注入字段
test_section_style_props_survive_unrelated_update ..... 只改文案时样式不丢
```

---

## 九、TODO（校赛后）

| 项 | 说明 |
| --- | --- |
| 生产数据库 | `SITEPILOT_DATABASE_URL` 换 Postgres（SQLAlchemy 已兼容，无需改代码） |
| 真实 AI 网关 | ~~TODO~~ **链路已就绪**：`.env` 配 `SITEPILOT_LLM_PROVIDER=openai` + API Key + 真实 base_url 即接真模型（协议链路已由 fake server 验证，见第十一节 P0-1） |
| MCP 独立 Server | 工具层已全部真实化（见第十一节 P0-3）；未来如需独立 MCP Server 只换传输层，签名与契约（`docs/mcp-contract.example.json`）不变 |
| 真实短信验证 | `POST /api/company/verify` 对接真实短信服务（当前为诚实降级说明，不冒充已发送） |
| 鉴权 / 账户系统 | 当前为单租户；权限挂在套餐而非账户。生产加注册登录 + JWT + 多租户行级隔离（审计 P1 清单首项） |
| 真实支付 | 套餐开通申请已真实落库为线索；支付网关对接 |
| .xls 旧格式 | 仅支持 .xlsx（现代格式）；.xls 需先另存为 .xlsx 或 CSV |
