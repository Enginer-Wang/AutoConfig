# 教师管理后台纵深扩展 - 任务计划

## 目标
为 Autoconfig 打造闭环、硬核的教育级系统，扩展教师管理后台：
1. 智能化班级与学生管理系统（学情雷达、危机预警、能力画像、动态分组）
2. 即时做完即时登记的作业（代码填空、单元测试、限时抢答 → 免批改）
3. 需要学生上传、老师人工批改的作业（ZIP部署、三栏批改台、源码批注、打回重做）

## Phases
- [x] Phase 1: 探索现有代码架构
- [x] Phase 2: 数据库 Schema 扩展
- [x] Phase 3: 班级/学生管理 API（学情看板、预警、分组）
- [x] Phase 4: 即时作业系统 API（填空、测试、抢答）
- [x] Phase 5: 上传批改系统 API 增强
- [x] Phase 6: 教师批改工作台前端
- [x] Phase 7: 班级管理看板前端

## 文件变更记录
- `src/database.js` - 新增 8 张表：student_risk_alerts, student_ability_profiles, gradebook, instant_quizzes, quiz_questions, quiz_responses, code_fill_assignments, code_fill_submissions, group_configs
- `src/routes/classAnalytics.js` - **新建** 班级学情路由（预警、雷达图、分组、成绩册）
- `src/routes/instantAssignment.js` - **新建** 即时作业路由（测验CRUD、代码填空、自动判分）
- `src/routes/homework.js` - 扩展三栏批改工作台API、文件浏览、批量打分、提交历史
- `server.js` - 注册新路由和页面
- `public/grading-workspace.html` - **新建** 三栏式深度批改工作台
- `public/class-analytics.html` - **新建** 班级学情看板（预警、热力图、雷达图、分组）
- `public/instant-quiz.html` - **新建** 即时作业答题界面

## 技术决策
- DB: SQLite (better-sqlite3) 保持一致
- Frontend: 纯 HTML/CSS/JS 无框架
- Realtime: WebSocket 推送即时作业结果

## Phase 8: Bug 修复与错题本扩展（2026-06-04）
### Bug 修复
- [x] **dashboard.js code_activity 列错误**：原查询使用不存在的 `created_at` / `total_keystrokes` 列，
  导致教师数据大屏「代码活跃度」「夜猫排行」「每小时分布」「人均代码量」及学生画像全部 SQL 报错。
  已改用实际列 `date` / `hour` / `lines_added+lines_deleted`，与 playback.js、classAnalytics.js 对齐。
- 排查为误报（无需修改）：chat.js `MAX(a,b)`（SQLite 合法标量函数）、collab.js `INSERT INTO messages`
  （messages 表确实存在）、instantAssignment `expected:undefined`（JSON 序列化自动剔除）。

### 新功能：错题本（错题归集与智能重练）
- `src/database.js` - 新增 `mistake_notebook` 表（掌握度状态机 + 个人笔记 + 错误次数统计）
- `src/routes/instantAssignment.js` - 答错时自动归集错题钩子
- `src/routes/mistakes.js` - **新建** 错题本路由：列表/统计/重练判分/笔记/移除/班级高频错题
- `public/mistakes.html` - **新建** 错题本页面（学生重练 + 教师班级高频错题讲评）
- `server.js` - 注册 `/api/mistakes` 路由与 `/mistakes` 页面
- 掌握度机制：答错→unmastered；重练答对→reviewing；再答对→mastered（攻克奖励 1 金币）

## Phase 9: 在线直播课堂 + 数字巡课墙 MVP（2026-06-04）
### 范围（用户选择：MVP / WebRTC P2P 自建信令 / 优先数字巡课墙）
实现「开课→巡课墙→协同编辑→结课」完整闭环。
### 文件变更
- `src/database.js` - 新增 5 张表：live_sessions、live_participants、live_student_status、
  live_help_requests、live_interventions
- `src/websocket.js` - 扩展直播课堂订阅与消息：live_subscribe/live_status/webrtc_signal/
  takeover/code_sync；新增 broadcastToLive、sendToLiveTeachers、notifyLive 导出
- `src/routes/live.js` - **新建** 直播课堂路由：开课/下课/进入/心跳/编译失败/呼叫老师/
  求助处理/巡课墙(动态排序)/单人聚焦/互动记录/结课质量报告
- `server.js` - 注册 `/api/live` 路由与 `/live-console`、`/live-classroom` 页面
- `public/live-console.html` - **新建** 教师数字巡课墙：网格动态墙、专注度标签、求助红框闪烁、
  屏幕共享(getDisplayMedia + WebRTC mesh 广播)、单人聚焦+接管开关、结课报告
- `public/live-classroom.html` - **新建** 学生端课堂：WebRTC 直播观看、编辑器、专注度监控
  (切屏次数/时长 + 60s 编码活跃度)、一键呼叫老师、接管强同步
### 技术决策
- 音视频：浏览器原生 WebRTC，教师为广播端(每生一个 RTCPeerConnection)，WS 中继信令，STUN 公网
- 巡课墙：3s 轮询 + WS live_status 实时增量；动态排序 default/abnormal/help/code
- 专注度：前端 visibilitychange 计切屏；服务端按 last_keystroke_at 判 60s 卡顿
- 协同编辑：MVP 采用全文 last-write 同步 + 光标行号标签（非完整 CRDT，后续可接 Yjs）
- 隐私：摄像头人脸分析未实现；缩略图仅截前 220 字代码文本，不留存截图

## Phase 10: 课堂互动聊天室（绑定班级永久聊天室）
### 范围（MVP，复用 chat_rooms/chat_messages 表，不改动庞大的 chat.js）
钉钉式强互动 + 多媒体 + 教师管理 + 课堂分析，绑定班级「永久聊天室」(下课后仍可讨论作业)。
### 文件变更记录
- `src/database.js` - 新增 chat_message_reactions 表；ALTER chat_messages.is_deleted、chat_rooms.danmaku_on
- `src/websocket.js` - 新增 notifyChat(roomId,payload) 房间广播（含发送者多端同步）
- `src/routes/classroomChat.js` - **新建** 课堂聊天室路由：
  消息收发(WS实时)/Markdown代码块/文件·图片·语音上传/表态Reaction(+1/赞/懂了)/
  引用回复/撤回删除/置顶/公告/全员·单人禁言/弹幕模式/代码分享卡片·教师广播示范/
  已读未读(教师)/DING强提醒/敏感词过滤/发言限流/课堂活跃度分析(发言·热词·类型分布)
- `server.js` - 注册 `/api/classroom-chat`
- `src/routes/live.js` - 结课质量报告新增 chatAnalytics（复用 computeChatAnalytics）
- `public/js/classroom-chat.js` - **新建** 共享聊天面板模块 ClassroomChat.init/handleWS（师生复用）
- `public/live-classroom.html` - 接入聊天面板 + 视频弹幕层 #danmakuLayer + __getMyCode 代码分享
- `public/live-console.html` - 教师侧栏接入聊天面板 + 已读/DING/禁言/弹幕/广播控制
### 技术决策
- 实时：notifyChat 走 WS roomSubscriptions（auth 时按 chat_room_members 自动订阅 + 前端 join_room）
- 永久聊天室：ensureClassRoom 按 class 创建 type=class 房间，自动纳入教师(admin)+全部班级成员
- 只读：全员禁言即「下课只读」；班级群默认开放供课后讨论
- 弹幕：text 消息在 danmaku_on 时飞过学生视频层；DING 通过 sendToUser 定向未读学生弹窗
### 验证
- 模块加载 OK；server 启动 3999；/js/classroom-chat.js、/live-console、/live-classroom 均 200
### 补充：签到/投票活动卡片（实时柱状图）
- `src/routes/classroomChat.js` - 复用 chat_activities/chat_activity_responses 表，新增
  POST `/room/:id/activity`(发起签到/投票) · POST `/activity/:id/respond`(签到/投票·支持改票) ·
  POST `/activity/:id/end`(结束) · GET `/activity/:id`(结果)，computeActivityResults 聚合柱状图数据，
  WS 广播 `chat_activity_update`；历史消息加载时附加活动实时结果
- `public/js/classroom-chat.js` - activity 卡片渲染（签到名单/投票横向柱状图+百分比+我的选择高亮）、
  教师「发起签到/发起投票」按钮、学生点击投票/改票、实时更新、结束活动控制

## Phase 11: 聊天室与直播课堂联动 + 好友系统（2026-06-05）
### 范围
打通 `/chat` 独立聊天页与直播课堂的双向跳转，并为聊天页新增好友查询/添加体系。
### 文件变更记录
- `src/database.js` - 新增 `friendships` 表（requester_id/addressee_id/status[pending|accepted]/
  remark + 3 索引 + UNIQUE 约束）
- `src/routes/chat.js` - 新增好友系统 8 端点 + 助手：
  `GET /users/search`(模糊搜索+附带好友状态) · `POST /friends/request`(发起，反向请求自动通过) ·
  `GET /friends/requests`(收/发件箱) · `POST /friends/respond`(接受/拒绝) ·
  `GET /friends`(好友列表) · `DELETE /friends/:userId`(删除) · `friendStatus()` · `notifyFriend()`(WS 实时通知)
- `public/chat.html` - 新增「👫 好友」侧栏 Tab + 好友 UI（搜索框/请求收发/好友列表/角色徽章/
  私聊·删除按钮）+ 好友相关 JS（loadFriends/renderFriendLists/searchUsers/addFriend/
  respondFriend/removeFriend/startDM）；header 增加「进入直播课堂」按钮（按角色路由 live-console/
  live-classroom）；handleWsMessage 增加 friend_request/friend_accepted 实时提醒；
  班级群聊天头部增加「🎥 进入直播」按钮（携带 classId）
- `public/live-console.html` - 顶栏增加「💬 聊天室」跳转；loadClasses 支持 `?classId=` 预选
- `public/live-classroom.html` - 顶栏增加「💬 聊天室」跳转
### 技术决策
- 好友关系单向存储 + 双向查询；反向 pending 请求在再次发起时自动互通为 accepted
- 私聊复用旧版 `messages` 表（startDM → openLegacyChat）
- 实时通知复用 `websocket.sendToUser`，懒加载避免循环依赖
### 验证
- DB 迁移 OK，friendships 表与列确认存在；chat 路由模块加载 OK；四个文件无 lint 错误



## Phase 12: 上线前 Bug 修复与全链路回归（2026-06-26）
### 根因排查方法
- 启动服务 + 管理员登录冒烟测试 → 端到端业务流程脚本（教师/学生注册、建班、作业、批改、测验、大屏、直播、好友等 40 项）
- 静态 SQL 列校验器：扫描所有路由 INSERT/UPDATE 语句列名 vs 真实 schema

### 修复的真实 Bug
- **积分银行模块整体崩溃（严重）**：`src/routes/gamification.js` 大量按"想象的 schema"编写，
  与真实表结构字段名全面错配，导致商店/购买/道具使用/任务/触发/领取所有端点运行时 SQL 报错：
  - `coin_items` 缺 `is_active`；`coin_missions` 缺 `is_active`/`sort_order` → database.js 补列 + 兼容 ALTER 迁移
  - 字段名错配修复：`reward_coins→reward`、`trigger_event→condition_type`、`target_value→condition_value`、
    `reset_period→type`、`current_progress→progress`、`claimed_at→claimed`、`ci.category→ci.type`
  - `/items/use` 整段失效（读取不存在的 `effect_type`/`effect_value`）→ 重写为按 `effect`(JSON) + slug 分发，
    支持迟交券个人延期/重做卡/成绩免公示/装饰道具
  - 新增迁移列：`homework_submissions.personal_due_date`、`homework_submissions.hide_from_rank`、`users.active_cosmetics`
- **auth.js 教师注册健壮性**：`(inviteCode||'').trim()` 当 inviteCode 非字符串时崩溃 → 改为 `String(inviteCode||'').trim()`
- **JWT_SECRET 生产告警**：未设置环境变量且 NODE_ENV=production 时启动打印安全警告

### 回归验证
- 端到端主流程 40/40、积分写入路径 15/15、即时测验全链路（创建→开启→判分→错题本→成绩册→排行）12/12 全部通过
- 静态 SQL 校验：除已修复的积分模块外，所有路由 INSERT/UPDATE 列名均与 schema 一致
- 子代理曾误报 live_sessions/teacher_invite_codes 表缺失 → 实测 61 张表齐全（误报，已排除）
