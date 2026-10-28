"""WorkBuddy SitePilot — FastAPI 应用入口。

启动：
    cd backend
    uvicorn app.main:app --reload --port 8000

接口文档：http://127.0.0.1:8000/docs
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .bootstrap import initialize_database
from .config import get_settings
from .database import SessionLocal

# Website Intelligence 模型(确保 create_all 建表)
from .website_intelligence import models as _wi_models  # noqa: F401

from .routers import (
    agent,
    ai as ai_router,
    skills as skills_router,
    auth,
    brush,
    company,
    conversion,
    credits,
    entitlements as entitlements_router,
    inquiries,
    mcp as mcp_router,
    pages,
    products,
    public,
    seo,
    service_orders,
    site,
    sites,
    tasks,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sitepilot")

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.auto_init:
        # 本地单进程开发：启动时自动建表/播种；Compose 使用独立 init 服务并关闭此开关。
        initialize_database()
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    # 文档与 openapi 跟随部署前缀（子路径部署时经同一 Nginx location 即可访问）
    docs_url=f"{settings.api_prefix}/docs",
    redoc_url=f"{settings.api_prefix}/redoc",
    openapi_url=f"{settings.api_prefix}/openapi.json",
    description=(
        "AI 外贸独立站智能体后端。提供产品/询盘/站点/SEO/Agent 全套接口，"
        "AI 能力支持 mock 与真实 LLM 双 provider。"
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全部业务路由挂在 /api 下
for r in (
    auth.router,
    entitlements_router.router,
    service_orders.router,
    public.router,
    mcp_router.router,
    company.router,
    products.router,
    inquiries.router,
    pages.router,
    sites.router,
    brush.router,
    conversion.router,
    tasks.router,
    credits.router,
    site.router,
    seo.router,
    agent.router,
    ai_router.router,
    skills_router.router,
):
    app.include_router(r, prefix=settings.api_prefix)


@app.get("/", tags=["meta"])
def root():
    return {
        "name": settings.app_name,
        "version": "1.0.0",
        "docs": f"{settings.api_prefix}/docs",
        "api_prefix": settings.api_prefix,
        "app_base": settings.app_base,
    }


@app.get("/healthz", include_in_schema=False)
def healthz():
    """容器编排健康探针：与部署前缀无关，且真实检查 PostgreSQL 连通性。"""
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("健康检查失败（数据库不可用）：%s", str(exc)[:160])
        return JSONResponse(status_code=503, content={"ok": False, "database": "unavailable"})
    finally:
        db.close()
    return {"ok": True, "database": "ok"}


if settings.app_base != "/":
    @app.get(settings.app_base, include_in_schema=True, tags=["meta"])
    def base_meta():
        """应用子路径上的 meta（与 / 同内容，子路径部署时的入口自检）。"""
        return root()
