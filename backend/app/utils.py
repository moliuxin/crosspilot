"""通用工具。"""
import re
import time
import uuid


def new_id(prefix: str) -> str:
    """生成短 ID（前缀 + 时间戳36进制 + 随机片段）。

    同一毫秒内可能批量创建多条记录（如一次生成的十余个 AIExecution），
    随机片段取 10 位 hex：同毫秒碰撞率 ≈ 1e-12，测试高频写入也不再撞主键。
    """
    return f"{prefix}_{int(time.time() * 1000):x}{uuid.uuid4().hex[:10]}"


def slugify(text: str) -> str:
    """英文产品名 → URL slug。"""
    s = (text or "").strip().lower()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"[\s_-]+", "-", s).strip("-")
    return s or "product"
