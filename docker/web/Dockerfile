# CrossPilot 前端镜像：Node 构建 dist → nginx 托管
# 构建上下文 = 仓库根目录：
#   docker build -f docker/web/Dockerfile -t crosspilot-web .
# 默认无需业务构建参数：API 前缀由前端在运行时从页面地址推导（src/config/paths.js）
#
# 国内构建默认走 DaoCloud 镜像 + npmmirror；海外环境可通过 build args 覆盖。
ARG NODE_IMAGE=docker.m.daocloud.io/library/node:20-alpine
ARG NGINX_IMAGE=docker.m.daocloud.io/library/nginx:1.27-alpine

FROM ${NODE_IMAGE} AS build

ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /app

# lock 文件已入库：npm ci 保证依赖与本地一致
COPY package.json package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
    && npm config set replace-registry-host always \
    && npm ci --no-audit --no-fund

COPY vite.config.js index.html site-preview.html ./
COPY src ./src
COPY public ./public

# 可选构建期注入（默认留空 = 运行时从页面地址推导 API 前缀，见 src/config/paths.js）：
#   VITE_API_BASE       完整后端地址（跨域部署用）
#   VITE_API_BASE_PATH  同源 API 前缀（API 不挂在应用路径下时用，如 /backend-api）
#   VITE_DEMO_SITES_ENABLED  是否启用固定 slug 的 Skill 演示站（需导入演示数据库）
ARG VITE_API_BASE=""
ARG VITE_API_BASE_PATH=""
ARG VITE_DEMO_SITES_ENABLED="false"
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_API_BASE_PATH=$VITE_API_BASE_PATH \
    VITE_DEMO_SITES_ENABLED=$VITE_DEMO_SITES_ENABLED
RUN npm run build

FROM ${NGINX_IMAGE}

# 路径变量规范化（在官方 20-envsubst 模板渲染前运行）
COPY docker/web/15-base-path.sh /docker-entrypoint.d/15-base-path.sh
RUN chmod +x /docker-entrypoint.d/15-base-path.sh

COPY docker/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
