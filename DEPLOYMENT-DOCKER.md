# Docker 一键部署（nginx + FastAPI + PostgreSQL）

## 架构与转发约定

```
浏览器
  │  https://example.com/crosspilot/…            （子路径示例）
  ▼
外部统一 Nginx（域名 / HTTPS 在这一层管理，本项目不配置域名）
  │  ★ 不剥离子路径前缀：/crosspilot/… 原样转发
  ▼
web（nginx 容器，唯一入口）
  ├── /crosspilot/            前端静态资源（构建产物，相对路径引用）
  └── /crosspilot/api/        反代 → api:8000（保留完整路径）
                                 │
                                 ▼
                            api（FastAPI，按同一前缀挂载路由）
                                 │
                                 ▼
                            db（postgres:16-alpine，数据卷 pgdata）
```

- **外部 Nginx 不移除子路径前缀**（转发完整路径）。容器内各层（web 反代、后端路由挂载、前端 API 请求）使用同一套路径配置，任何一层都不需要知道域名。
- 前端与 API **同源**（经 web 反代），无跨域问题。
- 首次启动后端自动**建表 + 播种演示数据**。

## 一键启动

```bash
cp .env.docker.example .env    # 修改密码、JWT 密钥、（可选）子路径
docker compose up -d --build
```

打开 `http://localhost:8080${APP_BASE_PATH}`（默认 `http://localhost:8080/`）。

## 部署路径配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `APP_BASE_PATH` | `/` | 应用部署子路径。支持 `/`、`/crosspilot/` 等任意子路径 |
| `API_BASE_PATH` | 派生 | 浏览器调用 API 的前缀。留空 = `${APP_BASE_PATH}api/`，如 `/crosspilot/api/`；可单独设置 |

**生效方式**：两个变量都由 nginx 模板（envsubst）和后端 Settings 在**启动时读取**——
修改 `.env` 后 `docker compose up -d` 重建相关容器即可，**前端无需重新构建**：

```bash
# 例：部署到 /crosspilot/ 子路径
# .env: APP_BASE_PATH=/crosspilot/
docker compose up -d --force-recreate web api
```

各层如何拿到路径（同一约定，不写死域名/IP/端口）：

| 层 | 机制 | 是否需要重建 |
|---|---|---|
| 后端路由挂载 | 环境变量 `SITEPILOT_APP_BASE_PATH` / `SITEPILOT_API_BASE_PATH`，启动时挂载 | 重启容器 |
| web 反代 | nginx 模板 `docker/web/default.conf.template`，envsubst 运行时注入 | 重启容器 |
| 前端 API 请求 | 运行时从页面地址推导（`location.pathname` 目录 + `api`），唯一真源 `src/config/paths.js` | 无需 |
| 前端静态资源 | Vite `base: './'` 相对引用，任意子路径下天然正确 | 无需 |

**例外（前端必须构建时注入的情况）**：当 API 不在应用路径下（`API_BASE_PATH` 不是
`${APP_BASE_PATH}api/`，例如单独设置 `/backend-api/`）时，运行时无法推导，必须构建时注入：

```bash
docker compose build --build-arg VITE_API_BASE_PATH=/backend-api/ web
# 或本地构建：VITE_API_BASE_PATH=/backend-api/ npm run build
```

跨域直连后端（不经 web 反代）同理：构建时注入完整地址 `VITE_API_BASE=https://api.example.com`。

### 子路径下的认证

- 登录态为 **JWT + `Authorization: Bearer` 头**（localStorage），**不使用 Cookie**，
  因此不存在 Cookie Path 适配问题。
- 登录/退出/401 处理均为前端路由行为（HashRouter），路径无关，无需适配。
- 项目当前**没有 WebSocket 端点**；若后续新增，约定：
  - 路径默认 `${APP_BASE_PATH}ws`（前端 `src/config/paths.js` 的 `wsBaseUrl()` 已实现派生，
    协议随页面 http/https 自动选择 ws/wss）；
  - web 反代已预留 `Upgrade`/`Connection` 头透传，外部 Nginx 按下文示例加 upgrade 头即可。

## 外部统一 Nginx 配置示例

域名与 HTTPS 都在接入层处理，本项目不配置域名。以下示例假设：
应用部署在 `https://example.com/crosspilot/`（`.env` 中 `APP_BASE_PATH=/crosspilot/`），
upstream 指向本项目的 web 容器 `127.0.0.1:8080`。

```nginx
# 子路径部署：location 与 proxy_pass 均不带 URI —— 不剥离 /crosspilot 前缀
upstream crosspilot_web {
    server 127.0.0.1:8080;
}

# WebSocket 升级映射（当前项目无 WS 端点，配置保留无害）
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    http2 on;                          # nginx >= 1.25.1；旧版本改为 listen 443 ssl http2;
    server_name example.com;

    # ssl_certificate     /etc/nginx/certs/example.com.pem;   # 证书由接入层统一管理
    # ssl_certificate_key /etc/nginx/certs/example.com.key;

    client_max_body_size 25m;

    location /crosspilot/ {
        proxy_pass http://crosspilot_web;          # 注意：末尾没有 "/"，保留完整路径
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # WebSocket 预留（当前无 WS 端点，加上无害）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 300s;
    }

    # /crosspilot（无尾斜杠）→ 301 补斜杠（容器内也会兜底，双保险）
    location = /crosspilot {
        return 301 /crosspilot/$is_args$args;
    }
}

# http → https 由接入层统一处理（略）
```

> **与实现的契约**：`proxy_pass http://crosspilot_web;`（不带路径）= 不剥离前缀。
> 若接入层策略要求剥离前缀（`location /crosspilot/ { proxy_pass http://upstream/; }`），
> 则容器内收到的路径不再含 `/crosspilot`，需把 `.env` 中两个变量都保持 `/`（根路径模式），
> 且浏览器侧 API 前缀仍需 `/crosspilot/api/` —— 此时前端必须构建时注入
> `VITE_API_BASE_PATH=/crosspilot/api/`。推荐保持默认的不剥离模式。

**根路径部署**（默认）：直接整站代理即可，无需任何子路径配置：

```nginx
location / {
    proxy_pass http://crosspilot_web;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 常用命令

```bash
docker compose ps                 # 查看状态（healthy 为就绪）
docker compose logs -f api        # 后端日志（建表/播种/AI 降级）
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
- [ ] 子路径部署时确认 `.env` 的 `APP_BASE_PATH` 与外部 Nginx location 一致
- [ ] 域名 / HTTPS / http→https 跳转由外部统一 Nginx 处理
- [ ] 数据备份：`docker compose exec db pg_dump -U crosspilot crosspilot > backup.sql`

## 数据库说明

- 连接串：`postgresql+psycopg://user:pass@db:5432/crosspilot`（由 compose 注入）
- 建表由 SQLAlchemy `create_all` 完成，**无需手工迁移**
- `main.py` 里的 SQLite PRAGMA 增量迁移仅作用于存量 SQLite 库，Postgres 下自动跳过

## 已知限制

- 前端 API 前缀默认靠运行时推导（页面所在目录 + `api`）。若用户访问「不存在的前端深层路径」
  （如 `/crosspilot/foo/bar`，非 hash 路由路径），页面会由 nginx 兜底渲染，但 API 推导会失准。
  正常入口（`/crosspilot/` 与 hash 路由）不受影响；对确定性要求高时用 `VITE_APP_BASE_PATH` 构建注入
- 外部监控探活：外部 Nginx 只转发 `/crosspilot/*`，可探测 `/crosspilot/`（静态 200）；
  容器内探针走 `/healthz`（前缀无关，不对外暴露）
