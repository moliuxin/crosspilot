"""ORM 模型。

字段设计对齐 docs/data-model.example.json 与前端 src/types/index.js：
- Product 存储用 specs/benefits/seo_score/geo_score，语义对应指令里的
  attributes/sellingPoints/seoScore/geoScore（见 README 字段映射说明）。
- 复杂结构（specs/benefits/applications/seo/localized_content）用 JSON 列存储，
  避免为 Demo 阶段过度拆表；生产若要按属性检索可再拆 product_attribute 表。
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.ext.mutable import MutableDict, MutableList
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# 默认租户：迁移既有单租户数据时全部归入它，老数据不丢
DEFAULT_TENANT_ID = 1


class Tenant(Base):
    """租户（一家商户企业）。所有业务数据按 tenant_id 隔离。"""

    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    industry: Mapped[str] = mapped_column(String(255), default="")
    # 权限真源是 Subscription.plan_id ∪ Entitlement；本字段降级为展示冗余，勿用作门禁。
    plan: Mapped[str] = mapped_column(String(32), default="free")  # free/starter/growth/expert
    # 独立站前台对外标识：不可枚举（如 t-1-8f3a），用于 /api/public/site?tenant=<slug>
    public_slug: Mapped[str] = mapped_column(String(64), default="", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    users: Mapped[list["User"]] = relationship(back_populates="tenant")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "industry": self.industry,
            "plan": self.plan,
            "publicSlug": self.public_slug,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class User(Base):
    """账户。role: owner（企业管理员）| staff（企业员工）| operator（平台运营，跨租户）。"""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), default="")
    role: Mapped[str] = mapped_column(String(32), default="owner")
    # operator 属平台侧，不绑定租户；其余角色必须绑定
    tenant_id: Mapped[int | None] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    tenant: Mapped["Tenant | None"] = relationship(back_populates="users")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "displayName": self.display_name,
            "role": self.role,
            "tenantId": self.tenant_id,
            "tenant": self.tenant.to_dict() if self.tenant else None,
        }


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, default=DEFAULT_TENANT_ID, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(128), default="")
    category: Mapped[str] = mapped_column(String(128), default="General", index=True)

    # 指令中的 attributes / sellingPoints
    specs: Mapped[list] = mapped_column(MutableList.as_mutable(JSON), default=list)
    benefits: Mapped[list] = mapped_column(MutableList.as_mutable(JSON), default=list)
    applications: Mapped[list] = mapped_column(MutableList.as_mutable(JSON), default=list)
    images: Mapped[list] = mapped_column(MutableList.as_mutable(JSON), default=list)

    description: Mapped[str] = mapped_column(Text, default="")

    # SEO / GEO 状态
    seo: Mapped[dict] = mapped_column(MutableDict.as_mutable(JSON), default=dict)  # title/slug/meta_description/h1/faq/image_alt/schema_enabled
    seo_score: Mapped[int] = mapped_column(Integer, default=60)
    geo_score: Mapped[int] = mapped_column(Integer, default=42)

    localized_content: Mapped[dict] = mapped_column(MutableDict.as_mutable(JSON), default=dict)
    inquiries_count: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "model": self.model,
            "category": self.category,
            "specs": self.specs or [],
            "benefits": self.benefits or [],
            "applications": self.applications or [],
            "images": self.images or [],
            "description": self.description or "",
            "seo": self.seo or {},
            "seo_score": self.seo_score,
            "geo_score": self.geo_score,
            "localized_content": self.localized_content or {},
            "inquiries": self.inquiries_count,
            "updated_at": _humanize(self.updated_at),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Inquiry(Base):
    __tablename__ = "inquiries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, default=DEFAULT_TENANT_ID, index=True)
    # 多站点：询盘来自哪个站点（前台独立站按站点渲染后携带）
    site_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), default="")
    company: Mapped[str] = mapped_column(String(255), default="")
    country: Mapped[str] = mapped_column(String(128), default="", index=True)

    product_id: Mapped[str] = mapped_column(String(64), ForeignKey("products.id"), nullable=True)
    product_name: Mapped[str] = mapped_column(String(255), default="")

    source_page: Mapped[str] = mapped_column(String(255), default="")
    source_channel: Mapped[str] = mapped_column(String(128), default="Direct")

    message: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="new", index=True)  # new/contacted/following/done
    intent: Mapped[str] = mapped_column(String(16), default="warm")  # hot/warm/cold

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "site_id": self.site_id,
            "customer_name": self.customer_name,
            "email": self.email,
            "company": self.company,
            "country": self.country,
            "product_id": self.product_id,
            "product_name": self.product_name,
            "source_page": self.source_page,
            "source_channel": self.source_channel,
            "message": self.message,
            "status": self.status,
            "intent": self.intent,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Site(Base):
    """站点（多站点架构的一等业务实体）。

    一个租户（Tenant）可拥有多个 Site；Page / Inquiry / Version / Draft 等
    站点级数据通过 site_id 挂到具体站点。Product 保持租户级、经 SiteProduct
    关联复用（不复制产品事实）。
    """

    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # site_xxx
    tenant_id: Mapped[int] = mapped_column(Integer, default=DEFAULT_TENANT_ID, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), default="", index=True)  # 租户内唯一
    industry: Mapped[str] = mapped_column(String(255), default="")
    product_category: Mapped[str] = mapped_column(String(255), default="")
    target_markets: Mapped[list] = mapped_column(MutableList.as_mutable(JSON), default=lambda: ["en-US"])

    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)  # draft/published/archived
    template_id: Mapped[str] = mapped_column(String(64), default="")
    # 独立站前台对外标识（站点级 public_slug，用于 /api/public/site?site=<slug>）
    public_slug: Mapped[str] = mapped_column(String(64), default="", index=True)
    # 迁移存量数据时生成的默认站点（承载旧数据，不可删除）
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    language: Mapped[str] = mapped_column(String(16), default="zh-CN")
    publish_count: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    def to_dict(self) -> dict:
        counts = getattr(self, "_counts", None) or {}
        return {
            "id": self.id,
            "name": self.name,
            "slug": self.slug,
            "industry": self.industry,
            "product_category": self.product_category,
            "target_markets": self.target_markets or ["en-US"],
            "status": self.status,
            "template_id": self.template_id,
            "public_slug": self.public_slug,
            "is_default": self.is_default,
            "language": self.language,
            "publish_count": self.publish_count,
            "pages": counts.get("pages"),
            "inquiries": counts.get("inquiries"),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "updated_at_human": _humanize(self.updated_at),
        }


class SiteProduct(Base):
    """站点 ↔ 产品关联（多站点复用同一份产品事实，不复制数据）。"""

    __tablename__ = "site_products"

    site_id: Mapped[str] = mapped_column(String(64), ForeignKey("sites.id"), primary_key=True)
    product_id: Mapped[str] = mapped_column(String(64), ForeignKey("products.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SiteState(Base):
    """站点设置（每租户一行，主键即 tenant_id）。

    多站点后站点级信息（行业/市场/发布状态）以 Site 为准；
    本表降级为租户级企业资料与旧接口兼容层，新代码勿再往这里加站点字段。
    """

    __tablename__ = "site_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # = tenant_id
    company_name: Mapped[str] = mapped_column(String(255), default="")
    industry: Mapped[str] = mapped_column(String(255), default="")
    primary_products: Mapped[str] = mapped_column(Text, default="")
    target_markets: Mapped[list] = mapped_column(MutableList.as_mutable(JSON), default=lambda: ["en-US"])

    language: Mapped[str] = mapped_column(String(16), default="zh-CN")
    plan: Mapped[str] = mapped_column(String(32), default="free")  # free/starter/growth/expert
    publish_status: Mapped[str] = mapped_column(String(32), default="draft")  # draft/published
    publish_count: Mapped[int] = mapped_column(Integer, default=0)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    def to_dict(self) -> dict:
        return {
            "companyName": self.company_name,
            "industry": self.industry,
            "products": self.primary_products,
            "targetMarkets": self.target_markets or ["en-US"],
            "language": self.language,
            "plan": self.plan,
            "publishStatus": self.publish_status,
            "publishCount": self.publish_count,
            "verified": self.verified,
        }


class Usage(Base):
    """用量（每租户一行，主键即 tenant_id）。"""

    __tablename__ = "usage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # = tenant_id
    free_generation_limit: Mapped[int] = mapped_column(Integer, default=1)
    free_generation_used: Mapped[int] = mapped_column(Integer, default=0)

    def to_dict(self) -> dict:
        return {
            "freeGenerationLimit": self.free_generation_limit,
            "freeGenerationUsed": self.free_generation_used,
        }


class Draft(Base):
    """Agent / SEO 产生的草稿（Draft → Diff → 人工确认 → Publish）。"""

    __tablename__ = "drafts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, default=DEFAULT_TENANT_ID, index=True)
    site_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    entity_type: Mapped[str] = mapped_column(String(32), default="product")
    entity_id: Mapped[str] = mapped_column(String(64), default="")

    diff: Mapped[list] = mapped_column(MutableList.as_mutable(JSON), default=list)
    # 结构化写回补丁：发布时真正应用到实体（title/slug/meta/faq/... 或 sections）
    # diff 是给人看的展示对比，patch 是给发布引擎执行的数据，两者必须分开。
    patch: Mapped[dict] = mapped_column(MutableDict.as_mutable(JSON), default=dict)
    market: Mapped[str] = mapped_column(String(16), default="")

    seo_score_before: Mapped[float] = mapped_column(Float, nullable=True)
    seo_score_after: Mapped[float] = mapped_column(Float, nullable=True)
    geo_score_before: Mapped[float] = mapped_column(Float, nullable=True)
    geo_score_after: Mapped[float] = mapped_column(Float, nullable=True)

    status: Mapped[str] = mapped_column(String(32), default="draft")  # draft/published
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    human_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "site_id": self.site_id,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "diff": self.diff or [],
            "patch": self.patch or {},
            "market": self.market,
            "seoScoreBefore": self.seo_score_before,
            "seoScoreAfter": self.seo_score_after,
            "geoScoreBefore": self.geo_score_before,
            "geoScoreAfter": self.geo_score_after,
            "status": self.status,
            "confirmed": self.confirmed,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class Version(Base):
    """发布版本快照：每次发布保存实体前后镜像，支持真实回滚。

    Draft → Diff → Confirm → Publish → **Rollback** 闭环的最后一环。
    没有这张表，「回滚」就只能是一句 toast —— 用户看到"已回滚"，
    数据库里的内容纹丝不动。
    """

    __tablename__ = "versions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, default=DEFAULT_TENANT_ID, index=True)
    site_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    entity_type: Mapped[str] = mapped_column(String(32), index=True)  # product | page
    entity_id: Mapped[str] = mapped_column(String(64), index=True)
    version_no: Mapped[int] = mapped_column(Integer, default=1)  # 同一实体内自增
    before_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    after_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    draft_id: Mapped[str] = mapped_column(String(64), default="")
    # publish | rollback | edit | brush | template | seo | geo
    action: Mapped[str] = mapped_column(String(32), default="publish")
    published_by: Mapped[str] = mapped_column(String(64), default="merchant")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "version_no": self.version_no,
            "draft_id": self.draft_id,
            "action": self.action,
            "published_by": self.published_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "created_at_human": _humanize(self.created_at),
        }


class Page(Base):
    """页面编辑器中的页面（含组件树与属性）。

    组件树 sections 为有序数组，每项 {id, type, label, props:{...}}，
    属性编辑与拖拽排序都写回该结构，实现真正的"保存"。
    """

    __tablename__ = "pages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, default=DEFAULT_TENANT_ID, index=True)
    # 页面属于哪个站点；空串视为未关联（迁移后会回填到租户默认站点）
    site_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(128), default="")
    sections: Mapped[list] = mapped_column(MutableList.as_mutable(JSON), default=list)
    is_home: Mapped[bool] = mapped_column(Boolean, default=False)

    seo_title: Mapped[str] = mapped_column(String(255), default="")
    seo_description: Mapped[str] = mapped_column(Text, default="")

    order_index: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "slug": self.slug,
            "site_id": self.site_id,
            "sections": self.sections or [],
            "is_home": self.is_home,
            "seo_title": self.seo_title,
            "seo_description": self.seo_description,
            "order_index": self.order_index,
            "updated_at": _humanize(self.updated_at),
        }


class TaskItem(Base):
    """跟进任务 / 增长任务（询盘跟进、AI 增长服务提交后生成）。

    kind: followup（询盘跟进）| growth（增长服务）
    status: todo | doing | done
    """

    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, default=DEFAULT_TENANT_ID, index=True)
    kind: Mapped[str] = mapped_column(String(32), default="followup", index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    detail: Mapped[str] = mapped_column(Text, default="")

    inquiry_id: Mapped[str] = mapped_column(String(64), default="")
    owner: Mapped[str] = mapped_column(String(128), default="我")
    due_at: Mapped[str] = mapped_column(String(64), default="")

    status: Mapped[str] = mapped_column(String(32), default="todo", index=True)  # todo/doing/done
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0-100，增长任务用
    steps: Mapped[list] = mapped_column(MutableList.as_mutable(JSON), default=list)  # 子步骤 [{label, done}]

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "detail": self.detail,
            "inquiry_id": self.inquiry_id,
            "owner": self.owner,
            "due_at": self.due_at,
            "status": self.status,
            "progress": self.progress,
            "steps": self.steps or [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": _humanize(self.updated_at),
        }


class Credit(Base):
    """Skill / AI 能力用量（每租户一行，主键即 tenant_id）。"""

    __tablename__ = "credits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # = tenant_id
    balance: Mapped[int] = mapped_column(Integer, default=1860)
    total_granted: Mapped[int] = mapped_column(Integer, default=1860)

    def to_dict(self) -> dict:
        return {
            "balance": self.balance,
            "totalGranted": self.total_granted,
            "used": max(0, self.total_granted - self.balance),
        }


class CreditLog(Base):
    """额度流水（每次使用 Skill / 生成内容记一条）。"""

    __tablename__ = "credit_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, default=DEFAULT_TENANT_ID, index=True)
    skill: Mapped[str] = mapped_column(String(255), default="")
    cost: Mapped[int] = mapped_column(Integer, default=0)  # 正数=消耗，负数=充值
    balance_after: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "skill": self.skill,
            "cost": self.cost,
            "balance_after": self.balance_after,
            "note": self.note,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "time": _humanize(self.created_at),
        }


class Plan(Base):
    """套餐字典（平台侧，不属于任何租户）。features 为 feature_key 列表。"""

    __tablename__ = "plans"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # free/starter/growth/expert
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    price: Mapped[int] = mapped_column(Integer, default=0)  # 元/月
    features: Mapped[list] = mapped_column(MutableList.as_mutable(JSON), default=list)
    limits: Mapped[dict] = mapped_column(MutableDict.as_mutable(JSON), default=dict)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "price": self.price,
            "features": self.features or [],
            "limits": self.limits or {},
            "sort": self.sort,
            "active": self.active,
        }


class Subscription(Base):
    """租户当前订阅（每租户一行，主键即 tenant_id）。权限真源之一。"""

    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # = tenant_id
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    plan_id: Mapped[str] = mapped_column(String(32), default="free", index=True)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active/expired/pending
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_dict(self) -> dict:
        return {
            "planId": self.plan_id,
            "status": self.status,
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "expiresAt": self.expires_at.isoformat() if self.expires_at else None,
        }


class Entitlement(Base):
    """套餐之外单独开通 / 加购的单向能力。quota 为 None 表示不限次。"""

    __tablename__ = "entitlements"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    feature_key: Mapped[str] = mapped_column(String(64), index=True)
    source: Mapped[str] = mapped_column(String(32), default="plan")  # plan/grant/purchase/trial
    quota: Mapped[int | None] = mapped_column(Integer, nullable=True)
    used: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "feature_key": self.feature_key,
            "source": self.source,
            "quota": self.quota,
            "used": self.used,
            "left": None if self.quota is None else max(0, self.quota - self.used),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class ServiceOrder(Base):
    """套餐 / 能力开通申请。点击购买产生真实记录，而非只弹一句"客服稍后联系"。"""

    __tablename__ = "service_orders"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    plan_id: Mapped[str] = mapped_column(String(32), default="")
    feature_key: Mapped[str] = mapped_column(String(64), default="")
    contact: Mapped[str] = mapped_column(String(255), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    amount: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending/approved/rejected
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "plan_id": self.plan_id,
            "feature_key": self.feature_key,
            "contact": self.contact,
            "note": self.note,
            "amount": self.amount,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "created_at_human": _humanize(self.created_at),
        }


def _humanize(dt: datetime | None) -> str:
    """把时间转成前端展示的相对时间（与 mock 阶段保持一致）。"""
    if not dt:
        return "—"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - dt
    secs = int(delta.total_seconds())
    if secs < 60:
        return "刚刚"
    if secs < 3600:
        return f"{secs // 60} 分钟前"
    if secs < 86400:
        return f"{secs // 3600} 小时前"
    if secs < 172800:
        return "昨天"
    return f"{secs // 86400} 天前"
