# INNOVATION_TRACK_CURRENT_STATE.md — 创新赛现状审计(未改代码)

> 分支基线:feature/national-real-capabilities · pytest 293 passed · npm build ✓ · Docker 三容器 healthy
> 判定标准:Frontend + API + DB + Logic/AI + Permission + Persistence + Test + E2E 全部真实存在 = DONE

| Capability | 状态 | 依据 |
|---|---|---|
| Auth(JWT/注册/演示账号) | **DONE** | 真后端登录/注册/JWT 72h/多租户,测试+E2E 齐备 |
| Multi-Site | **DONE** | Site 表 + site_id 迁移 + 隔离 404 + E2E |
| Template Marketplace | **DONE** | 6 模板公开浏览/悬停整页预览/使用模板回跳(线上验证) |
| AI Site Generation | **DONE** | LLM 优先链 + 降级标注 + 免费额度账号级 + ai_source 徽章 |
| Skill Engine | **DONE**(上一批) | backend/app/skills(base/registry/9 个真 Skill)+ SkillRun 落库 + /api/skills* + 失败不扣费 + SkillCenter 真运行(293 测试含 16 项) |
| Industry Intelligence | **DONE** | 7 行业三语画像规则优先,GLM 补全;协作机器人实测命中 |
| Buyer Persona | **DONE** | buyer_persona Skill 注册 + SkillRun(基础版) |
| Market Variant | **DONE** | SiteMarketVariant(唯一 site+market)+ 三市场结构互异 + SEO metadata + 公开 API |
| CN/EN/RU Layout | **DONE** | component_registry 三市场默认布局 + site-blocks Schema 渲染;公开站三 URL 实测肉眼不同 |
| Image Pipeline | **DONE**(Mock 源) | Asset 槽位管线 REAL>AI>FALLBACK + 真实 <img>;真实 Image API Key 未配(如实标注 FALLBACK) |
| AI Brush | **DONE**(上一批) | 403→购买→Draft/Diff→确认→Version v1→回滚恢复,八步 E2E 全绿 + 自动化测试 |
| SEO/GEO | **DONE** | SEO 优化真写回 + GEO 报告页 + seo_optimization Skill |
| Buyer Conversion | **NOT STARTED** | 无真实评分引擎/报告表(首页本批先用真实 GEO 诊断截图,不伪造) |
| Agent | **PARTIAL** | 15 MCP 读工具真实;多步编排/AgentRun 日志未做(P0-9 第三批) |
| MCP | **PARTIAL** | 读工具真实接数据层;写链(brush→draft)走 API,Agent 编排未接 |
| RFQ | **PARTIAL** | 公开 RFQ→Inquiry 落库真实;产品快照字段未加(P1 第三批) |
| Version | **DONE** | 真快照回滚(market_variant 实体已接入) |
| AI Sales Assistant | **NOT STARTED** | P1 |
| PostgreSQL | **DONE**(Docker) | 生产跑 PG;Alembic 未引入(方言感知补列顶替) |
| Public Backend(HTTPS 公网) | **NOT STARTED** | 仅 localhost:8080;GitHub Pages 只有静态前端 |
| Algorithm Evaluation | **NOT STARTED** | evaluation/ 未建(P0-10 第三批,国赛核心证据) |
| Homepage | **PARTIAL→本批** | 2D canvas 地球 + 卡片式区块;未达全国赛官网水准(无 Three.js/浅蓝视觉/真实截图叙事) |

## 结论:第一批开发项 = **Homepage(P0-1/2/3)**;Skill Engine / Market Variant / Component Registry 已 DONE,仅做稳定回归。
