#!/bin/sh
# 计算部署子路径相关变量（在官方 20-envsubst-on-templates.sh 之前运行，供 nginx 模板注入）。
# 约定：外部统一 Nginx 不剥离子路径前缀，容器内收到完整路径。
set -e

# ---- APP_BASE_PATH → 目录形式（带且仅带一个尾斜杠）：/ 或 /crosspilot/ ----
APP="${APP_BASE_PATH:-/}"
case "$APP" in
  /*) ;;
  *) APP="/$APP" ;;
esac
APP=$(printf '%s' "$APP" | sed -e 's|//\+|/|g')
[ "$APP" = "//" ] && APP="/"
case "$APP" in
  */) ;;
  *) APP="$APP/" ;;
esac

# ---- APP_BASE_PATH_NO_SLASH：无尾斜杠形式；根部署用哨兵路径（避免 location = / 劫持首页）----
if [ "$APP" = "/" ]; then
  NO_SLASH="/__base_path_redirect_disabled__"
else
  NO_SLASH="${APP%/}"
fi

# ---- API_BASE_PATH → 目录形式（带尾斜杠）；留空 = ${APP_BASE_PATH}api/ ----
API="${API_BASE_PATH:-}"
if [ -z "$API" ]; then
  API="${APP}api"
else
  case "$API" in
    /*) ;;
    *) API="/$API" ;;
  esac
fi
API=$(printf '%s' "$API" | sed -e 's|//\+|/|g')
[ "$API" = "//" ] && API="/"
case "$API" in
  */) ;;
  *) API="$API/" ;;
esac

APP_BASE_PATH="$APP"
APP_BASE_PATH_NO_SLASH="$NO_SLASH"
API_BASE_PATH="$API"
export APP_BASE_PATH APP_BASE_PATH_NO_SLASH API_BASE_PATH
