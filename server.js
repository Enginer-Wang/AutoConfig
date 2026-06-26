/**
 * Autoconfig - 完整静态网页托管平台
 * 主服务器入口
 */
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { initDatabase } = require('./src/database');
const authRoutes = require('./src/routes/auth');
const projectRoutes = require('./src/routes/projects');
const siteRoutes = require('./src/routes/sites');
const communityRoutes = require('./src/routes/community');
const storeRoutes = require('./src/routes/store');
const adminRoutes = require('./src/routes/admin');
const chatRoutes = require('./src/routes/chat');
const subjectRoutes = require('./src/routes/subjects');
const exerciseRoutes = require('./src/routes/exercises');
const classRoutes = require('./src/routes/classes');
const homeworkRoutes = require('./src/routes/homework');
const dashboardRoutes = require('./src/routes/dashboard');
const collabRoutes = require('./src/routes/collab');
const playbackRoutes = require('./src/routes/playback');
const autogradeRoutes = require('./src/routes/autograde');
const gamificationRoutes = require('./src/routes/gamification');
const classAnalyticsRoutes = require('./src/routes/classAnalytics');
const instantAssignmentRoutes = require('./src/routes/instantAssignment');
const mistakesRoutes = require('./src/routes/mistakes');
const liveRoutes = require('./src/routes/live');
const classroomChatRoutes = require('./src/routes/classroomChat');
const feedbackRoutes = require('./src/routes/feedback');
const { authMiddleware, adminMiddleware } = require('./src/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化数据库
initDatabase();

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 静态文件服务 - 前端页面
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/projects', authMiddleware, projectRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/admin', adminMiddleware, adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/exercises', exerciseRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/homework', homeworkRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/collab', collabRoutes);
app.use('/api/playback', playbackRoutes);
app.use('/api/autograde', autogradeRoutes);
app.use('/api/gamification', gamificationRoutes);
app.use('/api/class-analytics', classAnalyticsRoutes);
app.use('/api/instant', instantAssignmentRoutes);
app.use('/api/mistakes', mistakesRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/classroom-chat', classroomChatRoutes);
app.use('/api/feedback', feedbackRoutes);

// 已部署站点的路由 - /site/username/project 路径访问
app.use('/site', siteRoutes);

// 页面路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/register.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/dashboard.html'));
});

app.get('/community', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/community.html'));
});

app.get('/feedback', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/feedback.html'));
});

app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/docs.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/about.html'));
});

app.get('/subjects', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/subjects.html'));
});

app.get('/stats', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/stats.html'));
});

app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/privacy.html'));
});

app.get('/templates', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/templates.html'));
});

app.get('/leaderboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/leaderboard.html'));
});

app.get('/editor/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/editor.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/chat.html'));
});

app.get('/chat/:username', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/chat.html'));
});

app.get('/classes', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/classes.html'));
});

app.get('/homework', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/homework.html'));
});

app.get('/teacher-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/teacher-dashboard.html'));
});

app.get('/grading-workspace', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/grading-workspace.html'));
});

app.get('/class-analytics', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/class-analytics.html'));
});

app.get('/instant-quiz', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/instant-quiz.html'));
});

app.get('/mistakes', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/mistakes.html'));
});

app.get('/live-console', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/live-console.html'));
});

app.get('/live-classroom', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/live-classroom.html'));
});

app.get('/edit-project/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/editor.html'));
});

// 作品展示页 - /project/:username/:slug
app.get('/project/:username/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/project.html'));
});

// 404
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public/404.html'));
});

// 使用 http.createServer 以支持 WebSocket 升级
const http = require('http');
const { initWebSocket } = require('./src/websocket');
const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, () => {
    console.log(`\n  ⚡  Autoconfig 全功能平台已启动`);
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  控制台:  http://localhost:${PORT}/dashboard`);
    console.log(`  ➜  社区:    http://localhost:${PORT}/community`);
    console.log(`  ➜  聊天室:  http://localhost:${PORT}/chat`);
    console.log(`  ➜  管理后台: http://localhost:${PORT}/admin`);
    console.log(`  🔌 WebSocket: ws://localhost:${PORT}/ws`);
    console.log(`  👑  管理员:  admin / admin1234\n`);
});

// 全局错误处理
process.on('uncaughtException', (err) => {
    console.error('  ❌ 未捕获的异常:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
    console.error('  ❌ 未处理的 Promise 拒绝:', reason);
});
