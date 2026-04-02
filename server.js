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

app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/docs.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/about.html'));
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

app.listen(PORT, () => {
    console.log(`\n  ⚡  Autoconfig 全功能平台已启动`);
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  控制台:  http://localhost:${PORT}/dashboard`);
    console.log(`  ➜  社区:    http://localhost:${PORT}/community`);
    console.log(`  ➜  管理后台: http://localhost:${PORT}/admin`);
    console.log(`  👑  管理员:  admin / admin1234\n`);
});

// 全局错误处理
process.on('uncaughtException', (err) => {
    console.error('  ❌ 未捕获的异常:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
    console.error('  ❌ 未处理的 Promise 拒绝:', reason);
});
