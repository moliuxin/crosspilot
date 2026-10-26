"""模板商城背景图升级:6 模板站 + 机器人站,hero/applications/cases 换 Unsplash 高清真实图库(已验证 200)。
诚实标注 VERIFIED_STOCK;产品特写图保留 AI 生成(主体是产品本身)。幂等。"""
from app.database import SessionLocal
from app import models

U = "https://images.unsplash.com/{id}?q=80&w=1920&auto=format&fit=crop"

PLAN = {
    # slug: (hero, applications, cases)
    "s-1-b9528a": ("photo-1581091226825-a6a2a5aee158", "photo-1504328345606-18bbc8c9d7d1", "photo-1581094794329-c8112a89af12"),
    "s-1-18b564": ("photo-1504307651254-35680f356dfd", "photo-1553413077-190dd305871c", "photo-1581092160562-40aa08e78837"),
    "s-1-56abdf": ("photo-1541888946425-d81bb19240f5", "photo-1503387762-592deb58ef4e", "photo-1581094794329-c8112a89af12"),
    "s-1-cca731": ("photo-1447933601403-0c6688de566e", "photo-1512621776951-a57141f2eefd", "photo-1504148455328-c376907d081c"),
    "s-1-cd90cb": ("photo-1505740420928-5e560c06d30e", "photo-1546868871-7041f2a55e12", "photo-1523275335684-37898b6baf30"),
    "s-1-0d9eec": ("photo-1600585154340-be6161a56a0c", "photo-1524758631624-e2822e304c36", "photo-1503387837-b154d5074bd2"),
    "s-1-b1c8dc": ("photo-1485827404703-89b55fcc595e", "photo-1531746790731-6c087fecd65a", "photo-1531746790731-6c087fecd65a"),
}
TYPE_ORDER = ["hero", "applications", "cases"]

db = SessionLocal()
changed_variants = 0
changed_assets = 0

for slug, ids in PLAN.items():
    site = db.query(models.Site).filter(models.Site.public_slug == slug).first()
    if site is None:
        print("MISS site", slug)
        continue
    urls = [U.format(id=i) for i in ids]
    for v in db.query(models.SiteMarketVariant).filter(models.SiteMarketVariant.site_id == site.id).all():
        import json as _json
        # 深拷贝生成新对象再赋值,确保 SQLAlchemy JSON 列变更被追踪(原地改不落库)
        schema = _json.loads(_json.dumps(v.layout_schema or {}, ensure_ascii=False))
        secs = schema.get("sections", [])
        touched = set()
        for s in secs:
            t = s.get("type")
            if t in TYPE_ORDER:
                s.setdefault("props", {})
                s["props"]["image"] = urls[TYPE_ORDER.index(t)]
                s["props"]["image_source"] = "VERIFIED_STOCK"
                touched.add(s.get("id", ""))
        v.layout_schema = schema
        changed_variants += 1
        # Asset 行同步(图片状态统计与溯源一致)
        if touched:
            rows = db.query(models.Asset).filter(models.Asset.site_id == site.id, models.Asset.section_id.in_(touched)).all()
            for a in rows:
                sec_type = next((s["type"] for s in secs if s.get("id") == a.section_id), None)
                if sec_type in TYPE_ORDER:
                    a.url = urls[TYPE_ORDER.index(sec_type)]
                    a.source_type = "VERIFIED_STOCK"
                    a.provider = "unsplash"
                    a.note = "Unsplash 免费图库(学习 LUMINA 图库策略)"
                    changed_assets += 1

db.commit()
print(f"OK variants={changed_variants} assets={changed_assets}")
db.close()
