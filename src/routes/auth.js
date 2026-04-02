/**
 * 用户认证路由 - 注册 / 登录 / 登出 / 个人信息
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 注册
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: '请填写所有必填字段' });
        }

        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ error: '用户名长度需在3-20个字符之间' });
        }

        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            return res.status(400).json({ error: '用户名只能包含字母、数字、下划线和连字符' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: '密码至少6个字符' });
        }

        const db = getDb();

        // 检查用户名和邮箱是否已存在
        const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
        if (existing) {
            return res.status(400).json({ error: '用户名或邮箱已被注册' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = db.prepare(
            'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
        ).run(username, email, hashedPassword);

        const user = { id: result.lastInsertRowid, username, email };
        const token = generateToken(user);

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        });

        res.json({ success: true, user: { id: user.id, username, email }, token });
    } catch (err) {
        console.error('注册失败:', err);
        res.status(500).json({ error: '注册失败，请稍后重试' });
    }
});

// 登录
router.post('/login', async (req, res) => {
    try {
        const { login, password } = req.body;

        if (!login || !password) {
            return res.status(400).json({ error: '请填写用户名/邮箱和密码' });
        }

        const db = getDb();
        const user = db.prepare(
            'SELECT * FROM users WHERE username = ? OR email = ?'
        ).get(login, login);

        if (!user) {
            return res.status(400).json({ error: '用户名或密码错误' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(400).json({ error: '用户名或密码错误' });
        }

        const token = generateToken(user);

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        });

        res.json({
            success: true,
            user: { id: user.id, username: user.username, email: user.email },
            token
        });
    } catch (err) {
        console.error('登录失败:', err);
        res.status(500).json({ error: '登录失败，请稍后重试' });
    }
});

// 登出
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
    const db = getDb();
    const user = db.prepare(
        'SELECT id, username, email, avatar, bio, coins, role, created_at FROM users WHERE id = ?'
    ).get(req.user.id);

    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    // 获取项目统计
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as project_count,
            COALESCE(SUM(visit_count), 0) as total_visits,
            COALESCE(SUM(total_size), 0) as total_storage
        FROM projects WHERE user_id = ?
    `).get(req.user.id);

    res.json({ user: { ...user, ...stats } });
});

// 更新个人信息
router.put('/profile', authMiddleware, (req, res) => {
    const { bio, avatar } = req.body;
    const db = getDb();

    db.prepare('UPDATE users SET bio = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(bio || '', avatar || '', req.user.id);

    res.json({ success: true });
});

module.exports = router;
