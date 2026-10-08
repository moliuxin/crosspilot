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

from .config import get_settings
from .database import Base, SessionLocal, engine
from .routers import (
    agent,
    auth,
    company,
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
from .seed import seed_if_empty

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sitepilot")

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 建表 + 首次写入种子数据
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite(db=SessionLocal())
    db = SessionLocal()
    try:
        if seed_if_empty(db):
            logger.info("已写入种子数据")
        else:
            logger.info("数据库已有数据，跳过种子写入")
    finally:
        db.close()
    yield


def _migrate_sqlite(db) -> None:
    """SQLite 的 create_all 不会给已有表补新列 —— 这里做最小迁移。

    迁移点：
      1) drafts.patch（P0-2 结构化写回补丁）
      2) 各业务表 tenant_id（多租户隔离）—— 存量数据归入默认租户，老数据不丢
    生产换 Postgres 后应改用 Alembic。
    """
    from sqlalchemy import text

    # 带 tenant_id 的业务表；单例表（site_state/usage/credits）主键即 tenant_id，无需加列
    tenant_tables = [
        "products",
        "inquiries",
        "pages",
        "tasks",
        "drafts",
        "versions",
        "credit_logs",
    ]
    try:
        cols = {row[1] for row in db.execute(text("PRAGMA table_info(drafts)"))}
        if cols and "patch" not in cols:
            db.execute(text("ALTER TABLE drafts ADD COLUMN patch JSON DEFAULT '{}'"))
            db.commit()
            logger.info("已迁移：drafts 增加 patch 列")
    except Exception as exc:  # pragma: no cover
        db.rollback()
        logger.warning("SQLite 迁移（patch）失败：%s", exc)

    for tbl in tenant_tables:
        try:
            rows = list(db.execute(text(f"PRAGMA table_info({tbl})")))
            if not rows:  # 表还不存在（全新库会由 create_all 建好）
                continue
            existing = {r[1] for r in rows}
            if "tenant_id" not in existing:
                db.execute(text(f"ALTER TABLE {tbl} ADD COLUMN tenant_id INTEGER DEFAULT 1"))
                db.commit()
                logger.info("已迁移：%s 增加 tenant_id 列", tbl)
        except Exception as exc:  # pragma: no cover
            db.rollback()
            logger.warning("SQLite 迁移（%s.tenant_id）失败：%s", tbl, exc)

    # 存量单租户数据归入默认租户，并确保默认租户存在
    try:
        from . import models

        if not db.get(models.Tenant, models.DEFAULT_TENANT_ID):
            db.add(models.Tenant(id=models.DEFAULT_TENANT_ID, name="AQUAFLOW Industrial", industry="工业水处理设备", plan="free"))
            db.commit()
            logger.info("已创建默认租户（存量数据归属）")
        for tbl in tenant_tables:
            rows = list(db.execute(text(f"PRAGMA table_info({tbl})")))
            if rows and "tenant_id" in {r[1] for r in rows}:
                db.execute(text(f"UPDATE {tbl} SET tenant_id = 1 WHERE tenant_id IS NULL"))
        db.commit()
    except Exception as exc:  # pragma: no cover
        db.rollback()
        logger.warning("默认租户初始化失败：%s", exc)

    # tenants.public_slug（独立站前台对外标识）
    try:
        rows = list(db.execute(text("PRAGMA table_info(tenants)")))
        if rows and "public_slug" not in {r[1] for r in rows}:
            db.execute(text("ALTER TABLE tenants ADD COLUMN public_slug VARCHAR(64) DEFAULT ''"))
            db.commit()
            logger.info("已迁移：tenants 增加 public_slug 列")
    except Exception as exc:  # pragma: no cover
        db.rollback()
        logger.warning("SQLite 迁移（tenants.public_slug）失败：%s", exc)

    # 套餐字典 + 存量租户订阅回填（权限真源）
    try:
        from . import entitlements, models

        entitlements.seed_plans(db)
        tenants = db.query(models.Tenant).all()
        changed = False
        for t in tenants:
            if not t.public_slug:
                t.public_slug = f"t-{t.id}-{__import__('secrets').token_hex(3)}"
                changed = True
            if db.get(models.Subscription, t.id) is None:
                db.add(
                    models.Subscription(
                        id=t.id, tenant_id=t.id, plan_id=t.plan or "free", status="active"
                    )
                )
                changed = True
        if changed:
            db.commit()
        logger.info("已回填 public_slug / Subscription")
    except Exception as exc:  # pragma: no cover
        db.rollback()
        logger.warning("套餐字典 / 订阅回填失败：%s", exc)

    # 多站点迁移：site_id 列 + 每租户默认站点 + 存量数据回填（P0-MULTI-SITE）
    _migrate_multi_site(db)
    db.close()


def _migrate_multi_site(db) -> None:
    """1 tenant = 1 website → 1 tenant : N sites 的增量迁移。

    规则（AGENTS.md / P0-MULTI-SITE 指令）：
    - pages / inquiries / versions / drafts 增加 site_id 列；
    - 每个存量租户自动创建 Default Site（名称取自 SiteState.company_name）；
    - 旧 Page / Inquiry / Version / Draft 记录全部关联到 Default Site；
    - 租户产品通过 site_products 关联到 Default Site（不复制产品事实）；
    - 禁止让旧数据丢失。
    """
    from sqlalchemy import text

    from . import models
    from .tenancy import create_default_site

    site_tables = ["pages", "inquiries", "versions", "drafts"]
    for tbl in site_tables:
        try:
            rows = list(db.execute(text(f"PRAGMA table_info({tbl})")))
            if not rows:
                continue
            if "site_id" not in {r[1] for r in rows}:
                db.execute(text(f"ALTER TABLE {tbl} ADD COLUMN site_id VARCHAR(64) DEFAULT ''"))
                db.commit()
                logger.info("已迁移：%s 增加 site_id 列", tbl)
        except Exception as exc:  # pragma: no cover
            db.rollback()
            logger.warning("SQLite 迁移（%s.site_id）失败：%s", tbl, exc)

    try:
        tenants = db.query(models.Tenant).all()
        for tenant in tenants:
            # 该租户已有站点 → 只补 site_id 空值，不重复建默认站点
            sites = (
                db.query(models.Site)
                .filter(models.Site.tenant_id == tenant.id)
                .order_by(models.Site.created_at.asc())
                .all()
            )
            if not sites:
                # ORM 层建默认站点（与运行时 default_site() 同一入口，字段一致）
                site = create_default_site(db, tenant.id)
                sites = [site]
                logger.info("已为租户 %s 创建默认站点 %s", tenant.id, site.name)
            fallback = sites[0].id

            for tbl in site_tables:
                db.execute(
                    text(f"UPDATE {tbl} SET site_id = :sid WHERE tenant_id = :tid AND (site_id IS NULL OR site_id = '')"),
                    {"sid": fallback, "tid": tenant.id},
                )

            # 产品关联：租户级产品 → 默认站点（复用事实，不复制）
            product_ids = [
                pid
                for (pid,) in db.query(models.Product.id).filter(models.Product.tenant_id == tenant.id).all()
            ]
            existing = {
                (sp.site_id, sp.product_id)
                for sp in db.query(models.SiteProduct)
                .filter(models.SiteProduct.site_id == fallback)
                .all()
            }
            added = False
            for pid in product_ids:
                if (fallback, pid) not in existing:
                    db.add(models.SiteProduct(site_id=fallback, product_id=pid))
                    added = True
            db.commit()
            if added:
                logger.info("已为租户 %s 回填站点-产品关联", tenant.id)
    except Exception as exc:  # pragma: no cover
        db.rollback()
        logger.warning("多站点迁移失败：%s", exc)


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
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
    tasks.router,
    credits.router,
    site.router,
    seo.router,
    agent.router,
):
    app.include_router(r, prefix=settings.api_prefix)


@app.get("/", tags=["meta"])
def root():
    return {
        "name": settings.app_name,
        "version": "1.0.0",
        "docs": "/docs",
        "api_prefix": settings.api_prefix,
    }
