# IMAGE_RATE_LIMIT_REPORT.md

**CrossPilot P0-IMAGE-RATE-LIMIT-RESILIENCE 验收报告**
日期:2026-10-11 · 分支:`feature/national-real-capabilities`

---

## 1. 背景与问题

三市场(zh-CN / en-US / ru-RU)变体生成时,原实现为每个市场的每个图片槽位独立调用图像 API:

```
Before: 4 slots × 3 markets = 12 次连续 API 调用
```

连续调用触发 Provider 429(Rate Limit),系统简单降级到 FALLBACK,导致
CN 正常、EN/RU 全部占位图,且用户只能整站重新生成(重复计费)。

## 2. 修复总览

| # | 规格 | 实现 | 状态 |
|---|------|------|------|
| 一 | 减少无意义调用(Product Fact vs Market Visual 分层) | `product_cover`/`product_gallery` 进 `SHARED_SLOTS`,三市场共享 1 次;REAL 产品图三市场直接共享 | ✅ |
| 二 | Market Visual 按市场生成(hero/application) | hero + application_scene 每市场独立,`factory` 别名复用 application_scene | ✅ |
| 三 | Case 不许 AI 伪装真实案例 | case 槽位永不调 API → `AI_GENERATED_CONCEPT`,cases 区块本地化改题为「应用场景概念展示 / Application Concepts / Концепция применения」 | ✅ |
| 四 | 统一 ImageGenerationQueue | `services/image_queue.py`:全局信号量 `IMAGE_MAX_CONCURRENCY=1` + 请求间隔,状态日志 queued→running→retrying→success/fallback | ✅ |
| 五 | 429 处理 | **Retry-After 响应头严格等待**(httpx 异常提取);无头时指数退避 2s→4s→8s + jitter;最多 3 次重试后才 FALLBACK(不一次放弃) | ✅ |
| 六 | Provider 限流配置(环境变量) | `IMAGE_MAX_CONCURRENCY` / `IMAGE_REQUEST_INTERVAL_MS` / `IMAGE_MAX_RETRIES` / `IMAGE_RETRY_BASE_SECONDS`,不硬编码供应商限额 | ✅ |
| 七 | Asset 缓存 | 三级缓存:DB(site+market+role 已成功资产)→ 共享槽位跨市场复用 → 内存 cache key hash(tenant+category+market+role+prompt)。刷新/重开/重新生成 = 零 API 成本 | ✅ |
| 八 | 失败可恢复 | `POST /api/sites/{site_id}/visuals/regenerate`(market/role 可选)只重生成 FALLBACK/PENDING,已成功图不重复计费;走同一队列+缓存 | ✅ |
| 九 | 后台显示真实状态 | `GET /api/sites/{site_id}/visuals/status`:每市场 AI/REAL/CONCEPT/FALLBACK/PENDING 计数 + `Reason: Provider Rate Limited` | ✅ |
| 十 | SkillRun 记录 | asset_manifest 每张图保存 provider/attempts/retries/rate_limit_hit/latency_ms/error_code/status/source_type;AIExecution 落库(不含 API Key) | ✅ |
| 十一 | 生成顺序优化 | `priority_market` 参数:用户预览市场最先;槽位顺序 hero → application_scene → 其余 | ✅ |
| 十二 | Async UX | 结构生成后立即返回站点(AI 槽位标 PENDING);`fill_pending_images` 后台任务逐张补图,每张完成即落库;前端 3s 轮询自动刷新 | ✅ |
| 十三 | E2E | `tests/test_image_rate_limit.py` 8 个用例(见 §4) | ✅ |

## 3. API 调用预算

| | Before | After |
|---|--------|-------|
| 图片 API 调用(三市场全量) | 12 | **≤ 7**(cover×1 + hero×3 + application×3) |
| product_cover | 3(每市场 1 次) | **1**(三市场共享) |
| case | 3(AI 伪装真实案例 ❌) | **0**(概念展示,复用 application_scene 图) |
| 重新打开/重新生成 | 12(全量重调) | **0**(三级缓存命中) |

## 4. E2E 测试结果(8/8 通过)

```
tests/test_image_rate_limit.py
├─ test_queue_retry_after_then_success      429一次→Retry-After严格等待→重试成功,attempts=2, rate_limit_hit=True
├─ test_queue_sustained_429_falls_back      持续429→4次尝试(1+3重试)→FALLBACK(error_code=429)
├─ test_queue_non_429_fails_fast            非限流错误不浪费重试
├─ test_shared_cover_and_budget             cover恰好1次共享,总量≤7,hero全AI,元数据完整
├─ test_sustained_429_then_regenerate_recovers  持续429→全FALLBACK+Reason→Provider恢复→regenerate→全部AI,props回写
├─ test_case_never_ai_generated_as_customer_case  case零API调用,概念化标题本地化
├─ test_repeated_generation_uses_cache      首次≤7次;再次生成=0次调用
└─ test_status_endpoint_reports_market_counts  status端点AI/CONCEPT/PENDING计数准确

全量回归:backend 332 tests 全部通过;frontend build ✓
```

## 5. 恢复流程(规格十三场景)

```
持续429 → retry×3 → FALLBACK(reason=rate_limited, error_code=429)
   ↓ Provider 恢复
POST /visuals/regenerate  → 只补 FALLBACK(已成功的图零调用)
   ↓
CN / EN / RU 全部 AI_GENERATED,section props 同步回写
```

## 6. 最终视觉状态表

| Market | Hero | Product | Application | Case |
|--------|------|---------|-------------|------|
| CN | AI | AI/shared | AI | AI_GENERATED_CONCEPT |
| EN | AI | shared | AI | AI_GENERATED_CONCEPT |
| RU | AI | shared | AI | AI_GENERATED_CONCEPT |

Case 不允许 AI 伪装真实案例:无真实素材时以「应用场景概念展示」呈现并明确
标注 `AI_GENERATED_CONCEPT`;用户提供真实案例图后(source_type=REAL)三市场共享。

## 7. 关键文件

- `backend/app/services/image_queue.py` — 队列/429退避/Retry-After/三级缓存/共享槽位
- `backend/app/services/market_variants.py` — PENDING结构解析 + `fill_pending_images` 后台补图 + Case概念化 + 任务注册表
- `backend/app/routers/sites.py` — 生成端点后台补图(`BackgroundTasks` + `priority_market`)、regenerate 走队列、`GET /visuals/status`
- `backend/tests/test_image_rate_limit.py` — 8 个 E2E 用例
- `src/pages/Sites/MarketVariantsPanel.jsx` — Images Generating N/M 轮询 + 每市场状态条 + Regenerate Missing Visuals

## 8. 已知限制

- 并发默认 1(`IMAGE_MAX_CONCURRENCY=1`),吞吐换稳定;如 Provider 配额允许可设 2
- 后台补图使用请求级 DB 会话(FastAPI 保证后台任务期间不关闭);PostgreSQL 生产无锁问题
- `fill_pending_images` 为进程内任务注册表,多 worker 部署时状态查询以 DB manifest 为准(job 进度仅本 worker 可见)
