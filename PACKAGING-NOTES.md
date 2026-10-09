# 打包说明

本压缩包为 **WorkBuddy SitePilot 全栈版完整源码**（前端 + 后端 + 测试 + 文档）。

## 未包含（需自行安装 / 生成）

| 目录 | 原因 | 恢复方式 |
| --- | --- | --- |
| `node_modules/` | 体积大且平台相关 | `npm install` |
| `dist/` | 构建产物 | `npm run build` |
| `backend/sitepilot.db` | 运行时数据库（含演示数据） | 首次启动自动建表 + 播种（含 plans / subscriptions 种子） |
| `backend/__pycache__/`、`.pytest_cache/` | Python 缓存 | 自动生成 |
| `.xlsx` 示例文件 | 演示用 | 可在前端「批量导入」中下载示例或自行准备 |

## 启动步骤

```bash
# 1. 后端
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
# 接口文档 http://127.0.0.1:8000/docs

# 2. 前端（另起终端）
npm install
npm run dev
# 打开 http://127.0.0.1:5173
```

## 验证

```bash
# 后端单测（226 用例：权限 / 版本 / 租户前台 / MCP / Excel / 区块合并等）
cd backend && pytest

# 前端构建
npm run build

# 浏览器端联调（可选，需先启后端 + 静态服务）
cd backend && python3 -m uvicorn app.main:app --port 8000     # 终端 A
npm run build && python3 -m http.server 5173 --directory dist # 终端 B

# 8 套 E2E 共 159 项断言
node test/e2e.mjs              # 商家后台：产品筛选 + 编辑器样式（25）
node test/e2e-site.mjs         # 独立站前台：样式真实渲染（13）
node test/e2e-agent.mjs        # AI Agent + MCP 15 工具 + 任务进度（13）
node test/e2e-p05.mjs          # 无 Demo 假反馈 + 付费弹窗真实订单落库（10）
node test/e2e-multitenant.mjs  # 账户注册登录 + 跨租户隔离（21）
node test/e2e-marketing.mjs    # 门户叙事 + WhatsApp + AI 徽章（18）
node test/e2e-versions.mjs     # 版本历史 + 真回滚（32）
node test/e2e-navigation.mjs   # 固定一级菜单 + 模板商城购买 + 使用说明（28）
```

## 验证真实 LLM 链路（可选）

无外部 API key 时，可用内置假 LLM 服务器验证「真实链路」（走与 OpenAI 完全相同的
httpx 协议与代码路径）：

```bash
# 终端 A：假 LLM（OpenAI 协议兼容，:8100）
cd backend && python3 tools/fake_llm_server.py

# 终端 B：后端指向它
cd backend && SITEPILOT_LLM_PROVIDER=openai \
  SITEPILOT_LLM_BASE_URL=http://127.0.0.1:8100/v1 \
  SITEPILOT_LLM_API_KEY=test-key-123 \
  SITEPILOT_LLM_MODEL=fake-llm-test \
  python3 -m uvicorn app.main:app --port 8000

# 校验：GET /api/health 的 ai.runtime 应为 "real-llm"
```

## 环境变量（可选）

默认零依赖即可运行（Mock LLM + SQLite）。要接真实 AI 网关：

```bash
# backend/.env
SITEPILOT_LLM_PROVIDER=openai
SITEPILOT_LLM_BASE_URL=https://api.deepseek.com/v1
SITEPILOT_LLM_API_KEY=sk-xxx
SITEPILOT_LLM_MODEL=deepseek-chat
```
