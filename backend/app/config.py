"""WorkBuddy SitePilot — FastAPI 后端配置。

所有配置项可用环境变量覆盖（前缀 SITEPILOT_），便于本地/校赛/生产多环境切换。
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_base_path(p: str) -> str:
    """规范化部署子路径：过滤空段、确保前导 /、去尾斜杠；空值 → '/'。

    >>> normalize_base_path("") == "/"
    >>> normalize_base_path("crosspilot") == "/crosspilot"
    >>> normalize_base_path("/crosspilot//") == "/crosspilot"
    """
    segs = [seg for seg in (p or "").split("/") if seg]
    return "/" + "/".join(segs) if segs else "/"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SITEPILOT_", env_file=".env", extra="ignore")

    app_name: str = "WorkBuddy SitePilot API"

    # 部署子路径（外部统一 Nginx 不剥离前缀时使用）：
    #   SITEPILOT_APP_BASE_PATH=/crosspilot/ → 应用挂在 /crosspilot 下
    app_base_path: str = "/"
    # 浏览器侧 API 前缀；留空 = 从 app_base_path 派生（/ → /api，/crosspilot → /crosspilot/api）
    api_base_path: str = ""

    # 数据库：仅支持 PostgreSQL（本地开发可先 docker compose -f docker-compose.test.yml up -d）
    database_url: str = "postgresql+psycopg://crosspilot:crosspilot@127.0.0.1:5432/crosspilot"

    # 启动时自动建表 + 播种（Docker Compose 由独立 init 服务执行，故可关闭）
    auto_init: bool = True

    # 连接池（PostgreSQL 长连接场景下避免连接被回收后继续使用）
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_recycle: int = 1800

    # 跨域：前端 Vite dev server / 静态托管
    cors_origins: str = "*"

    # LLM provider：mock（默认，无外部依赖）| openai（兼容 OpenAI 协议的任意服务）
    llm_provider: str = "mock"
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    llm_timeout: float = 60.0

    # 国赛 Demo 模式：true 时真实 LLM 不可用不再静默降级模板，
    # 直接报「真实AI服务暂时不可用」——用于向评委证明没有冒充 AI。
    demo_require_real_ai: bool = False

    # Image provider(GLM-Image 走 OpenAI 兼容图像协议;未配置 key 时用 mock 占位图)
    image_api_key: str = ""
    image_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    image_model: str = "cogview-4"
    image_timeout: float = 120.0

    # 图片生成限流韧性(P0-IMAGE-RATE-LIMIT-RESILIENCE)
    image_max_concurrency: int = 1          # 同时最多几个图片请求
    image_request_interval_ms: int = 1200   # 请求间隔(ms),避免连续触发 429
    image_max_retries: int = 3              # 429 时最大重试次数
    image_retry_base_seconds: float = 2.0   # 指数退避基数: 2s → 4s → 8s

    # 免费额度策略
    free_generation_limit: int = 1

    # 账户会话：JWT 密钥与有效期（生产必须用环境变量覆盖默认密钥）
    jwt_secret: str = "sitepilot-dev-secret-change-me-in-production"
    jwt_expire_hours: int = 72

    # 注册开关：演示环境允许自助注册；生产可关闭改为邀请制
    allow_signup: bool = True

    @property
    def app_base(self) -> str:
        """规范化后的应用子路径（无尾斜杠）：'/' 或 '/crosspilot'。"""
        return normalize_base_path(self.app_base_path)

    @property
    def api_prefix(self) -> str:
        """路由挂载前缀（无尾斜杠）。默认从部署子路径派生，可被 api_base_path 覆盖。"""
        if self.api_base_path:
            return normalize_base_path(self.api_base_path)
        base = self.app_base
        return f"{base}/api" if base != "/" else "/api"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sqlalchemy_database_url(self) -> str:
        """规范化并校验数据库 URL：本项目仅支持 PostgreSQL。"""
        url = (self.database_url or "").strip()
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        if not url.startswith("postgresql+psycopg://"):
            raise ValueError(
                "SITEPILOT_DATABASE_URL 必须是 PostgreSQL URL"
                "（postgresql+psycopg://user:pass@host:port/db）；本项目仅支持 PostgreSQL"
            )
        return url

    @property
    def llm_enabled(self) -> bool:
        return self.llm_provider != "mock" and bool(self.llm_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
