# Docker 一键部署（nginx + FastAPI + PostgreSQL）

## 架构

```
浏览器 ──> web (nginx:80)
            ├── /            静态资源（前端 dist，构建时 VITE_API_BASE=/）
            ├── /api/        反代 → api:8000（FastAPI）
            └── /docs        反代 → FastAPI Swagger
                              │
                              └── db (postgres:16-alpine，数据卷 pgdata)
```

- 前端与 API **同源**（nginx 反代），无跨域问题
- 首次启动后端自动**建表 + 播种演示数据**（plans / 订阅 / 默认租户）
- `VITE_API_BASE` 在前端构建期注入，改后端域名时无需改它（同源反代已覆盖）

## 一键启动

```bash
cp .env.docker.example .env    # 修改 POSTGRES_PASSWORD 与 SITEPILOT_JWT_SECRET
docker compose up -d --build
```

打开 `http://localhost:8080`（端口由 `.env` 的 `WEB_PORT` 决定）。

| 服务 | 说明 |
|---|---|
| `web` | nginx，托管前端 + 反代 API，对外唯一入口 |
| `api` | FastAPI，健康检查 `/api/health` 通过后 web 才启动 |
| `db` | PostgreSQL 16，数据持久化在 named volume `pgdata` |

## 常用命令

```bash
docker compose ps                 # 查看状态（healthy 为就绪）
docker compose logs -f api        # 看后端日志（建表/播种/AI 降级都在这）
docker compose down               # 停止（数据保留在 pgdata 卷）
docker compose down -v            # 停止并清空数据库（慎用）
docker compose up -d --build api  # 只重建后端
```

## 接入真实 AI

编辑 `.env` 后 `docker compose up -d api` 重建后端即可：

```env
SITEPILOT_LLM_PROVIDER=openai
SITEPILOT_LLM_API_KEY=sk-xxxx
SITEPILOT_LLM_BASE_URL=https://api.deepseek.com/v1
SITEPILOT_LLM_MODEL=deepseek-chat
```

真实模型不可用时后端自动回退模板生成，行为一致不报错。
图像能力（GLM-Image / CogView）配置 `SITEPILOT_IMAGE_API_KEY`，未配置时生成占位图。

## 生产清单

- [ ] `SITEPILOT_JWT_SECRET` 换成长随机串（默认值是开发密钥）
- [ ] `POSTGRES_PASSWORD` 换强密码（仅限字母数字；数据库 URL 未做 URL 编码）
- [ ] `SITEPILOT_CORS_ORIGINS=*` 收紧为实际域名（同源部署下其实已不走跨域）
- [ ] 建议在 web 前再挂一层 TLS（如宿主机 Caddy / 云负载均衡），或改用自定义 nginx 配置挂证书
- [ ] 数据备份：`docker compose exec db pg_dump -U crosspilot crosspilot > backup.sql`

## 数据库说明

- 连接串：`postgresql+psycopg://user:pass@db:5432/crosspilot`（由 compose 注入）
- 建表由 SQLAlchemy `create_all` 完成，**无需手工迁移**
- `main.py` 里的 SQLite PRAGMA 增量迁移仅作用于存量 SQLite 库，Postgres 下自动跳过
- 从旧 SQLite 迁移数据（可选）：
  `sqlite3 backend/sitepilot.db .dump > dump.sql` 后用 pgloader 或手工导入

## 已知限制

- 仓库暂无 `package-lock.json`，前端镜像用 `npm install` 构建；提交 lock 文件后建议把
  `docker/web/Dockerfile` 中的 `npm install` 换成 `npm ci`
