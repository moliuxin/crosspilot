# BATCH1_NATIONAL_ACCEPTANCE.md — 全国赛 Batch 1 验收报告

> 分支:`feature/national-real-capabilities` · 环境:Docker(nginx + FastAPI + PostgreSQL) http://localhost:8080
> 测试产品:**10kg Collaborative Robot** · 演示站:`s-13-d7bcad`(已发布,三市场公开页可访问)
> **pytest 355 passed(33 个文件,本轮新增 31 个) · npm build ✓ · 每项能力均浏览器实测后才标 DONE**

---

## 一、执行顺序(按指令十八)

1. ✅ 三市场 SiteMarketVariant 真实差异
2. ✅ Freehand AI Brush
3. ✅ Buyer Conversion 真实算法
4. ✅ Image Rate Limit 稳定性
5. ✅ 接管审计(CURRENT_NATIONAL_STATE_AUDIT.md,先于报告完成并贯穿全程)

**到此停止,不自动进入 Batch 2。**

---

## 二、图片状态表(真实 manifest,浏览器 + API 双验)

| Market | Hero | Product | Application | Case |
|---|---|---|---|---|
| zh-CN | **AI_GENERATED**(产线橙调) | **AI_GENERATED**(三市场共享 1 次) | **AI_GENERATED** | AI_GENERATED_CONCEPT(应用场景概念展示,不伪装案例) |
| en-US | **AI_GENERATED**(蓝调协作臂) | AI_GENERATED(shared) | **AI_GENERATED** | AI_GENERATED_CONCEPT(Application Concepts) |
| ru-RU | **AI_GENERATED**(深色车间) | AI_GENERATED(shared) | **AI_GENERATED** | AI_GENERATED_CONCEPT(Концепция применения) |

补充实测事实:
- GLM **cogview-4 资源包已耗尽**(HTTP 429 error 1113 余额不足);已切换 `cogview-3-flash`(免费档)→ 9/9 全 AI
- 限流降级→恢复双路径浏览器实证:`batch1-async-images-generating.png`(Generating 3/7 + Reason: Provider Rate Limited)→ `batch1-async-images-ready.png`(Images ready 9/9)
- 图片 API 预算:三市场全量 **≤7 次调用**(cover 三市场共享 1 次;case 永不调 API);重新生成 = 0 次(三级缓存命中,实测)

---

## 三、功能状态表

| Capability | API | DB | UI | E2E | Status |
|---|---|---|---|---|---|
| Market Variant(三市场真实差异) | ✓ 生成/查询 + **市场策略校正**(glm+market_profile) | ✓ SiteMarketVariant 唯一约束 | ✓ 三卡并排 + 公开页 | ✓ 三公开页肉眼互异,cn/en/ru-home.png | **DONE** |
| Freehand Brush(自由圈选) | ✓ /brush/generate + **selection 裁决** | ✓ **drafts.selection 落库** | ✓ 手绘/矩形圈选层 + 工具条(ESC/Ctrl+Z) | ✓ 手绘→Draft→Diff→发布→公开变体变化→回滚(brush-selection/diff.png) | **DONE** |
| Buyer Conversion(真实算法) | ✓ analyze/reports/improvement-draft(**无事实 422 拒绝编造**) | ✓ **BuyerConversionReport** | ✓ 站点级「转化分析」页(分数条/缺失/建议/历史) | ✓ **30→63 分前后对比**(buyer-conversion-before/after.png),单调性 3 条测试 | **DONE** |
| Visual Pipeline(图片稳定性) | ✓ 队列/Retry-After 退避/三级缓存/共享槽位/regenerate/status | ✓ Asset + manifest 元数据 | ✓ Images Generating N/M 状态条 + 一键补图 | ✓ 429 降级→Provider 恢复→9/9 补齐(双路径截图) | **DONE** |

---

## 四、验收产物清单

| 产物 | 路径 |
|---|---|
| 接管审计 | `CURRENT_NATIONAL_STATE_AUDIT.md`(含"报告 vs 事实"差异表) |
| 三市场 E2E 报告 | `MARKET_VARIANT_E2E_REPORT.md` |
| Freehand Brush E2E 报告 | `FREEHAND_BRUSH_E2E_REPORT.md` |
| Buyer Conversion 报告 | `BUYER_CONVERSION_REAL_ALGORITHM_REPORT.md` |
| 图片限流报告 | `IMAGE_RATE_LIMIT_REPORT.md`(上一提交)+ 本报告 §二 |
| 截图 | `docs/cn-home.png` `docs/en-home.png` `docs/ru-home.png` `docs/brush-selection.png` `docs/brush-diff.png` `docs/buyer-conversion-before.png` `docs/buyer-conversion-after.png` `docs/batch1-async-images-generating.png` `docs/batch1-async-images-ready.png` |
| 新增测试 | `test_market_layout_correction.py`(6) `test_market_theme_tokens.py`(4) `test_freehand_brush.py`(5) `test_buyer_conversion.py`(8) + 本轮早前 `test_image_rate_limit.py`(8) |

## 五、本轮代码变更(接管以来全部提交)

| 提交 | 内容 |
|---|---|
| `ade7711`(已推送) | P0-ASYNC-IMAGE-FILL:结构先行 + 后台补图 + /visuals/status + new_id 碰撞加固 |
| 本轮待提交 | 三市场策略校正 + tokens 差异化(10 测试);Freehand 圈选(前端 Overlay + 后端 selection,5 测试);Buyer Conversion 全链(模型/服务/路由/前端页,8 测试);前端 AI 端点 300s 超时;图片保留修复;图片模型切换 cogview-3-flash;全部报告与截图 |

## 六、诚实声明(指令二十)

- Case 图片一律 `AI_GENERATED_CONCEPT` 三语本地化标注,**永不伪装真实客户案例**;买家提供真实案例图(REAL)后三市场共享
- 改进草稿只写入产品资料中的**真实采购信息**;无事实时 API 422 明示拒绝
- 分数全部来自确定性规则引擎(证据可溯),`Readiness Score ≠ 成交概率` 全程标注
- GLM 降级时如实标注"模板"(ai_source);cogview-4 余额耗尽如实报告并降档免费模型
- 演示站数据为 E2E 测试自建账户(self-registered),无伪造用户/询盘/访问量

---

**BATCH 1 完成。按指令停止,等待审核后再进入 Batch 2。**
