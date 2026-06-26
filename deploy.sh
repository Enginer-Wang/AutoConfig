#!/usr/bin/env bash
#
# Autoconfig 一键更新 / 运行脚本
# -----------------------------------------------------------------------------
# 功能：
#   - 首次运行自动克隆仓库；已存在则拉取最新代码
#   - 仅在依赖变化时执行 npm install（更快、更稳）
#   - 保留 data/ 目录（用户站点 + SQLite 数据库不丢失）
#   - 通过 PM2 守护进程启动 / 重启服务
#
# 用法：
#   bash deploy.sh                 # 使用默认配置
#   APP_DIR=/srv/app bash deploy.sh
#
# 也可远程一键执行：
#   curl -fsSL https://raw.githubusercontent.com/Enginer-Wang/AutoConfig/main/deploy.sh | bash
# -----------------------------------------------------------------------------

set -euo pipefail

# ---- 可配置项（支持环境变量覆盖）-------------------------------------------
APP_DIR="${APP_DIR:-/home/autoconfig}"
REPO_URL="${REPO_URL:-https://github.com/Enginer-Wang/AutoConfig.git}"
BRANCH="${BRANCH:-main}"
PM2_NAME="${PM2_NAME:-autoconfig}"
SITE_URL="${SITE_URL:-https://www.autoconfig.top}"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[deploy] 错误:\033[0m %s\n' "$*" >&2; exit 1; }

# ---- 前置依赖检查 -----------------------------------------------------------
command -v git  >/dev/null 2>&1 || die "未安装 git"
command -v node >/dev/null 2>&1 || die "未安装 node"
command -v npm  >/dev/null 2>&1 || die "未安装 npm"
command -v pm2  >/dev/null 2>&1 || die "未安装 pm2（请先执行: npm install -g pm2）"

# ---- 获取代码 ---------------------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  log "更新已存在的仓库：$APP_DIR"
  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  # 记录更新前后的依赖清单指纹，判断是否需要重装依赖
  OLD_LOCK="$(git rev-parse "HEAD:package-lock.json" 2>/dev/null || echo none)"
  OLD_PKG="$(git rev-parse "HEAD:package.json" 2>/dev/null || echo none)"
  git reset --hard "origin/$BRANCH"
  NEW_LOCK="$(git rev-parse "HEAD:package-lock.json" 2>/dev/null || echo none)"
  NEW_PKG="$(git rev-parse "HEAD:package.json" 2>/dev/null || echo none)"
else
  log "首次部署，克隆仓库到：$APP_DIR"
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
  OLD_LOCK="none"; OLD_PKG="none"
  NEW_LOCK="changed"; NEW_PKG="changed"  # 强制首次安装
fi

# ---- 安装依赖（仅在 package.json / lock 变化或缺少 node_modules 时）---------
if [ ! -d node_modules ] || [ "$OLD_LOCK" != "$NEW_LOCK" ] || [ "$OLD_PKG" != "$NEW_PKG" ]; then
  log "依赖发生变化，安装依赖中..."
  if [ -f package-lock.json ]; then
    npm ci || npm install
  else
    npm install
  fi
else
  log "依赖无变化，跳过 npm install"
fi

# ---- 确保数据目录存在（data/ 已被 .gitignore 忽略，更新不会覆盖）-----------
mkdir -p data

# ---- 启动 / 重启服务 --------------------------------------------------------
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  log "重启 PM2 进程：$PM2_NAME"
  pm2 restart "$PM2_NAME" --update-env
else
  log "首次启动 PM2 进程：$PM2_NAME"
  pm2 start server.js --name "$PM2_NAME"
fi

pm2 save

log "完成 ✅  访问：$SITE_URL"
