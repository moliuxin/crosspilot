# P0-REAL-AI-RUNTIME 实施说明

> 目标：国赛现场可以证明「这一次到底是 GLM 生成的，还是模板 fallback」，并留下 capability 级证据链。

## 交付内容

### 1. 统一 AI 状态：`GET /api/ai/status`（需登录）

返回：`provider / model / enabled / runtime / degraded / calls_total / calls_ok /
calls_failed / last_error / last_latency_ms / executions[] / execution_count`。
**绝不返回 API Key**（有测试断言）。`runtime` 三态：
`real-llm`（真实模型在线）/ `degraded`（真实模型失败已降级）/ `template-fallback`（未配置真实模型）。

### 2. 所有 AI 输出带来源标注

`sites/generate` 响应新增：

- `ai_source`：`glm`（真实模型生成）| `template_fallback`（真实调用失败降级）| `template`（未配置，内置模板）
- `ai_model`：实际使用的模型名
- `ai_note`：一句话人话说明（禁止真实失败仍写「AI 生成成功」）

前端生成结果页显示对应徽章：`● GLM 已连接` / `▲ 模板降级模式` / `○ 内置模板`。

### 3. JSON Schema 校验 + 自动重试

`llm.complete_json(..., schema_keys=[...])`：真实返回缺必需顶层键时自动重试一次，
仍失败按失败处理（降级 + 记录 error）。生成链路 5 个调用点
（industry_analyzer / buyer_persona / market_localization / site_planner / image_brief）
均已带上 capability 与 schema_keys。

### 4. AI 运行日志（AIExecution 表）

字段：`id / tenant_id / site_id / capability / provider / model / source /
latency_ms / success / error / created_at`。每次 `sites/generate` 成功后按
capability 逐条落库；`GET /api/ai/status` 返回该租户最近 20 条。
**不保存 API Key**。

### 5. 国赛 Demo 模式：`SITEPILOT_DEMO_REQUIRE_REAL_AI=true`

开启后：未配置真实模型或真实调用失败 → 不再静默降级，
直接报 503「真实AI服务暂时不可用，请检查模型连接。」（`AIRealUnavailableError`）。
普通模式仍允许降级（演示不中断）。

## 接入真实 GLM

```bash
# docker compose 环境（.env 或 compose environment）
SITEPILOT_LLM_PROVIDER=openai
SITEPILOT_LLM_API_KEY=<你的 GLM Key>
SITEPILOT_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
SITEPILOT_LLM_MODEL=glm-4-plus
```

配置后无需改代码：`runtime=real-llm`，生成结果 `ai_source=glm`，
状态页可现场展示 `calls_ok / latency`。

## 测试

`backend/tests/test_ai_runtime.py`（5 项）：
状态端点形状与无 Key 断言 / 生成响应 ai_source 如实为 template /
AIExecution 落库与 capability 断言 / Demo 模式抛错 / schema 重试一次后降级。
全量 `pytest -q`：263 passed。
