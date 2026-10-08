"""账户安全：密码哈希 + JWT 签发校验 + 当前用户/租户依赖。

设计要点：
- 密码用 bcrypt（passlib）哈希，绝不明文存储。
- 会话用 JWT（PyJWT, HS256），载荷含 user_id / tenant_id / role / exp。
  密钥来自 SITEPILOT_JWT_SECRET（生产必须覆盖默认值）。
- 业务端点统一依赖 ``current_user``（登录必需）与 ``tenant_scope``（租户隔离）。
  未登录访问业务端点 → 401；跨租户访问他人资源 → 404（不泄露存在性）。
"""
from __future__ import annotations

import datetime as dt
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, status
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from . import models
from .config import get_settings
from .database import get_db

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"


# ---------------- 密码 ----------------

def hash_password(raw: str) -> str:
    # bcrypt 只处理前 72 字节，超长直接截断会让不同长密码碰撞，这里显式限制长度
    return _pwd.hash(raw[:72])


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return _pwd.verify(raw[:72], hashed)
    except Exception:
        return False


# ---------------- Token ----------------

def create_token(user: models.User) -> str:
    s = get_settings()
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": str(user.id),
        "tenant_id": user.tenant_id,
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(hours=s.jwt_expire_hours)).timestamp()),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    s = get_settings()
    try:
        return jwt.decode(token, s.jwt_secret, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登录已过期，请重新登录") from None
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "无效的登录凭证") from None


# ---------------- 依赖 ----------------

def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> models.User:
    """解析当前登录用户；无 token / token 失效 → 401。"""
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录：缺少访问凭证")
    payload = decode_token(token)
    user = db.get(models.User, int(payload["sub"]))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "账户不存在或已停用")
    return user


def tenant_scope(user: models.User = Depends(current_user)) -> int:
    """当前请求的数据归属租户。业务端点全部依赖它做隔离。

    平台运营（role=operator）不绑定租户，需通过 X-Tenant-Id 显式指定要操作哪个租户；
    其余角色一律用自己账户上的 tenant_id，忽略任何客户端传入的租户参数。
    """
    if user.role == "operator":
        if not user.tenant_id:
            # operator 默认看默认租户；真实运营场景应由前端显式切换
            return models.DEFAULT_TENANT_ID
        return user.tenant_id
    if not user.tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "账户未绑定企业，请联系管理员")
    return user.tenant_id


def resolve_tenant_id(authorization: Annotated[str | None, Header()] = None,
                      x_tenant_id: Annotated[int | None, Header()] = None,
                      db: Session = Depends(get_db)) -> int:
    """支持 X-Tenant-Id 覆盖的租户解析（仅 operator 可跨租户）。

    普通商家传入 X-Tenant-Id 会被忽略，始终用自己账户的租户 —— 防止越权。
    """
    user = current_user(authorization=authorization, db=db)
    if user.role == "operator" and x_tenant_id:
        return x_tenant_id
    return tenant_scope(user)
