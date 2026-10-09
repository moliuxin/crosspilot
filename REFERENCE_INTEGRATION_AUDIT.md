# REFERENCE_INTEGRATION_AUDIT.md — 参考工程审计(PHASE 0)

> 主工程:CrossPilot(crosspilot-faron,React+Vite / FastAPI / SQLAlchemy / SQLite+PostgreSQL / 统一 LLM Provider / ImageProvider / Tenant→Sites→Draft→Publish→Version)
> 参考工程 A:`instant_site_ai-main`(零后端 Python 单文件 HTML 生成器 + 六阶段 Skill 规则包)
> 参考工程 B:`jhworld-main`(Django + Nuxt 的俄语 B2B 展示站,含询盘/图库/案例)
> 原则:**CrossPilot 是唯一主工程**。两个参考工程只吸收知识与结构思想,全部改造为 CrossPilot 架构;严禁引入 Django/Nuxt/第二套 Auth/DB/LLM。

## A. instant_site_ai 审计

### 结构
```
skills/
  skill_0_industry_intelligence/  dictionaries/industry_profiles.json(3 行业,16KB)
  skill_1_theme_style/            rules/color_palettes.json(12KB) market_styles.json(1.8KB)
  skill_2_layout_selection/       rules/layout_variants.json(editorial/compact/dense)
  skill_3_transcreation/          dictionaries/{cta_lexicon,tone_matrix,ru_idioms,legal_terms}.json
  skill_4_asset_matcher/          槽位思想(hero/story_main/product_1...)+Unsplash 关键词匹配
  skill_5_token_injector/         CSS 变量动态注入
system/agent_director.md          六阶段调用顺序 + 质量检查
output/index.html                 单文件 HTML 产物(不采用)
```

### 吸收(改造成 CrossPilot 形态)
| 参考 | 去处 |
|---|---|
| industry_profiles(别名/决策模型/痛点三语/site_answer/视觉倾向/排版倾向) | `backend/app/knowledge/industries/*.json` + IndustryIntelligenceSkill(规则优先,GLM 补全) |
| color_palettes + token_schema + WCAG 规则 | ThemeStyleSkill 的 DesignTokenProfile + 对比度校验 |
| market_styles(CN/West/RU 差异) | 融入 `backend/app/knowledge/markets/*/style.json` |
| layout_variants(editorial/compact/dense) | LayoutPlanningSkill 的密度/网格提示 |
| cta_lexicon(三语统一询盘 CTA) | `knowledge/markets/*/cta.json` + Transcreation CTA 白名单 |
| tone_matrix(行业×市场语调) | `knowledge/markets/*/tone.json` |
| ru_idioms(оставить заявку/под ключ/вы 敬称…) | `knowledge/markets/ru-RU/idioms.json` |
| legal_terms(152-ФЗ 同意措辞等) | `knowledge/markets/ru-RU/compliance.json`(仅辅助,UI 声明"需法律复核") |
| asset 槽位思想 | Asset Slot System(PHASE 8,本批不实施) |
| 六阶段质量门 | Verification Pipeline(PHASE 14,本批不实施) |

### 不采用
单文件 HTML 输出、零后端架构、原 HTML 组件复制、固定 Section 顺序、硬编码 Unsplash 图、固定 Trust Badge、会员/评论模块默认启用。

## B. jhworld 审计

### 结构
```
backend/(Django): catalog(Product/ProductGalleryImage/cover_image) leads(InquiryLead/QuoteRequest+产品快照) …
frontend/(Nuxt + i18n): /ru /en /zh 独立 URL、SEO meta、产品图库交互
docker-compose.yml + 双 Dockerfile
document_info/: 中文 PRD 两份
```

### 吸收(思想,非代码)
| 参考 | 去处 |
|---|---|
| ProductGalleryImage 多图 | 强化现有 Asset(product_id/caption/sort_order/is_primary)— PHASE 8 |
| QuoteRequest 产品快照 | Inquiry 快照字段 — PHASE 10 |
| 询盘状态机 | new→qualified→…→closed — PHASE 10 |
| CaseStudy | CaseStudy 模型(USER_VERIFIED 才可发布)— PHASE 11 |
| 多语言独立 URL + hreflang | 公开站 SEO — PHASE 13 |
| Docker 部署结构 | 已有等价物(crosspilot 自带 compose,无需借鉴实现) |

### 不采用
Django/DRF、Django ORM、Nuxt、整套账号体系、价格/购买意向电商逻辑、Translation 表(用 Market Variant 替代)、两套数据库。

## C. CrossPilot 现状对照(本批四个 Phase 的落点)

- Skill Center 目前是前端静态目录(`src/data/skills.js`)→ **PHASE 1** 建真后端 Skill Engine(`backend/app/skills/`,Skill 协议 + Registry + SkillRun 落库 + `/api/skills*` API,成功才扣 Credits)。
- 行业理解目前只有 LLM prompt → **PHASE 2** 规则库优先(industrial_robotics 等 7 类三语画像,规则置信度不足再 GLM 补全,schema 校验)。
- market_profiles 目前 13 字段 → **PHASE 3** 扩为每市场知识目录(content/cta/tone/idioms/compliance/style),含俄语惯用表达与合规术语(标注"辅助,非法律意见")。
- 页面渲染目前按 section type → **PHASE 5** Component Registry(组件元数据 + market/industry 适配 + layout_schema 由 GLM 输出而非 HTML)。

## D. 分支与验证纪律

- 分支:`feature/national-skill-integration`(基于 main @ 89d409a)
- 每 Phase:`pytest -q` + `npm run build` 全绿才进下一 Phase
- 本批范围:PHASE 1 / 2 / 3 / 5(顾问指定的"第一批");6/7/8/9 留给第二批
