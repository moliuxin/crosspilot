"""数据库连接与会话管理（SQLAlchemy 2.x）。"""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

# SQLite 需要 check_same_thread=False 才能在多线程（FastAPI 线程池）下使用
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


def get_db() -> Generator[Session, None, None]:
    """FastAPI 依赖注入：每个请求一个会话。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
