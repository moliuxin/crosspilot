# 前端 GitHub Pages 部署

## 公开访问

部署完成后，平台公开链接为：

```
https://<GitHub用户名>.github.io/<仓库名>/
```

## 公开链接能看到什么（Public Access 规则）

| 内容 | 未登录 | 说明 |
|---|---|---|
| 平台公开主页（模板商城） | ✅ | 无后端时的落地页，含平台简介 hero |
| 模板筛选 / 卡片 hover 整页滚动预览 | ✅ | 预览图为真实 Demo 截图（非 AI 概念图） |
| 模板 Demo 预览页 `/templates/:slug` | ✅ | 6 个模板各自渲染不同页面结构，标注 DEMO DATA |
| 登录 / 注册 | 需后端 | 静态部署无后端时提示离线模式并引导去模板商城 |
| 商家工作台（多站点 / 询盘 / SEO 等） | 需后端 + 登录 | 静态部署下自动降级，不白屏 |

## 部署方式（GitHub Actions 自动部署）

1. 推送到 `main` 分支即自动触发 `.github/workflows/deploy-pages.yml`：`npm ci → npm run build → deploy-pages`。
2. 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**（首次需手动设置一次，或用 gh 命令，见下）。
3. 后端地址通过仓库变量 `VITE_API_BASE`（Settings → Secrets and variables → Actions → Variables）注入，例如 `https://api.your-domain.com`；未设置时构建为静态演示模式。

> 前端使用 HashRouter + `vite base: './'`（相对路径），天然兼容 GitHub Pages 项目子路径，无需 404 重写。

## 命令速查（gh 已登录时）

```bash
# 启用 Actions 方式发布 Pages（等价于在 Settings 里选 GitHub Actions）
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow

# 手动触发一次部署
gh workflow run deploy-pages.yml

# 查看部署状态与最终 URL
gh run list --workflow=deploy-pages.yml --limit 1
gh api repos/<owner>/<repo>/pages --jq .html_url
```

## 本地开发 / 自托管完整版

```bash
# 后端（商家工作台需要）
cd backend && uvicorn app.main:app --port 8000

# 前端
npm install && npm run dev   # http://127.0.0.1:5173
```

自托管部署时设置 `VITE_API_BASE=https://<你的后端域名>` 重新构建，即可在公开链接上使用注册 / 登录与全部商家功能（多租户数据隔离由后端保证）。
