"""Yandex Wordstat 数据接入与分析服务（零 LLM，全规则）。

三层能力：
1. 解析 Wordstat 导出（Web 界面 CSV/TXT：短语<TAB>次数，数字千分位为空格）；
2. 采购意图分层 —— 俄语标记词规则分类（交易/商业/信息/品牌型号），输出意图分；
3. 词形族聚合 —— 俄语屈折变化后缀剥离，робот/робота/роботом 归同一词族。

诚实性约定：
- Wordstat 只提供搜索量，不提供竞争度。导入数据若未附竞争度列，
  以「搜索量分位数」作竞争度代理并在结果里标注 comp_source="volume_rank_proxy"，
  与真实 SERP 竞争度区分，不冒充实测。
"""

from __future__ import annotations

import re
from typing import Iterable

# ── 俄语采购意图标记词（规则库，可按行业扩充）───────────────────────────
TRANSACTION_MARKERS = (
    "купить", "куплю", "купил", "купит", "купите", "цена", "цены", "цене", "стоимость",
    "сколько стоит", "оптом", "поставщик", "поставщики", "поставщика",
    "производитель", "производители", "производителя",
    "заказать", "заказ", "доставка", "с доставкой", "продажа", "продам",
    "прайс", "где купить", "в наличии",
    "недорого", "дешево", "со скидкой", "акци", "оплата", "рассрочка",
)
COMMERCIAL_MARKERS = (
    "лучший", "лучшая", "лучшие", "топ ", "топ-", "рейтинг",
    "сравнить", "сравнение", "какой ", "какую ", "выбрать", "выбор",
    "отзывы", "обзор", " vs ", "аналог", "официальный сайт",
    "каталог", "фото", "характеристики",
)
INFORMATIONAL_MARKERS = (
    "как ", "что такое", "своими руками", "схема", "чертеж", "чертёж",
    "инструкция", "принцип работы", "виды", "устройство",
    "почему", "руководство", "способ", "пошагово", "пример",
)

INTENT_LABELS = {
    "transactional": "交易",
    "commercial": "商业比较",
    "informational": "信息",
    "brand": "品牌/型号",
    "general": "通用",
}
INTENT_SCORES = {
    "transactional": 1.0,
    "commercial": 0.55,
    "brand": 0.5,
    "general": 0.35,
    "informational": 0.15,
}

# 俄语常用屈折后缀（长后缀优先剥离；剥后主干不足 4 字符则保留原词）
_RU_SUFFIXES = (
    "ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими",
    "ой", "ей", "ый", "ий", "ая", "яя", "ое", "ее", "ые", "ие",
    "ов", "ев", "ам", "ям", "ах", "ях",
    "у", "ю", "а", "я", "ы", "и", "е", "ь",
)


def _match_markers(kw_lower: str, markers: Iterable[str]) -> str | None:
    for m in markers:
        if m in kw_lower:
            return m.strip()
    return None


def classify_intent(keyword: str) -> dict:
    """规则分类采购意图。返回 {intent, score, label, matched}。"""
    low = " " + keyword.lower() + " "
    for kind, markers, in (
        ("transactional", TRANSACTION_MARKERS),
        ("commercial", COMMERCIAL_MARKERS),
        ("informational", INFORMATIONAL_MARKERS),
    ):
        hit = _match_markers(low, markers)
        if hit:
            return {
                "intent": kind,
                "score": INTENT_SCORES[kind],
                "label": INTENT_LABELS[kind],
                "matched": hit,
            }
    # 含数字/拉丁字母 → 品牌/型号词（采购后期，高价值）
    if re.search(r"[0-9a-z]", keyword.lower()):
        return {"intent": "brand", "score": INTENT_SCORES["brand"], "label": INTENT_LABELS["brand"], "matched": "model/no"}
    return {"intent": "general", "score": INTENT_SCORES["general"], "label": INTENT_LABELS["general"], "matched": ""}


def _stem(word: str) -> str:
    w = word.lower()
    for suf in _RU_SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 4:
            w = w[: len(w) - len(suf)]
            break
    return w


def family_of(keyword: str) -> str:
    """以首词词干作词族键：робот манипулятор / робота → «робот…»。"""
    tokens = re.split(r"[\s/]+", keyword.strip())
    if not tokens:
        return "—"
    return _stem(tokens[0])[:8] or tokens[0][:8]


_NUM_RE = re.compile(r"[\d\s\u00a0\u202f.,]+")


def _parse_number(raw: str) -> int | None:
    digits = re.sub(r"[^\d]", "", raw)
    return int(digits) if digits else None


def parse_wordstat_export(content: str, max_rows: int = 200) -> list[dict]:
    """解析 Wordstat 导出文本。容错：表头行/空行跳过；分隔符 TAB/分号/逗号；
    千分位空格（含窄空格）；末列必须是纯数字。"""
    rows: list[dict] = []
    for line in content.splitlines():
        line = line.strip()
        if not line or not _NUM_RE.search(line):
            continue
        low = line.lower()
        if low.startswith(("ключев", "по запросу", "показы", "запросов", "keyword", "слов")):
            continue  # 表头/汇总行
        parts = re.split(r"[\t;]|,(?=\s*\d)", line)
        if len(parts) < 2:
            continue
        phrase = parts[0].strip().strip('"')
        vol = _parse_number(parts[-1])
        comp = None
        if len(parts) >= 3:
            comp = _parse_number(parts[1])
        if not phrase or not vol or not re.search(r"[а-яa-z]", phrase.lower()):
            continue
        rows.append({"kw": phrase, "vol": vol, "comp": comp})
        if len(rows) >= max_rows:
            break
    return rows


def enrich_dataset(rows: list[dict]) -> dict:
    """补齐意图/词族/竞争度代理/象限，并给出行业级汇总指标。"""
    if not rows:
        return {"keywords": [], "metrics": {}}
    vols = sorted((r["vol"] for r in rows), reverse=True)
    max_vol = vols[0]

    keywords = []
    for i, r in enumerate(rows):
        intent = classify_intent(r["kw"])
        comp = r.get("comp")
        comp_source = "imported"
        if comp is None:
            # 透明代理：头部高搜索量词通常竞争更激烈，以量级分位映射 95→30
            rank = i / max(1, len(rows) - 1)
            comp = int(95 - 65 * rank)
            comp_source = "volume_rank_proxy"
        keywords.append({
            "kw": r["kw"],
            "vol": r["vol"],
            "comp": comp,
            "comp_source": comp_source,
            "trend": None,
            **intent,
            "family": family_of(r["kw"]),
        })

    total_vol = sum(r["vol"] for r in rows)
    concentration = sum(k["vol"] * k["score"] for k in keywords) / total_vol * 100
    families = {}
    for k in keywords:
        families.setdefault(k["family"], 0)
        families[k["family"]] += k["vol"]
    median_vol = vols[len(vols) // 2]

    metrics = {
        "total_vol": total_vol,
        "kw_count": len(keywords),
        "max_vol": max_vol,
        "median_vol": median_vol,
        "avg_comp": round(sum(k["comp"] for k in keywords) / len(keywords), 1),
        "blue_ocean_count": sum(1 for k in keywords if k["comp"] < 40),
        "intent_concentration": round(concentration, 1),
        "family_count": len(families),
        "top_family": max(families, key=families.get) if families else "",
    }
    return {"keywords": keywords, "metrics": metrics}


BUKVARIX_API = "http://api.bukvarix.com/v1/keywords/"


def parse_bukvarix_rows(payload: dict, max_rows: int = 40) -> list[dict]:
    """Bukvarix /v1/keywords/ 返回 {data:[[短语,词数,字符数,宽泛频次,精确频次],...]}。
    数据口径：Wordstat 数据库（区域=Весь мир 全球），频次为近期月度值。"""
    rows: list[dict] = []
    for item in payload.get("data", []):
        if len(item) < 5:
            continue
        kw, _wc, _cc, broad, exact = item[0], item[1], item[2], item[3], item[4]
        if not kw or not isinstance(broad, int):
            continue
        rows.append({"kw": str(kw), "vol": int(broad), "exact": int(exact or 0), "comp": None})
        if len(rows) >= max_rows:
            break
    return rows


async def fetch_bukvarix(keyword: str, num: int = 20, api_key: str = "free") -> list[dict]:
    """实时拉取 Bukvarix（Wordstat 库镜像，免费 API）。
    服务器出口被拒（境内/数据中心 IP 常见 502）时抛出真实原因。"""
    import httpx
    from urllib.parse import quote

    url = f"{BUKVARIX_API}?q={quote(keyword)}&api_key={api_key}&num={num}&format=json"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        if resp.status_code != 200:
            raise RuntimeError(f"bukvarix_http_{resp.status_code}（出口 IP 可能被拒）")
        return parse_bukvarix_rows(resp.json())
    except httpx.TimeoutException:
        raise RuntimeError("bukvarix_timeout（服务器网络不可达）")


async def try_live_fetch(keyword: str) -> dict:
    """在线抓取适配器：尝试直连 wordstat.yandex.ru。
    本机/境内网络通常被地理屏蔽（超时），返回诚实失败原因；
    部署在可达 Yandex 的服务器上即可走通，再接解析。"""
    import httpx

    url = "https://wordstat.yandex.ru/home/search"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        ),
        "Accept-Language": "ru-RU,ru;q=0.9",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            resp = await client.get(url, params={"text": keyword}, headers=headers)
        if resp.status_code != 200:
            return {"ok": False, "reason": f"http_{resp.status_code}", "hint": "Wordstat 返回非 200（可能触发验证码/风控）"}
        if "captcha" in resp.text.lower():
            return {"ok": False, "reason": "captcha", "hint": "Wordstat 要求人机验证，程序化抓取被拦截"}
        return {"ok": True, "hint": "连通正常 —— 解析管线待接入真实页面结构", "html_bytes": len(resp.text)}
    except httpx.TimeoutException:
        return {"ok": False, "reason": "timeout", "hint": "本网络无法直达 wordstat.yandex.ru（地理屏蔽）。请改用 CSV 导入，或将平台部署于境外服务器后启用在线抓取"}
    except Exception as exc:  # pragma: no cover
        return {"ok": False, "reason": type(exc).__name__, "hint": str(exc)[:200]}
