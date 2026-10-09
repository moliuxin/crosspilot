"""Excel(.xlsx) 批量导入解析。

设计取舍：
- 放在后端而非前端，避免为「读一个文件」引入前端 sheetjs（约 400KB）。
- 纯函数 `parse_xlsx_rows()` 不依赖 FastAPI，便于单测。
- 列约定与 CSV 导入一致：名称, 型号, 分类, 参数, 应用场景（后四列可空）。
- 自动跳过表头行；参数与应用场景支持 ; / ；/ | / ｜ 分隔多条。
"""
from __future__ import annotations

import base64
import binascii
import io
from typing import Any

from openpyxl import load_workbook

# 与前端 HEADER_HINTS 保持同一套识别词
HEADER_HINTS = {
    "名称", "名字", "产品", "产品名称", "品名",
    "name", "title", "product", "product name",
    "型号", "model", "sku",
    "分类", "category",
}

MAX_ROWS = 200
MAX_BYTES = 5 * 1024 * 1024  # 5MB


class XlsxParseError(ValueError):
    """解析失败（内容非法 / 超限）。"""


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        # Excel 数字常以 600.0 读入，去掉无意义的小数
        return str(int(value))
    return str(value).strip()


def _split_multi(raw: str) -> list[str]:
    if not raw:
        return []
    for sep in ("｜", "|", "；", ";"):
        raw = raw.replace(sep, "\x00")
    return [p.strip() for p in raw.split("\x00") if p.strip()]


def _looks_like_header(row: list[str]) -> bool:
    """判断首行是否为表头。

    - 多列时：出现 ≥2 个表头词 → 表头（避免把「产品型号」这类正常名称误判）
    - 单列时：首格本身是表头词 → 表头（如只有「名称」一列）
    """
    cells = [c.strip().lower() for c in row if c.strip()]
    if not cells:
        return False
    hits = sum(1 for c in row[:3] if c.strip().lower() in HEADER_HINTS)
    if len(cells) == 1:
        return cells[0] in HEADER_HINTS
    return hits >= 2


def parse_xlsx_rows(rows: list[list[Any]]) -> dict[str, Any]:
    """把二维单元格数组解析成产品数组。

    :returns: {"items": [...], "errors": [...], "skippedHeader": bool}
    """
    items: list[dict[str, Any]] = []
    errors: list[str] = []

    # 去掉尾部空行，但保留行号用于报错
    cleaned: list[tuple[int, list[str]]] = []
    for idx, raw in enumerate(rows, start=1):
        cells = [_cell_str(c) for c in (raw or [])]
        if any(cells):
            cleaned.append((idx, cells))

    if not cleaned:
        return {"items": [], "errors": ["表格为空，未读取到任何数据行"], "skippedHeader": False}

    start = 1 if _looks_like_header(cleaned[0][1]) else 0
    skipped_header = start == 1

    for row_no, cells in cleaned[start:]:
        name = cells[0] if cells else ""
        if not name:
            errors.append(f"第 {row_no} 行：名称为空，已跳过")
            continue
        items.append(
            {
                "name": name[:255],
                "model": (cells[1] if len(cells) > 1 else "")[:128],
                "category": (cells[2] if len(cells) > 2 else "")[:128],
                "specs": _split_multi(cells[3] if len(cells) > 3 else ""),
                "applications": _split_multi(cells[4] if len(cells) > 4 else ""),
            }
        )
        if len(items) >= MAX_ROWS:
            errors.append(f"数据超过 {MAX_ROWS} 行上限，仅解析前 {MAX_ROWS} 条")
            break

    if not items and not errors:
        errors.append("未解析出任何有效产品行")

    return {"items": items, "errors": errors, "skippedHeader": skipped_header}


def parse_xlsx_base64(content_b64: str) -> dict[str, Any]:
    """解析 base64 编码的 .xlsx 内容。供路由直接调用。

    只取第一个工作表；公式读缓存值（data_only=True）。
    """
    if not content_b64:
        raise XlsxParseError("文件内容为空")

    payload = content_b64.split(",", 1)[-1] if content_b64.startswith("data:") else content_b64
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise XlsxParseError(f"文件内容不是合法的 base64：{exc}") from exc

    if not raw:
        raise XlsxParseError("文件内容为空")
    if len(raw) > MAX_BYTES:
        raise XlsxParseError(f"文件超过 {MAX_BYTES // 1024 // 1024}MB，请拆分后再导入")

    # .xlsx 实为 zip，头两字节固定为 PK
    if not raw.startswith(b"PK"):
        raise XlsxParseError("不是有效的 .xlsx 文件（可能是 .xls 旧格式或已损坏）")

    try:
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 — openpyxl 异常类型较杂，统一转为业务错误
        raise XlsxParseError(f"无法读取 Excel 文件：{exc}") from exc

    try:
        ws = wb.worksheets[0] if wb.worksheets else None
        if ws is None:
            raise XlsxParseError("Excel 中没有任何工作表")
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
    finally:
        wb.close()

    result = parse_xlsx_rows(rows)
    result["sheet"] = ws.title
    result["sheetCount"] = len(wb.worksheets) if hasattr(wb, "worksheets") else 1
    return result
