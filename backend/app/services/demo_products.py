# -*- coding: utf-8 -*-
"""示例产品自动填充(free AI 生成也精美):
generate 完成后在后台用 **一次** glm-4-flash 调用生成 3 个行业示例产品
(名称/型号/规格/描述),再各配 1 张 cogview-3-flash 产品图(免费档),
创建并挂载到站点,最后重建市场变体让 REAL 产品图与 ProductGrid 生效。

省 token 设计:产品结构 = 确定性提示词 + 单次 flash 调用;图片全走免费档;
任一步失败静默跳过 —— 示例产品是增强,绝不阻塞主流程。
"""
import json
import logging

from .. import models

logger = logging.getLogger(__name__)


def seed_demo_products(db, tenant_id: int, site_id: str, product_category: str, market: str = "en-US") -> None:
    """后台任务:行业示例产品 ×3 → 挂站点 → 重建变体。失败静默。"""
    try:
        from .. import llm
        from ..utils import new_id

        site = db.get(models.Site, site_id)
        if site is None:
            return

        result = llm.complete_json(
            "你是B2B外贸产品策划。只输出JSON:{\"products\":[{\"name\":..,\"model\":..,"
            "\"description\":..,\"specs\":[{\"key\":..,\"value\":..},...3条]}]},"
            "正好3个该行业最有代表性的出口产品,英文名+英文规格,禁止编造认证。",
            f"行业/品类:{product_category}",
            capability="demo_product_seed",
            schema_keys=["products"],
        )
        products = (result or {}).get("products") or []
        products = products[:3] if isinstance(products, list) else []
        if not products:
            logger.info("示例产品生成为空(跳过):site=%s", site_id)
            return

        key = _image_key()
        created = []
        for p in products[:3]:
            name = str(p.get("name", ""))[:180]
            if not name:
                continue
            specs = p.get("specs") if isinstance(p.get("specs"), list) else []
            specs = [s for s in specs if isinstance(s, dict) and s.get("key")][:4]
            img_url = ""
            try:
                img_url = _gen_image(key, f"{name}, {product_category}, professional e-commerce product photo, white background")
            except Exception as exc:  # noqa: BLE001 — 图片失败不阻断
                logger.warning("示例产品图失败:%s", str(exc)[:80])
            prod = models.Product(
                id=new_id("prod"),
                tenant_id=tenant_id,
                name=name,
                model=str(p.get("model", ""))[:120],
                category=str(product_category)[:120],
                specs=specs,
                applications=[],
                benefits=[],
                images=[img_url] if img_url else [],
                description=str(p.get("description", ""))[:2000],
            )
            db.add(prod)
            created.append((prod, bool(img_url)))
        db.commit()

        linked = 0
        for prod, _has_img in created:
            try:
                db.add(models.SiteProduct(site_id=site_id, product_id=prod.id))
                linked += 1
            except Exception:  # noqa: BLE001 — 重复挂载忽略
                db.rollback()
        db.commit()
        logger.info("示例产品已挂载 %d/%d:site=%s", linked, len(created), site_id)

        if linked:
            from ..services.market_variants import generate_variants

            import asyncio

            try:
                loop = asyncio.get_event_loop()
                if loop.is_closed():
                    raise RuntimeError("no loop")
            except Exception:  # noqa: BLE001 — 后台线程无事件循环时新建
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            loop.run_until_complete(generate_variants(db, tenant_id, site, regenerate=True))
            db.commit()
    except Exception:  # noqa: BLE001 — 示例产品是增强,任何失败静默
        logger.exception("示例产品填充失败(静默):site=%s", site_id)
        db.rollback()


def _image_key() -> str:
    from ..config import get_settings

    return get_settings().image_api_key or ""


def _gen_image(key: str, prompt: str) -> str:
    import httpx

    from ..config import get_settings

    s = get_settings()
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            f"{s.image_base_url}/images/generations",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": s.image_model, "prompt": prompt, "n": 1, "size": "1024x1024"},
        )
        resp.raise_for_status()
        item = resp.json()["data"][0]
        return item.get("url") or ("data:image/png;base64," + item["b64_json"] if item.get("b64_json") else "")
