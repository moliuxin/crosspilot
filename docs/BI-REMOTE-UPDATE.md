# 商机 BI v5 — 服务器更新指引（crosspilot.faron.top）

本次更新把「商机 BI」升级为商业决策大屏：真实俄罗斯行政边界热力地图（geoBoundaries ADM1，
83 个联邦主体）、机会矩阵（竞争度×搜索量四象限）、采购意图分层（俄语标记词规则引擎）、
词形族聚合、产品价值评分、区域点击下钻，以及 **110 个真实 Wordstat 库关键词**（经 Bukvarix
API 拉取，随仓库 `docs/wordstat-real-data.sql` 交付）。

## 更新步骤（在服务器仓库目录执行）

```bash
git fetch origin
git checkout analysis/docker-compose-local-deploy
git pull origin analysis/docker-compose-local-deploy

# 重建并重启（前端在 web 镜像内构建，数据卷不受影响）
docker compose up -d --build
```

## 导入真实 BI 数据（可选但推荐，约 110 个关键词）

等 api 容器 healthy 后（新表 `wordstat_datasets` 由启动流程自动建好）：

```bash
docker compose exec -T db psql -U crosspilot -d crosspilot < docs/wordstat-real-data.sql
```

导入后打开大屏，行业下拉框最上方会出现三个 🔌 数据集：
「真实数据 · 协作机器人 / 工业设备 / 建材出口（Wordstat 库）」。

## 验证

1. 登录演示账号（demo@aquaflow-demo.com / demo-pass-123）
2. 左侧「AI 增长」→「商机 BI · 热词地图」（`/#/growth/bi-map`）
3. 应看到：真实俄罗斯地图（83 区域着色）、机会矩阵四象限、采购意图浓度指标卡；
   底部数据来源如实标注「预置演示 / Wordstat 库（Bukvarix）」口径

## 说明

- 竞争度（KD）列：Wordstat/Bukvarix 不提供 SERP 竞争度，导入数据以「搜索量分位代理」
  计算并在 `comp_source=volume_rank_proxy` 中如实标注；预置行业数据为演示口径。
- 近一年逐月趋势：Bukvarix 免费接口不含逐月历史；如需可在 Wordstat 网页版
  「История запроса」导出 CSV 后从页面「📥 导入」进入，趋势面板即显示真实月度曲线。
