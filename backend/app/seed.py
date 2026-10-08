"""首次启动的种子数据（与前端 mock 阶段保持一致的演示企业）。"""
import logging

from sqlalchemy.orm import Session

from . import models

logger = logging.getLogger("sitepilot.seed")

PRODUCTS = [
    {
        "id": "prod_001",
        "name": "Industrial RO System",
        "model": "AF-RO-1200",
        "category": "Water Treatment",
        "specs": [
            {"key": "Capacity", "value": "120 m³/h"},
            {"key": "Recovery", "value": "75%"},
            {"key": "Membrane", "value": "BW-8040 × 24"},
            {"key": "Pressure", "value": "1.2 MPa"},
        ],
        "benefits": ["High recovery for process water", "Low energy consumption", "Easy maintenance"],
        "applications": ["Water treatment", "Industrial circulation", "Process water reuse"],
        "seo_score": 92,
        "geo_score": 78,
        "seo": {
            "title": "Industrial RO Water Treatment System Manufacturer | AQUAFLOW",
            "slug": "/industrial-ro-system/",
            "meta_description": "Industrial reverse osmosis system for process water and reuse applications.",
            "h1": "Industrial RO Water Treatment System",
            "faq": ["Lead time?", "Installation support?", "OEM available?"],
            "image_alt": ["Industrial RO system front view", "RO membrane rack"],
            "schema_enabled": True,
        },
    },
    {
        "id": "prod_002",
        "name": "Ultrafiltration Unit",
        "model": "AF-UF-600",
        "category": "Filtration",
        "specs": [
            {"key": "Capacity", "value": "60 m³/h"},
            {"key": "Membrane", "value": "PVDF UF"},
            {"key": "Backwash", "value": "Automatic"},
        ],
        "benefits": ["Stable pretreatment", "Automated backwash and CIP"],
        "applications": ["Filtration", "Pretreatment"],
        "seo_score": 58,
        "geo_score": 40,
        "seo": {
            "title": "UF Water Filter Machine",
            "slug": "/product?id=1028",
            "meta_description": "",
            "h1": "Water Pump",
            "faq": [],
            "image_alt": [],
            "schema_enabled": False,
        },
    },
    {
        "id": "prod_003",
        "name": "Automatic Dosing System",
        "model": "AF-DS-320",
        "category": "Dosing",
        "specs": [
            {"key": "Capacity", "value": "320 L/h"},
            {"key": "Control", "value": "PLC + HMI"},
        ],
        "benefits": ["Precise dosing", "Remote monitoring"],
        "applications": ["Chemical dosing", "Water treatment"],
        "seo_score": 74,
        "geo_score": 56,
        "seo": {
            "title": "Automatic Dosing System",
            "slug": "/dosing-system/",
            "meta_description": "Automatic chemical dosing system for water treatment.",
            "h1": "Automatic Dosing System",
            "faq": ["Accuracy?"],
            "image_alt": ["Dosing system installed"],
            "schema_enabled": False,
        },
    },
    {
        "id": "prod_004",
        "name": "Containerized Treatment Plant",
        "model": "AF-CTP-40",
        "category": "Turnkey Plant",
        "specs": [
            {"key": "Capacity", "value": "40 m³/h"},
            {"key": "Footprint", "value": "2 × 40ft container"},
            {"key": "Climate", "value": "-40°C ~ +50°C"},
        ],
        "benefits": ["Fast deployment", "Remote-site ready", "Cold-climate design"],
        "applications": ["Remote sites", "Mining", "Turnkey projects"],
        "seo_score": 88,
        "geo_score": 72,
        "seo": {
            "title": "Containerized Water Treatment Plant | AQUAFLOW",
            "slug": "/containerized-treatment-plant/",
            "meta_description": "Packaged containerized water treatment plant for remote industrial sites.",
            "h1": "Containerized Water Treatment Plant",
            "faq": ["Delivery time?", "Cold climate?"],
            "image_alt": ["Containerized plant on site"],
            "schema_enabled": True,
        },
    },
]

INQUIRIES = [
    {
        "id": "rfq_001", "customer_name": "Michael Kim", "email": "michael@delta-process.com",
        "company": "Delta Process", "country": "United States", "product_id": "prod_001",
        "product_name": "Industrial RO System", "source_page": "/products/industrial-ro-system",
        "source_channel": "Google Search", "status": "new", "intent": "hot",
        "message": "Please quote 10 units of AF-RO-1200 with delivery to Houston, TX.",
    },
    {
        "id": "rfq_002", "customer_name": "Alexey Novikov", "email": "alexey@volga-eng.ru",
        "company": "Volga Engineering", "country": "Russia", "product_id": "prod_004",
        "product_name": "Containerized Treatment Plant", "source_page": "/products/containerized-treatment-plant",
        "source_channel": "Yandex", "status": "following", "intent": "warm",
        "message": "Нужен расчёт поставки контейнерной установки в Казань. Просьба указать сроки и условия оплаты.",
    },
    {
        "id": "rfq_003", "customer_name": "Sarah Taylor", "email": "sarah@northwater.co.uk",
        "company": "Northwater", "country": "United Kingdom", "product_id": "prod_002",
        "product_name": "Ultrafiltration Unit", "source_page": "/products/ultrafiltration-unit",
        "source_channel": "AI Search", "status": "new", "intent": "hot",
        "message": "Looking for a UF unit for process water pretreatment. Please send spec sheet and lead time.",
    },
    {
        "id": "rfq_004", "customer_name": "Wang Lei", "email": "wanglei@sinopro.cn",
        "company": "Sinopro EPC", "country": "China", "product_id": "prod_003",
        "product_name": "Automatic Dosing System", "source_page": "/products/automatic-dosing-system",
        "source_channel": "Direct", "status": "contacted", "intent": "warm",
        "message": "需要 AF-DS-320 的报价，配 PLC 控制，用于市政水厂项目。",
    },
    {
        "id": "rfq_005", "customer_name": "Ivan Petrov", "email": "ivan@aquaplus.ru",
        "company": "AquaPlus", "country": "Russia", "product_id": "prod_001",
        "product_name": "Industrial RO System", "source_page": "/products/industrial-ro-system",
        "source_channel": "Google Search", "status": "done", "intent": "warm",
        "message": "Запрос коммерческого предложения на систему обратного осмоса.",
    },
]


def seed_if_empty(db: Session) -> bool:
    """数据库为空时写入种子数据。返回是否执行了写入。"""
    if db.query(models.Product).count() > 0:
        return False

    for p in PRODUCTS:
        db.add(models.Product(**p))
    for i in INQUIRIES:
        db.add(models.Inquiry(**i))

    db.add(
        models.SiteState(
            id=1,
            company_name="AQUAFLOW Industrial",
            industry="工业水处理设备",
            primary_products="centrifugal pump, process pump, RO system, ultrafiltration unit",
            # 与「免费版含 1 个新增市场版本」规则一致：初始仅默认市场，
            # 让「生成新市场版本」与付费门槛在演示中真实可触发。
            target_markets=["en-US"],
            language="zh-CN",
            plan="free",
            publish_status="draft",
            publish_count=0,
            verified=True,
        )
    )
    db.add(models.Usage(id=1, free_generation_limit=1, free_generation_used=0))
    db.add(models.Credit(id=1, balance=1860, total_granted=1860))

    # 演示用的额度流水
    db.add(
        models.CreditLog(
            id="cl_seed_001",
            skill="AI 文案生成",
            cost=20,
            balance_after=1880,
            note="产品描述生成",
        )
    )
    db.add(
        models.CreditLog(
            id="cl_seed_002",
            skill="套餐赠送",
            cost=-2000,
            balance_after=1900,
            note="Starter 套餐开通赠送",
        )
    )
    db.add(
        models.CreditLog(
            id="cl_seed_003",
            skill="SEO/GEO 审计",
            cost=40,
            balance_after=1860,
            note="全站 SEO 体检",
        )
    )
    _seed_demo_account(db)
    # 套餐字典 + 默认租户订阅（权限真源，必须随种子一起就绪）
    from . import entitlements

    entitlements.seed_plans(db)
    entitlements.ensure_subscription(db, 1, plan_id="free")
    db.commit()

    # 多站点：为种子租户建默认站点，种子数据全部挂到它
    _seed_default_site(db)
    return True


def _seed_default_site(db: Session) -> None:
    """给默认租户创建 Default Site 并回填 site_id / 站点-产品关联。

    与生产库 _migrate_multi_site 的行为保持一致：老数据归属默认站点，不丢。
    """
    import secrets

    from .utils import slugify

    tenant = db.get(models.Tenant, models.DEFAULT_TENANT_ID)
    if tenant is None:
        # 与 conftest 的种子租户约定一致（public_slug 固定，便于测试断言）
        db.add(
            models.Tenant(
                id=models.DEFAULT_TENANT_ID,
                name="AQUAFLOW Industrial",
                industry="工业水处理设备",
                plan="free",
                public_slug=f"t-{models.DEFAULT_TENANT_ID}-seed01",
            )
        )
        db.commit()
        tenant = db.get(models.Tenant, models.DEFAULT_TENANT_ID)

    if db.query(models.Site).filter(models.Site.tenant_id == models.DEFAULT_TENANT_ID).count() > 0:
        return

    site = models.Site(
        id="site_seed_default",
        tenant_id=models.DEFAULT_TENANT_ID,
        name="AQUAFLOW Industrial",
        slug=slugify("AQUAFLOW Industrial") or "default",
        industry="工业水处理设备",
        product_category="水处理设备",
        target_markets=["en-US"],
        status="draft",
        is_default=True,
        public_slug=f"s-{models.DEFAULT_TENANT_ID}-{secrets.token_hex(3)}",
    )
    db.add(site)
    db.commit()

    for row in db.query(models.Page).filter(models.Page.tenant_id == models.DEFAULT_TENANT_ID).all():
        if not row.site_id:
            row.site_id = site.id
    for row in db.query(models.Inquiry).filter(models.Inquiry.tenant_id == models.DEFAULT_TENANT_ID).all():
        if not row.site_id:
            row.site_id = site.id
    for (pid,) in db.query(models.Product.id).filter(models.Product.tenant_id == models.DEFAULT_TENANT_ID).all():
        db.add(models.SiteProduct(site_id=site.id, product_id=pid))
    db.commit()


def _seed_demo_account(db: Session) -> bool:
    """预置演示账户，归属默认租户（= 种子数据所在的租户）。

    没有它，全新环境第一次打开就是登录页，评审方不知道用什么账号进去 ——
    而默认租户里已经有完整种子数据，直接给一个 owner 账户即可立刻看到成品。
    """
    from .security import hash_password

    email = "demo@aquaflow-demo.com"
    if db.query(models.User).filter(models.User.email == email).first():
        return False
    db.add(
        models.User(
            email=email,
            password_hash=hash_password("demo-pass-123"),
            display_name="AQUAFLOW 演示账户",
            role="owner",
            tenant_id=models.DEFAULT_TENANT_ID,
        )
    )
    logger.info("已预置演示账户 %s（密码 demo-pass-123）", email)
    return True
