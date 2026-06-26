# ⚡ Autoconfig - 极速静态网页托管平台

> 一站式教育互动平台 — 静态网页托管、班级管理、作业系统、即时测验、协作编程、自动批改、学情分析、模板商城与社区互动。

---

## 📖 项目简介

**Autoconfig** 是一个面向教育场景的全功能互动平台，集静态网页托管、班级与学生管理、作业发布批改、即时测验、协作编程、代码回放、自动化测试、学情分析、在线直播课堂与数字巡课墙、课堂互动聊天室、课件展示、模板商城、社区广场、教学 IM 系统（含好友系统）和管理后台于一体。适合教师创建互动课件并管理班级教学，也适合学生展示个人项目和参与学习互动。

## 📖 项目在线预览

https://www.autoconfig.uno/

### ✨ 核心功能

| 模块 | 功能说明 |
|------|----------|
| 🚀 **一键部署** | 上传 ZIP 文件自动解压部署，支持自动检测入口文件 |
| ✏️ **在线编辑器** | 内置 HTML/CSS/JS 三栏编辑器，实时预览，一键发布 |
| 👥 **班级管理** | 创建/加入班级、邀请码机制、协作教师、学生管理、考勤签到、分组引擎、数据分析可视化 |
| 📝 **作业系统** | 钉钉风格作业中心，多模式切换（待批改/已批改/待完成等），文件上传，多维度评分，代码批注，催交提醒，查重报告 |
| 📢 **班级公告** | 教师发布普通/紧急公告、学生控制台实时展示 |
| 🎯 **即时测验** | 限时选择题、代码填空、单元测试，实时判分，成绩自动写入成绩册 |
| 🤖 **自动化测试** | DOM 结构检查、自动判分、HTML/CSS/JS 语法检测、lint 报告 |
| 👀 **互评系统** | 匿名互评分配、评分检查清单、综合加权成绩 |
| 🔄 **协作编程** | Yjs CRDT 实时协同，师生结对编程，教师远程进入学生编辑器，会话码加入 |
| 🎥 **直播课堂** | WebRTC 屏幕共享直播、数字巡课墙（实时网格监控）、专注度监测、一键呼叫老师、远程接管、结课质量报告 |
| 💬 **课堂聊天室** | 绑定班级的永久聊天室、Markdown/代码/图片/语音、表态回复、弹幕模式、全员/单人禁言、DING 强提醒、签到/投票活动柱状图、课堂活跃度分析 |
| ⏪ **代码回放** | 按键轨迹记录，编码过程回放，"直接粘贴"检测，代码活跃度统计 |
| 📊 **学情分析** | 代码活跃度热力图（GitHub 绿墙风格）、学业危机预警、学生能力五维雷达画像、动态分组引擎 |
| 📈 **教师数据大屏** | 作业完成度漏斗、成绩正态分布直方图、学生画像预警、知识点掌握度 |
| 🪙 **积分银行** | 金币任务系统（每日签到、连续提交等 8 种任务）、积分商店（迟交券/重做卡/装饰等 6 种道具）、道具使用效果 |
| 🏪 **模板商城** | 12+ 精选网站/游戏模板，金币系统解锁，获取源码自由修改 |
| 🌐 **社区广场** | 公开项目展示、点赞、评论，作品互相交流 |
| 💬 **教学 IM 系统** | 私信/班级群/小组群/答疑工单、好友查询添加、悬赏提问、抢答/签到活动、消息打赏、答疑排行榜、WebSocket 实时推送 |
| 🏆 **排行榜** | 项目访问量、点赞数、金币排行 |
| 👑 **管理后台** | 用户/项目/模板/评论/角色全面 CRUD 管理、教师注册邀请码管理 |
| 🎟️ **教师邀请码** | 教师注册需管理员提供的邀请码验证，支持次数上限/有效期/启用停用 |
| 📱 **响应式设计** | 全平台适配，移动端友好 |

### 📸 页面一览

- `/` — 首页落地页
- `/login` `/register` — 登录注册
- `/dashboard` — 用户控制台（项目管理、上传部署、学生学习概览）
- `/teacher-dashboard` — 教师数据大屏（完成度漏斗、成绩分布、学生预警）
- `/classes` — 班级管理（总览、学生管理、公告、考勤、分组、数据分析）
- `/class-analytics` — 学情看板（活跃度热力图、危机预警、能力画像雷达图）
- `/homework` — 作业中心（发布/提交/批改/编辑/删除/催交/查重）
- `/grading-workspace` — 批改工作台（多维度评分、代码逐行批注、查重报告）
- `/instant-quiz` — 即时测验（限时选择题、代码填空、实时判分）
- `/live-console` — 教师数字巡课墙（实时网格监控、屏幕共享、远程接管、结课报告）
- `/live-classroom` — 学生直播课堂（观看直播、编辑器、专注度监控、呼叫老师）
- `/editor/:id` — 模板源码编辑器
- `/edit-project/:id` — 已部署项目源码编辑器
- `/templates` — 模板商城
- `/community` — 社区广场
- `/leaderboard` — 排行榜
- `/subjects` — 学科课件浏览
- `/chat` `/chat/:username` — 教学 IM 系统（含好友查询添加、直播课堂跳转）
- `/project/:username/:slug` — 项目展示页
- `/site/:username/:slug` — 部署站点访问
- `/admin` — 管理后台（用户/项目/模板/评论管理）
- `/stats` — 统计页面
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
| **multer** | ^2.x | 文件上传处理（50MB ZIP + 20MB 作业附件） |
| **adm-zip** | ^0.5.x | ZIP 解压，支持自动过滤系统文件 |
| **cookie-parser** | ^1.4.x | Cookie 解析中间件 |
| **ws** | ^8.x | WebSocket 实时通讯（聊天、抢答、签到、协作编程） |

### 前端

| 技术 | 说明 |
|------|------|
| **原生 HTML/CSS/JS** | 零框架依赖，加载极速 |
| **CSS 变量系统** | 深色主题，统一设计语言 |
| **iframe srcdoc** | 编辑器实时预览 & 模板商城活体展示 |
| **Fetch API** | 统一接口调用封装 |
| **SPA 平滑导航** | 页面间过渡动画（淡入淡出 + 顶部加载条），统一导航栏渲染 |

### 数据库结构（SQLite，40+ 张表）

**核心表**
```
users                    — 用户表（含金币、角色、头像、简介、学校）
projects                 — 项目表（名称、slug、文件数、大小、访问量、学段、学科）
likes                    — 点赞表
comments                 — 评论表
templates                — 模板表（HTML/CSS/JS 源码、价格、分类）
purchases                — 购买记录表
coin_transactions        — 金币交易记录表
exercise_records         — 练习记录表（得分、关卡、用时）
```

**班级与教学**
```
classes                  — 班级表（名称、学科、学段、邀请码）
class_members            — 班级成员表（student / co_teacher 角色）
homework                 — 作业表（标题、描述、截止日期、满分、类型、多维度评分维度）
homework_submissions     — 作业提交表（内容、附件、得分、评语、状态）
homework_dimension_scores — 多维度分项评分
homework_reminders       — 作业催交记录
announcements            — 班级公告表（标题、内容、优先级）
attendance               — 考勤签到
attendance_records       — 签到记录
student_groups           — 学生分组
group_members            — 分组成员
group_configs            — 分组策略配置
gradebook                — 统一成绩册（跨来源成绩汇总：作业/测验/互评）
```

**代码与批改**
```
code_annotations         — 代码逐行批注
plagiarism_reports       — 查重报告
code_keystrokes          — 代码回放轨迹（按键记录）
code_activity            — 代码活跃度（GitHub 绿墙风格）
collab_sessions          — 协作编程会话
collab_participants      — 协作参与者
auto_test_results        — 自动化测试结果
peer_review_assignments  — 互评分配
lint_reports             — 语法检测报告
```

**即时测验**
```
instant_quizzes          — 即时测验/限时练
quiz_questions           — 测验题目（MCQ/代码填空/单元测试）
quiz_responses           — 学生作答记录
code_fill_assignments    — 代码填空作业
code_fill_submissions    — 代码填空提交
```

**学情分析**
```
student_risk_alerts      — 学业危机预警
student_ability_profiles — 学生能力画像（五维雷达）
```

**积分与商店**
```
coin_items               — 积分商店道具（迟交券/重做卡/装饰等）
user_items               — 用户道具持有
coin_missions            — 金币任务/成就（8 种任务类型）
user_mission_progress    — 用户任务进度
```

**教学 IM 系统**
```
chat_rooms               — 聊天房间（私信/班级群/小组群/答疑 Ticket）
chat_room_members        — 房间成员
chat_messages            — 群组消息（支持代码片段/Markdown/系统消息）
chat_message_reactions   — 消息表态（+1/赞/懂了）
chat_tickets             — 答疑工单
chat_bounties            — 金币悬赏提问
chat_activities          — 课堂抢答/签到/投票活动
chat_activity_responses  — 活动参与记录
chat_tips                — 消息打赏
chat_helper_stats        — 答疑排行榜统计
friendships              — 好友关系（申请/接受/双向查询）
messages                 — 私信消息（向下兼容）
```

**直播课堂与巡课**
```
live_sessions            — 直播课堂会话（开课/下课）
live_participants        — 课堂参与者
live_student_status      — 学生实时状态（专注度/编码活跃度）
live_help_requests       — 一键呼叫老师求助
live_interventions       — 教师介入/接管记录
```

**系统管理**
```
teacher_invite_codes     — 教师注册邀请码（管理员编辑提供，次数/有效期/启用控制）
```

### 项目目录结构

```
Autoconfig/
├── server.js                 # 主入口，Express 服务器
├── package.json              # 依赖配置
├── src/
│   ├── database.js           # SQLite 初始化、建表（40+ 张表）、迁移、种子数据
│   ├── seedCourseware.js     # 学科课件种子数据
│   ├── websocket.js          # WebSocket 服务（聊天/抢答/签到/协作/打赏推送）
│   ├── middleware/
│   │   └── auth.js           # JWT 认证中间件（auth/optional/admin）
│   └── routes/
│       ├── auth.js           # 注册、登录、退出、个人信息
│       ├── projects.js       # 项目 CRUD、ZIP 上传、部署、源码读取
│       ├── sites.js          # 已部署站点静态文件服务
│       ├── community.js      # 社区广场、点赞、评论
│       ├── store.js          # 模板商城、购买、金币兑换、排行榜
│       ├── chat.js           # 教学 IM（房间/群组/答疑工单/悬赏/抢答/签到/打赏/好友）
│       ├── classroomChat.js  # 课堂聊天室（绑定班级永久聊天室、弹幕、表态、签到投票）
│       ├── live.js           # 直播课堂与数字巡课墙（开课/巡课/接管/结课报告）
│       ├── classes.js        # 班级管理、成员、公告、考勤、分组、数据分析
│       ├── homework.js       # 作业发布、提交、批改、催交、文件上传
│       ├── exercises.js      # 练习记录、排名
│       ├── subjects.js       # 学科课件浏览
│       ├── dashboard.js      # 教师数据大屏（漏斗/分布/预警/掌握度）
│       ├── collab.js         # 协作编程（Yjs CRDT、师生结对、远程编辑）
│       ├── playback.js       # 代码回放（按键轨迹、粘贴检测、活跃度统计）
│       ├── autograde.js      # 自动化测试、互评分配、语法检测
│       ├── gamification.js   # 积分银行（任务系统、道具商店、道具使用）
│       ├── classAnalytics.js # 学情管理（热力图/预警/画像/分组引擎）
│       ├── instantAssignment.js # 即时测验（MCQ/代码填空/限时练/实时判分）
│       └── admin.js          # 管理后台全面 CRUD
├── public/
│   ├── index.html            # 首页落地页
│   ├── login.html            # 登录页
│   ├── register.html         # 注册页
│   ├── dashboard.html        # 用户控制台
│   ├── teacher-dashboard.html # 教师数据大屏
│   ├── editor.html           # 在线源码编辑器
│   ├── templates.html        # 模板商城
│   ├── community.html        # 社区广场
│   ├── leaderboard.html      # 排行榜
│   ├── chat.html             # 教学 IM 系统（含好友系统、直播跳转）
│   ├── live-console.html     # 教师数字巡课墙
│   ├── live-classroom.html   # 学生直播课堂
│   ├── project.html          # 项目展示页
│   ├── classes.html          # 班级管理（侧边栏 + 多标签页）
│   ├── class-analytics.html  # 学情看板（热力图/预警/雷达图）
│   ├── homework.html         # 作业中心（钉钉风格）
│   ├── grading-workspace.html # 批改工作台
│   ├── instant-quiz.html     # 即时测验
│   ├── subjects.html         # 学科课件
│   ├── stats.html            # 统计页面
│   ├── admin.html            # 管理后台
│   ├── docs.html             # 使用文档
│   ├── about.html            # 关于页面
│   ├── privacy.html          # 隐私政策
│   ├── 404.html              # 404 页面
│   ├── css/                  # 全局样式文件
│   ├── js/
│   │   ├── common.js         # 统一导航栏、SPA 过渡、API 封装、工具函数
│   │   ├── classroom-chat.js # 课堂聊天面板共享模块（师生复用）
│   │   └── main.js           # 首页动画脚本
│   └── assets/               # 静态资源
└── data/                     # 运行时数据（自动生成）
    ├── autoconfig.db          # SQLite 数据库文件
    ├── uploads/               # 上传文件
    │   └── homework/          # 作业附件上传目录
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
# 教师大屏: http://localhost:3000/teacher-dashboard
# 管理后台: http://localhost:3000/admin
```

首次启动会自动：
- 创建 `data/` 目录
- 初始化 SQLite 数据库，建立全部 40+ 张表
- 运行数据库迁移（自动添加新列/新表）
- 插入管理员账号、12 个模板种子数据、13 个学科示例课件教师
- 启动 WebSocket 实时通讯服务

### 默认账号

| 角色 | 用户名 | 密码 | 说明 |
|------|--------|------|------|
| 👑 管理员 | `admin` | `admin1234` | 无限金币，全部权限 |
| 👨‍🏫 教师（示例） | `teacher_wuli` | `teacher123` | 可创建班级、发布作业 |

> 系统支持 4 种角色：`admin`（管理员）、`teacher`（教师）、`student`（学生）、`user`（普通用户）
>
> ⚠️ **教师注册需邀请码**：教师身份注册必须填写由管理员在后台「🎟️ 教师邀请码」页生成的有效邀请码；学生注册无需邀请码。

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

    # WebSocket 支持
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

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
| POST | `/register` | 注册（教师需提供有效邀请码） |
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
| GET | `/rooms` | 聊天房间列表 |
| POST | `/rooms` | 创建房间（班级群/小组群） |
| GET | `/rooms/:id/messages` | 房间消息记录 |
| POST | `/rooms/:id/messages` | 发送房间消息 |
| POST | `/tickets` | 创建答疑工单 |
| POST | `/bounties` | 发布悬赏提问 |
| POST | `/activities` | 发起抢答/签到活动 |
| POST | `/tips` | 消息打赏 |
| GET | `/users/search` | 搜索用户（附带好友状态） |
| POST | `/friends/request` | 发起好友申请 |
| GET | `/friends/requests` | 好友请求收/发件箱 |
| POST | `/friends/respond` | 接受/拒绝好友请求 |
| GET | `/friends` | 好友列表 |
| DELETE | `/friends/:userId` | 删除好友 |

### 课堂聊天室 `/api/classroom-chat`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/room/:id/messages` | 聊天室消息记录 |
| POST | `/room/:id/message` | 发送消息（文本/代码/图片/语音） |
| POST | `/message/:id/reaction` | 表态回复（+1/赞/懂了） |
| POST | `/room/:id/activity` | 发起签到/投票 |
| POST | `/activity/:id/respond` | 签到/投票（支持改票） |
| POST | `/activity/:id/end` | 结束活动 |
| GET | `/room/:id/analytics` | 课堂活跃度分析 |

### 直播课堂 `/api/live`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/start` | 开课（教师） |
| POST | `/end` | 下课并生成质量报告 |
| POST | `/join` | 进入课堂（学生） |
| POST | `/heartbeat` | 专注度/状态心跳 |
| POST | `/help` | 一键呼叫老师 |
| GET | `/wall/:sessionId` | 数字巡课墙（动态排序） |
| POST | `/takeover` | 教师远程接管学生 |
| GET | `/active` | 查询进行中的直播 |

### 班级 `/api/classes`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/my` | 我的班级列表 |
| POST | `/create` | 创建班级（教师） |
| POST | `/join` | 加入班级（邀请码） |
| GET | `/student/overview` | 学生学习概览 |
| GET | `/:id` | 班级详情（成员、统计） |
| PUT | `/:id` | 编辑班级信息 |
| DELETE | `/:id` | 删除班级 |
| PUT | `/:id/member/:userId/role` | 修改成员角色 |
| DELETE | `/:id/member/:userId` | 移除成员 |
| POST | `/:id/regenerate-code` | 重新生成邀请码 |
| GET | `/:id/analytics` | 班级数据分析 |
| GET | `/:id/announcements` | 班级公告列表 |
| POST | `/:id/announcements` | 发布公告 |
| DELETE | `/:id/announcements/:annId` | 删除公告 |

### 作业 `/api/homework`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/my` | 我的作业列表 |
| POST | `/create` | 发布作业（教师，支持附件） |
| GET | `/:id` | 作业详情 |
| PUT | `/:id` | 编辑作业（教师） |
| DELETE | `/:id` | 删除作业（教师） |
| POST | `/:id/submit` | 提交作业（学生，支持文件上传） |
| POST | `/:id/grade` | 批改作业（教师） |
| POST | `/:id/remind` | 催交作业（教师） |
| POST | `/upload` | 上传作业附件（20MB 限制） |

### 即时测验 `/api/instant`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/quiz` | 创建即时测验（MCQ/代码填空/单元测试） |
| GET | `/quiz/:id` | 获取测验详情与题目 |
| POST | `/quiz/:id/respond` | 学生作答 |
| GET | `/quiz/:id/results` | 测验结果统计 |
| POST | `/code-fill` | 创建代码填空作业 |
| POST | `/code-fill/:id/submit` | 提交代码填空 |

### 自动化测试 `/api/autograde`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/:submissionId/run` | 运行自动化 DOM 测试 |
| GET | `/:submissionId/results` | 获取测试结果 |
| POST | `/:homeworkId/peer-review` | 启动互评分配 |
| GET | `/peer-review/:assignmentId` | 获取互评任务 |
| POST | `/peer-review/:assignmentId/submit` | 提交互评打分 |
| POST | `/:submissionId/lint` | 运行语法检测 |

### 协作编程 `/api/collab`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/sessions` | 创建协作会话 |
| POST | `/sessions/join` | 通过会话码加入 |
| GET | `/sessions/:id` | 获取会话详情 |
| POST | `/sessions/:id/enter` | 教师远程进入学生编辑器 |

### 代码回放 `/api/playback`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/keystrokes` | 上报按键轨迹 |
| GET | `/:submissionId` | 获取编码过程回放数据 |
| GET | `/:submissionId/analysis` | 粘贴行为检测分析 |
| GET | `/activity/:userId` | 代码活跃度统计 |

### 学情分析 `/api/class-analytics`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/:classId/heatmap` | 代码活跃度热力图 |
| GET | `/:classId/risk-alerts` | 学业危机预警列表 |
| GET | `/:classId/ability-profiles` | 学生能力画像（五维雷达） |
| POST | `/:classId/auto-group` | 动态分组引擎 |

### 教师数据大屏 `/api/dashboard`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/overview` | 教师总览数据 |
| GET | `/homework-funnel` | 作业完成度漏斗 |
| GET | `/score-distribution` | 成绩正态分布直方图 |
| GET | `/student-portraits` | 学生画像预警 |
| GET | `/knowledge-mastery` | 知识点掌握度 |

### 积分银行 `/api/gamification`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/missions` | 可用任务列表 |
| POST | `/missions/:id/claim` | 领取任务奖励 |
| GET | `/shop` | 积分商店道具列表 |
| POST | `/shop/:itemId/buy` | 购买道具 |
| GET | `/inventory` | 我的道具背包 |
| POST | `/inventory/:itemId/use` | 使用道具 |

### 练习 `/api/exercises`（需登录）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/submit` | 提交练习记录 |
| GET | `/my` | 我的练习记录 |
| GET | `/ranking/:projectId` | 项目练习排名 |
| GET | `/report` | 练习报告 |

### 管理 `/api/admin`（需管理员）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET/PUT/DELETE | `/users` | 用户管理（支持角色筛选） |
| GET/DELETE | `/projects` | 项目管理 |
| GET/POST/PUT/DELETE | `/templates` | 模板管理 |
| GET/POST/PUT/DELETE | `/invite-codes` | 教师注册邀请码管理 |

### WebSocket `/ws`
| 事件 | 说明 |
|------|------|
| `join_room` | 加入聊天房间 |
| `room_message` | 房间消息推送 |
| `typing` | 打字状态广播 |
| `online_status` | 在线状态推送 |
| `activity_start` | 抢答/签到活动实时通知 |
| `activity_response` | 活动参与结果推送 |
| `tip_animation` | 打赏动效广播 |
| `collab_sync` | 协作编程实时同步 |
| `live_status` | 巡课墙学生状态实时增量 |
| `webrtc_signal` | 直播 WebRTC 信令中继 |
| `chat_activity_update` | 课堂签到/投票柱状图实时更新 |
| `friend_request` / `friend_accepted` | 好友请求/通过实时提醒 |

---

## 🔄 更新日志

### v3.1.0 (2026-06-04)

**直播课堂、聊天室与社交增强**
- ✅ 在线直播课堂 + 数字巡课墙（WebRTC 屏幕共享、实时网格监控、专注度检测、一键呼叫老师、远程接管、结课质量报告）
- ✅ 课堂互动聊天室（绑定班级永久聊天室、Markdown/代码/图片/语音、表态回复、引用回复、撤回、置顶、公告、弹幕模式、全员/单人禁言、DING 强提醒、敏感词过滤、发言限流）
- ✅ 签到/投票活动卡片（实时柱状图、支持改票、课堂活跃度分析）
- ✅ 好友系统（用户搜索、发起/接受/拒绝请求、好友列表、一键私聊、WebSocket 实时提醒）
- ✅ 聊天页与直播课堂双向跳转联动（班级群一键进入直播）
- ✅ 教师注册邀请码验证（管理后台编辑提供、次数上限/有效期/启用停用）
- ✅ 错题本（错题归集、掌握度状态机、智能重练、班级高频错题讲评）
- ✅ 管理后台用户编辑增强（可修改密码/姓名/角色/金币/头像等全部字段）

### v3.0.0 (2026-05-15)

**教学功能全面升级**
- ✅ 钉钉风格作业中心重构（多模式切换、侧边栏导航、拖拽文件上传、批改驳回、催交提醒）
- ✅ 即时测验系统（限时 MCQ、代码填空、单元测试、实时判分、成绩册自动写入）
- ✅ 自动化测试引擎（DOM 结构检查、自动判分、HTML/CSS/JS 语法检测）
- ✅ 互评系统（匿名分配、评分检查清单、综合加权成绩）
- ✅ 协作编程（Yjs CRDT 实时协同、师生结对编程、教师远程进入学生编辑器）
- ✅ 代码回放（按键轨迹记录、编码过程回放、"直接粘贴"检测、活跃度统计）
- ✅ 学情分析看板（代码活跃度热力图、学业危机预警、学生五维能力画像、动态分组引擎）
- ✅ 教师数据大屏（作业完成度漏斗、成绩正态分布、学生画像预警、知识点掌握度）
- ✅ 积分银行系统（8 种金币任务、6 种道具商店、道具使用效果）
- ✅ 教学 IM 全面升级（房间/群组/答疑工单/悬赏/抢答/签到/打赏/答疑排行榜）
- ✅ WebSocket 实时通讯（`ws` 库，替代轮询）
- ✅ 高级批改工作台（多维度分项评分、代码逐行批注、查重报告）
- ✅ 考勤签到系统、作业催交功能
- ✅ 分层分组引擎（自由/均衡分组策略）
- ✅ 统一成绩册（跨来源成绩汇总：作业/测验/互评）
- ✅ 统一导航栏渲染（12 个公共页面一致导航，SPA 平滑过渡动画）

### v2.0.0 (2026-05-01)

- ✅ 班级管理系统（创建/加入/邀请码/协作教师/成员管理）
- ✅ 作业系统（发布/提交/批改/编辑/删除/成绩统计）
- ✅ 班级公告系统（普通/紧急公告、教师发布、学生查看）
- ✅ 学生学习概览面板（作业进度环形图、最近成绩、公告通知）
- ✅ 班级数据分析可视化（成绩分布、作业趋势、学生活跃度图表）
- ✅ 练习记录与排行榜系统
- ✅ 多角色支持（admin/teacher/student/user）
- ✅ 管理后台角色筛选与编辑增强
- ✅ 导航栏退出按钮
- ✅ 学科课件种子数据（13 个学科示例课件）

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

- 编辑器为纯 textarea，无代码高亮与智能提示（后续考虑集成 Monaco Editor / CodeMirror）
- 模板商城卡片预览使用 iframe 缩放渲染，部分复杂模板可能存在样式偏差
- ZIP 上传仅支持单层或自动修正一层目录嵌套，深层嵌套目录结构可能需手动调整
- SQLite 为单文件数据库，高并发场景建议迁移 PostgreSQL / MySQL

### 后续更新计划

- [ ] 🎨 集成 Monaco Editor 代码编辑器（语法高亮、智能补全）
- [ ] 🌍 自定义域名绑定
- [ ] 📊 项目访问统计面板（UV/PV、来源、地域）
- [ ] 🔐 HTTPS 支持 & SSL 证书自动签发
- [ ] 📦 支持更多部署方式（Git 仓库拉取、拖拽文件夹上传）
- [ ] 🤖 AI 辅助建站（自然语言生成页面）
- [ ] 📅 课程表与日程安排
- [ ] 🌐 国际化（i18n）多语言支持
- [ ] 📱 PWA 支持
- [ ] 📹 教学视频录播/直播集成


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

# ⚡ Autoconfig - Lightning-Fast Static Web Hosting & Education Platform

> An all-in-one education platform — static web hosting, class management, homework system, instant quizzes, collaborative coding, auto-grading, learning analytics, template marketplace, and community hub.

---

## 📖 Introduction

**Autoconfig** is a comprehensive education-oriented interactive platform integrating static web hosting, class & student management, homework grading, instant quizzes, collaborative coding, code playback, automated testing, learning analytics, courseware display, template marketplace, community hub, teaching IM system, and admin dashboard. Built for teachers to create interactive courseware and manage classes, and for students to showcase projects and engage in learning.

### ✨ Core Features

| Module | Description |
|--------|-------------|
| 🚀 **One-Click Deploy** | Upload ZIP files for automatic extraction and deployment with entry file auto-detection |
| ✏️ **Online Editor** | Built-in HTML/CSS/JS three-panel editor with live preview and one-click publish |
| 👥 **Class Management** | Create/join classes, invite codes, co-teachers, student management, attendance, grouping, analytics |
| 📝 **Homework System** | DingTalk-style homework center with mode switching, file upload, multi-dimensional grading, code annotations, reminders, plagiarism detection |
| 🎯 **Instant Quizzes** | Timed MCQ, code fill-in-the-blank, unit tests, real-time scoring, auto gradebook entry |
| 🤖 **Auto-Grading** | DOM structure checks, auto-scoring, HTML/CSS/JS linting, lint reports |
| 👀 **Peer Review** | Anonymous peer review assignment, scoring checklists, weighted composite grades |
| 🔄 **Collaborative Coding** | Yjs CRDT real-time sync, teacher-student pair programming, remote editor access |
| ⏪ **Code Playback** | Keystroke recording, coding process replay, paste detection, activity statistics |
| 📊 **Learning Analytics** | Code activity heatmap (GitHub-style), academic risk alerts, five-dimensional ability radar, dynamic grouping engine |
| 📈 **Teacher Dashboard** | Homework completion funnel, grade distribution histogram, student portrait alerts |
| 🪙 **Coin Bank** | Coin mission system (8 types), item shop (late pass, redo card, decorations), item effects |
| 🏪 **Template Store** | 12+ curated website/game templates, coin-based unlock, source code access |
| 🌐 **Community Hub** | Public project showcase, likes, comments, mutual interaction |
| 💬 **Teaching IM** | Private/group/ticket chat, bounty questions, quiz rush/check-in activities, message tipping, helper leaderboard, WebSocket real-time push |
| 🏆 **Leaderboard** | Rankings by visits, likes, and coins |
| 👑 **Admin Panel** | Full CRUD management for users/projects/templates/comments/roles |
| 📱 **Responsive Design** | Cross-platform compatible, mobile-friendly |

---

## 🚀 Quick Start

```bash
git clone https://github.com/your-repo/autoconfig.git
cd autoconfig
npm install
npm start
# Visit http://localhost:3000/
# Admin: admin / admin1234
```

---

## 📬 Contact

| Channel | Contact |
|---------|---------|
| 💬 **WeChat** | `wzy1079769401` |
| 📧 **QQ Email** | [1079769401@qq.com](mailto:1079769401@qq.com) |
| 🐛 **Issues** | Submit bug reports via GitHub Issues |

---

## 📄 License

This project is open-sourced under the [MIT License](LICENSE).

---

<p align="center">
  <b>⚡ Autoconfig</b> — Lightning-fast hosting for your web pages & projects<br>
  Made with ❤️ by Autoconfig Team
</p>
