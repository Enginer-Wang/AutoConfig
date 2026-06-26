/**
 * 用户反馈/建议路由 - 提交建议、查看列表
 */
const express = require('express');
const { getDb } = require('../database');
const { optionalAuth, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

const CATEGORIES = ['suggestion', 'bug', 'feature', 'other'];

// 提交反馈/建议
router.post('/', optionalAuth, (req, res) => {
    const { category, content, contact } = req.body || {};

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return res.status(400).json({ error: '请填写建议内容' });
    }
    if (content.trim().length > 2000) {
        return res.status(400).json({ error: '建议内容过长（最多 2000 字）' });
    }

    const safeCategory = CATEGORIES.includes(category) ? category : 'suggestion';
    const safeContact = (contact || '').toString().trim().slice(0, 120);
    const userId = req.user?.id || null;
    const username = req.user?.username || '';

    const db = getDb();
    const result = db.prepare(`
        INSERT INTO feedback (user_id, username, contact, category, content)
        VALUES (?, ?, ?, ?, ?)
    `).run(userId, username, safeContact, safeCategory, content.trim());

    res.json({ success: true, id: result.lastInsertRowid, message: '感谢你的反馈！' });
});

// 获取反馈列表（仅管理员）
router.get('/', adminMiddleware, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const db = getDb();
    const items = db.prepare(`
        SELECT * FROM feedback
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `).all(limit, offset);
    const { total } = db.prepare('SELECT COUNT(*) as total FROM feedback').get();

    res.json({
        items,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
});

module.exports = router;
