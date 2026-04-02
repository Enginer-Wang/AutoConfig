# ⚡ Autoconfig - 极速静态网页托管平台

> 拖拽 HTML，秒变公网网站。一站式静态网页托管、模板商城、社区互动与在线代码编辑平台。

---

## 📖 项目简介

**Autoconfig** 是一个功能完备的静态网页托管平台，支持用户上传 ZIP 压缩包一键部署静态网站，内置在线代码编辑器、模板商城、社区广场、聊天系统和管理后台。适合个人开发者快速托管展示页面、小游戏、作品集等静态项目。

## 📖 项目在线预览

https://www.autoconfig.uno/

### ✨ 核心功能

| 模块 | 功能说明 |
|------|----------|
| 🚀 **一键部署** | 上传 ZIP 文件自动解压部署，支持自动检测入口文件 |
| ✏️ **在线编辑器** | 内置 HTML/CSS/JS 三栏编辑器，实时预览，一键发布 |
| 🏪 **模板商城** | 12+ 精选网站/游戏模板，金币系统解锁，获取源码自由修改 |
| 🌐 **社区广场** | 公开项目展示、点赞、评论，作品互相交流 |
| 💬 **聊天系统** | 私信聊天、联系作者、赠送金币 |
| 🪙 **金币系统** | 获赞兑换金币（5 赞 = 1 币），购买模板、赠送好友 |
| 🏆 **排行榜** | 项目访问量、点赞数、金币排行 |
| 👑 **管理后台** | 用户/项目/模板/评论全面 CRUD 管理 |
| 📱 **响应式设计** | 全平台适配，移动端友好 |

### 📸 页面一览

- `/` — 首页落地页
- `/login` `/register` — 登录注册
- `/dashboard` — 用户控制台（项目管理、上传部署）
- `/editor/:id` — 模板源码编辑器
- `/edit-project/:id` — 已部署项目源码编辑器
- `/templates` — 模板商城
- `/community` — 社区广场
- `/leaderboard` — 排行榜
- `/chat` `/chat/:username` — 聊天系统
- `/project/:username/:slug` — 项目展示页
- `/site/:username/:slug` — 部署站点访问
- `/admin` — 管理后台
- `/docs` — 使用文档
- `/about` — 关于页面

---

## 🛠 技术栈

### 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| **Node.js** | 18+ | 运行时环境 |
| **Express** | v5.x | Web 框架（使用 path-to-regexp v8+ 路由语法） |
| **better-sqlite3** | ^12.x | SQLite 数据库引擎，轻量高性能 |
| **JWT (jsonwebtoken)** | ^9.x | 用户认证，httpOnly Cookie，7 天有效期 |
| **bcryptjs** | ^3.x | 密码哈希加密 |
| **multer** | ^2.x | 文件上传处理（50MB 上限，仅 .zip） |
| **adm-zip** | ^0.5.x | ZIP 解压，支持自动过滤系统文件 |
| **cookie-parser** | ^1.4.x | Cookie 解析中间件 |

### 前端

| 技术 | 说明 |
|------|------|
| **原生 HTML/CSS/JS** | 零框架依赖，加载极速 |
| **CSS 变量系统** | 深色主题，统一设计语言 |
| **iframe srcdoc** | 编辑器实时预览 & 模板商城活体展示 |
| **Fetch API** | 统一接口调用封装 |

### 数据库结构（SQLite）

```
users            — 用户表（含金币、角色、头像、简介）
projects         — 项目表（名称、slug、文件数、大小、访问量）
likes            — 点赞表
comments         — 评论表
templates        — 模板表（HTML/CSS/JS 源码、价格、分类）
purchases        — 购买记录表
coin_transactions — 金币交易记录表
messages         — 聊天消息表（私信、赠送）
```

### 项目目录结构

```
Autoconfig/
├── server.js                 # 主入口，Express 服务器
├── package.json              # 依赖配置
├── src/
│   ├── database.js           # SQLite 初始化、建表、种子数据
│   ├── middleware/
│   │   └── auth.js           # JWT 认证中间件（auth/optional/admin）
│   └── routes/
│       ├── auth.js           # 注册、登录、退出、个人信息
│       ├── projects.js       # 项目 CRUD、ZIP 上传、部署、源码读取
│       ├── sites.js          # 已部署站点静态文件服务
│       ├── community.js      # 社区广场、点赞、评论
│       ├── store.js          # 模板商城、购买、金币兑换、排行榜
│       ├── chat.js           # 聊天系统、私信、赠送金币
│       └── admin.js          # 管理后台全面 CRUD
├── public/
│   ├── index.html            # 首页落地页
│   ├── login.html            # 登录页
│   ├── register.html         # 注册页
│   ├── dashboard.html        # 用户控制台
│   ├── editor.html           # 在线源码编辑器
│   ├── templates.html        # 模板商城
│   ├── community.html        # 社区广场
│   ├── leaderboard.html      # 排行榜
│   ├── chat.html             # 聊天系统
│   ├── project.html          # 项目展示页
│   ├── admin.html            # 管理后台
│   ├── docs.html             # 使用文档
│   ├── about.html            # 关于页面
│   ├── privacy.html          # 隐私政策
│   ├── 404.html              # 404 页面
│   ├── css/                  # 全局样式文件
│   ├── js/                   # 公共 JS 工具库
│   └── assets/               # 静态资源
└── data/                     # 运行时数据（自动生成）
    ├── autoconfig.db          # SQLite 数据库文件
    ├── uploads/               # 上传的 ZIP 临时文件
    └── sites/                 # 部署后的静态站点文件
        └── {username}/{slug}/ # 各用户各项目的文件目录
```

---

## 🚀 部署指南

### 环境要求

- **Node.js** >= 18.x（推荐 20.x LTS）
- **npm** >= 8.x
- 操作系统：Windows / macOS / Linux 均可

### 本地开发

```bash
# 1. 克隆项目
git clone https://github.com/your-repo/autoconfig.git
cd autoconfig

# 2. 安装依赖
npm install

# 3. 启动服务
npm start

# 4. 访问
# 主页: http://localhost:3000/
# 控制台: http://localhost:3000/dashboard
# 管理后台: http://localhost:3000/admin
```

首次启动会自动：
- 创建 `data/` 目录
- 初始化 SQLite 数据库，建立全部 8 张表
- 插入管理员账号和 12 个模板种子数据

### 默认账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 👑 管理员 | `admin` | `admin1234` |

> 管理员拥有无限金币和全部模板访问权限

### 生产部署

#### 方式一：直接部署

```bash
# 使用 PM2 守护进程
npm install -g pm2
pm2 start server.js --name autoconfig
pm2 save
pm2 startup
```

#### 方式二：Docker 部署

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t autoconfig .
docker run -d -p 3000:3000 -v ./data:/app/data autoconfig
```

#### 方式三：反向代理（Nginx）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }
}
```

### 环境变量（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务监听端口 |

---

## 📋 API 接口概览

### 认证 `/api/auth`
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/register` | 注册 |
| POST | `/login` | 登录 |
| POST | `/logout` | 退出 |
| GET | `/me` | 获取当前用户信息 |

### 项目 `/api/projects`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 我的项目列表 |
| POST | `/deploy` | 上传 ZIP 部署 |
| POST | `/deploy-template` | JSON 方式部署（编辑器用） |
| PUT | `/:id` | 更新项目信息 |
| DELETE | `/:id` | 删除项目 |
| GET | `/:id/source` | 获取项目源码（HTML/CSS/JS） |

### 社区 `/api/community`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects` | 公开项目列表 |
| GET | `/project/:user/:slug` | 项目详情 |
| POST | `/project/:id/like` | 点赞/取消点赞 |
| POST | `/project/:id/comment` | 发表评论 |

### 商城 `/api/store`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/list` | 模板列表（支持分类/难度/搜索） |
| GET | `/detail/:slug` | 模板详情 |
| POST | `/buy/:id` | 购买模板 |
| GET | `/source/:id` | 获取已购模板源码 |
| GET | `/coins` | 金币余额 |
| POST | `/coins/exchange` | 赞兑换金币 |

### 聊天 `/api/chat`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/conversations` | 会话列表 |
| GET | `/messages/:userId` | 消息记录 |
| POST | `/send` | 发送消息 |
| GET | `/unread` | 未读消息数 |
| POST | `/gift-coins` | 赠送金币 |

### 管理 `/api/admin`（需管理员）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET/PUT/DELETE | `/users` | 用户管理 |
| GET/DELETE | `/projects` | 项目管理 |
| GET/POST/PUT/DELETE | `/templates` | 模板管理 |

---

## 🔄 更新日志

### v1.0.0 (2026-04-02)

- ✅ 首页落地页与用户系统（注册/登录/JWT 认证）
- ✅ ZIP 上传部署，自动解压、过滤系统文件、检测入口文件
- ✅ 社区广场（公开项目展示、点赞、评论、访问统计）
- ✅ 模板商城（12 个种子模板、金币购买、分类筛选）
- ✅ 金币系统（获赞兑换、交易记录）
- ✅ 排行榜（访问量、点赞、金币排名）
- ✅ 在线代码编辑器（支持模板编辑 & 项目源码编辑、实时预览、一键发布）
- ✅ 管理后台（用户/项目/模板/评论 CRUD）
- ✅ 聊天系统（私信、联系作者、赠送金币）
- ✅ 导航栏聊天图标与未读消息徽章

---

## 🐛 已知问题与后续计划

### 已知问题

- 聊天系统采用轮询方式（每 3 秒），暂未实现 WebSocket 实时推送
- 编辑器为纯 textarea，无代码高亮与智能提示（后续考虑集成 Monaco Editor / CodeMirror）
- 模板商城卡片预览使用 iframe 缩放渲染，部分复杂模板可能存在样式偏差
- ZIP 上传仅支持单层或自动修正一层目录嵌套，深层嵌套目录结构可能需手动调整
- SQLite 为单文件数据库，高并发场景建议迁移 PostgreSQL / MySQL

### 后续更新计划

- [ ] 🔌 WebSocket 实时聊天（替换轮询）
- [ ] 🎨 集成 Monaco Editor 代码编辑器（语法高亮、智能补全）
- [ ] 🌍 自定义域名绑定
- [ ] 📊 项目访问统计面板（UV/PV、来源、地域）
- [ ] 🔐 HTTPS 支持 & SSL 证书自动签发
- [ ] 📦 支持更多部署方式（Git 仓库拉取、拖拽文件夹上传）
- [ ] 🤖 AI 辅助建站（自然语言生成页面）
- [ ] 👥 团队协作功能
- [ ] 🌐 国际化（i18n）多语言支持
- [ ] 📱 PWA 支持

---

## 📬 联系方式

如有问题、建议或合作意向，欢迎通过以下方式联系：

| 渠道 | 联系方式 |
|------|----------|
| 💬 **微信** | `wzy1079769401` |
| 📧 **QQ 邮箱** | [1079769401@qq.com](mailto:1079769401@qq.com) |
| 🐛 **Issue** | 欢迎在 GitHub Issues 中提交 Bug 反馈 |

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。

---

<p align="center">
  <b>⚡ Autoconfig</b> — 极速托管你的个人网页与项目<br>
  Made with ❤️ by Autoconfig Team
</p>

---

<br>

# ⚡ Autoconfig - Lightning-Fast Static Web Hosting Platform

> Drag & drop HTML, instantly go live. An all-in-one static web hosting, template marketplace, community, and online code editor platform.

---

## 📖 Introduction

**Autoconfig** is a full-featured static web hosting platform that allows users to upload ZIP archives for one-click deployment of static websites. It comes with a built-in online code editor, template marketplace, community hub, chat system, and admin dashboard. Perfect for individual developers to quickly host landing pages, mini-games, portfolios, and other static projects.

### ✨ Core Features

| Module | Description |
|--------|-------------|
| 🚀 **One-Click Deploy** | Upload ZIP files for automatic extraction and deployment, with auto-detection of entry files |
| ✏️ **Online Editor** | Built-in HTML/CSS/JS three-panel editor with live preview and one-click publish |
| 🏪 **Template Store** | 12+ curated website/game templates, unlock with coins, freely modify source code |
| 🌐 **Community Hub** | Public project showcase, likes, comments, and mutual interaction |
| 💬 **Chat System** | Private messaging, contact authors, gift coins |
| 🪙 **Coin System** | Exchange likes for coins (5 likes = 1 coin), buy templates, gift friends |
| 🏆 **Leaderboard** | Rankings by visits, likes, and coins |
| 👑 **Admin Panel** | Full CRUD management for users/projects/templates/comments |
| 📱 **Responsive Design** | Cross-platform compatible, mobile-friendly |

### 📸 Pages Overview

- `/` — Landing page
- `/login` `/register` — Login & Registration
- `/dashboard` — User dashboard (project management, upload & deploy)
- `/editor/:id` — Template source code editor
- `/edit-project/:id` — Deployed project source code editor
- `/templates` — Template store
- `/community` — Community hub
- `/leaderboard` — Leaderboard
- `/chat` `/chat/:username` — Chat system
- `/project/:username/:slug` — Project showcase page
- `/site/:username/:slug` — Deployed site access
- `/admin` — Admin panel
- `/docs` — Documentation
- `/about` — About page

---

## 🛠 Tech Stack

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 18+ | Runtime environment |
| **Express** | v5.x | Web framework (uses path-to-regexp v8+ routing syntax) |
| **better-sqlite3** | ^12.x | SQLite database engine, lightweight & high-performance |
| **JWT (jsonwebtoken)** | ^9.x | User authentication, httpOnly Cookie, 7-day expiry |
| **bcryptjs** | ^3.x | Password hashing |
| **multer** | ^2.x | File upload handling (50MB limit, .zip only) |
| **adm-zip** | ^0.5.x | ZIP extraction with automatic system file filtering |
| **cookie-parser** | ^1.4.x | Cookie parsing middleware |

### Frontend

| Technology | Description |
|------------|-------------|
| **Vanilla HTML/CSS/JS** | Zero framework dependencies, blazing fast loading |
| **CSS Custom Properties** | Dark theme, unified design language |
| **iframe srcdoc** | Editor live preview & template store live rendering |
| **Fetch API** | Unified API call wrapper |

### Database Schema (SQLite)

```
users            — Users (with coins, role, avatar, bio)
projects         — Projects (name, slug, file count, size, visits)
likes            — Likes
comments         — Comments
templates        — Templates (HTML/CSS/JS source, price, category)
purchases        — Purchase records
coin_transactions — Coin transaction history
messages         — Chat messages (private messages, gifts)
```

### Project Structure

```
Autoconfig/
├── server.js                 # Entry point, Express server
├── package.json              # Dependencies
├── src/
│   ├── database.js           # SQLite init, table creation, seed data
│   ├── middleware/
│   │   └── auth.js           # JWT auth middleware (auth/optional/admin)
│   └── routes/
│       ├── auth.js           # Register, login, logout, profile
│       ├── projects.js       # Project CRUD, ZIP upload, deploy, source reading
│       ├── sites.js          # Deployed site static file serving
│       ├── community.js      # Community hub, likes, comments
│       ├── store.js          # Template store, purchases, coin exchange, leaderboard
│       ├── chat.js           # Chat system, private messages, coin gifting
│       └── admin.js          # Admin panel full CRUD
├── public/
│   ├── index.html            # Landing page
│   ├── login.html            # Login page
│   ├── register.html         # Registration page
│   ├── dashboard.html        # User dashboard
│   ├── editor.html           # Online source code editor
│   ├── templates.html        # Template store
│   ├── community.html        # Community hub
│   ├── leaderboard.html      # Leaderboard
│   ├── chat.html             # Chat system
│   ├── project.html          # Project showcase
│   ├── admin.html            # Admin panel
│   ├── docs.html             # Documentation
│   ├── about.html            # About page
│   ├── privacy.html          # Privacy policy
│   ├── 404.html              # 404 page
│   ├── css/                  # Global stylesheets
│   ├── js/                   # Shared JS utilities
│   └── assets/               # Static resources
└── data/                     # Runtime data (auto-generated)
    ├── autoconfig.db          # SQLite database file
    ├── uploads/               # Uploaded ZIP temp files
    └── sites/                 # Deployed static site files
        └── {username}/{slug}/ # Per-user per-project file directories
```

---

## 🚀 Deployment Guide

### Requirements

- **Node.js** >= 18.x (20.x LTS recommended)
- **npm** >= 8.x
- OS: Windows / macOS / Linux

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/your-repo/autoconfig.git
cd autoconfig

# 2. Install dependencies
npm install

# 3. Start the server
npm start

# 4. Access
# Home: http://localhost:3000/
# Dashboard: http://localhost:3000/dashboard
# Admin: http://localhost:3000/admin
```

On first launch, the system will automatically:
- Create the `data/` directory
- Initialize the SQLite database with all 8 tables
- Seed the admin account and 12 template entries

### Default Accounts

| Role | Username | Password |
|------|----------|----------|
| 👑 Admin | `admin` | `admin1234` |

> The admin has unlimited coins and full access to all templates

### Production Deployment

#### Option 1: Direct Deployment

```bash
# Using PM2 process manager
npm install -g pm2
pm2 start server.js --name autoconfig
pm2 save
pm2 startup
```

#### Option 2: Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t autoconfig .
docker run -d -p 3000:3000 -v ./data:/app/data autoconfig
```

#### Option 3: Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }
}
```

### Environment Variables (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server listening port |

---

## 📋 API Overview

### Auth `/api/auth`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Register |
| POST | `/login` | Login |
| POST | `/logout` | Logout |
| GET | `/me` | Get current user info |

### Projects `/api/projects` (Auth required)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List my projects |
| POST | `/deploy` | Deploy via ZIP upload |
| POST | `/deploy-template` | Deploy via JSON (for editor) |
| PUT | `/:id` | Update project info |
| DELETE | `/:id` | Delete project |
| GET | `/:id/source` | Get project source code (HTML/CSS/JS) |

### Community `/api/community`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/projects` | List public projects |
| GET | `/project/:user/:slug` | Project details |
| POST | `/project/:id/like` | Like / Unlike |
| POST | `/project/:id/comment` | Post comment |

### Store `/api/store`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/list` | Template list (filter by category/difficulty/search) |
| GET | `/detail/:slug` | Template details |
| POST | `/buy/:id` | Purchase template |
| GET | `/source/:id` | Get purchased template source |
| GET | `/coins` | Coin balance |
| POST | `/coins/exchange` | Exchange likes for coins |

### Chat `/api/chat` (Auth required)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/conversations` | Conversation list |
| GET | `/messages/:userId` | Message history |
| POST | `/send` | Send message |
| GET | `/unread` | Unread message count |
| POST | `/gift-coins` | Gift coins |

### Admin `/api/admin` (Admin only)
| Method | Path | Description |
|--------|------|-------------|
| GET/PUT/DELETE | `/users` | User management |
| GET/DELETE | `/projects` | Project management |
| GET/POST/PUT/DELETE | `/templates` | Template management |

---

## 🔄 Changelog

### v1.0.0 (2026-04-02)

- ✅ Landing page & user system (register/login/JWT auth)
- ✅ ZIP upload deployment with auto-extraction, system file filtering, entry file detection
- ✅ Community hub (public project showcase, likes, comments, visit tracking)
- ✅ Template store (12 seed templates, coin purchases, category filtering)
- ✅ Coin system (like-to-coin exchange, transaction history)
- ✅ Leaderboard (visits, likes, coins rankings)
- ✅ Online code editor (template editing & project source editing, live preview, one-click publish)
- ✅ Admin panel (user/project/template/comment CRUD)
- ✅ Chat system (private messaging, contact author, coin gifting)
- ✅ Navigation chat icon with unread message badge

---

## 🐛 Known Issues & Roadmap

### Known Issues

- Chat system uses polling (every 3 seconds); WebSocket real-time push not yet implemented
- Editor is a plain textarea without syntax highlighting or IntelliSense (Monaco Editor / CodeMirror integration planned)
- Template store card previews use scaled iframe rendering; some complex templates may display with slight style differences
- ZIP upload only supports single-level or auto-corrected one-level nested directories; deeply nested structures may require manual adjustment
- SQLite is a single-file database; for high-concurrency scenarios, consider migrating to PostgreSQL / MySQL

### Roadmap

- [ ] 🔌 WebSocket real-time chat (replace polling)
- [ ] 🎨 Monaco Editor integration (syntax highlighting, IntelliSense)
- [ ] 🌍 Custom domain binding
- [ ] 📊 Project analytics dashboard (UV/PV, referrers, geography)
- [ ] 🔐 HTTPS support & automatic SSL certificate provisioning
- [ ] 📦 More deployment methods (Git repo pull, drag & drop folder upload)
- [ ] 🤖 AI-assisted site builder (natural language to page generation)
- [ ] 👥 Team collaboration features
- [ ] 🌐 Internationalization (i18n) multi-language support
- [ ] 📱 PWA support

---

## 📬 Contact

For questions, suggestions, or collaboration inquiries, feel free to reach out:

| Channel | Contact |
|---------|---------|
| 💬 **WeChat** | `wzy1079769401` |
| 📧 **QQ Email** | [1079769401@qq.com](mailto:1079769401@qq.com) |
| 🐛 **Issues** | Feel free to submit bug reports via GitHub Issues |

---

## 📄 License

This project is open-sourced under the [MIT License](LICENSE).

---

<p align="center">
  <b>⚡ Autoconfig</b> — Lightning-fast hosting for your personal web pages & projects<br>
  Made with ❤️ by Autoconfig Team
</p>
