# FREEHAND_BRUSH_E2E_REPORT.md — 自由涂鸦 AI 画笔验收

> 分支:`feature/national-real-capabilities` · 环境:Docker http://localhost:8080 · 真实浏览器(Playwright)
> 测试市场:en-US · 圈选目标:Hero 标题区 · 日期:2026-10-14 · pytest 347 passed

## 1. 接管审计结论

| 项 | 接管前状态 |
|---|---|
| 区块选中方式 | **仅整块点击高亮**(规范判定 = PARTIAL):`mv-section onClick` 直接 setSelected |
| 圈选数据结构 | 无(无 polygon/bbox/mode 记录) |
| 工具条 | 无(无确认/重画/撤销/清空/退出,无 ESC/Ctrl+Z) |
| 后端 | 只收 section_id,无圈选裁决、无选区落库 |

**按规范 5.6 判定:接管前 Freehand Brush = NOT STARTED(只有整块点击)。**

## 2. 本轮实现

### 2.1 前端(`src/pages/Sites/FreehandBrushOverlay.jsx` 新建 + 面板集成)

- **透明 Overlay + 指针事件**:`pointerdown/move/up` 记录路径点;Freehand(默认)/Rectangle 双模式
- **路径处理**:≥4px 距离阈值降采样 + Chaikin 一轮平滑 + 自动闭合 → Polygon + BoundingBox
- **视觉**:蓝青色发光边线(`#22d3ee`,双层 drop-shadow)+ 12% 半透明选区;**选区外整体暗化**(SVG evenodd 挖洞)
- **工具条**:✓确认 / ↺重画 / ⌫撤销 / ✕清空 / ⎋退出 + 手绘/矩形切换;**ESC 退出、Ctrl+Z 撤销**已绑定
- **section_hint 裁决**:确认时按选区 BBox 与 `[data-brush-target]` 区块矩形最大重叠,命中区块即改哪块
- 数据结构(spec 5.3):`{selection_mode, polygon_points, bounding_box, section_hint, market, strokes}` 随请求提交

### 2.2 后端(`backend/app/routers/brush.py` + `models.Draft.selection` 新列)

- `BrushGenerateRequest.selection`(可选);**`selection.section_hint` 优先于 section_id** —— 手绘圈了哪块就改哪块(点击态残留不生效)
- 选区元数据完整落库(`drafts.selection` JSON 列,方言感知迁移);含 market/site_id 可追溯
- LLM 提示词注入圈选模式;CTA 白名单/事实禁伪校验不变
- **缺陷修复**:AI/模板未提供 image 时保留原 hero 图(圈选改文案不再误删已生成图片)

### 2.3 自动化测试(`backend/tests/test_freehand_brush.py`,5 个)

圈选裁决(section_hint≠section_id 时以圈选为准)/ 选区元数据落库 / 全链 Draft→Publish→Rollback / 无权限 403 / 非法 hint 404。**全量 347 passed。**

## 3. 浏览器真实操作 E2E(Playwright 手绘驱动)

| 步骤 | 操作 | 结果 |
|---|---|---|
| ① 进入圈选 | 点击「✏️ 自由圈选」 | Overlay + 工具条出现,光标十字 |
| ② 手绘圈选 | `cua.drag` 14 点椭圆路径圈住 en-US Hero 标题区 | 平滑闭合多边形(28 点),发光边线 + 外部暗化 —— **`docs/brush-selection.png`** |
| ③ 确认 | 点工具条 ✓确认 | 状态条显示「已圈选 🇺🇸 en-US · sec_hero(freehand,28 点)」,输入框解锁 |
| ④ 指令生成 | 输入"更适合美国自动化工程师,突出 10kg 负载、deployment flexibility 和 24/7 service support" → 生成草稿 | Draft 生成(本次模板降级,如实标注"模板");**Before/After Diff 只含圈选 hero 区块字段**(eyebrow/title/description/image/image_source)—— **`docs/brush-diff.png`** |
| ⑤ 确认发布 | POST /publish(human_confirmed=true) | Version **v1** 落库;公开站 en-US hero 标题变为 AFTER 内容(实测 API 返回验证) |
| ⑥ 回滚 | POST /versions/rollback | 公开站标题恢复 "Simplify Your Automation Journey with Precision Robots"(实测) |

未确认之前公开站不变(⑤ 前实测公开标题仍为 BEFORE)——Human Confirm 硬约束保持。

## 4. 结论

| 验收项 | 状态 |
|---|---|
| 自由手绘圈选(非整块点击) | **DONE**(不规则多边形,平滑自动闭合) |
| Rectangle 模式 | **DONE**(同一 Overlay,拖拽矩形) |
| 发光边线 + 10-15% 半透明 + 选区外暗化 | **DONE**(截图) |
| 工具条(确认/重画/撤销/清空/退出)+ ESC/Ctrl+Z | **DONE** |
| 数据结构落库(mode/points/bbox/hint/market/site_id) | **DONE**(drafts.selection) |
| 圈选裁决(只改圈选相关区域) | **DONE**(hint 优先 + diff 仅限该区块) |
| Draft → Diff → Confirm → Publish → Public 变化 → Rollback | **DONE**(浏览器实测 + 自动化测试) |
| 后端硬校验(免费 403) | **DONE**(圈选请求同样 403) |

**Freehand AI Brush:PARTIAL → DONE**
