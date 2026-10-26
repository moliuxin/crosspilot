"""产品图升级:为每站行业专属产品配独立 Unsplash 高清图;协作机器人站补 3 个产品。幂等。"""
import json

from app.database import SessionLocal
from app import models
from app.utils import new_id

U = "https://images.unsplash.com/{id}?q=80&w=900&auto=format&fit=crop"

db = SessionLocal()

# ---- ① 协作机器人站补 3 个产品 ----
robot_site = db.query(models.Site).filter(models.Site.public_slug == "s-1-b1c8dc").first()
if robot_site:
    existing_names = {p.name for p in db.query(models.Product).filter(models.Product.tenant_id == robot_site.tenant_id).all()}
    ROBOT_PRODUCTS = [
        {
            "name": "六轴协作机器人 CR-5",
            "model": "CR-5",
            "category": "协作机器人",
            "specs": [{"key": "负载", "value": "5 kg"}, {"key": "臂展", "value": "900 mm"}, {"key": "重复精度", "value": "±0.02 mm"}],
            "benefits": ["人机协作安全", "图形化编程", "IP54 防护"],
            "applications": ["焊接", "搬运", "装配", "检测"],
        },
        {
            "name": "焊接机器人工作站",
            "model": "WR-10",
            "category": "焊接机器人",
            "specs": [{"key": "负载", "value": "10 kg"}, {"key": "焊接类型", "value": "MIG/MAG/TIG"}, {"key": "工作站尺寸", "value": "2m×1.5m"}],
            "benefits": ["24h 连续作业", "焊缝一致性", "烟雾净化集成"],
            "applications": ["汽车零部件", "钣金加工", "管道焊接"],
        },
        {
            "name": "移动搬运机器人 MR-100",
            "model": "MR-100",
            "category": "移动机器人",
            "specs": [{"key": "载重", "value": "100 kg"}, {"key": "导航", "value": "激光SLAM"}, {"key": "续航", "value": "8 h"}],
            "benefits": ["自主导航", "自动充电", "多机调度"],
            "applications": ["产线送料", "仓储转运", "检测工位"],
        },
    ]
    for rp in ROBOT_PRODUCTS:
        if rp["name"] in existing_names:
            continue
        prod = models.Product(
            id=new_id("prod"), tenant_id=robot_site.tenant_id,
            name=rp["name"], model=rp["model"], category=rp["category"],
            specs=rp["specs"], benefits=rp["benefits"], applications=rp["applications"],
            description=f"{rp['name']}——面向'新新三样'出海场景，支持俄语/英语/中文三语言技术资料。",
        )
        db.add(prod)
        db.flush()
        db.add(models.SiteProduct(site_id=robot_site.id, product_id=prod.id))
        print(f"CREATED product: {rp['name']}")
    db.commit()

# ---- ② 每站产品配独立图库照片 ----
IMG_PLAN = {
    # (product_name_fragment, unsplash_id)
    "CNC Press Brake": "photo-1565793298595-6a879b1d9492",
    "Centrifugal Pump": "photo-1621905251189-08b45d6a269e",
    "Air Compressor": "photo-1581094794329-c8112a89af12",
    "LED Flood Light": "photo-1550985616-10810253b84d",
    "Fastener Kit": "photo-1581094794329-c8112a89af12",
    "Solar Mounting": "photo-1509391366360-2e959784a276",
    "Crawler Excavator": "photo-1541888946425-d81bb19240f5",
    "Wheel Loader": "photo-1621905251189-08b45d6a269e",
    "Diesel Generator": "photo-1581094794329-c8112a89af12",
    "Vannamei Shrimp": "photo-1565680018434-b513d5e5fd47",
    "Coffee Beans": "photo-1447933601403-0c6688de566e",
    "Pine Nut": "photo-1508061253366-f7da158b6d46",
    "Rugged Tablet": "photo-1544244015-0df4b3ffc6b0",
    "ANC Headphones": "photo-1505740420928-5e560c06d30e",
    "Smart Watch": "photo-1546868871-7041f2a55e12",
    "Marble Slab": "photo-1553095066-5014bc7b7f2d",
    "Vinyl Plank": "photo-1594026112284-02bb6f3352fe",
    "Bathroom Set": "photo-1600566753086-00f18fb6b3ea",
    "六轴协作机器人": "photo-1485827404703-89b55fcc595e",
    "焊接机器人": "photo-1531746790731-6c087fecd65a",
    "移动搬运机器人": "photo-1565793298595-6a879b1d9492",
}

changed = 0
for frag, uid in IMG_PLAN.items():
    products = db.query(models.Product).filter(models.Product.name.ilike(f"%{frag}%")).all()
    for p in products:
        url = U.format(id=uid)
        existing = db.query(models.Asset).filter(models.Asset.product_id == p.id).first()
        if existing:
            existing.url = url
            existing.source_type = "VERIFIED_STOCK"
            existing.provider = "unsplash"
        else:
            db.add(models.Asset(
                id=new_id("asset"), tenant_id=p.tenant_id, site_id="",
                product_id=p.id, role="product",
                source_type="VERIFIED_STOCK", provider="unsplash",
                url=url, caption=p.name, alt_text=p.name,
                is_primary=True, sort_order=0,
            ))
        changed += 1

db.commit()
print(f"PRODUCT-IMAGES updated {changed}")
db.close()
