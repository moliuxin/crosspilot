"""账户与租户端点：注册 / 登录 / 当前用户。

注册同时创建「租户 + owner 账户 + 该租户的初始站点/额度行」，
保证新账号进入工作台时数据完整（而不是空指针）。
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import entitlements, models, schemas
from ..database import get_db
from ..security import create_token, current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def make_public_slug(tenant_id: int) -> str:
    """生成不可枚举的对外站点标识（独立站前台 /api/public/site?tenant=<slug>）。"""
    import secrets

    return f"t-{tenant_id}-{secrets.token_hex(3)}"


def _ensure_tenant_rows(db: Session, tenant_id: int) -> None:
    """为新租户初始化站点状态 / 用量 / 额度 / 订阅四张单例行。"""
    if not db.get(models.SiteState, tenant_id):
        db.add(models.SiteState(id=tenant_id))
    if not db.get(models.Usage, tenant_id):
        db.add(models.Usage(id=tenant_id))
    if not db.get(models.Credit, tenant_id):
        db.add(models.Credit(id=tenant_id))
    # 订阅是权限真源，必须随租户一起建立
    entitlements.ensure_subscription(db, tenant_id, plan_id="free")
    db.commit()


@router.post("/register", status_code=201)
def register(payload: schemas.RegisterRequest, db: Session = Depends(get_db)):
    from ..config import get_settings

    if not get_settings().allow_signup:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "当前环境未开放自助注册")

    email = payload.email.strip().lower()
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "该邮箱已注册，请直接登录")

    tenant = models.Tenant(name=payload.company_name.strip(), industry=payload.industry.strip(), plan="free")
    db.add(tenant)
    db.flush()  # 拿到 tenant.id
    tenant.public_slug = make_public_slug(tenant.id)

    user = models.User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name.strip() or payload.company_name.strip(),
        role="owner",
        tenant_id=tenant.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    _ensure_tenant_rows(db, tenant.id)

    return {"ok": True, "token": create_token(user), "user": user.to_dict()}


@router.post("/login")
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.query(models.User).filter(models.User.email == email).first()
    # 统一错误文案：不区分「邮箱不存在」与「密码错误」，避免账号枚举
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "邮箱或密码不正确")
    return {"ok": True, "token": create_token(user), "user": user.to_dict()}


@router.get("/me")
def me(user: models.User = Depends(current_user)):
    return {"ok": True, "user": user.to_dict()}
