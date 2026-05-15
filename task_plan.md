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

