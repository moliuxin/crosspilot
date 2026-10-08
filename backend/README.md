# SitePilot Backend — FastAPI 服务

AI 外贸独立站智能体的后端。提供产品 / 询盘 / 站点 / SEO / Agent 全套 REST 接口，
AI 能力支持 **mock**（默认，零外部依赖）与 **真实 LLM**（OpenAI 兼容协议）双 provider。

## 快速开始

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

- 接口文档（Swagger）：http://127.0.0.1:8000/docs
- 健康检查：http://127.0.0.1:8000/api/health
- 首次启动自动建表 + 写入演示数据（4 产品 / 5 询盘）

## 配置

复制 `.env.example` 为 `.env`（所有配置项前缀 `SITEPILOT_`）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SITEPILOT_DATABASE_URL` | `sqlite:///backend/sitepilot.db` | 生产可换 `postgresql+psycopg://...` |
| `SITEPILOT_CORS_ORIGINS` | `*` | 前端地址，逗号分隔 |
| `SITEPILOT_LLM_PROVIDER` | `mock` | `mock` 或 `openai` |
| `SITEPILOT_LLM_API_KEY` | 空 | 切真实模型时填写 |
| `SITEPILOT_LLM_BASE_URL` | `https://api.openai.com/v1` | DeepSeek/通义等改这里 |
| `SITEPILOT_LLM_MODEL` | `gpt-4o-mini` | 模型名 |
| `SITEPILOT_FREE_GENERATION_LIMIT` | `1` | 免费完整生成次数 |

### 切换到真实 LLM

```bash
SITEPILOT_LLM_PROVIDER=openai \
SITEPILOT_LLM_API_KEY=sk-xxxx \
SITEPILOT_LLM_BASE_URL=https://api.deepseek.com/v1 \
SITEPILOT_LLM_MODEL=deepseek-chat \
uvicorn app.main:app --port 8000
```

生效的接口：产品内容生成（三语言）、SEO 优化建议、Agent 意图识别。
**调用失败会自动降级到内置模板**，演示不中断（返回值 `ai_source` 标注来源）。

## 运行测试

```bash
cd backend
pytest          # 137 passed（pytest.ini 已配置，开箱即用）
```

覆盖：产品增删改查 + 校验、**批量导入（含 200 条边界与逐行容错）**、**Excel(.xlsx) 解析（真实文件往返）**、
**市场本地化额度（免费额度 + 402 门槛）**、询盘状态流转 + RFQ、
SEO Diff + 草稿、Agent 双模式、**页面组件树保存 + AI 改写（断言不污染线上）**、
**任务子步骤推进与进度持久化**、**Credits 消耗 / 402 门槛 / 充值恢复**、
发布安全规则（403/409）、免费额度 402、健康检查、企业核验。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 + AI provider 状态 |
| GET | `/api/metrics` | 仪表盘指标（由真实数据推导） |
| GET | `/api/health/site` | 网站健康度（按产品完整度动态计算） |
| GET | `/api/company` | 企业信息 |
| POST | `/api/company/verify` | 企业身份核验 |
| GET | `/api/products` | 产品列表（支持 `q` / `category` 筛选） |
| GET | `/api/products/{id}` | 产品详情 |
| POST | `/api/products` | 新增产品（**自动 AI 生成三语言内容**） |
| PUT | `/api/products/{id}` | 更新产品（局部更新） |
| DELETE | `/api/products/{id}` | 删除产品 |
| GET | `/api/inquiries` | 询盘列表 + 统计 |
| GET | `/api/inquiries/{id}` | 询盘详情 |
| PUT | `/api/inquiries/{id}` | 修改状态（new/contacted/following/done） |
| POST | `/api/inquiries` | 独立站 RFQ 提交 |
| GET | `/api/site/state` | 站点设置 |
| PUT | `/api/site/state` | 更新站点设置 |
| POST | `/api/site/generate` | 首次建站生成 |
| GET | `/api/usage` | 免费额度 |
| POST | `/api/usage/consume` | 消耗一次（超限返回 **402**） |
| GET | `/api/drafts` | 草稿列表 |
| POST | `/api/publish` | 发布（**必须 `human_confirmed=true`，否则 403**） |
| GET | `/api/seo/diff/{product_id}` | 优化前后 Diff |
| POST | `/api/seo/optimize` | 生成优化草稿 |
| POST | `/api/agent/run` | Agent 指令（自然语言或结构化 patch） |

## Agent 安全规则

**Draft → Diff → 人工确认 → Publish**：
- Agent 只产出草稿，永不直接改线上内容
- 发布接口强制校验 `human_confirmed`，为 `false` 时返回 403
- 已发布的草稿重复发布会返回 409

## 目录结构

```text
backend/
├── app/
│   ├── main.py           应用入口（CORS / 路由挂载 / 启动建表+种子）
│   ├── config.py         Pydantic Settings 配置
│   ├── database.py       SQLAlchemy 引擎与会话
│   ├── models.py         ORM 模型（Product/Inquiry/SiteState/Usage/Draft）
│   ├── schemas.py        Pydantic 请求校验模型
│   ├── seed.py           种子数据
│   ├── llm.py            LLM adapter（mock + OpenAI 兼容）
│   ├── utils.py          ID / slug 工具
│   ├── services/
│   │   ├── ai_service.py AI 服务层（真实 LLM 优先，降级模板）
│   │   └── xlsx_service.py Excel(.xlsx) 解析（openpyxl，纯函数可单测）
│   └── routers/
│       ├── company.py    企业信息与核验
│       ├── products.py   产品增删改查 + 批量导入 + Excel 解析
│       ├── inquiries.py  询盘列表/详情/状态/RFQ
│       ├── pages.py      页面组件树读写 + AI 改写
│       ├── tasks.py      跟进任务 / 增长任务 + 子步骤推进
│       ├── credits.py    额度消耗 / 充值 / 流水
│       ├── site.py       站点状态/用量/草稿/发布/健康/指标
│       ├── seo.py        SEO Diff 与优化草稿
│       └── agent.py      Agent 指令
├── tests/                pytest（137 用例）
├── pytest.ini
├── requirements.txt
└── .env.example
```
