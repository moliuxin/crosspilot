# MARKET_VARIANT_E2E_REPORT.md — 三市场变体真实差异 E2E 验收

> 分支:`feature/national-real-capabilities` · 环境:Docker(nginx + FastAPI + PostgreSQL)http://localhost:8080
> 测试产品:**10kg Collaborative Robot**(规范 4.5 指定) · 站点:`s-13-d7bcad`(已发布)
> 日期:2026-10-14 · pytest 342 passed · npm build ✓

## 1. 本轮修复(接管审计发现的真实缺陷)

| # | 缺陷 | 修复 | 文件 |
|---|------|------|------|
| 1 | **LLM 布局顺序三市场雷同**:LayoutPlanningSkill 对 GLM 输出照单全收,zh/ru 实测输出完全相同(hero→key_specs→applications→products→cases→rfq),市场策略形同虚设;且 key_specs(en 不支持)泄入 en 布局 | 市场策略强制校正:①组件按 supported_markets 过滤 ②签名区块(factory/solutions、benefits/fast_quote、key_specs/supply_capability)漏选时补齐 ③按市场默认序重排;`layout_source=glm+market_profile` 如实标注 | `backend/app/skills/market_localization.py` |
| 2 | **行业 hints 覆盖市场策略**:industrial_robotics 的 sections_priority 把 applications/products 提到市场签名区块前,抹平差异 | 市场签名区块恒居 hero 之后最前位;行业 hints 只重排其余区块 | `backend/app/skills/component_registry.py` |
| 3 | **Design Tokens 三市场全同**:ThemeStyleSkill 文档声称"市场色温微调",代码根本没读 market 参数(连 en/ru 字体都是微软雅黑) | 市场确定性差异化:bg/radius/shadow/字体栈/accent(ru 加深保 WCAG)/density(取自 markets/*/style.json);色温微调不经过 LLM,可复现 | `backend/app/skills/market_localization.py` |
| 4 | **前端 8s 全局超时掐断真实生成**:真实 GLM 结构生成 60-90s,浏览器端 8s 即 abort(服务器实际已完成),用户必现"生成失败" | 新增 `AI_TIMEOUT=300000`,应用于全部 AI 生成类端点(generateSite / generateMarketVariants / brushGenerate / runSkill / agentRun / regenerateVisuals / seo optimize / ai-rewrite / localization generate) | `src/services/api.js` |

新增自动化测试 10 个:`tests/test_market_layout_correction.py`(6,懒 LLM 三市场校正/顺序两两互异≥3处/市场过滤/来源标注/LLM 失败回落)+ `tests/test_market_theme_tokens.py`(4,tokens 互异/字体栈/密度/ru accent WCAG)。**全量 342 passed。**

## 2. E2E 数据(真实 GLM 生成,浏览器实测)

### 2.1 Section 顺序(结构级,非翻译)

| Market | Section 顺序 | 特征 |
|---|---|---|
| zh-CN | hero > **factory** > **solutions** > key_specs > products > cases > rfq > applications | 制造能力/解决方案前置 |
| en-US | hero > **benefits** > **fast_quote** > applications > products > cases > rfq | 价值/快速询价前置 |
| ru-RU | hero > **key_specs** > **supply_capability** > products > rfq > applications > cases | 参数/供货前置 |

三套顺序两两不同(zh 8 区块 / en 7 / ru 7),由 Market Profile 保证而非 LLM 心情。

### 2.2 Design Tokens(每市场独立)

| Token | zh-CN | en-US | ru-RU |
|---|---|---|---|
| bg | #f7f8fa | #f8fafc(冷白) | #f4f6f8(冷灰) |
| radius | 8px | 10px(圆润留白) | 4px(务实直角) |
| density | high | medium | high |
| body_font | PingFang SC / Microsoft YaHei | Segoe UI / Helvetica | PT Sans |
| accent | #c2570c | #c2570c | **#b34e0a**(加深,W CAG 白字对比度只升不降) |

### 2.3 Hero 文案与 CTA(transcreation,非翻译)

| Market | Hero 标题 | 副文案要点 | CTA |
|---|---|---|---|
| zh-CN | 为您的产线量身定制协作机器人系统 | 负载精度、48小时响应、交钥匙服务(制造话术) | 获取报价 |
| en-US | Simplify Your Automation Journey with Precision Robots | From RFQ to commissioning(采购旅程话术) | Request a quote |
| ru-RU | Программируемые промышленные роботы | под ключ пусконаладка(务实直给话术) | Запросить расчёт |

### 2.4 图片(per-market AI 生成,零伪装)

| Market | Hero | Product | Application | Case |
|---|---|---|---|---|
| zh-CN | AI_GENERATED(产线近景·橙调) | AI shared | AI_GENERATED | **AI_GENERATED_CONCEPT**(应用场景概念展示) |
| en-US | AI_GENERATED(双臂协作·蓝调) | AI shared | AI_GENERATED | **AI_GENERATED_CONCEPT**(Application Concepts) |
| ru-RU | AI_GENERATED(深色车间) | AI shared | AI_GENERATED | **AI_GENERATED_CONCEPT**(Концепция применения) |

Case 不伪装真实客户案例:无真实素材时三市场均以本地化"应用场景概念"呈现并标注 `AI_GENERATED_CONCEPT`;图片异步补图管线完成(见 IMAGE_RATE_LIMIT_REPORT / batch1 验收)。

## 3. 公开页截图(Playwright 实截,docs/)

- `cn-home.png` — 中文站:制造定制叙事 + 获取报价 + 产线橙调 hero 图
- `en-home.png` — English:价值叙事 + Request a quote + 蓝调协作臂
- `ru-home.png` — Русский:参数直给 + Запросить расчёт + 深色车间

Product Facts(产品名/类别)三市场共享一致;差异全部来自 Market Layer(layout/tokens/copy/visual/cta/case 标注),符合规范 4.1/4.2。

## 4. 结论

| 验收项 | 状态 |
|---|---|
| 三套 Section 顺序肉眼不同 | **DONE**(2.1) |
| 三套 Hero 结构/文案不同 | **DONE**(2.3 + 截图) |
| 三套 CTA 不同(词库白名单) | **DONE** |
| 三套图片不同(per-market 生成) | **DONE**(2.4) |
| 三套 FAQ 不同 | **PARTIAL**(FAQ 区块本轮均未入选布局;theme/tone 知识就绪,待 FAQ 组件入选后验证) |
| 三套 Trust 模块不同 | **PARTIAL**(zh factory/trust 叙事在区块级体现;独立认证墙区块未入选本轮布局) |
| Product Facts 完全一致 | **DONE**(事实层只读共享,变体不写 facts) |
| 持久化(刷新/重启保持) | **DONE**(SiteMarketVariant 唯一 site+market,PostgreSQL 落库) |
| 自动化测试 | **DONE**(10 新增,342 全绿) |
| 浏览器 E2E | **DONE**(真实 GLM 生成 + 三公开页实截) |
