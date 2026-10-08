"""统一付费权限体系 —— 单一真源。

设计原则（对总指令「不要在每个页面单独写死收费判断」的落实）：

- 真源 = ``Subscription.plan_id`` ∪ ``Entitlement``（未过期且未超额）。
  ``Tenant.plan`` 只是展示冗余，``SiteState.plan`` **不承载任何权限语义**。
- 所有门禁都经由本模块的 :func:`require_feature` / :func:`consume_feature`，
  路由层不再各自写 `if xxx: raise HTTPException(402)`。
- feature_key 命名规范：``<domain>.<action>``，全小写点分。

免费额度说明：免费版 = 1 次 AI 完整生成 + 发布能力。生成次数由
``Usage.free_generation_*`` 计数（与 ``site.generate`` 的 quota 联动），
其余能力一律由套餐决定。
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .security import tenant_scope

# --------------------------------------------------------------------------
# 套餐 → 能力映射（平台侧配置，唯一出处）
# --------------------------------------------------------------------------

# "*" 表示该套餐拥有全部能力（含未来新增能力）
PLAN_FEATURES: dict[str, list[str]] = {
    "free": ["site.generate", "site.publish", "version.restore"],
    "starter": [
        "site.generate",
        "site.publish",
        "version.restore",
        "page.publish",
        "seo.optimize",
        "market.localize",
        "skill.product_seo",
        "skill.product_copy",
        "skill.website_audit",
    ],
    "growth": ["*"],
    "expert": ["*"],
}
FEATURE_REQUIRED_PLAN: dict[str, str] = {
    "site.generate": "free",
    "site.publish": "free",
    "version.restore": "free",
    "template.purchase": "starter",
    "page.publish": "starter",
    "seo.optimize": "starter",
    "market.localize": "starter",
    "skill.product_seo": "starter",
    "skill.product_copy": "free",
    "skill.website_audit": "free",
    "geo.publish": "growth",
    "agent.run": "growth",
    "brush.edit": "growth",
    "seo.expert": "growth",
    "skill.geo": "growth",
    "skill.competitor": "growth",
    "skill.visual_scene": "growth",
    "skill.redesign": "growth",
    "skill.localization": "growth",
}

FEATURE_LABELS: dict[str, str] = {
    "site.generate": "AI 完整生成网站",
    "site.publish": "站点发布",
    "version.restore": "版本回滚",
    "template.purchase": "模板商城购买",
    "page.publish": "页面发布",
    "seo.optimize": "SEO 智能优化",
    "market.localize": "多语言市场版本",
    "geo.publish": "GEO 生成式引擎优化",
    "agent.run": "AI 智能体自动化",
    "brush.edit": "AI 画笔编辑",
    "seo.expert": "专家代优化服务",
    "skill.product_seo": "产品 SEO",
    "skill.product_copy": "产品文案",
    "skill.website_audit": "网站体检",
    "skill.geo": "GEO 优化",
    "skill.competitor": "竞品分析",
    "skill.visual_scene": "AI 场景图",
    "skill.redesign": "整站改版",
    "skill.localization": "本地化翻译",
}

UPGRADE_URL = "/#/pricing"


# --------------------------------------------------------------------------
# 套餐字典（运行期从 plans 表读；表为空时回落到常量，保证永不崩）
# --------------------------------------------------------------------------

_FALLBACK_PLANS: list[dict] = [
    {"id": "free", "name": "Free 免费版", "price": 0, "features": PLAN_FEATURES["free"], "sort": 0},
    {"id": "starter", "name": "Starter 起步版", "price": 399, "features": PLAN_FEATURES["starter"], "sort": 1},
    {"id": "growth", "name": "Growth 增长版", "price": 1280, "features": PLAN_FEATURES["growth"], "sort": 2},
    {"id": "expert", "name": "Expert 专业版", "price": 0, "features": PLAN_FEATURES["expert"], "sort": 3},
]


def list_plans(db: Session) -> list[dict]:
    """返回可用套餐（供前端渲染 PaywallModal，替代硬编码 PLANS）。"""
    rows = db.execute(
        select(models.Plan).where(models.Plan.active == True).order_by(models.Plan.sort)  # noqa: E712
    ).scalars().all()
    if not rows:
        return _FALLBACK_PLANS
    return [r.to_dict() for r in rows]


# --------------------------------------------------------------------------
# 真源查询
# --------------------------------------------------------------------------


def get_subscription(db: Session, tenant_id: int) -> models.Subscription | None:
    return db.get(models.Subscription, tenant_id)


def get_plan_id(db: Session, tenant_id: int) -> str:
    """当前生效套餐 id；无订阅记录时回落 free。"""
    sub = get_subscription(db, tenant_id)
    if sub is None:
        return "free"
    if sub.status == "expired":
        return "free"
    return sub.plan_id or "free"


def _plan_features(plan_id: str) -> list[str]:
    return PLAN_FEATURES.get(plan_id, PLAN_FEATURES["free"])


def _entitlement_rows(db: Session, tenant_id: int) -> list[models.Entitlement]:
    rows = db.execute(
        select(models.Entitlement).where(models.Entitlement.tenant_id == tenant_id)
    ).scalars().all()
    now = datetime.now(timezone.utc)
    out: list[models.Entitlement] = []
    for r in rows:
        if r.expires_at is not None:
            exp = r.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < now:
                continue  # 已过期
        out.append(r)
    return out


def _entitlement_usable(row: models.Entitlement) -> bool:
    """额度型能力：还有剩余次数才算可用。"""
    if row.quota is None:
        return True
    return row.used < row.quota


def has_feature(db: Session, tenant_id: int, feature_key: str) -> bool:
    """租户当前是否可用该能力（套餐 ∪ 单独开通）。"""
    plan_id = get_plan_id(db, tenant_id)
    features = _plan_features(plan_id)
    if "*" in features or feature_key in features:
        return True
    for row in _entitlement_rows(db, tenant_id):
        if row.feature_key == feature_key and _entitlement_usable(row):
            return True
    return False


def _quota_for(db: Session, tenant_id: int, feature_key: str) -> dict | None:
    """返回额度型能力的用量（既含套餐内 quota，也含 Entitlement quota）。"""
    for row in _entitlement_rows(db, tenant_id):
        if row.feature_key == feature_key and row.quota is not None:
            return {
                "used": row.used,
                "limit": row.quota,
                "left": max(0, row.quota - row.used),
            }
    return None


def get_entitlements(db: Session, tenant_id: int) -> dict:
    """一次性下发全量权限，供前端收口所有硬编码判断。"""
    plan_id = get_plan_id(db, tenant_id)
    plan_features = _plan_features(plan_id)
    is_wildcard = "*" in plan_features

    # 前端可查询的全部 feature_key（已知集合 ∪ 该租户已单独开通的）
    known: set[str] = set(FEATURE_REQUIRED_PLAN.keys())
    ent_rows = _entitlement_rows(db, tenant_id)
    for r in ent_rows:
        known.add(r.feature_key)

    features: dict[str, bool] = {}
    for key in sorted(known):
        if is_wildcard or key in plan_features:
            features[key] = True
        else:
            features[key] = any(
                r.feature_key == key and _entitlement_usable(r) for r in ent_rows
            )

    quotas: dict[str, dict] = {}
    # 免费生成额度映射到 site.generate，与 Usage 表保持一致
    usage = db.get(models.Usage, tenant_id)
    if usage is not None:
        quotas["site.generate"] = {
            "used": usage.free_generation_used,
            "limit": usage.free_generation_limit,
            "left": max(0, usage.free_generation_limit - usage.free_generation_used),
        }
    for r in ent_rows:
        if r.quota is not None and r.feature_key not in quotas:
            quotas[r.feature_key] = {
                "used": r.used,
                "limit": r.quota,
                "left": max(0, r.quota - r.used),
            }

    plan_row = next((p for p in list_plans(db) if p["id"] == plan_id), None)
    sub = get_subscription(db, tenant_id)

    return {
        "plan": plan_id,
        "planName": (plan_row or {}).get("name", plan_id),
        "status": sub.status if sub else "active",
        "features": features,
        "limits": (plan_row or {}).get("limits", {}),
        "quotas": quotas,
        "entitlements": [r.to_dict() for r in ent_rows],
        "plans": list_plans(db),
        "upgradeUrl": UPGRADE_URL,
    }


# --------------------------------------------------------------------------
# 门禁
# --------------------------------------------------------------------------


def required_plan_for(feature_key: str) -> str:
    return FEATURE_REQUIRED_PLAN.get(feature_key, "starter")


def require_feature(db: Session, tenant_id: int, feature_key: str) -> None:
    """不满足则抛 402；响应体带 feature/requiredPlan/upgradeUrl 供前端弹窗。

    额度型能力（如 site.generate 的免费 1 次）也会在此拦：quota 用尽即 402。
    """
    plan_id = get_plan_id(db, tenant_id)
    plan_features = _plan_features(plan_id)
    is_wildcard = "*" in plan_features
    label = FEATURE_LABELS.get(feature_key, feature_key)
    required_plan = required_plan_for(feature_key)

    if not (is_wildcard or feature_key in plan_features):
        # 看是否有单独开通
        rows = [r for r in _entitlement_rows(db, tenant_id) if r.feature_key == feature_key]
        if not rows:
            raise HTTPException(
                status_code=402,
                detail={
                    "message": f"「{label}」为付费能力，当前套餐无法使用。",
                    "feature": feature_key,
                    "requiredPlan": required_plan,
                    "upgradeUrl": UPGRADE_URL,
                },
            )
        if not any(_entitlement_usable(r) for r in rows):
            raise HTTPException(
                status_code=402,
                detail={
                    "message": f"「{label}」额度已用完，请升级套餐或加购。",
                    "feature": feature_key,
                    "requiredPlan": required_plan,
                    "upgradeUrl": UPGRADE_URL,
                },
            )
        return

    # 套餐已含：检查额度型超限
    quotas = _quota_for(db, tenant_id, feature_key)
    if quotas is not None and quotas["left"] <= 0:
        raise HTTPException(
            status_code=402,
            detail={
                "message": f"「{label}」额度已用完，请升级套餐或加购。",
                "feature": feature_key,
                "requiredPlan": required_plan,
                "upgradeUrl": UPGRADE_URL,
            },
        )


def consume_feature(db: Session, tenant_id: int, feature_key: str) -> None:
    """对额度型能力扣减一次（无额度配置则不动）。调用方负责 commit。"""
    for row in _entitlement_rows(db, tenant_id):
        if row.feature_key == feature_key and row.quota is not None:
            row.used = (row.used or 0) + 1
            return


def feature_guard(feature_key: str):
    """FastAPI dependency 工厂：``dependencies=[Depends(feature_guard("brush.edit"))]``。"""

    def _dep(db: Session = Depends(get_db), tid: int = Depends(tenant_scope)) -> int:
        require_feature(db, tid, feature_key)
        return tid

    return _dep


# --------------------------------------------------------------------------
# 初始化
# --------------------------------------------------------------------------

_PLAN_SEED = [
    ("free", "Free 免费版", 0, PLAN_FEATURES["free"], {"generations": 1, "products": 10}, 0),
    ("starter", "Starter 起步版", 399, PLAN_FEATURES["starter"], {"generations": 5, "products": 50}, 1),
    ("growth", "Growth 增长版", 1280, PLAN_FEATURES["growth"], {"generations": -1, "products": 500}, 2),
    ("expert", "Expert 专业版", 0, PLAN_FEATURES["expert"], {"generations": -1, "products": -1}, 3),
]


def seed_plans(db: Session) -> None:
    """写入套餐字典（幂等）。"""
    existing = {r.id for r in db.execute(select(models.Plan)).scalars().all()}
    for pid, name, price, features, limits, sort in _PLAN_SEED:
        if pid in existing:
            continue
        db.add(
            models.Plan(
                id=pid,
                name=name,
                price=price,
                features=list(features),
                limits=dict(limits),
                sort=sort,
                active=True,
            )
        )


def ensure_subscription(db: Session, tenant_id: int, plan_id: str = "free") -> models.Subscription:
    """为新租户 / 存量租户建立订阅行（幂等）。"""
    sub = db.get(models.Subscription, tenant_id)
    if sub is None:
        sub = models.Subscription(id=tenant_id, tenant_id=tenant_id, plan_id=plan_id, status="active")
        db.add(sub)
    return sub
