# -*- coding: utf-8 -*-
"""方言感知的列迁移:assets 表新增 PHASE 8 列(product_id/caption/sort_order/is_primary)。
SQLite 用 PRAGMA,PostgreSQL 用 information_schema。
"""
from sqlalchemy import text


def ensure_columns(db, table: str, columns: dict[str, str]) -> list[str]:
    """columns: {name: DDL 类型描述}。返回新增的列名列表。"""
    if db.bind is None:
        return []
    dialect = db.bind.dialect.name
    if dialect == "postgresql":
        rows = db.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = :t"
        ), {"t": table}).fetchall()
        existing = {r[0] for r in rows}
    else:
        rows = db.execute(text(f"PRAGMA table_info({table})")).fetchall()
        existing = {r[1] for r in rows}
    if not existing:
        return []  # 表不存在,create_all 会带新列建表
    added = []
    for col, ddl in columns.items():
        if col in existing:
            continue
        try:
            db.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
            db.commit()
            added.append(col)
        except Exception:
            db.rollback()
    return added
