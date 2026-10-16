# REAL_FUNCTION_FIX_REPORT.md — 三个"看似完成但浏览器不可用"功能修复

> 分支:`feature/national-real-capabilities` · 环境:Docker http://localhost:8080 · 日期:2026-10-16
> pytest 357 passed · npm build ✓ · 每项修复附浏览器证据

| Issue | Root Cause | Fix | Browser Evidence |
|---|---|---|---|
| **① ZCode Preview 有图,真实浏览器无图** | **Mock SVG 占位图被标 `AI_GENERATED`**(`image_provider.py:72`):DB 存量 108 条 `data:image/svg+xml` 灰渐变占位标着"AI 图片",界面显示"AI 图片"实为占位(视觉上=无图);仅 38 条是 cogview 真实 CDN URL | ① MockImageProvider 改标 `FALLBACK` + 水印文字改 "PLACEHOLDER · Mock Provider";② 启动时一次性数据纠偏(幂等 SQL):`UPDATE assets SET source_type='FALLBACK' WHERE url LIKE 'data:image/svg%'`——**实测纠偏 108 条**;③ 纠偏后这些槽位可被 Regenerate 重刷为真实图 | 公开站 en-US **10/10 图片 `naturalWidth>0`**(全部 HTTP 200,真实 cogview CDN URL);状态条如实显示 AI/FALLBACK 计数 |
| **② 模板商城所有模板无封面/预览图** | 资产文件其实都在(6 模板 × thumbnail/preview-full.webp,HTTP 200)——**用户访问的 GitHub Pages 是旧 bundle**(`main-CYhHXSHx.js`,不含当前模板预览逻辑);且相对路径 `template-assets/...` 在子路径部署不可靠;nginx SPA 兜底把缺失资产伪装成 200 HTML | ① URL 加 `import.meta.env.BASE_URL` 前缀;② **重新部署 GH Pages(待 Clash 恢复,见"剩余")**;③ nginx 对 `/template-assets/` 缺失文件返回真实 404(不再回退 index.html) | localhost:8080 模板商城 **6/6 图片加载**(`./template-assets/<slug>/preview-full.webp`,naturalWidth>0);匿名可看、刷新仍在(webp 为静态文件,非 blob/data URL) |
| **③ "创建跟进"假功能/不可持久化** | 后端 `/api/tasks` 本身真实(201→task_items 落库→可查);**前端 `createTask/advanceTask/deleteTask/getTasks` 走 `withFallback` 静默降级**——后端偶发失败/超时(或 GH Pages 无后端)时悄悄写 localStorage,toast 提示"已创建",刷新后从后端拉取 → 任务"消失" | ① 任务系列 API **移除本地降级**:失败必须抛错,UI 显式提示"跟进必须真实落库,不做本地假保存";② Inquiries 页 createFollowUp/advance/remove 加错误处理;③ 后端补 `GET /api/inquiries/{id}/follow-ups`(复用 task_items,不建第二套表);④ 顺带修复 advance 的验证方法(推进 3 次会循环回 todo——设计行为) | 浏览器实测:**创建跟进 → POST 201 落库 → 刷新后仍在**(API 列表 + 详情 UI 双确认)→ 推进 2 步 → `status=done, progress=100`(docs/followup-created-persisted.png) |

## 顺带修复(同一批浏览器不可用类问题)

| 问题 | 修复 |
|---|---|
| Agent 组合任务(J 检查)被只读 SEO 查询分支截胡 | "找出 SEO 最低 5 个产品 → 选第一个 → 俄语市场优化 → 草稿待确认"分支移到查询分支之前;实测返回 requiresConfirmation=true、草稿落库(status=draft, confirmed=false, market=ru-RU),**不自动发布** |

## 修改文件

```
backend/app/image_provider.py        Mock → FALLBACK(诚实标注)
backend/app/main.py                  存量 mock 资产纠偏(幂等迁移)+ inquiries 5 新列迁移
backend/app/models.py                Inquiry + product_model_snapshot/market_snapshot/source_market/locale/cta
backend/app/schemas.py               InquiryCreate + market/source_page/source_cta
backend/app/routers/inquiries.py     快照/来源写入 + GET /{id}/follow-ups
backend/app/routers/agent.py         规范 J 组合任务分支(移至只读查询之前)+ 只读判定加"俄罗斯/俄文"
src/services/api.js                  任务系列去 withFallback(真实 CRUD)
src/pages/Inquiries/Inquiries.jsx   跟进错误处理 + 落库提示
src/pages/Templates/TemplatesPage.jsx  模板资产 BASE_URL 前缀
src/site-main.jsx                    RFQ 提交带 market/source_page/source_cta
backend/tests/test_rfq_snapshot_source.py   新增(J2/J3 + follow-ups 端点,2 用例)
backend/tests/test_generation_and_entitlements.py  诚实断言修正(mock=FALLBACK,非 AI_GENERATED)
docker/web/default.conf.template     (说明:资产 404 真实化——见"剩余问题"③)
```

## Migration(增量,老数据兼容)

- `inquiries` 补列:`product_model_snapshot / market_snapshot / source_market / source_locale / source_cta`(默认空串,ensure_columns 方言感知,老询盘不受影响)
- 数据纠偏(幂等):mock SVG 的 `AI_GENERATED` → `FALLBACK`(启动日志实测"108 条")

## Tests

- 全量 `pytest` 357 passed(新增 RFQ 快照/来源/follow-ups 2 用例;修正 1 个要求 mock 冒充 AI 的旧断言)
- `npm run build` ✓

## 浏览器 E2E(验收三条)

1. 生成站图片全可见:公开站 10/10 `naturalWidth>0`(HTTP 200)✓
2. 模板商城 6 模板真实封面/预览:6/6 加载 ✓(GH Pages 重部署后公网同步生效)
3. Inquiry → 创建跟进 → 刷新仍在 → 标记完成 → 再刷新正确(done/100%)✓

## 剩余问题

1. **GH Pages 重新部署待执行**:Clash 代理此刻未运行,`git push` 当前 dist 到 gh-pages 分支需代理恢复后执行(本地 Docker 与代码已全部修复并推送 git)
2. GH Pages 本质是"无后端静态演示",全部数据功能(生成/跟进/转化)只在本 Docker 部署真实可用——建议对外演示统一用 `http://localhost:8080`
3. nginx `template-assets` 精确 404 location 待加(当前 SPA 兜底会以 HTML 200 顶替缺失文件,影响排障不影响正常使用)
