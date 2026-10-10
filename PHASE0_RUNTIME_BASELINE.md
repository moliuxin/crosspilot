# PHASE 0 — 工程运行基线

## 依赖(backend/requirements.txt 全量,`pip install -r backend/requirements.txt` 可复现)

```
fastapi>=0.115 / uvicorn[standard]>=0.30 / sqlalchemy>=2.0 / pydantic>=2.7
pydantic-settings>=2.3 / email-validator>=2.1
pyjwt>=2.8          # JWT 签发/校验(security.py)
bcrypt>=4.1         # 密码哈希(直接使用;passlib 停止维护且与新版 bcrypt 不兼容,故未列入)
httpx>=0.27 / pytest>=8.0 / openpyxl>=3.1
psycopg[binary]>=3.1  # PostgreSQL(生产)
```

前端:`package.json` + `package-lock.json` 已提交,`npm ci && npm run build` 通过(117+ 模块)。

## 验证结果(本分支)

| 项 | 结果 |
|---|---|
| `pip install -r backend/requirements.txt` | ✅(Docker 镜像构建内亦执行) |
| `cd backend && pytest -q` | ✅ **293 passed,0 failed** |
| `npm ci && npm run build` | ✅ |
| 本地后端 :8000 / 前端 :5173 | ✅(vite dev)前端显示「● 已连接后端」 |
| Docker 全栈(nginx+api+postgres) | ✅ 三容器 healthy,http://localhost:8080 |

## 安全相关

- JWT:PyJWT(HS256,72h);密码:bcrypt 直用(security.py,无 passlib 依赖缺口)
- Secret 只走环境变量(`.env.example` / compose),不入 Git/前端 bundle
