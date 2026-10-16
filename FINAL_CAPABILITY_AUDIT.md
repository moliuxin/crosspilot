# FINAL_CAPABILITY_AUDIT.md — 国赛最终功能审计

> 分支:`feature/national-real-capabilities` · 最新提交含本轮全部修复 · **pytest 357 passed · npm build ✓**
> 判定:UI 入口 + API + DB 持久化 + 刷新不丢 + Tenant 权限 + 错误处理 + test + 浏览器可用 = DONE
> 审计方式:源码 + API 实测 + DB 直查 + 浏览器操作,不信历史报告

## 1. 状态表

| # | Capability | Before(本轮前) | After | Evidence |
|---|---|---|---|---|
| 1 | Multi-Site | DONE | DONE | 站点 CRUD + 租户隔离 404(测试+实测) |
| 2 | Generic Dashboard | DONE | DONE | Overview 真实计数(0 值如实显示) |
| 3 | Public Template Marketplace | DONE(图不可靠) | **DONE** | 6/6 真实 webp 封面/预览加载;匿名可看;BASE_URL 前缀 |
| 4 | One Free Full-Site Generation | DONE | DONE | 账号级 1 次,成功才扣(测试) |
| 5 | Paid AI Brush entitlement | DONE | DONE | 403→购买→生效(测试) |
| 6 | AI Site Generation | DONE | DONE | 真实 GLM(ai_source 标注);300s 前端超时修复 |
| 7 | Product Fact Layer | DONE | DONE | 产品事实只读共享;变体不写 facts |
| 8 | Industry Intelligence | DONE | DONE | 7 行业三语画像(规则优先+GLM) |
| 9 | Buyer Persona | PARTIAL | PARTIAL | Skill 真跑+SkillRun;独立工作台未做(非承诺入口,不再扩) |
| 10 | SiteMarketVariant | DONE | DONE | 三市场持久化,刷新/重启保持 |
| 11 | CN/EN/RU Market Localization | DONE | DONE | 市场策略校正+tokens 差异化;三公开页肉眼互异(cn/en/ru-home.png) |
| 12 | Visual Pipeline | DONE | DONE | REAL>AI>FALLBACK;异步补图+状态条 |
| 13 | Product real images/gallery | PARTIAL | **DONE** | Asset 已有 product_id/caption/sort_order/is_primary;公开站 ProductGrid 渲染真实图(10/10 img OK);Gallery 组件在站点详情可用 |
| 14 | GLM/Image Provider | DONE | DONE | cogview-3-flash(cogview-4 资源包耗尽,免费档顶替) |
| 15 | Image retry/cache/fallback | DONE | DONE | Retry-After+指数退避+三级缓存+增量 regenerate(浏览器双路径实证) |
| 16 | SEO | DONE | DONE | 优化真写回+Draft/Publish |
| 17 | GEO | DONE | DONE | GEO 报告页+真实诊断 |
| 18 | Buyer Conversion | DONE | DONE | 五维规则引擎+报告表+改进闭环(30→63 实测)+单调性测试 |
| 19 | Freehand AI Brush | DONE | DONE | 手绘圈选→patch→draft→diff→confirm→publish→version(浏览器实拍) |
| 20 | Skill Engine | DONE | DONE | 10+ Skill 注册/运行/SkillRun 落库 |
| 21 | Agent | PARTIAL | **DONE(规范 J 任务)** | "找出 SEO 最低 5 个→选第一个→俄语优化→草稿待确认"真实跑通:table 返回 5 产品排序、draft 落库(market=ru-RU)、requiresConfirmation=true、**不自动发布** |
| 22 | MCP | PARTIAL | PARTIAL | 15 读工具真实;写链走 brush/draft API;完整编排未做(P2) |
| 23 | RFQ/Inquiry | DONE | DONE | 公开表单→Inquiry 落库→后台跟进 |
| 24 | Lead Source Tracking | MISSING | **DONE** | `source_market/locale/cta` 落库(实测 ru-RU/Запросить цену);来源页面/渠道已有;后续可按市场/CTA 分析询盘 |
| 25 | Draft/Diff/Confirm/Publish | DONE | DONE | human_confirmed 硬校验;未确认公开站不变(实测) |
| 26 | Version/Rollback | DONE | DONE | 真快照真恢复(浏览器实测) |
| 27 | Privacy/Consent | MISSING | MISSING | PolicyVersion/ConsentRecord 未做(见"下一步") |
| 28 | Russia data handling | MISSING | **PARTIAL** | 152-ФЗ 术语/合规文案在知识库并进 RU 文案;RfqBlock 已有同意提示;**ConsentRecord 落库未做** |
| 29 | AI 客服/询盘助手 | — | — | 现有产品无此入口与承诺,按指令不实现 |
| 30 | Homepage Premium 3D Globe | DONE(有缺陷) | DONE(缺陷已记录) | V4 真贴图地球/Bloom/拖动;canvas 拦截 hero 点击为已知 P1 缺陷 |
| 31 | Production/Docker readiness | PARTIAL | PARTIAL | Docker 三容器健康+healthz;公网 HTTPS/Alembic 未做(按指令不部署) |
| 32 | Fake/demo data detection | DONE | **DONE(加固)** | 108 条 mock SVG 假 AI 标注纠正为 FALLBACK(数据迁移);Mock provider 永标 FALLBACK;任务跟进禁止本地假保存;逐页 grep 无硬编码分数 |

## 2. 从 instant_site_ai 吸收了什么

**结论:五类能力此前已在知识库/技能层等价落地,本轮核验复用,零重复实现:**

| 能力 | CrossPilot 等价物 | 状态 |
|---|---|---|
| I1 Industry Profile | `knowledge/industries/` 7 行业(profile/aliases/pain_points 三语 + layout_hints.sections_priority) | 已有,复用 |
| I2 Market Style Profile | `knowledge/markets/*/style.json`(density/emphasis/notes)+ ThemeStyleSkill 市场差异化(bg/radius/字体/密度) | 已有,本轮接通 market 参数 |
| I3 Layout Variant | `MARKET_DEFAULT_SECTIONS`(zh dense/制造前置 · en editorial/价值前置 · ru dense/参数前置)+ 行业 hints 重排 | 已有,复用 |
| I4 Tone Matrix | `knowledge/markets/*/tone.json`(zh 禁淘宝腔 / en specs-over-adjectives / ru вы+禁倒计时) | 已有,复用 |
| I5 CTA Lexicon | `knowledge/markets/*/cta.json` 白名单(brush 强制从词库取,电商话术黑名单测试断言) | 已有,复用 |

按指令未复制:静态 HTML 模板 / 旧 i18n engine / 旧 Token Injector。

## 3. 从 jhworld 吸收了什么

| 能力 | 实现 | 状态 |
|---|---|---|
| J1 Product Gallery | 复用现有 Asset(product_id/caption/sort_order/is_primary)+ ProductGallery/ProductGrid 组件;**未建第二套表** | 核验为等价,补验浏览器(公开站图片 10/10) |
| J2 RFQ Snapshot | `inquiries` 增列 `product_model_snapshot/market_snapshot`;提交时固化,产品改型号历史不失真(测试断言) | **本轮新增** |
| J3 Lead Source Tracking | `inquiries` 增列 `source_market/source_locale/source_cta`;公开 RFQ 表单注入;查询分析可用 | **本轮新增** |

按指令未复制:Django/Nuxt 架构、订单/支付/ERP、购物车、完整 CRM。

## 4. 修改文件(本轮)

```
backend/app/image_provider.py           Mock 标 FALLBACK(不再冒充 AI)
backend/app/main.py                     inquiries 5 列迁移 + mock 资产纠偏(幂等,实测 108 条)
backend/app/models.py                   Inquiry 快照/来源 5 列 + to_dict
backend/app/schemas.py                  InquiryCreate + market/source_page/source_cta
backend/app/routers/inquiries.py        快照/来源写入 + GET /{id}/follow-ups
backend/app/routers/agent.py            规范 J 组合任务分支 + 只读判定修正
src/services/api.js                     任务系列去静默本地降级(真实 CRUD)
src/pages/Inquiries/Inquiries.jsx       跟进错误处理
src/pages/Templates/TemplatesPage.jsx   模板资产 BASE_URL 前缀
src/site-main.jsx                       RFQ 提交带市场/来源
backend/tests/test_rfq_snapshot_source.py            新增 2 用例
backend/tests/test_generation_and_entitlements.py    诚实断言修正
```

## 5. Migration(增量,老数据兼容)

- `inquiries` 补 5 列(默认空串,ensure_columns 方言感知,SQLite/PG 双兼容)
- 数据纠偏(幂等 UPDATE):mock SVG 的 AI_GENERATED→FALLBACK,实测 108 条
- 无删表/无重置

## 6. Tests

- `pytest` **357 passed**(新增 RFQ 快照/来源 + follow-ups 端点 2 用例;修正 1 个"要求 mock 冒充 AI"的旧断言)
- `npm run build` ✓
- 浏览器 E2E:三市场公开页图片 10/10 · 模板 6/6 · 跟进创建→刷新→完成→刷新(全链) · Agent 任务 · RFQ 快照落库

## 7. 仍然 PARTIAL 的项目

| 项 | 缺口 |
|---|---|
| Buyer Persona 独立工作台 | Skill 真跑;无专门 UI(无承诺入口,暂不扩) |
| MCP 完整编排 | 15 读工具真实;多步自动编排未做 |
| Russia ConsentRecord | 152-ФЗ 文案就绪;勾选记录落库未做 |
| Production 公网 | Docker 本地完整;HTTPS/云部署按指令不做 |
| Homepage canvas 拦截点击 | 已知 P1 缺陷(路由直达绕过) |

## 8. 下一步最多 3 项

1. **俄罗斯合规落地**:RFQ Consent 默认不勾选 + ConsentRecord(consent_at/policy_version/market/purpose)落库——RU 市场合规是评委必问点
2. **GH Pages 重部署**(Clash 恢复后):公网静态演示同步最新 bundle+模板资产
3. **Homepage canvas 点击穿透修复**(pointer-events:none 豁免 UI 层):消除 hero 按钮不可点的已知缺陷

---

**git diff --stat 见提交;本轮到此停止。**
