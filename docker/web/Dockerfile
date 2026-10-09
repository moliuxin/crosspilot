# CrossPilot 前端镜像：Node 构建 dist → nginx 托管
# 构建上下文 = 仓库根目录：
#   docker build -f docker/web/Dockerfile -t crosspilot-web .
# VITE_API_BASE=/ 表示同源相对路径，由 nginx 把 /api 反代到 api 容器
FROM node:20-alpine AS build

WORKDIR /app

# 仓库暂无 package-lock.json，先 npm install；提交 lock 文件后可换成 npm ci
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY vite.config.js index.html site-preview.html ./
COPY src ./src
COPY public ./public

# 可选构建期注入（默认留空 = 运行时从页面地址推导 API 前缀，见 src/config/paths.js）：
#   VITE_API_BASE       完整后端地址（跨域部署用）
#   VITE_API_BASE_PATH  同源 API 前缀（API 不挂在应用路径下时用，如 /backend-api）
ARG VITE_API_BASE=""
ARG VITE_API_BASE_PATH=""
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_API_BASE_PATH=$VITE_API_BASE_PATH
RUN npm run build

FROM nginx:1.27-alpine

# 路径变量规范化（在官方 20-envsubst 模板渲染前运行）
COPY docker/web/15-base-path.sh /docker-entrypoint.d/15-base-path.sh
RUN chmod +x /docker-entrypoint.d/15-base-path.sh

COPY docker/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
