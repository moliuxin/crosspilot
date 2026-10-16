# CrossPilot 功能审计与创新融合清单（阶段 1 · 只审计未改码）

> 当前分支 `feature/national-real-capabilities` @ `98c7ee5`（工作区干净，仅 1 张未跟踪截图）
> 参考包已解压至 `_ref_audit/`（不进主项目）：`jhworld/`(157 文件, Django+Nuxt) · `instant_site_ai/`(211 文件, 六技能流水线)
> 审计方法：CrossPilot 侧基于本会话连续多轮的源码/API/DB/浏览器实测；参考包侧定向读取关键文件到字段级

---

## 一、当前项目功能矩阵（30+ 项，浓缩版）

### ✅ 真实可用（源码+API+DB+测试+浏览器五重验证）
Multi-Site 多租户 · 免费整站生成(账号级1次) · 模板商城(6 真实封面) · **三市场 SiteMarketVariant**(策略校正+tokens 差异化, cn/en/ru-home.png 肉眼互异) · Visual Pipeline(REAL>AI>FALLBACK+异步补图+一键恢复) · **RFQ 快照+线索来源**(product_model/market_snapshot + source_market/locale/cta) · **Buyer Conversion 闭环**(五维规则引擎+报告表+改进草稿 422 拒编造+Re-score 30→63) · **Freehand AI Brush**(手绘圈选+selection 落库+裁决) · SEO/GEO 真写回 · Skill Engine(10+ Skills/SkillRun) · **Agent 规范J任务**(最低SEO→俄语草稿, requiresConfirmation) · Draft/Diff/Confirm/Publish · Version/Rollback · 跟进任务真实 CRUD · 首页 V5(雪山背景+完整动态地球)

### ⚠️ 部分实现
| 项 | 已有 | 缺口 |
|---|---|---|
| Buyer Persona | Skill 真跑+SkillRun 落库 | 独立工作台 UI（无承诺入口，低优先） |
| MCP | 15 读工具真实接数据层 | 多步自动编排（写链已走 brush/draft API） |
| RU 合规 | 152-ФЗ 术语/文案在知识库+RFQ 提示 | ConsentRecord 落库（勾选记录） |
| 公网部署 | GH Pages 最新前端已同步 | **公网无后端**（架构性，见 §四） |

### 🚫 仅 UI/Mock
- 无（上一轮已清理：mock SVG 假 AI 标注纠正 108 条；任务跟进静默本地降级已移除；首页假百分比加 Demo 徽标）

### ❓ 无法验证
- cogview-4 高清档（资源包耗尽，已用 cogview-3-flash 顶替）
- 云生产部署（按此前指令不碰导师生产环境）

---

## 二、两个压缩包审计结果（文件级证据）

### jhworld（Django + Nuxt，俄区 B2B 独立站）

| 参考实现 | 文件:行 | CrossPilot 对照 | 结论 |
|---|---|---|---|
| J1 ProductGalleryImage(product, image, caption, sort_order) | `backend/catalog/models.py:94-98` | Asset 表已有 product_id/caption/sort_order/is_primary + ProductGrid/SlotImage 渲染（公开站 10/10 图片实测） | **已有等价，复用不建表** |
| J1b ProductTranslation(locale, name, subtitle, summary) | `catalog/models.py:45-50` | Product.localized_content JSON（已含多语言内容） | 已有等价（JSON vs 行模型，够用） |
| J2 QuoteRequest.product_name_snapshot/slug_snapshot | `backend/leads/models.py:57-58` | **本轮已加** product_model_snapshot/market_snapshot | **已吸收 ✓** |
| J3 InquiryLead.target_market/source_locale/source_page | `leads/models.py:18-20` | **本轮已加** source_market/locale/cta（超集，+source_channel） | **已吸收 ✓** |
| J+ LeadForm **预算范围** estimated_budget + quote/purchase 双请求类型 | `leads/models.py:59,66` + `LeadForm.vue`（三语预算占位文案） | CrossPilot RFQ 无预算字段 | **🆕 值得吸收（增量 1 列+1 表单字段，B2B 询盘质量信号）** |
| CaseStudy(+Translation) 案例 | `catalog/models.py:109-137` | cases 区块已概念化展示（AI 不伪装真实案例） | 设计对齐，暂不扩 |
| docker-compose（Django+env 驱动） | `docker-compose.yml` | CrossPilot 已有更完整 compose（healthcheck+反代+PG） | 不采用 |

### instant_site_ai（六技能流水线 → 零后端单文件 HTML）

| 参考实现 | 文件 | CrossPilot 对照 | 结论 |
|---|---|---|---|
| I1 industry_profiles.json（aliases/decision_model/buyer_pain_points/trust_signals/layout_hints, 模板含 SOP 入库规则） | `skills/skill_0_.../dictionaries/industry_profiles.json` | `knowledge/industries/` 7 行业同构画像（字段级对应：visual_tone≈visual_hints.palette_family、trust_signals≈trust_requirements、layout_hints 同名） | **已有等价，复用** |
| I1b 行业兜底画像+强制入库 SOP | `templates/industry_profile.template.json` | match_industry 未命中回落 general_b2b（无入库流程） | 价值低（7 行业已覆盖演示场景），记录不动 |
| I2 color_palettes.json + validate_palette.py | `skill_1/rules/color_palettes.json` | ThemeStyleSkill.PALETTES 6 套 + wcag_check() | **已有等价，复用** |
| I2b market_styles.json（市场层只调字风/密度/色温/CTA 形态，行业 palette 为基底） | `skill_1/rules/market_styles.json` | `knowledge/markets/*/style.json` + MARKET_THEME 市场微调（本轮已接通） | **已有等价 ✓** |
| I3 layout_variants.json（editorial/compact/dense + 行业映射） | `skill_2/rules/layout_variants.json` | MARKET_DEFAULT_SECTIONS + industry sections_priority（zh dense/en editorial/ru dense） | **已有等价 ✓** |
| I4 cta_lexicon.json（unified_ctas/forbidden_cta_words/form_microcopy） | `skill_3/dictionaries/cta_lexicon.json` | `knowledge/markets/*/cta.json` 白名单 + brush 禁电商话术(测试断言) | 已有等价；**🆕 form_microcopy（表单微文案按市场）**可作为文案增量，优先级低 |
| I4b legal_terms.json（俄区合规措辞锚点） | `skill_3/dictionaries/legal_terms.json` | `knowledge/markets/ru-RU/compliance.json` | **已有等价 ✓** |
| I4c tone_matrix.json + ru_idioms.json（вы 称呼/Yandex 习惯） | `skill_3/dictionaries/` | `knowledge/markets/ru-RU/tone.json + ru_idioms.json` | **已有等价 ✓** |
| I5 asset_tags.json → Unsplash 外链槽位 | `skill_4/dictionaries/asset_tags.json` | CrossPilot 用 cogview 真实生成 + REAL 产品图优先，不依赖 Unsplash 外链 | **不采用**（外部依赖+失效风险，与"真实图片"目标相悖） |
| 六步流水线 + 质量门（validate_palette/lint_transcreation/validate_assets） | `system/agent_director.md` | `services/market_variants.py` 六技能编排 + VerificationSkill + wcag_check + CTA 白名单测试 | **已有等价 ✓**；lint 思路可借鉴（低优先） |
| 零后端单文件 index.html | `AGENT_RULES.md` | CrossPilot 全栈多租户 + 公开渲染 API | 架构不同，不采用 |

**关键结论：导师点名的 8 项能力（I1-I5、J1-J3）中 7 项 CrossPilot 已有等价实现且上一轮已核验复用；仅 J2 的"预算范围"字段是净新增点。**

---

## 三、独立站无图片——真实根因（已查明，非猜测）

数据链路逐环实测结论（源码+DB+浏览器）：

1. **生成链真实**：cogview 真实调用 → Asset 落库（38 条真实 CDN URL）→ manifest → section props 注入 → SlotImage 渲染，公开站 10/10 图片 HTTP 200（浏览器实测）
2. **历史污染已清除**：108 条 Mock SVG 曾被误标 `AI_GENERATED` → 已一次性迁移纠正为 FALLBACK（启动日志实证）
3. **公网"无图"的真正根因 = 部署架构**：GitHub Pages 是**纯前端静态站，没有后端**——`/api/*` 全部失败，站点数据走浏览器本地演示模式，图片不落公网。**这不是代码 bug，任何前端修复都无法让 GH Pages 有后端数据**
4. 次要因素（已修）：前端 8s 超时掐断慢生成；mock 假 AI 标注；模板资产子路径

**最小修复方案（已实施完毕）**：完整功能走本机 Docker `http://localhost:8080`（nginx+FastAPI+PG）；公网 GH Pages 定位为"静态演示+导流"，页面已有真实后端连接提示。若需"带后端的公网"，需要一台云主机跑 docker-compose（提供现成 compose，约 30 分钟，需您提供服务器/域名——导师此前指示不碰其生产环境）。

## 四、后端是否需要重新部署——判定：**不需要**

| 检查项 | 结果 |
|---|---|
| 公网前端指向 | GH Pages 无 API（本地演示模式），非指向某后端 |
| 本机 Docker 后端 | 三容器 healthy，`/api/health` 200（需登录），与本地代码一致（web/api 镜像每次改动均 `--build` 重建） |
| 本次是否改后端 | 上一批 RFQ 快照/来源/跟进修复**已随镜像部署并浏览器验证** |
| 数据库 | PostgreSQL volume 持久化；迁移为启动时方言感知增量列（无需手工步骤） |
| 待部署变更 | **无**——当前代码即线上（Docker）运行版本 |

**触发重部署的条件**（记录备用）：把后端公开到云上（需服务器+域名+HTTPS），或未来修改 backend 代码后忘记 `docker compose up -d --build`。

## 五、风险 / 测试 / 优先级

| 优先级 | 事项 | 成本 | 风险 | 测试方法 |
|---|---|---|---|---|
| P2 🆕 | RFQ 表单增加"预算范围"可选字段（吸收 jhworld estimated_budget； inquiries 加 1 列 + 公开表单 1 字段 + 1 测试） | 极低（≤1h） | 低（增量列默认空） | 提交带预算询盘 → DB 断言 |
| P3 | 表单微文案按市场（instant form_microcopy 思路） | 低 | 低 | 三语表单文案抽查 |
| P3 | 云服务器部署后端（消除公网/本机差异） | 中 | 需账号权限 | 公网 /api/health |
| P4 | RU ConsentRecord 落库 | 中 | 低 | RFQ 不勾选拒提交断言 |
| — | 其余（Persona 工作台/MCP 编排/Unsplash 素材库/单文件输出） | — | — | 明确不采纳，避免无价值开发 |

**已核对的部署事实**：公网 GH Pages = 最新前端（main-6bie8OYW 之后的 `main-Cz2o3GjR.js` 已验证）；本机 Docker = 全栈最新（357 tests passed, npm build ✓）。

---

**阶段 1 结论：无需大改。** 当前项目与两包的能力映射已在先前列轮落地 7/8，净新增仅"预算范围"一个字段级增强；图片链路与三市场独立性已真实修复并验证；后端无需重部署。等待确认后可进入阶段 2（若需要）——默认建议直接做 P2 的 RFQ 预算字段（30 分钟内含测试），其余按上表优先级。
