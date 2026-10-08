"""WorkBuddy SitePilot — FastAPI 后端配置。

所有配置项可用环境变量覆盖（前缀 SITEPILOT_），便于本地/校赛/生产多环境切换。
"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SITEPILOT_", env_file=".env", extra="ignore")

    app_name: str = "WorkBuddy SitePilot API"
    api_prefix: str = "/api"

    # 数据库：默认 SQLite（校赛零依赖）；生产改 postgresql+psycopg://...
    database_url: str = f"sqlite:///{BASE_DIR / 'sitepilot.db'}"

    # 跨域：前端 Vite dev server / 静态托管
    cors_origins: str = "*"

    # LLM provider：mock（默认，无外部依赖）| openai（兼容 OpenAI 协议的任意服务）
    llm_provider: str = "mock"
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    llm_timeout: float = 60.0

    # Image provider（GLM-Image 走 OpenAI 兼容图像协议；未配置 key 时用 mock 占位图）
    image_api_key: str = ""
    image_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    image_model: str = "cogview-4"
    image_timeout: float = 120.0

    # 免费额度策略
    free_generation_limit: int = 1

    # 账户会话：JWT 密钥与有效期（生产必须用环境变量覆盖默认密钥）
    jwt_secret: str = "sitepilot-dev-secret-change-me-in-production"
    jwt_expire_hours: int = 72

    # 注册开关：演示环境允许自助注册；生产可关闭改为邀请制
    allow_signup: bool = True

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_enabled(self) -> bool:
        return self.llm_provider != "mock" and bool(self.llm_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
