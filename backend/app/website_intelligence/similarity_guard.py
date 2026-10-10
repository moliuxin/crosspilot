"""Similarity Guard:防止生成的页面与某一竞品过于相似。"""
from __future__ import annotations

from difflib import SequenceMatcher

SIMILARITY_THRESHOLD = 0.80  # 与单一 Source 的 section sequence 相似度上限


def _normalize_sequence(sections: list[str]) -> list[str]:
    """过滤 'other',去连续重复。"""
    out = []
    for s in sections:
        if s != "other" and (not out or s != out[-1]):
            out.append(s)
    return out


def sequence_similarity(a: list[str], b: list[str]) -> float:
    """两个 section 序列的相似度(0-1)。"""
    na, nb = _normalize_sequence(a), _normalize_sequence(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


def check_similarity(
    new_layout: list[dict],
    source_layouts: list[list[str]],
) -> dict:
    """检查新页面的 section 序列与所有 Source 的相似度。

    Returns:
        {"pass": bool, "max_similarity": float, "most_similar_source": int, "details": [...]}
    """
    new_seq = [s.get("type", "other") for s in new_layout]
    max_sim = 0.0
    max_idx = -1
    details = []

    for i, src_seq in enumerate(source_layouts):
        sim = sequence_similarity(new_seq, src_seq)
        details.append({"source_index": i, "similarity": round(sim, 3)})
        if sim > max_sim:
            max_sim = sim
            max_idx = i

    return {
        "pass": max_sim < SIMILARITY_THRESHOLD,
        "max_similarity": round(max_sim, 3),
        "threshold": SIMILARITY_THRESHOLD,
        "most_similar_source": max_idx,
        "details": details,
        "action": "ok" if max_sim < SIMILARITY_THRESHOLD else "replan_needed",
    }


def suggest_variation(layout: list[dict], most_similar: list[str]) -> list[dict]:
    """当相似度过高时,建议调整 section 顺序(交换中间两个非 hero/rfq 区块)。"""
    result = [dict(s) for s in layout]
    swappable = [i for i, s in enumerate(result)
                 if s.get("type") not in ("hero", "rfq") and 0 < i < len(result) - 1]
    if len(swappable) >= 2:
        i, j = swappable[0], swappable[-1]
        result[i], result[j] = result[j], result[i]
    return result
