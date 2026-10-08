"""Pydantic 请求/响应模型：入参校验与出参约束。"""
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

InquiryStatus = Literal["new", "contacted", "following", "done"]
Plan = Literal["free", "starter", "growth", "expert"]
Market = Literal["zh-CN", "en-US", "ru-RU"]


# ---------------- 公共 ----------------

class SpecItem(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    value: str = Field(default="", max_length=200)


class FaqItem(BaseModel):
    q: str = Field(min_length=1, max_length=300)
    a: str = Field(default="", max_length=1200)


class SeoState(BaseModel):
    title: str = ""
    slug: str = ""
    meta_description: str = ""
    h1: str = ""
    faq: list[str] = Field(default_factory=list)
    image_alt: list[str] = Field(default_factory=list)
    schema_enabled: bool = False


# ---------------- Product ----------------

class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    model: str = Field(default="", max_length=128)
    category: str = Field(default="General", max_length=128)
    specs: list[SpecItem] = Field(default_factory=list)
    benefits: list[str] = Field(default_factory=list)
    applications: list[str] = Field(default_factory=list)
    images: list[str] = Field(default_factory=list)
    description: str = ""
    seo: SeoState | None = None
    localized_content: dict = Field(default_factory=dict)

    @field_validator("name", "model", "category")
    @classmethod
    def strip_text(cls, v: str) -> str:
        return v.strip()


class ProductUpdate(BaseModel):
    """全部字段可选，实现局部更新（PATCH 语义）。"""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    model: str | None = None
    category: str | None = None
    specs: list[SpecItem] | None = None
    benefits: list[str] | None = None
    applications: list[str] | None = None
    images: list[str] | None = None
    description: str | None = None
    seo: SeoState | None = None
    seo_score: int | None = Field(default=None, ge=0, le=100)
    geo_score: int | None = Field(default=None, ge=0, le=100)
    localized_content: dict | None = None


# ---------------- Auth ----------------

class RegisterRequest(BaseModel):
    """注册：同时创建租户与 owner 账户。"""

    email: EmailStr
    password: str = Field(min_length=6, max_length=72)
    company_name: str = Field(min_length=1, max_length=255)
    industry: str = Field(default="", max_length=255)
    display_name: str = Field(default="", max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


# ---------------- Inquiry ----------------

class InquiryCreate(BaseModel):
    """独立站 RFQ 表单提交。"""

    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    company: str = Field(default="", max_length=255)
    country: str = Field(default="", max_length=128)
    message: str = Field(min_length=1, max_length=4000)


class InquiryStatusUpdate(BaseModel):
    status: InquiryStatus


# ---------------- Site / Usage ----------------

class SiteCreate(BaseModel):
    """创建站点（多站点）。name 必填；其余为站点画像字段。"""

    name: str = Field(min_length=1, max_length=255)
    industry: str = Field(default="", max_length=255)
    product_category: str = Field(default="", max_length=255)
    target_markets: list[Market] = Field(default_factory=lambda: ["en-US"])
    template_id: str = Field(default="", max_length=64)
    language: Market = "zh-CN"


class SiteUpdate(BaseModel):
    """站点局部更新（PATCH 语义）。"""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    industry: str | None = Field(default=None, max_length=255)
    product_category: str | None = Field(default=None, max_length=255)
    target_markets: list[Market] | None = None
    status: Literal["draft", "published", "archived"] | None = None
    template_id: str | None = Field(default=None, max_length=64)
    language: Market | None = None


class SiteProductLink(BaseModel):
    """站点 ↔ 产品关联。"""

    product_id: str = Field(min_length=1, max_length=64)


class SiteGenerateRequest(BaseModel):
    """AI 整站生成（AI Site Onboarding）输入。product_category 必填。"""

    company_name: str = Field(default="", max_length=255)
    product_category: str = Field(min_length=1, max_length=255)
    product_description: str = Field(default="", max_length=2000)
    target_buyer: str = Field(default="", max_length=255)
    target_markets: list[Market] = Field(default_factory=lambda: ["zh-CN", "en-US", "ru-RU"])
    preferred_style: str = Field(default="professional", max_length=32)
    template_preference: str = Field(default="", max_length=64)
    uploaded_product_images: list[str] = Field(default_factory=list)


class BrushPreviewRequest(BaseModel):
    """AI 画笔预览（付费能力 brush.edit 的后端校验入口）。"""

    page_id: str = Field(min_length=1, max_length=64)
    instruction: str = Field(min_length=1, max_length=500)


class SiteGenerateInput(BaseModel):
    company: str = Field(default="", max_length=255)
    industry: str = Field(default="", max_length=255)
    products: str = Field(default="", max_length=2000)
    markets: list[Market] = Field(default_factory=list)


class MarketGenerateRequest(BaseModel):
    """生成某个语言市场版本。"""

    market: Market


class SiteStateUpdate(BaseModel):
    companyName: str | None = None
    industry: str | None = None
    products: str | None = None
    targetMarkets: list[Market] | None = None
    language: Market | None = None
    plan: Plan | None = None
    verified: bool | None = None


class PublishRequest(BaseModel):
    draft_id: str = Field(min_length=1)
    # 安全约束：必须显式为 true 才允许发布
    human_confirmed: bool = False


class DraftCreate(BaseModel):
    """创建内容修改草稿（MCP update_draft 落点）。patch 为结构化写回数据。"""

    entity_type: Literal["product", "page"]
    entity_id: str = Field(min_length=1)
    patch: dict = Field(default_factory=dict)
    title: str = Field(default="", max_length=255)


class RollbackRequest(BaseModel):
    """回滚到指定版本（恢复该版本的 before 快照）。"""

    entity_type: Literal["product", "page"]
    entity_id: str = Field(min_length=1)
    version_id: str = Field(min_length=1)


# ---------------- SEO ----------------

class SeoOptimizeRequest(BaseModel):
    productId: str = Field(min_length=1)


# ---------------- Agent ----------------

class AgentCommand(BaseModel):
    """Agent 指令：自然语言字符串，或结构化 patch 对象。"""

    command: str | dict


class AgentRunRequest(BaseModel):
    entity_type: Literal["product", "page"] | None = None
    entity_id: str | None = None
    market: Market | None = None
    patch: dict | None = None
    command: str | None = None

    def to_command(self) -> str | dict:
        if self.command:
            return self.command
        if self.patch is not None:
            return {
                "entity_type": self.entity_type or "product",
                "entity_id": self.entity_id or "",
                "patch": self.patch,
                "market": self.market,
            }
        return ""


# ---------------- Company verify ----------------

class VerifyRequest(BaseModel):
    company: str = Field(min_length=1, max_length=255)
    contact: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=40)
    code: str = Field(default="", max_length=12)
    website: str = Field(default="", max_length=255)


# ---------------- 页面编辑器 ----------------

SectionType = Literal[
    "hero", "trust", "products", "applications", "capability", "cases", "cta", "custom"
]


class SectionInput(BaseModel):
    id: str = Field(default="", max_length=64)
    type: SectionType = "custom"
    label: str = Field(default="", max_length=128)
    props: dict = Field(default_factory=dict)


class PageCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    slug: str = Field(default="", max_length=128)
    sections: list[SectionInput] = Field(default_factory=list)
    is_home: bool = False
    seo_title: str = Field(default="", max_length=255)
    seo_description: str = Field(default="", max_length=1000)


class PageUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    slug: str | None = Field(default=None, max_length=128)
    sections: list[SectionInput] | None = None
    is_home: bool | None = None
    seo_title: str | None = Field(default=None, max_length=255)
    seo_description: str | None = Field(default=None, max_length=1000)


class PageAiRewriteRequest(BaseModel):
    """AI 改写页面区块文案。"""

    section_id: str = Field(default="", max_length=64)
    field: Literal["title", "subtitle", "description", "cta"] = "title"
    instruction: str = Field(default="", max_length=500)
    market: Market | None = None


# ---------------- 任务（跟进 / 增长） ----------------

TaskStatus = Literal["todo", "doing", "done"]
TaskKind = Literal["followup", "growth"]


class TaskCreate(BaseModel):
    kind: TaskKind = "followup"
    title: str = Field(min_length=1, max_length=255)
    detail: str = Field(default="", max_length=2000)
    inquiry_id: str = Field(default="", max_length=64)
    owner: str = Field(default="我", max_length=128)
    due_at: str = Field(default="", max_length=64)
    steps: list[dict] = Field(default_factory=list)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    detail: str | None = Field(default=None, max_length=2000)
    status: TaskStatus | None = None
    owner: str | None = Field(default=None, max_length=128)
    due_at: str | None = Field(default=None, max_length=64)
    progress: int | None = Field(default=None, ge=0, le=100)
    steps: list[dict] | None = None


# ---------------- 额度（Skill 用量） ----------------

class CreditConsumeRequest(BaseModel):
    skill: str = Field(min_length=1, max_length=255)
    cost: int = Field(default=0, ge=0, le=100000)
    note: str = Field(default="", max_length=255)


class CreditGrantRequest(BaseModel):
    amount: int = Field(gt=0, le=1000000)
    note: str = Field(default="套餐充值", max_length=255)


# ---------------- 批量导入产品 ----------------

class BulkImportItem(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    model: str = Field(default="", max_length=128)
    category: str = Field(default="", max_length=128)
    specs: list[str] = Field(default_factory=list)  # "Key: Value" 形式
    applications: list[str] = Field(default_factory=list)


class BulkImportRequest(BaseModel):
    items: list[BulkImportItem] = Field(min_length=1, max_length=200)


class XlsxParseRequest(BaseModel):
    """上传 .xlsx（base64）解析为待导入产品；可选直接落库。"""

    filename: str = Field(default="", max_length=255)
    content_base64: str = Field(min_length=1)
    sheet: str = Field(default="", max_length=128)
    commit: bool = False
    items: list[BulkImportItem] | None = None
