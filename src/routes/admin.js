/**
 * 管理员路由 - 用户管理 / 金币管理 / 项目管理 / 模板管理 / 系统统计
 * 所有路由均需 adminMiddleware 验证
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');

const router = express.Router();

const SITES_DIR = path.join(__dirname, '..', '..', 'data', 'sites');

// ===== 系统统计 =====
router.get('/stats', (req, res) => {
    const db = getDb();
    const stats = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM users) as user_count,
            (SELECT COUNT(*) FROM projects) as project_count,
            (SELECT COUNT(*) FROM projects WHERE is_public = 1) as public_project_count,
            (SELECT COUNT(*) FROM templates) as template_count,
            (SELECT COUNT(*) FROM likes) as like_count,
            (SELECT COUNT(*) FROM comments) as comment_count,
            (SELECT COUNT(*) FROM purchases) as purchase_count,
            (SELECT COALESCE(SUM(visit_count), 0) FROM projects) as total_visits,
            (SELECT COALESCE(SUM(coins), 0) FROM users) as total_coins,
            (SELECT COUNT(*) FROM coin_transactions) as transaction_count
    `).get();
    res.json(stats);
});

// ===== 用户管理 =====

// 获取所有用户列表
router.get('/users', (req, res) => {
    const db = getDb();
    const { search, role } = req.query;

    let query = `
        SELECT u.id, u.username, u.email, u.avatar, u.bio, u.coins, u.role, u.created_at, u.updated_at,
            (SELECT COUNT(*) FROM projects WHERE user_id = u.id) as project_count,
            (SELECT COALESCE(SUM(visit_count), 0) FROM projects WHERE user_id = u.id) as total_visits,
            (SELECT COUNT(*) FROM likes l JOIN projects p ON l.project_id = p.id WHERE p.user_id = u.id) as total_likes
        FROM users u WHERE 1=1
    `;
    const params = [];

    if (search) {
        query += ' AND (u.username LIKE ? OR u.email LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }
    if (role && role !== 'all') {
        query += ' AND u.role = ?';
        params.push(role);
    }

    query += ' ORDER BY u.created_at DESC';
    const users = db.prepare(query).all(...params);
    res.json({ users });
});

// 获取单个用户详情
router.get('/users/:id', (req, res) => {
    const db = getDb();
    const user = db.prepare(`
        SELECT u.id, u.username, u.email, u.avatar, u.bio, u.coins, u.role, u.created_at, u.updated_at,
            (SELECT COUNT(*) FROM projects WHERE user_id = u.id) as project_count,
            (SELECT COALESCE(SUM(visit_count), 0) FROM projects WHERE user_id = u.id) as total_visits,
            (SELECT COUNT(*) FROM likes l JOIN projects p ON l.project_id = p.id WHERE p.user_id = u.id) as total_likes
        FROM users u WHERE u.id = ?
    `).get(req.params.id);

    if (!user) return res.status(404).json({ error: '用户不存在' });

    // 获取用户的项目列表
    const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(user.id);
    // 获取最近交易
    const transactions = db.prepare('SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(user.id);

    res.json({ user, projects, transactions });
});

// 创建用户
router.post('/users', async (req, res) => {
    try {
        const { username, email, password, role, coins, bio } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ error: '用户名、邮箱和密码为必填项' });
        }

        const db = getDb();
        const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
        if (existing) {
            return res.status(400).json({ error: '用户名或邮箱已存在' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = db.prepare(
            'INSERT INTO users (username, email, password, role, coins, bio) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(username, email, hashedPassword, role || 'user', coins || 0, bio || '');

        res.json({ success: true, userId: result.lastInsertRowid, message: `用户 ${username} 创建成功` });
    } catch (err) {
        res.status(500).json({ error: '创建用户失败: ' + err.message });
    }
});

// 更新用户信息
router.put('/users/:id', async (req, res) => {
    try {
        const db = getDb();
        const userId = parseInt(req.params.id);
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) return res.status(404).json({ error: '用户不存在' });

        const { username, email, password, role, coins, bio, avatar } = req.body;

        // 如果修改了用户名或邮箱，检查唯一性
        if (username && username !== user.username) {
            const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
            if (dup) return res.status(400).json({ error: '用户名已存在' });
        }
        if (email && email !== user.email) {
            const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, userId);
            if (dup) return res.status(400).json({ error: '邮箱已存在' });
        }

        // 构建更新
        const updates = [];
        const params = [];

        if (username !== undefined) { updates.push('username = ?'); params.push(username); }
        if (email !== undefined) { updates.push('email = ?'); params.push(email); }
        if (role !== undefined) { updates.push('role = ?'); params.push(role); }
        if (coins !== undefined) { updates.push('coins = ?'); params.push(parseInt(coins)); }
        if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
        if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updates.push('password = ?');
            params.push(hashedPassword);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: '没有要更新的字段' });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(userId);

        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        res.json({ success: true, message: '用户信息已更新' });
    } catch (err) {
        res.status(500).json({ error: '更新失败: ' + err.message });
    }
});

// 删除用户
router.delete('/users/:id', (req, res) => {
    const db = getDb();
    const userId = parseInt(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    // 不能删除自己 (admin)
    if (userId === req.user.id) {
        return res.status(400).json({ error: '不能删除自己的账号' });
    }

    // 删除用户的站点文件
    const siteDir = path.join(SITES_DIR, user.username);
    if (fs.existsSync(siteDir)) {
        fs.rmSync(siteDir, { recursive: true, force: true });
    }

    // 级联删除（数据库外键已设置 ON DELETE CASCADE）
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ success: true, message: `用户 ${user.username} 已删除` });
});

// ===== 金币操作 =====

// 给用户增加/扣除金币
router.post('/users/:id/coins', (req, res) => {
    const db = getDb();
    const userId = parseInt(req.params.id);
    const { amount, reason } = req.body;

    if (!amount || amount === 0) {
        return res.status(400).json({ error: '请指定金币数量' });
    }

    const user = db.prepare('SELECT username, coins FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    const coinAmount = parseInt(amount);
    if (user.coins + coinAmount < 0) {
        return res.status(400).json({ error: `扣除后余额不能为负数（当前: ${user.coins}）` });
    }

    const transaction = db.transaction(() => {
        db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(coinAmount, userId);
        db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(
            userId, coinAmount, 'admin', reason || `管理员${coinAmount > 0 ? '充值' : '扣除'} ${Math.abs(coinAmount)} 金币`
        );
    });
    transaction();

    const newBalance = db.prepare('SELECT coins FROM users WHERE id = ?').get(userId).coins;
    res.json({ success: true, coins: newBalance, message: `已${coinAmount > 0 ? '增加' : '扣除'} ${Math.abs(coinAmount)} 金币，当前余额: ${newBalance}` });
});

// 批量充值金币
router.post('/coins/batch', (req, res) => {
    const db = getDb();
    const { amount, reason } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: '请指定正数金币数量' });
    }

    const users = db.prepare('SELECT id, username FROM users').all();
    const transaction = db.transaction(() => {
        for (const user of users) {
            db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(amount, user.id);
            db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(
                user.id, amount, 'admin', reason || `全服发放 ${amount} 金币`
            );
        }
    });
    transaction();

    res.json({ success: true, message: `已向 ${users.length} 位用户各发放 ${amount} 金币` });
});

// ===== 项目管理 =====

// 获取所有项目
router.get('/projects', (req, res) => {
    const db = getDb();
    const { search, userId } = req.query;

    let query = `
        SELECT p.*, u.username, u.avatar,
            (SELECT COUNT(*) FROM likes WHERE project_id = p.id) as like_count,
            (SELECT COUNT(*) FROM comments WHERE project_id = p.id) as comment_count
        FROM projects p
        JOIN users u ON p.user_id = u.id
        WHERE 1=1
    `;
    const params = [];

    if (search) {
        query += ' AND (p.name LIKE ? OR p.slug LIKE ? OR u.username LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (userId) {
        query += ' AND p.user_id = ?';
        params.push(parseInt(userId));
    }

    query += ' ORDER BY p.updated_at DESC';
    const projects = db.prepare(query).all(...params);
    res.json({ projects });
});

// 更新任意项目
router.put('/projects/:id', (req, res) => {
    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const { name, description, isPublic, status } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (isPublic !== undefined) { updates.push('is_public = ?'); params.push(isPublic ? 1 : 0); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);

    db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true, message: '项目已更新' });
});

// 删除任意项目
router.delete('/projects/:id', (req, res) => {
    const db = getDb();
    const project = db.prepare(`
        SELECT p.*, u.username FROM projects p JOIN users u ON p.user_id = u.id WHERE p.id = ?
    `).get(req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    // 删除文件
    const siteDir = path.join(SITES_DIR, project.username, project.slug);
    if (fs.existsSync(siteDir)) {
        fs.rmSync(siteDir, { recursive: true, force: true });
    }

    db.prepare('DELETE FROM comments WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM likes WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    res.json({ success: true, message: `项目 ${project.name} 已删除` });
});

// ===== 模板管理 =====

// 获取所有模板
router.get('/templates', (req, res) => {
    const db = getDb();
    const templates = db.prepare(`
        SELECT *, (SELECT COUNT(*) FROM purchases WHERE template_id = templates.id) as purchase_count
        FROM templates ORDER BY id ASC
    `).all();
    res.json({ templates });
});

// 添加模板
router.post('/templates', (req, res) => {
    const db = getDb();
    const { name, slug, description, category, difficulty, price, preview_html, html_content, css_content, js_content, tags } = req.body;

    if (!name || !slug || !html_content) {
        return res.status(400).json({ error: '名称、slug 和 HTML 内容为必填项' });
    }

    const existing = db.prepare('SELECT id FROM templates WHERE slug = ?').get(slug);
    if (existing) {
        return res.status(400).json({ error: 'slug 已存在' });
    }

    const result = db.prepare(`
        INSERT INTO templates (name, slug, description, category, difficulty, price, preview_html, html_content, css_content, js_content, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, slug, description || '', category || 'website', difficulty || 'easy', price || 0, preview_html || '', html_content, css_content || '', js_content || '', tags || '');

    res.json({ success: true, templateId: result.lastInsertRowid, message: `模板 ${name} 已添加` });
});

// 更新模板
router.put('/templates/:id', (req, res) => {
    const db = getDb();
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!template) return res.status(404).json({ error: '模板不存在' });

    const { name, description, category, difficulty, price, preview_html, html_content, css_content, js_content, tags } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (category !== undefined) { updates.push('category = ?'); params.push(category); }
    if (difficulty !== undefined) { updates.push('difficulty = ?'); params.push(difficulty); }
    if (price !== undefined) { updates.push('price = ?'); params.push(parseInt(price)); }
    if (preview_html !== undefined) { updates.push('preview_html = ?'); params.push(preview_html); }
    if (html_content !== undefined) { updates.push('html_content = ?'); params.push(html_content); }
    if (css_content !== undefined) { updates.push('css_content = ?'); params.push(css_content); }
    if (js_content !== undefined) { updates.push('js_content = ?'); params.push(js_content); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(tags); }

    if (updates.length === 0) return res.status(400).json({ error: '没有要更新的字段' });
    params.push(req.params.id);

    db.prepare(`UPDATE templates SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true, message: '模板已更新' });
});

// 删除模板
router.delete('/templates/:id', (req, res) => {
    const db = getDb();
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!template) return res.status(404).json({ error: '模板不存在' });

    db.prepare('DELETE FROM purchases WHERE template_id = ?').run(template.id);
    db.prepare('DELETE FROM templates WHERE id = ?').run(template.id);
    res.json({ success: true, message: `模板 ${template.name} 已删除` });
});

// ===== 评论管理 =====

// 删除任意评论
router.delete('/comments/:id', (req, res) => {
    const db = getDb();
    const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
    if (!comment) return res.status(404).json({ error: '评论不存在' });

    db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
    res.json({ success: true, message: '评论已删除' });
});

module.exports = router;
