# CrossPilot Engineering Rules

Project:
CrossPilot——面向B2B企业出海的AI获客与转化智能体平台。

## Core Product Principle

Customer does not buy a website.
Customer buys overseas inquiries and trusted business opportunities.

Core flow:

被找到
→ 被理解
→ 被信任
→ 被询价

## Architecture

Frontend:
React + Vite

Backend:
FastAPI + SQLAlchemy

AI:
GLM-5.3 compatible LLM Provider

Image:
GLM-Image through ImageProvider

## User Model

One user may manage multiple Sites.

Never assume:
1 user = 1 website.

All site-specific entities must eventually support site_id.

## Public Access

Unauthenticated users can:

- visit homepage
- browse template marketplace
- open template previews

Authentication is required only when:

- applying template
- AI generating site
- managing a site
- using merchant backend

## Free Generation

Every account receives exactly:

1 free full AI website generation.

The entitlement is account-level,
NOT per-site.

Only consume the free generation after a successful generation transaction.

Failed generation must not consume entitlement.

## Multi-Site

After login, user lands on generic merchant Dashboard.

Do NOT automatically select or display one website name.

Specific sites are accessed from:

我的网站

A user may:
- create multiple sites
- select a site
- edit a site
- publish a site
- manage each site's language versions

## Navigation

Each top-level menu must have exactly one responsibility.

Final sidebar:

概览
我的网站
询盘
客户
SEO & GEO
AI增长
数据分析
模板商城
设置

Do NOT create duplicate entries such as:
网站
我的网站
页面编辑
页面内容

Page Editor lives inside a selected Site.

Products live inside a selected Site (我的网站 → 某网站 → 产品).

AI Brush lives inside Page Editor.

Buyer Persona and Buyer Conversion live inside AI增长.

Privacy and Policies live under 设置.

## Site Generation

User inputs:

product category
company information
target buyer
target markets
optional real product images

AI must create:

Industry Profile
Buyer Persona
Market Profile
Site Plan
Image Brief
market-specific copy
market-specific visual assets

## Product Images

Real uploaded product photos take priority.

AI-generated images may be used for:
Hero
application scenes
visual backgrounds
market atmosphere

AI must never fabricate:
certificates
customer cases
factory evidence
technical specifications
product labels

Assets must track source:
REAL
AI_GENERATED

## Market Localization

zh-CN / en-US / ru-RU are NOT translations.

Shared:
Product ID
SKU
technical facts

Market specific:
layout
copy
image style
CTA
FAQ
trust evidence presentation
content hierarchy

## AI Safety

All modification operations:

AI
→ Draft
→ Diff
→ Human Confirmation
→ Publish
→ Version

Never allow AI to directly overwrite published production pages.

## AI Brush

AI Brush is a paid capability.

Free users may see the feature,
but must be shown upgrade / Credits flow before use.

## Templates

Every template needs:

thumbnail
full-page preview
preview gallery
industry tags
market tags
style profile
demo snapshot
price

Template hover must animate through the full page preview.

Template preview must work without login.

Applying template requires authentication.

## Truthfulness

Never fake:

visitors
inquiries
conversion rate
customers
AI scores
revenue
legal compliance
performance improvements

Demo data must be labeled:
Demo / Test.

## Completion Definition

A feature is DONE only if it has:

frontend entry
backend API when required
DB persistence
refresh persistence
tenant/site permission
error handling
automated test
actual browser verification

Do not mark mock/static/toast-only behavior as DONE.

## Development Rule

Do not rewrite the project.

Make incremental migrations.

Preserve existing APIs when possible.

After every phase run:

pytest
npm run build
relevant E2E

Return:
changed files
test results
remaining issues
screenshots
