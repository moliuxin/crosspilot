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

ARG VITE_API_BASE=/
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:1.27-alpine

COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
