"""数据库初始化入口：建表 + 种子 + 存量关联修复。

Docker Compose 的 init 服务执行：
    python -m app.bootstrap

本地开发也可以直接执行同一命令。AI 应用启动时是否自动执行由
SITEPILOT_AUTO_INIT 控制（Compose 中关闭，避免多实例并发建表/播种）。
"""
import logging

from sqlalchemy import text

from .config import get_settings
from .database import Base, SessionLocal, engine

# Website Intelligence 模型必须在此导入，确保 python -m app.bootstrap 建表完整
from .website_intelligence import models as _wi_models  # noqa: F401
from .seed import ensure_default_site_links, seed_if_empty, sync_pg_sequences

logger = logging.getLogger("sitepilot.bootstrap")


def _fix_mock_asset_labels(db) -> None:
    """存量纠偏：data:image/svg 占位图不得标 AI_GENERATED（诚实性）。幂等。"""
    try:
        r = db.execute(text(
            "UPDATE assets SET source_type = 'FALLBACK' "
            "WHERE source_type = 'AI_GENERATED' AND url LIKE 'data:image/svg%'"
        ))
        if r.rowcount:
            logger.info("数据纠偏:%d 条 mock SVG 资产 AI_GENERATED → FALLBACK", r.rowcount)
        db.commit()
    except Exception as exc:  # noqa: BLE001 — 迁移失败不阻断启动
        db.rollback()
        logger.warning("mock 资产标注纠偏失败(可忽略):%s", str(exc)[:120])


def initialize_database() -> None:
    """建表、播种并修复默认站点关联。可重复执行。"""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seeded = seed_if_empty(db)
        if seeded:
            logger.info("已写入种子数据")
        else:
            logger.info("数据库已有数据，跳过种子写入")
        # 新库 / 存量库都做一次幂等关联修复
        ensure_default_site_links(db)
        # PG：把自增序列推进到 MAX(id)（种子显式主键不推进序列）
        sync_pg_sequences(db)
        _fix_mock_asset_labels(db)
    finally:
        db.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    logger.info("初始化 PostgreSQL: %s", settings.sqlalchemy_database_url.rsplit("@", 1)[-1])
    initialize_database()


if __name__ == "__main__":
    main()
