> **WorkBuddy 接续开发请先阅读：`WORKBUDDY_START_HERE.md`**
> 如需直接给 WorkBuddy 一段任务指令，使用：`WORKBUDDY_MASTER_PROMPT.txt`。

# WorkBuddy SitePilot — AI 独立站智能体 Demo

这是基于你上传的 `WorkBuddy 9.28` 网页快照重新整理的一套 **可运行、可演示、可继续开发** 的前端 Demo。

## 为什么没有直接修改原 ZIP 里的 JS？

原始 ZIP 主要由 WorkBuddy 页面导出的 `saved_resource.html` 与编译/缓存资源构成，并不是一个完整的 React/Vue 源码仓库。直接改压缩后的 JS 不利于维护。因此本 Demo 保留原方案中有价值的 **Skill 分层、多语言、询盘、主题与组件思想**，重新搭建为干净的静态工程。

## 直接运行

最简单：双击 `index.html`。

也可使用本地静态服务器：

```bash
python -m http.server 8080
```

然后访问 `http://localhost:8080/`。

## 已完成的 Demo 模块

- 1 秒品牌 Logo 进入动效
- 我的网站 / 数据总览
- 网站实时预览
- 产品中心
- 页面可视化编辑器 Demo（左组件 / 中画布 / 右属性）
- 询盘中心（仅 RFQ，不涉及支付、物流、购物车）
- AI 增长诊断
- Skill Center 与商业化入口
- 单产品 SEO / GEO 优化前后 Diff
- EN / RU / 中文三个市场差异化演示
- 免费完整生成一次 / 后续付费解锁的交互示意
- 专业服务付费入口示意

## 文件结构

```text
index.html                 平台后台 Demo
site-preview.html          客户独立站预览 Demo
assets/styles.css          平台 UI
assets/site.css            独立站 UI
assets/app.js              Demo 交互
reference/                 原 WorkBuddy 导出页面快照，仅供参考
docs/                      产品方案、开发路线、演示脚本
```

## 产品方向

核心定位：

**AI 快速建站入口 + 专业 SEO/GEO 持续优化 + B2B 询盘获客。**

商家前台只保留 5 个一级入口：

1. 我的网站
2. 产品中心
3. 页面内容
4. 询盘中心
5. AI 增长

高级能力集中到 Skill Center / SEO / GEO 二级页面，避免普通客户被技术细节淹没。

## 下一步接真实后端

建议把当前静态数据替换成 API / MCP：

- `get_site_pages`
- `get_products`
- `get_product_detail`
- `get_inquiries`
- `get_seo_metrics`
- `get_language_versions`
- `update_draft`
- `publish_page`
- `rollback_version`

并将 AI Skill 的输出统一成结构化 JSON，由页面组件直接消费。
