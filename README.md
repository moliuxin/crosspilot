# WorkBuddy SitePilot — AI 外贸独立站智能体（全栈版）

**前端** React 18 + Vite 5 &nbsp;·&nbsp; **后端** FastAPI + SQLAlchemy + SQLite/Postgres

一个**可运行、可演示、可构建、数据真落库**的 AI 外贸独立站平台：真实路由、表单校验、
数据状态、FastAPI 真后端、产品/询盘增删改查、AI 生成流程状态机、免费 1 次限制、
付费门槛、SEO/GEO 优化前后 Diff、Agent 草稿 → Diff → 人工确认 → 发布。

> 产品定位：**AI 快速建站入口 + 专业 SEO/GEO 持续优化 + B2B 询盘获客**。
> 不做购物车、在线支付、物流 —— 交易环节只保留询价单（RFQ）。

---

## 一、快速开始

### 1. 启动后端（FastAPI）

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# 接口文档: http://127.0.0.1:8000/docs
# 健康检查: http://127.0.0.1:8000/api/health
```

首次启动自动建表并写入演示种子数据（4 个产品 / 5 条询盘 / 站点状态 / 用量）。

### 2. 启动前端

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 生产构建 → dist/（已验证通过）
npm run preview  # 预览构建产物，默认 4173
```

- 工作台：`#/`
- 首次建站流程：`#/onboarding`（企业资料 → Hero 预览 → 企业认证 → AI 生成等待页 → 后台）
- 客户独立站前台：`/site-preview.html`（RFQ 提交直连后端）

### 3. 后端单测

```bash
cd backend
pytest          # 137 passed（pytest.ini 已配置，开箱即用）
```

### 4. 浏览器端联调（真实点击验证）

```bash
cd backend && python3 -m uvicorn app.main:app --port 8000   # 终端 A
npm run build && python3 -m http.server 5173 --directory dist  # 终端 B
npm run test:e2e        # 商家后台：筛选 / 编辑器样式（25 项）
node test/e2e-site.mjs  # 独立站前台：编辑器样式是否真的渲染出来（13 项）
```

---

## 二、双链路数据层（核心设计）

前端**只调用 `src/services/api.js`**，不感知底层是后端还是本地：

| 链路 | 触发条件 | 行为 |
| --- | --- | --- |
| **backend** | 启动时 `/api/health` 探测成功 | 全部请求走 FastAPI，数据落库 |
| **local** | 后端不可用 / 网络中断 | 自动降级到 localStorage，演示不中断 |

- 顶栏实时显示 **「已连接后端」/「本地模式」** 徽章。
- 降级策略：**业务错误（4xx）直接抛出不降级**（如 402 付费墙），仅网络层错误降级。
- 后端恢复后，下一次成功请求自动切回 backend 模式（`onModeChange` 订阅）。

> **注意**：独立站前台（`site-main.jsx`）是**不经过 AppContext** 的独立入口，没有人替它做链路探测。
> 它自己会调一次 `detectBackend()`，否则 `MODE` 恒为 `unknown`，`getPages()` 会静默走本地降级 ——
> 于是出现「后台用后端存、前台用本地读」的错位，编辑器调好的样式在前台永远看不到。

切换后端地址：环境变量 `VITE_API_BASE`（默认 `http://127.0.0.1:8000`）。

---

## 三、后端 API（70+ 端点）

> 完整清单可访问 `http://127.0.0.1:8000/docs`（Swagger）或 `/openapi.json`。下表按业务分组列出全部端点。

**系统（3）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 + DB / AI provider 状态 |
| `GET /api/metrics` | 仪表盘指标（由真实数据推导） |
| `GET /api/health/site` | 网站健康度（按产品完整度动态计算） |

**企业（2）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/company` | 企业信息 |
| `POST /api/company/verify` | 企业身份核验（`company` 必填） |

**产品（7）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/products` | 列表（支持 `q` / `category` 筛选） |
| `GET /api/products/{id}` | 详情 |
| `POST /api/products` | 新增（**自动 AI 生成三语言内容**，返回 `ai_source`） |
| `POST /api/products/bulk-import` | **批量导入**（≤200 条，逐行 AI 生成 + 逐行容错，返回 `created` / `failed`） |
| `POST /api/products/parse-xlsx` | **解析 Excel(.xlsx)**（base64 上传，openpyxl 解析；`commit=false` 只预览，`commit=true` 直接导入） |
| `PUT /api/products/{id}` | 更新 |
| `DELETE /api/products/{id}` | 删除 |

**询盘（4）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/inquiries` | 列表（返回 `{inquiries, stats}`）+ 真实统计 |
| `GET /api/inquiries/{id}` | 详情 |
| `PUT /api/inquiries/{id}` | 状态流转（枚举校验） |
| `POST /api/inquiries` | 独立站 RFQ 提交（意向判定 hot/warm） |

**页面编辑器（6）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/pages` | 页面列表（首次访问自动播种 6 个页面） |
| `POST /api/pages` | 新建页面 |
| `GET /api/pages/{id}` | 页面详情（含有序 `sections` 组件树） |
| `PUT /api/pages/{id}` | **保存组件树**（区块类型枚举校验） |
| `DELETE /api/pages/{id}` | 删除（**首页不可删 → 400**） |
| `POST /api/pages/{id}/ai-rewrite` | **AI 改写区块文案**（返回 `before`/`after`，**不落库**，前端确认后再 PUT） |

**任务（7）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/tasks` | 列表（支持 `kind=followup\|growth`、`status` 筛选） |
| `POST /api/tasks` | 新建任务（followup 关联询盘时**自动把询盘 new→contacted**） |
| `GET /api/tasks/{id}` | 详情 |
| `PUT /api/tasks/{id}` | 更新（`status=done` 时进度自动置 100） |
| `POST /api/tasks/{id}/advance` | **推进子步骤**（按比例算进度，全完成 → done） |
| `DELETE /api/tasks/{id}` | 删除 |
| `GET /api/tasks/stats/summary` | 任务统计（total / done / doing / percent） |

**额度 Credits（4）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/credits` | 额度（`balance` / `totalGranted` / `used`） |
| `GET /api/credits/logs` | 消耗流水（充值记为负数，前端显示 `+N`） |
| `POST /api/credits/consume` | 消耗额度（**余额不足返回 402**） |
| `POST /api/credits/grant` | 充值额度 |

**市场本地化（2）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/localization` | 已生成的市场版本 + 免费额度（**免费规则由服务端裁定**，前端无法绕过） |
| `POST /api/localization/generate` | 生成市场版本（重复请求幂等；免费额度用尽且为新增市场 → **402**） |

**站点 / 用量 / 草稿 / 发布 / SEO / Agent（10）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET/PUT /api/site/state` | 站点状态读写 |
| `POST /api/site/generate` | 首次建站记录企业信息 |
| `GET /api/usage` | 免费额度 |
| `POST /api/usage/consume` | 消耗额度（**超限返回 402**） |
| `GET /api/drafts` | 待确认草稿列表 |
| `POST /api/publish` | 人工确认发布（**`human_confirmed≠true` → 403**，重复发布 409） |
| `GET /api/seo/diff/{product_id}` | 优化前后 Diff（10 字段） |
| `POST /api/seo/optimize` | 生成优化草稿（**不改线上**） |
| `POST /api/agent/run` | 自然语言 / 结构化 patch → 查询或草稿 |

**鉴权 / 账户（5）**

| 方法与路径 | 说明 |
| --- | --- |
| `POST /api/auth/register` | 注册（创建 User + Company + Tenant + Subscription） |
| `POST /api/auth/login` | 登录 → JWT（含 `tenant_id` / `role`） |
| `GET /api/auth/me` | 当前用户 + 所属租户 |
| `POST /api/auth/logout` | 退出 |
| `POST /api/auth/demo-switch` | 演示用切换租户 |

**统一付费权限（5）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/entitlements` | **权限单一真源**：plan / features / quotas / plans / upgradeUrl |
| `GET /api/service-orders` | 本租户开通申请与购买记录 |
| `POST /api/service-orders` | 创建申请（`plan_id` 或 `feature_key`，至少一项，否则 400） |
| `POST /api/service-orders/{id}/approve` | 审批通过 → **真实改写 Subscription / Entitlement** 并同步 `Tenant.plan` |
| — | 门禁由 `require_feature()` 注入各业务端点，**失败返回 402 + 结构化 detail** |

**版本历史（4）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/versions/recent?limit=` | 本租户全实体版本（新→旧），版本历史页数据源 |
| `GET /api/versions?entity_type=&entity_id=` | 单实体历史 |
| `GET /api/versions/{id}` | 详情（含 `before_snapshot` / `after_snapshot`） |
| `POST /api/versions/rollback` | **真回滚**：写回快照 + 生成 `action=rollback` 版本；404 版本不存在 / 409 实体不匹配 / 409 无快照 |

**独立站前台（匿名，3）**

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/public/site?tenant=<slug>` | **无需登录**；仅返回已发布租户；字段白名单（不含分数/询盘/用户） |
| `POST /api/inquiries` | RFQ 提交；按 `token → X-Tenant-Id → X-Tenant-Slug → 默认租户` 解析归属 |
| `GET /api/mcp/tools` | MCP 工具清单真源（15 条，含 `paid_feature` / `mutates`） |

---

## 四、AI 能力：LLM adapter 抽象

`backend/app/llm.py` 定义 `LLMProvider` 抽象基类，两种实现：

| Provider | 说明 |
| --- | --- |
| `mock`（默认） | 内置模板生成，**零外部依赖**，校赛/演示开箱即用 |
| `openai` | 兼容 OpenAI 协议（DeepSeek / 通义 / vLLM / Ollama 均可），失败自动降级并在 `ai_source` 标注 |

启用真实模型（复制 `backend/.env.example` 为 `.env`）：

```env
SITEPILOT_LLM_PROVIDER=openai
SITEPILOT_LLM_API_KEY=sk-xxxx
SITEPILOT_LLM_BASE_URL=https://api.deepseek.com/v1
SITEPILOT_LLM_MODEL=deepseek-chat
```

> 真实模型不可用时自动回退模板生成，前端/接口行为完全一致，不会报错。

---

## 五、Agent 安全规则（硬约束）

```
Draft → Diff → 人工确认（human_confirmed=true）→ Publish
```

- 任何会修改线上内容的动作**先生成草稿**，`POST /api/seo/optimize` 与 `POST /api/agent/run`
  都会验证「生成草稿后线上分数不变」。
- `POST /api/publish` 在 `human_confirmed=false` 时返回 **403**，从服务端强制保证 Agent 不能自行发布。
- 重复发布同一草稿返回 **409**。
- 免费计划首次发布免费，之后触发付费门槛。

---

## 六、两条演示路径

**完整演示路径（约 2 分钟，已通过 Playwright 前后端联调验证 30/30）**：

```
企业资料 → Hero预览 → 企业认证 → AI生成等待页 → 进入后台
→ 产品中心新增产品（AI生成内容，落库后端）
→ 单产品SEO优化 → 查看优化前后Diff → 生成草稿
→ Agent生成草稿 → 人工确认发布（产品分数真实更新、站点置为已发布）
→ 独立站预览 → RFQ询盘（写入后端）→ 询盘中心修改状态（落库）
```

**付费门槛触发点**：二次完整生成 / 第二次发布 / 高级 Skill / 专家代优化 / 全部语言市场版本。

---

## 七、项目结构

```text
backend/                          FastAPI 后端
├── app/
│   ├── main.py                   应用入口（CORS / 路由挂载 / lifespan 建表+种子）
│   ├── config.py                 Pydantic Settings（env 前缀 SITEPILOT_）
│   ├── database.py               SQLAlchemy engine / Session / Base
│   ├── models.py                 13 个 ORM 模型（User/Company/Tenant/Plan/Subscription/Entitlement/
│   │                             ServiceOrder + Product/Inquiry/SiteState/Usage/Draft/Page/TaskItem/
│   │                             Credit/CreditLog/Version）
│   ├── schemas.py                Pydantic 请求校验
│   ├── security.py               JWT 签发/校验 + current_user / tenant_scope 依赖
│   ├── tenancy.py                租户作用域查询助手（scoped_get / scoped_query / singleton）
│   ├── entitlements.py           ★ 权限单一真源（PLAN_FEATURES / require_feature / seed_plans）
│   ├── llm.py                    LLM provider 抽象（mock / openai）
│   ├── seed.py                   演示种子数据
│   ├── utils.py                  id 生成 / slugify
│   ├── services/ai_service.py    产品内容生成 / SEO / Agent 决策 / 页面文案改写
│   ├── services/xlsx_service.py  Excel(.xlsx) 解析（openpyxl，纯函数可单测）
│   └── routers/                  auth / entitlements / service_orders / public / mcp /
│                                 company / products / inquiries / pages / tasks / credits /
│                                 site / seo / agent
├── tools/fake_llm_server.py      OpenAI 协议兼容的假 LLM（验证真实链路用，:8100）
├── tests/                        pytest（226 用例）
├── pytest.ini
├── requirements.txt
├── .env.example
└── README.md                     后端独立说明

src/                              前端
├── main.jsx                      后台入口
├── site-main.jsx                 独立站前台入口（RFQ 真实提交 + 读取编辑器保存的区块样式）
├── App.jsx                       HashRouter + 路由 + PaywallModal
├── app/store/AppContext.jsx      全局状态 + 后端链路探测
├── services/
│   ├── api.js                    统一 API adapter（backend→local 双链路）
│   ├── db.js                     localStorage 降级数据层
│   └── mcp.js                    MCP 工具注册表 + 调用实现（15 个工具）
├── data/                         展示用静态数据（品牌视觉映射等）
├── components/                   layout / ui / products / brand / site
└── pages/                        Dashboard / Onboarding / Products / PageEditor /
                                  Inquiries / AIGrowth / Geo / SEOCompare / Agent /
                                  SkillCenter / Localization / Versions / Templates / Help

test/                              浏览器端联调（Playwright，真实点击，159 项断言）
├── e2e.mjs                        商家后台：产品筛选 + 编辑器样式（25）
├── e2e-site.mjs                   独立站前台：编辑器样式是否真的渲染（13）
├── e2e-agent.mjs                  AI Agent + MCP 15 工具 + 任务进度（13）
├── e2e-p05.mjs                    无 Demo 假反馈 + 付费弹窗真实订单落库（10）
├── e2e-multitenant.mjs            账户注册登录 + 跨租户隔离（21）
├── e2e-marketing.mjs              门户叙事 + WhatsApp + AI 徽章（18）
├── e2e-versions.mjs               版本历史 + 真回滚（32）
└── e2e-navigation.mjs             固定一级菜单 + 模板商城购买 + 使用说明（28）
```

---

## 八、API Adapter 命名空间

页面通过命名空间调用，后端替换/新增不影响组件：

```js
api.products.list() / create(data) / update(id, data) / delete(id)
api.products.bulkImport(items)            // 批量导入，返回 {created, failed}
api.inquiries.list() / updateStatus(id, status) / create(data)
api.pages.list() / create(data) / update(id, data) / delete(id) / aiRewrite(id, payload)
api.tasks.list(params) / create(data) / update(id, data) / advance(id) / delete(id)
api.credits.get() / logs(limit) / consume(payload) / grant(amount, note)
api.products.parseXlsx({filename, contentBase64, commit, items})  // Excel 解析（后端 openpyxl）
api.localization.get() / generate(market)
api.site.generate(input) / publish(draftId) / getState() / updateState(patch)
api.seo.optimizeProduct(productId)
api.agent.run(command)
api.publishDraft(draftId, humanConfirmed)
api.getMetrics() / getHealth()
```

**纯函数工具**（不依赖后端，已被单测/联调覆盖）：

```js
parseBulkText(text)      // 解析 CSV/TSV 粘贴文本 → {items, errors, skippedHeader}
splitCsvLine(line, sep)  // 处理双引号包裹与转义 "" 的字段切分
detectDelimiter(line)    // 自动识别 制表符 / 英文逗号 / 中文逗号
bulkSampleText()         // 生成可粘贴的示例清单
```

---

## 九、数据库结构（SQLite → 可换 Postgres）

> 建表由 SQLAlchemy `create_all` 完成；SQLite 缺列场景由 `main._migrate_sqlite()` 用 `PRAGMA table_info` + `ALTER TABLE` 补齐（已覆盖 `tenants.public_slug`、Subscription 回填、public_slug 回填）。
> 换 Postgres 只需设 `SITEPILOT_DATABASE_URL`，无需改代码。

**账户 / 企业 / 权限（6 张）**

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `users` | `id` / `email`(uniq) / `password_hash` / `role` / `tenant_id` | 登录主体，`role` = merchant \| operator |
| `tenants` | `id` / `name` / `industry` / `plan` / `public_slug`(uniq) | **隔离边界**；`public_slug` 供匿名访问独立站 |
| `plans` | `id` / `name` / `price` / `features`(JSON) / `limits`(JSON) / `sort` / `active` | 套餐字典，`features` 支持 `["*"]` 通配 |
| `subscriptions` | `tenant_id`(PK) / `plan_id` / `status` / `started_at` / `expires_at` | 每租户一条，权限真源之一 |
| `entitlements` | `id` / `tenant_id` / `feature_key` / `source` / `quota` / `used` / `expires_at` | 单项能力授权（可带配额），与 Subscription 取并集 |
| `service_orders` | `id` / `tenant_id` / `plan_id` / `feature_key` / `amount` / `status` / `note` | 开通/购买申请；审批通过真实改写 Subscription/Entitlement |

**业务（9 张）**

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `products` | `id` / `tenant_id` / `name` / `model` / `specs` / `seo`(JSON) / `seo_score` / `geo_score` / `localized_content`(JSON) | 产品；`localized_content` 存三语差异化内容 |
| `inquiries` | `id` / `tenant_id` / `customer_name` / `message` / `status` / `intent` / `source_channel` | RFQ 询盘；匿名提交按 slug 归属 |
| `pages` | `id` / `tenant_id` / `name` / `slug` / `sections`(JSON) / `is_home` / `seo_title` | 页面与有序组件树 |
| `drafts` | `id` / `tenant_id` / `entity_type` / `entity_id` / `diff`(JSON) / `patch`(JSON) / `status` / `human_confirmed` | AI 草稿；发布前必须 `human_confirmed=true` |
| `versions` | `id` / `tenant_id` / `entity_type` / `entity_id` / `version_no` / `before_snapshot`(JSON) / `after_snapshot`(JSON) / `action` / `published_by` | **版本快照**；`action` = publish\|rollback\|edit\|brush\|template\|seo\|geo |
| `site_state` | `id` / `company_name` / `industry` / `target_markets` / `plan` / `publish_status` / `publish_count` | 站点状态（**不承载权限语义**，权限只看 Subscription/Entitlement） |
| `usage` | `id` / `free_generation_limit` / `free_generation_used` | 免费额度（按租户） |
| `credits` / `credit_logs` | `balance` / `total_granted`；`skill` / `cost` / `balance_after` | 额度与流水 |
| `tasks` | `id` / `tenant_id` / `kind` / `inquiry_id` / `status` / `progress` / `steps`(JSON) | 跟进/增长任务 |

> **租户隔离约定**：所有业务表带 `tenant_id`；查询统一经 `tenant_scope` 依赖 + `scoped_get/scoped_query`；**跨租户访问返回 404 而非 403**（不泄露资源是否存在）。

---

## 十、环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SITEPILOT_DATABASE_URL` | `sqlite:///backend/sitepilot.db` | 数据库（生产可换 Postgres） |
| `SITEPILOT_CORS_ORIGINS` | `*` | 允许跨域来源（逗号分隔） |
| `SITEPILOT_FREE_GENERATION_LIMIT` | `1` | 免费完整生成次数 |
| `SITEPILOT_LLM_PROVIDER` | `mock` | `mock` / `openai` |
| `VITE_API_BASE` | `http://127.0.0.1:8000` | 前端指向的后端地址 |

---

## 十一、验收对照

| 项 | 状态 | 验证方式 |
| --- | --- | --- |
| `npm install / dev / build` | ✅ | `vite build` 79 modules 通过 |
| 后端 45 端点 + Pydantic 校验 | ✅ | `pytest` 137 passed |
| 前后端联调完整演示路径 | ✅ | Playwright 88/88（后台 25 + 前台 13 + 既有 50），运行时错误 0 |
| 数据真落库（SQLite） | ✅ | 刷新后数据保留，`/api/*` 可查 |
| Agent 人工确认硬约束 | ✅ | 403 / 409 单测覆盖 |
| 免费额度 402 付费墙 | ✅ | 单测 + 联调覆盖 |
| Credits 余额不足 402 + 充值恢复 | ✅ | 单测 + 联调覆盖 |
| 批量导入逐行容错 | ✅ | 200 条边界 + 单行失败不回滚 |
| 任务子步骤进度真持久化 | ✅ | 刷新后勾选状态保留 |
| AI 改写不污染线上 | ✅ | 单测断言改写前后 `sections` 相同 |
| 无 Demo 占位残留 | ✅ | `grep "Demo：" src/` 为空 |
| Excel(.xlsx) 原生导入 | ✅ | 端到端上传真实 xlsx，参数解析为键值对并落库 |
| 免费市场版本额度服务端裁定 | ✅ | 402 单测覆盖；被拒后状态不变 |
| 产品中心筛选真实生效 | ✅ | 分类/搜索状态叠加过滤，计数与空态可验证 |
| 编辑器样式属性真实生效 | ✅ | 对齐/背景/间距写入 props，画布与前台同步渲染 |
| 区块保存为合并语义 | ✅ | 单测断言「只改一个区块，其余不丢」 |
