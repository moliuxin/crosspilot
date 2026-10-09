"""通用工具。"""
import re
import time
import uuid

_counter = 0


def new_id(prefix: str) -> str:
    """生成短 ID（前缀 + 时间戳36进制 + 随机片段）。"""
    global _counter
    _counter += 1
    return f"{prefix}_{int(time.time() * 1000):x}{uuid.uuid4().hex[:4]}"


def slugify(text: str) -> str:
    """英文产品名 → URL slug。"""
    s = (text or "").strip().lower()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"[\s_-]+", "-", s).strip("-")
    return s or "product"
