# CURRENT_NATIONAL_STATE_AUDIT.md — 接管审计(2026-10-14)

> 分支:`feature/national-real-capabilities` · 判定标准:Frontend + API + DB + Logic + Test + **Browser E2E** 全真 = DONE
> 审计方式:不信任历史报告结论 —— 源码阅读 + API 实测 + 数据库直查 + pytest 全量 + 浏览器实际操作重新判定
> 本轮全量测试:**355 passed(含本轮新增 31 个)** · npm build ✓ · Docker 三容器 healthy

## 审计中发现的"报告与事实不符"项(本轮已修复或如实降级)

| # | 历史报告声称 | 实测发现 | 处置 |
|---|---|---|---|
| 1 | Market Variant DONE(三市场结构互异) | **LLM 布局顺序三市场雷同**(zh/ru 实测完全相同);ThemeStyleSkill 声称"市场色温微调"但**根本没读 market 参数**(三市场 tokens 全同,连字体都是微软雅黑) | 修复:市场策略强制校正 + tokens 市场差异化(MARKET_VARIANT_E2E_REPORT) |
| 2 | AI 画笔 DONE(八步 E2E) | 只有**整块点击选中**,无自由手绘圈选(按规范 5.6 判定 = PARTIAL) | 实现 Freehand 圈选(FREEHAND_BRUSH_E2E_REPORT) |
| 3 | Buyer Conversion(记忆中"5维引擎已接") | 引擎代码存在但**零接入**:无 DB 报告表、无专用 API、无前端、无闭环、无测试 | 补齐全链(BUYER_CONVERSION_REAL_ALGORITHM_REPORT) |
| 4 | 异步图片管线(P0 报告) | 后端管线真实,但**前端 8s 全局超时**掐断真实生成(60-90s),用户必现"生成失败" | 修复:AI 端点 300s 超时 |
| 5 | IMAGE_RATE_LIMIT_REPORT 称"cogview-4 全 AI" | 实测 BigModel **图片资源包余额耗尽**(错误 1113,非瞬时限流),cogview-4 全部 FALLBACK | 切换 cogview-3-flash(免费)→ 9/9 AI 恢复;一键补图链路浏览器实证 |
| 6 | 3D 地球"高级 3D" | canvas 真实渲染(可拖动),但**遮罩拦截 hero 按钮点击**(canvas 覆盖层无 pointer-events 豁免) | 如实记录为缺陷(P1),路由直达绕过验证其余功能 |

## 能力状态表(逐项实测)

| Capability | Frontend | API | DB | Logic/AI | Browser E2E | Status |
|---|---|---|---|---|---|---|
| Auth(多租户/JWT) | ✓ | ✓ | ✓ | ✓ | ✓(本轮注册登录) | **DONE** |
| Multi-Site | ✓ | ✓ | ✓ site_id | ✓ 隔离 404 | ✓(本轮建站) | **DONE** |
| Public Template Marketplace | ✓(页面渲染/分类/购买入口) | ✓ ServiceOrder | ✓ | — | ✓(渲染实测;悬停预览沿用上轮) | **DONE** |
| AI Site Generation | ✓ | ✓ | ✓ | ✓ GLM 真实(ai_source 标注) | ✓(本轮真实生成 10kg 机器人站) | **DONE** |
| SiteMarketVariant | ✓ | ✓ | ✓ 唯一约束 | ✓ 三市场持久化 | ✓(刷新/重启保持) | **DONE** |
| Market Localization | ✓ | ✓ | ✓ | ✓ **本轮修复:市场策略校正+tokens 差异化** | ✓(三公开页肉眼互异+3截图) | **DONE** |
| Visual Pipeline(REAL>AI>FALLBACK) | ✓ SlotImage | ✓ | ✓ Asset | ✓ | ✓ | **DONE** |
| GLM Image | — | ✓ | ✓ | ✓ cogview-3-flash(9/9 AI) | ✓ | **DONE** |
| Image Retry/恢复 | ✓ 一键补图 | ✓ regenerate/status | ✓ manifest | ✓ Retry-After+退避 | ✓(降级→恢复双路径截图) | **DONE** |
| 异步补图(PENDING→AI) | ✓ 轮询状态条 | ✓ BackgroundTasks | ✓ 逐张落库 | ✓ | ✓("Generating 3/7"→9/9 实测) | **DONE** |
| Buyer Persona | ✓ Skill 入口 | ✓ | ✓ SkillRun | ✓ 基础版 | 部分 | **PARTIAL**(独立工作台未做) |
| Buyer Conversion | ✓ **本轮新增转化分析页** | ✓ **本轮新增 3 端点** | ✓ **本轮新增报告表** | ✓ 规则引擎+语义±10 | ✓(30→63 前后截图) | **DONE** |
| AI Brush(整块) | ✓ | ✓ 403→Draft→Publish | ✓ Version | ✓ JSON Patch | ✓(本轮全链) | **DONE** |
| **Freehand Brush** | ✓ **本轮新增圈选层** | ✓ **selection 裁决+落库** | ✓ Draft.selection | ✓ | ✓(手绘→发布→回滚实拍) | **DONE** |
| SEO/GEO | ✓ | ✓ | ✓ | ✓ 写回+报告 | (上轮 ✓;测试保持绿) | **DONE** |
| Website Intelligence | ✓ | ✓ | ✓ 5 模型 | ✓ 提取/聚合/画像 | (上轮 ✓;355 测试含 WI) | **DONE**(backend) |
| Skill Engine | ✓ SkillCenter | ✓ | ✓ SkillRun | ✓ 10+ Skills | ✓ | **DONE** |
| Agent | ✓ 工作台 | ✓ /agent/run | ✓ | 部分(NL 路由基础) | 部分 | **PARTIAL**(多步编排/AgentRun 全链未做) |
| MCP | ✓ 工具面板 | ✓ 15 工具(401 鉴权实测) | ✓ | ✓ 读工具真实 | 部分 | **PARTIAL**(写链经 brush;编排未接) |
| RFQ | ✓ 公开表单+后台 | ✓ | ✓ Inquiry 落库 | ✓ | ✓ | **PARTIAL**(产品快照字段/152-ФЗ Consent 未做,P1) |
| Version(快照/回滚) | ✓ | ✓ | ✓ | ✓ | ✓(本轮回滚实测恢复) | **DONE** |
| Compliance(152-ФЗ) | ✗ | ✗ | ✗ | 知识库术语就绪 | ✗ | **NOT STARTED**(P1) |
| Homepage Premium Globe | ✓ V4 真贴图地球 | — | — | ✓ Three.js/Bloom | ✓(渲染实测;canvas 拦截点击为已知缺陷) | **DONE**(视觉) / 缺陷记录 |
| 主页数据真实性 | ✓ 无假指标 | — | — | — | ✓(本轮逐页 grep 无硬编码分数) | **DONE** |
| Production Readiness | ✓ Docker 三容器 | ✓ healthz 200 | ✓ PostgreSQL | — | ✓ localhost:8080 | **PARTIAL**(公网 HTTPS/Alembic 未做) |

## 基础设施事实(本轮实测)

- **GLM 图片资源包已耗尽**(cogview-4 → HTTP 429 error 1113「余额不足」);已切换 `SITEPILOT_IMAGE_MODEL=cogview-3-flash`(免费档)恢复全链;**充值 cogview-4 后改回 .env 即可**
- faron git 远程已恢复(此前宕机),本轮推送正常;GitHub 走 Clash 代理偶发握手失败,重试即可
- Docker Desktop 仍偶发退出,需手动重启(已知)
- 前端旧 bundle 被浏览器缓存:强刷(带 _cb 参数)后加载新指纹 bundle(部署验证注意项)

## 结论:BATCH 1 四项全部完成

1. **三市场 SiteMarketVariant 真实差异** — 修复后 DONE(MARKET_VARIANT_E2E_REPORT.md + 3 截图)
2. **Freehand AI Brush** — NOT STARTED → DONE(FREEHAND_BRUSH_E2E_REPORT.md + 2 截图)
3. **Buyer Conversion 真实算法** — NOT STARTED → DONE(BUYER_CONVERSION_REAL_ALGORITHM_REPORT.md + 2 截图)
4. **图片系统稳定性** — DONE(降级/恢复双路径实证;图片状态表见 BATCH1 验收)

**按指令:BATCH 1 到此停止,等待审核后再进入 Batch 2。**
