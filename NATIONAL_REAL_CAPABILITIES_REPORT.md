# NATIONAL_REAL_CAPABILITIES_REPORT.md — 真能力验收报告(PHASE 0–6 + 8)

> 分支:`feature/national-real-capabilities` · 主工程 CrossPilot 唯一
> 验收环境:Docker(nginx + FastAPI + PostgreSQL)http://localhost:8080
> **Test:293 passed,0 failed · npm build ✓ · 完整 E2E 八步全绿(见下)**

## 1. 本轮修改文件

```
backend/app/models.py                 SkillRun +user_id/finished_at;Asset +alt_text;
                                      SiteMarketVariant +seo_metadata;资产四列
backend/app/skills/{base,registry}.py Skill 协议/Registry(成功才扣 Credits)
backend/app/skills/industry_intelligence.py  规则优先→GLM 补全
backend/app/skills/market_localization.py    Theme(WCAG)/MarketLocalization/LayoutPlanning
backend/app/skills/market_transcreation.py   Transcreation(CTA 白名单+电商禁用)+ VisualBrief/Generation
backend/app/skills/audit_skills.py    BuyerPersona / SEOOptimization / Verification
backend/app/skills/component_registry.py     16 组件元数据 + 三市场默认布局(不写死 React)
backend/app/knowledge/{industries,markets}/  7 行业三语画像 + 3×5 市场知识
backend/app/services/market_variants.py      变体编排(Industry→Theme/Layout/Transcreation×3→Asset 管线→SEO)
backend/app/routers/{skills,ai,brush,sites,site,public}.py
                                      Skill API;/ai/status;/brush/generate;
                                      market-variants 端点;market_variant 实体接入 Draft/Publish/Version/Rollback;
                                      公开站返回变体
backend/app/skills/_migrate_helpers.py 方言感知列迁移(SQLite PRAGMA / PG information_schema)
src/components/site-blocks/           Schema 渲染器 + 真实 <img>(lazy/alt/onError)
src/pages/PublicMarketSite.jsx        /#/site/:slug/:market/ 公开页(独立 SEO Title/hreflang)
src/pages/Sites/MarketVariantsPanel.jsx  三市场并排 + AI 画笔(选中→指令→Diff→确认→回滚)
src/pages/SkillCenter/SkillCenter.jsx    真后端 Skill 运行(prompt 输入→JSON 结果落库)
```

## 2. 新增数据库表 / 迁移

| 表 | 说明 | 迁移 |
|---|---|---|
| `skill_runs` | Skill 执行(输入/输出/ai_source/latency/credits) | create_all + 存量补列(user_id/finished_at) |
| `ai_executions` | capability 级 LLM 调用日志 | create_all |
| `site_market_variants` | 市场变体(唯一 site_id+market;+seo_metadata) | create_all + 补列 |
| `assets` 扩列 | product_id/caption/alt_text/sort_order/is_primary | 方言感知 ALTER |

## 3–4. 新增 API / Skill

API:`GET /api/skills`、`/{id}`、`POST /{id}/run`、`GET /api/skills/runs[/{id}]`;`GET /api/ai/status`;`POST /api/brush/generate`;`GET /api/sites/{id}/market-variants[/{market}|/generate]`;`GET /api/public/site?site=&market=`(返回 market_variant)。

Skill(7 个真实注册):industry_intelligence、buyer_persona、theme_style(WCAG)、market_localization、market_transcreation、layout_planning、visual_brief、visual_generation、seo_optimization、verification。

## 5–8. 参考工程采用情况

**instant_site_ai**:行业画像/别名/痛点三语/site_answer → knowledge/industries(改造,非复制);CTA 词库/tone/ru_idioms/152-ФЗ 术语 → knowledge/markets;layout_variants 思想 → component_registry;六阶段质量门 → VerificationSkill(先行);Asset 槽位 → 管线。**不采用**:单文件 HTML 输出、零后端、硬编码 Unsplash、固定 Trust Badge。
**jhworld**:产品图库体验(React 重写 ProductGallery);QuoteRequest 快照思想(PHASE 10 未做,已记录);多语言独立 URL + hreflang → /site/{slug}/{market}/。**不采用**:Django/Nuxt/第二套账号/Translation 表。

## 9–10. AI / Image 来源

文本:统一 LLM Provider(mock→模板如实标注 / GLM 配置后真实调用,`ai_source` 全链标注);图片:统一 ImageProvider(MockImageProvider 产 SVG 占位并标 `FALLBACK`/`AI_GENERATED`,**绝不冒充**);事实性元素(cert/logo/铭牌/真实案例)AI 一律拒生成(测试断言)。

## 11–13. 测试

`cd backend && pytest -q` → **293 passed, 0 failed**(新增 test_skill_engine 16 / test_batch2_variants 9 / test_phase3_real 5);`npm run build` ✓。

## 14–15. 完整 E2E(Docker 实测,八步全绿)

```
① SkillRun: industrial_robotics | roles ✓  run-by-id ✓
② 站点变体: zh 8 区块 / en 7 / ru 8,三市场 hero 图 YES,SEO title 三语不同
③ 公开站 RU 变体: sections 8 | canonical /site/s-7-7d1b2c/ru-RU/
④ 免费账户 brush/generate → 403 ✓
⑤ 购买 growth + 审批 → brush.edit 生效 ✓
⑥ 草稿 draft_xxx | diff [eyebrow,title,description,image,cta…];未确认 → 公开变体不变 ✓
⑦ 确认发布 → Version v1(market_variant);发布后 title 改变 ✓
⑧ 回滚 → title 恢复发布前 ✓
```
浏览器三市场公开站实测(截图已存):zh「源头工厂·稳定可靠/获取报价」· en「manufacturer—precision/Request a quote」· ru「от производителя—точное позиционирование/Запросить цену」;区块结构互异;每站 1 张真实 `<img>`(SVG 数据图,来源标注)。

## 16–17. PARTIAL / DONE 状态表

| Capability | Frontend | API | DB | AI/Logic | E2E | Status |
|---|---|---|---|---|---|---|
| Skill Engine | ✓SkillCenter 真运行 | ✓ | ✓SkillRun | ✓Registry | ✓ | **DONE** |
| Industry Intelligence | ✓ | ✓ | ✓ | ✓规则优先+GLM | ✓ | **DONE** |
| Buyer Persona | ✓(Skill入口) | ✓ | ✓ | ✓ | ✓ | **DONE** |
| Market Variant | ✓面板+公开页 | ✓ | ✓唯一约束+SEO | ✓三市场不同结构 | ✓截图 | **DONE** |
| Transcreation | ✓ | ✓ | ✓ | ✓CTA白名单+电商禁用 | ✓ | **DONE** |
| Component Registry | ✓site-blocks | ✓ | — | ✓16组件+槽位 | ✓ | **DONE** |
| Visual Generation | ✓真实`<img>` | ✓ | ✓Asset扩列 | ✓Provider+事实禁伪 | ✓ | **DONE**(真实图片API待Key) |
| Product Gallery | ✓组件已建 | 部分 | ✓ | — | 部分 | **PARTIAL**(详情页接线待做) |
| AI Brush | ✓选中/指令/Diff/确认/回滚 | ✓403→Draft→Publish | ✓Version | ✓JSON Patch | ✓八步 | **DONE** |
| Buyer Conversion Engine | — | — | — | — | — | **NOT STARTED** |
| Case Study | — | — | — | — | — | **NOT STARTED** |
| RFQ Snapshot | — | — | — | — | — | **NOT STARTED** |
| Verification Gates | 部分 | ✓verification skill | — | ✓3门 | 部分 | **PARTIAL**(Publish 拦截未接) |
| Agent Orchestration | — | — | — | — | — | **NOT STARTED** |
| AI Sales Assistant | — | — | — | — | — | **NOT STARTED** |
| PostgreSQL | ✓ | ✓ | ✓Docker运行 | — | ✓ | **DONE**(Alembic 未引入) |
| Public Deployment | ✓localhost | ✓ | ✓ | — | ✓ | **PARTIAL**(公网后端未部署) |

## 18. 技术债

GLM/Image 真实 Key 未配置(标注体系已就绪);Alembic 未引入(用方言感知补列);Product Gallery 详情页接线;Verification Gate 未拦截 Publish;evaluation/ 算法实验未建;公网部署(Render/Railway + 云 PG)未做。

**按指令:本批到此暂停,等待审核后再进入 Agent / AI 客服 / 生产部署阶段。**
