/**
 * 模板商城 + 金币系统 + 排行榜 路由
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// ===== 模板商城 =====

// 获取模板列表（支持分类筛选）
router.get('/list', (req, res) => {
    const { category, difficulty, search } = req.query;
    const db = getDb();

    let query = 'SELECT id, name, slug, description, category, difficulty, price, preview_html, tags, download_count FROM templates WHERE 1=1';
    const params = [];

    if (category && category !== 'all') {
        query += ' AND category = ?';
        params.push(category);
    }
    if (difficulty && difficulty !== 'all') {
        query += ' AND difficulty = ?';
        params.push(difficulty);
    }
    if (search) {
        query += ' AND (name LIKE ? OR description LIKE ? OR tags LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s);
    }
    query += ' ORDER BY price ASC, download_count DESC';

    const templates = db.prepare(query).all(...params);
    res.json({ templates });
});

// 获取模板详情
router.get('/detail/:slug', optionalAuth, (req, res) => {
    const db = getDb();
    const template = db.prepare('SELECT * FROM templates WHERE slug = ?').get(req.params.slug);
    if (!template) return res.status(404).json({ error: '模板不存在' });

    // 检查当前用户是否已购买
    let purchased = false;
    if (req.user) {
        const p = db.prepare('SELECT id FROM purchases WHERE user_id = ? AND template_id = ?').get(req.user.id, template.id);
        purchased = !!p;
    }

    // 免费模板默认已拥有
    if (template.price === 0) purchased = true;

    res.json({ template, purchased });
});

// 购买模板
router.post('/buy/:id', authMiddleware, (req, res) => {
    const db = getDb();
    const templateId = parseInt(req.params.id);

    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template) return res.status(404).json({ error: '模板不存在' });

    // 检查是否已购买
    const existing = db.prepare('SELECT id FROM purchases WHERE user_id = ? AND template_id = ?').get(req.user.id, templateId);
    if (existing) return res.status(400).json({ error: '你已经拥有该模板' });

    // 免费模板直接获得
    if (template.price === 0) {
        db.prepare('INSERT INTO purchases (user_id, template_id) VALUES (?, ?)').run(req.user.id, templateId);
        db.prepare('UPDATE templates SET download_count = download_count + 1 WHERE id = ?').run(templateId);
        return res.json({ success: true, message: '免费模板已添加到你的收藏！' });
    }

    // 管理员免费购买
    const currentUser = db.prepare('SELECT coins, role FROM users WHERE id = ?').get(req.user.id);
    if (currentUser.role === 'admin') {
        db.prepare('INSERT INTO purchases (user_id, template_id) VALUES (?, ?)').run(req.user.id, templateId);
        db.prepare('UPDATE templates SET download_count = download_count + 1 WHERE id = ?').run(templateId);
        return res.json({ success: true, message: '管理员免费获取！' });
    }

    // 检查金币余额
    if (currentUser.coins < template.price) {
        return res.status(400).json({ error: `金币不足！需要 ${template.price} 金币，你只有 ${currentUser.coins} 金币` });
    }

    // 扣除金币并记录
    const transaction = db.transaction(() => {
        db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(template.price, req.user.id);
        db.prepare('INSERT INTO purchases (user_id, template_id) VALUES (?, ?)').run(req.user.id, templateId);
        db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(
            req.user.id, -template.price, 'purchase', `购买模板「${template.name}」`
        );
        db.prepare('UPDATE templates SET download_count = download_count + 1 WHERE id = ?').run(templateId);
    });
    transaction();

    const newBalance = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id).coins;
    res.json({ success: true, message: `购买成功！花费 ${template.price} 金币`, coins: newBalance });
});

// 获取我购买的模板列表
router.get('/my', authMiddleware, (req, res) => {
    const db = getDb();
    const templates = db.prepare(`
        SELECT t.*, p.created_at as purchased_at
        FROM templates t
        JOIN purchases p ON t.id = p.template_id
        WHERE p.user_id = ?
        ORDER BY p.created_at DESC
    `).all(req.user.id);

    // 也包含所有免费模板
    const freeTemplates = db.prepare(`
        SELECT t.*, NULL as purchased_at
        FROM templates t
        WHERE t.price = 0 AND t.id NOT IN (SELECT template_id FROM purchases WHERE user_id = ?)
    `).all(req.user.id);

    res.json({ templates: [...templates, ...freeTemplates] });
});

// 获取模板源码（需已购买或免费）
router.get('/source/:id', authMiddleware, (req, res) => {
    const db = getDb();
    const templateId = parseInt(req.params.id);
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template) return res.status(404).json({ error: '模板不存在' });

    // 免费或已购买才能获取源码
    if (template.price > 0) {
        const purchased = db.prepare('SELECT id FROM purchases WHERE user_id = ? AND template_id = ?').get(req.user.id, templateId);
        if (!purchased) return res.status(403).json({ error: '请先购买此模板' });
    }

    res.json({
        template: {
            id: template.id,
            name: template.name,
            slug: template.slug,
            html_content: template.html_content,
            css_content: template.css_content,
            js_content: template.js_content
        }
    });
});

// ===== 金币系统 =====

// 获取金币余额和交易记录
router.get('/coins', authMiddleware, (req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id);

    // 计算「已获赞数」和「可兑换金币」
    const likeStats = db.prepare(`
        SELECT COUNT(*) as total_likes
        FROM likes l
        JOIN projects p ON l.project_id = p.id
        WHERE p.user_id = ?
    `).get(req.user.id);

    // 已兑换的金币数
    const exchanged = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM coin_transactions
        WHERE user_id = ? AND type = 'like_reward'
    `).get(req.user.id);

    const totalLikes = likeStats.total_likes;
    const maxCoinsFromLikes = Math.floor(totalLikes / 5);
    const alreadyExchanged = Math.abs(exchanged.total);
    const canExchange = maxCoinsFromLikes - alreadyExchanged;

    const transactions = db.prepare(`
        SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(req.user.id);

    res.json({
        coins: user.coins,
        totalLikes,
        canExchange: Math.max(0, canExchange),
        transactions
    });
});

// 兑换金币（5 赞 = 1 金币）
router.post('/coins/exchange', authMiddleware, (req, res) => {
    const db = getDb();

    const likeStats = db.prepare(`
        SELECT COUNT(*) as total_likes
        FROM likes l
        JOIN projects p ON l.project_id = p.id
        WHERE p.user_id = ?
    `).get(req.user.id);

    const exchanged = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM coin_transactions
        WHERE user_id = ? AND type = 'like_reward'
    `).get(req.user.id);

    const totalLikes = likeStats.total_likes;
    const maxCoins = Math.floor(totalLikes / 5);
    const alreadyExchanged = Math.abs(exchanged.total);
    const canExchange = maxCoins - alreadyExchanged;

    if (canExchange <= 0) {
        return res.status(400).json({ error: '暂无可兑换的金币，继续创作获取更多赞吧！' });
    }

    const transaction = db.transaction(() => {
        db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(canExchange, req.user.id);
        db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(
            req.user.id, canExchange, 'like_reward', `赞数兑换 (${totalLikes} 赞 → ${canExchange} 金币)`
        );
    });
    transaction();

    const newBalance = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id).coins;
    res.json({ success: true, exchanged: canExchange, coins: newBalance, message: `成功兑换 ${canExchange} 金币！` });
});

// ===== 排行榜 =====

// 获赞数排行
router.get('/leaderboard/likes', (req, res) => {
    const db = getDb();
    const days = parseInt(req.query.days) || 30;

    const leaders = db.prepare(`
        SELECT u.id, u.username, u.avatar, u.bio,
            COUNT(l.id) as like_count,
            (SELECT COUNT(*) FROM projects WHERE user_id = u.id AND is_public = 1) as project_count
        FROM users u
        JOIN projects p ON p.user_id = u.id
        JOIN likes l ON l.project_id = p.id
        WHERE l.created_at >= datetime('now', ?)
        GROUP BY u.id
        ORDER BY like_count DESC
        LIMIT 20
    `).all(`-${days} days`);

    res.json({ leaders, period: days });
});

// 浏览量排行
router.get('/leaderboard/visits', (req, res) => {
    const db = getDb();

    const leaders = db.prepare(`
        SELECT u.id, u.username, u.avatar, u.bio,
            COALESCE(SUM(p.visit_count), 0) as total_visits,
            COUNT(p.id) as project_count
        FROM users u
        JOIN projects p ON p.user_id = u.id AND p.is_public = 1
        GROUP BY u.id
        ORDER BY total_visits DESC
        LIMIT 20
    `).all();

    res.json({ leaders });
});

// 热门项目排行
router.get('/leaderboard/projects', (req, res) => {
    const db = getDb();

    const projects = db.prepare(`
        SELECT p.id, p.name, p.slug, p.description, p.visit_count,
            u.username, u.avatar,
            (SELECT COUNT(*) FROM likes WHERE project_id = p.id) as like_count,
            (SELECT COUNT(*) FROM comments WHERE project_id = p.id) as comment_count
        FROM projects p
        JOIN users u ON p.user_id = u.id
        WHERE p.is_public = 1
        ORDER BY like_count DESC, p.visit_count DESC
        LIMIT 20
    `).all();

    res.json({ projects });
});

module.exports = router;
