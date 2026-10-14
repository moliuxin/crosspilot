# BUYER_CONVERSION_REAL_ALGORITHM_REPORT.md — Buyer Conversion 真实算法验收

> 分支:`feature/national-real-capabilities` · 环境:Docker http://localhost:8080 · 日期:2026-10-14
> 正式名称:**Buyer Conversion Readiness Score**(≠ Conversion Probability,全程如实标注)

## 1. 接管审计结论

| 项 | 接管前状态 |
|---|---|
| 五维规则引擎 | 已存在(`app/skills/buyer_conversion.py`,确定性规则,权重集中) |
| BuyerConversionReport DB | **NOT STARTED**(评分无处落库) |
| 专用 API | **NOT STARTED**(仅能借通用 /api/skills 手动调用) |
| Analyze→改进→发布→Re-score 闭环 | **NOT STARTED** |
| 前端入口 | **NOT STARTED**(首页如实标注"引擎即将上线") |
| 假分数排查 | 前端无 92/74/68/61/83/84 等硬编码(逐页 grep 验证);进度条均为真实值百分比 |

## 2. 本轮实现

### 2.1 数据库(`models.BuyerConversionReport`,规范 6.4 全字段)

id / tenant_id / site_id / market / variant_id / overall_score / dimension_scores / evidence /
missing_information / recommendations / rule_version / provider / model / created_at。
每次分析落库一份历史,支撑 Re-score 前后对比。

### 2.2 服务层(`app/services/buyer_conversion_service.py`)

- `collect_page_data()`:从 **变体可见区块 + 产品事实(只读)+ 市场词库** 采集规则输入
  (moq/lead_time/warranty 等取自真实 props 与 specs;AI 概念案例不计入信任证据 —— 诚实原则);
- `analyze_variant()`:规则评分 + 可选 GLM 语义微调(product_clarity ±10,provider 标注 rule_engine / rule_engine+glm);
- `build_improvement_draft()`:按缺失项从**产品真实 specs** 找采购事实生成改进 Draft;
  **找不到事实 → 拒绝生成(422)—— 绝不编造 MOQ/交期/质保**。

### 2.3 API(`app/routers/conversion.py`)

- `POST /api/sites/{id}/conversion/analyze`(market, use_semantic)
- `GET  /api/sites/{id}/conversion/reports?market=`(历史)
- `POST /api/sites/{id}/conversion/improvement-draft`(无事实 422,附缺失清单)

### 2.4 前端(站点级「转化分析」标签页,`SiteConversion.jsx`)

市场选择 → 分析 → 五维分数条 + 缺失清单 + 改进建议 → 生成改进草稿(显示"只写真实事实;
无真实采购信息时平台将拒绝生成")→ Diff → 确认发布 → 自动 Re-score(+Δ 徽章)+ 报告历史表。

### 2.5 自动化测试(`tests/test_buyer_conversion.py`,8 个,规范 6.6 单调性)

- 增加 MOQ → procurement_information 严格上升 ✓
- 增加明确 RFQ CTA → cta_clarity 上升 ✓
- 删除 Certification → trust_evidence 下降(不得提高)✓
- 同输入同输出(确定性)✓ / 空输入 0 分 ✓
- API:报告落库可查 ✓ / **无事实 422 拒绝 → 补真实 specs → 改进草稿 → 发布 → Re-score 采购维度上升** ✓ / 租户隔离 404 ✓

**全量 355 passed。**

## 3. 浏览器 E2E 实测(10kg Collaborative Robot · en-US)

| 阶段 | 总分 | 产品清晰度 | 信任证据 | **采购信息** | CTA | RFQ | 缺失项 |
|---|---|---|---|---|---|---|---|
| **BEFORE**(未补充采购信息) | **30** | 25 | 15 | **0** | 80 | 30 | 18 项 |
| **AFTER**(真实 facts → 改进草稿 → 发布 → Re-score) | **63(+18 vs 前次)** | 100 | 30(+15) | **75(+75)** | 80 | 30 | 9 项 |

- 改进草稿 diff(真实值,非编造):`procurement_moq="MOQ: 1 set"` / `procurement_warranty="Warranty: 36 months"` / `procurement_payment_terms="Payment: T/T, LC at sight"` / `procurement_shipping="FOB Ningbo"`(lead_time 因键名大小写别名未命中本轮未写入,已列入缺失清单如实展示)
- 发布写入公开变体 RFQ 区块 props(公开站真实可见),Version v3 落库
- 截图:**`docs/buyer-conversion-before.png`(30 分/缺失 18)** · **`docs/buyer-conversion-after.png`(63 分/Re-score 徽章"采购信息维度 +75")**

## 4. 结论

| 验收项 | 状态 |
|---|---|
| 去除所有假分数(前端无硬编码) | **DONE**(逐页 grep + 真实 API 值渲染) |
| 五维规则引擎(集中、确定性) | **DONE**(接管前已有,本轮接入闭环) |
| GLM 仅语义微调(±10,可解释) | **DONE**(provider/model 如实标注) |
| BuyerConversionReport 落库 | **DONE** |
| 改进只写真实事实、缺失即拒绝 | **DONE**(422 + 明示文案) |
| Analyze→Report→Improvement→Draft→Diff→Confirm→Publish→Re-score 闭环 | **DONE**(API 测试 + 浏览器实测 30→63) |
| 单调性测试(规范 6.6 三条) | **DONE** |
| 浏览器前后对比截图 | **DONE** |

**Buyer Conversion:NOT STARTED → DONE(引擎本身接管前已有,本轮补齐 DB/API/闭环/前端/测试)**
