/**
 * 聊天系统路由 - 私信 / 会话列表 / 金币赠送
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 所有路由需登录
router.use(authMiddleware);

// 获取会话列表（与每个人的最新消息）
router.get('/conversations', (req, res) => {
    const db = getDb();
    const userId = req.user.id;

    const conversations = db.prepare(`
        SELECT 
            u.id as user_id, u.username, u.avatar,
            m.content as last_message, m.type as last_type, m.created_at as last_time,
            (SELECT COUNT(*) FROM messages WHERE from_id = u.id AND to_id = ? AND is_read = 0) as unread
        FROM users u
        INNER JOIN (
            SELECT 
                CASE WHEN from_id = ? THEN to_id ELSE from_id END as other_id,
                MAX(id) as max_id
            FROM messages
            WHERE from_id = ? OR to_id = ?
            GROUP BY other_id
        ) latest ON u.id = latest.other_id
        INNER JOIN messages m ON m.id = latest.max_id
        ORDER BY m.created_at DESC
    `).all(userId, userId, userId, userId);

    res.json({ conversations });
});

// 获取与某个用户的消息记录
router.get('/messages/:userId', (req, res) => {
    const db = getDb();
    const myId = req.user.id;
    const otherId = parseInt(req.params.userId);
    const before = req.query.before; // 分页用
    const limit = parseInt(req.query.limit) || 50;

    let query = `
        SELECT m.*, 
            fu.username as from_username, fu.avatar as from_avatar,
            tu.username as to_username
        FROM messages m
        JOIN users fu ON m.from_id = fu.id
        JOIN users tu ON m.to_id = tu.id
        WHERE ((m.from_id = ? AND m.to_id = ?) OR (m.from_id = ? AND m.to_id = ?))
    `;
    const params = [myId, otherId, otherId, myId];

    if (before) {
        query += ' AND m.id < ?';
        params.push(parseInt(before));
    }
    query += ' ORDER BY m.id DESC LIMIT ?';
    params.push(limit);

    const messages = db.prepare(query).all(...params);

    // 标记收到的消息为已读
    db.prepare('UPDATE messages SET is_read = 1 WHERE from_id = ? AND to_id = ? AND is_read = 0')
        .run(otherId, myId);

    // 获取对方信息
    const otherUser = db.prepare('SELECT id, username, avatar, bio FROM users WHERE id = ?').get(otherId);

    res.json({ messages: messages.reverse(), user: otherUser });
});

// 发送消息
router.post('/send', (req, res) => {
    const db = getDb();
    const { toUserId, content, type } = req.body;

    if (!toUserId || !content?.trim()) {
        return res.status(400).json({ error: '消息内容不能为空' });
    }
    if (content.length > 1000) {
        return res.status(400).json({ error: '消息不能超过1000字' });
    }
    if (parseInt(toUserId) === req.user.id) {
        return res.status(400).json({ error: '不能给自己发消息' });
    }

    const toUser = db.prepare('SELECT id FROM users WHERE id = ?').get(parseInt(toUserId));
    if (!toUser) return res.status(404).json({ error: '用户不存在' });

    const result = db.prepare(
        'INSERT INTO messages (from_id, to_id, content, type) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, parseInt(toUserId), content.trim(), type || 'text');

    const message = db.prepare(`
        SELECT m.*, fu.username as from_username, fu.avatar as from_avatar, tu.username as to_username
        FROM messages m
        JOIN users fu ON m.from_id = fu.id
        JOIN users tu ON m.to_id = tu.id
        WHERE m.id = ?
    `).get(result.lastInsertRowid);

    res.json({ success: true, message });
});

// 获取未读消息总数
router.get('/unread', (req, res) => {
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as count FROM messages WHERE to_id = ? AND is_read = 0')
        .get(req.user.id);
    res.json({ unread: count.count });
});

// 赠送金币
router.post('/gift-coins', (req, res) => {
    const db = getDb();
    const { toUserId, amount } = req.body;
    const coinAmount = parseInt(amount);

    if (!toUserId || !coinAmount || coinAmount <= 0) {
        return res.status(400).json({ error: '请输入有效的金币数量' });
    }
    if (parseInt(toUserId) === req.user.id) {
        return res.status(400).json({ error: '不能给自己赠送金币' });
    }

    const sender = db.prepare('SELECT coins, username FROM users WHERE id = ?').get(req.user.id);
    if (sender.coins < coinAmount) {
        return res.status(400).json({ error: `金币不足！你只有 ${sender.coins} 金币` });
    }

    const receiver = db.prepare('SELECT id, username FROM users WHERE id = ?').get(parseInt(toUserId));
    if (!receiver) return res.status(404).json({ error: '用户不存在' });

    const transaction = db.transaction(() => {
        db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(coinAmount, req.user.id);
        db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(coinAmount, receiver.id);
        db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(
            req.user.id, -coinAmount, 'gift_sent', `赠送 ${receiver.username} ${coinAmount} 金币`
        );
        db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(
            receiver.id, coinAmount, 'gift_received', `收到 ${sender.username} 赠送的 ${coinAmount} 金币`
        );
        // 自动发一条系统消息
        db.prepare('INSERT INTO messages (from_id, to_id, content, type) VALUES (?, ?, ?, ?)').run(
            req.user.id, receiver.id, `🎁 赠送了 ${coinAmount} 金币`, 'gift'
        );
    });
    transaction();

    const newBalance = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id).coins;
    res.json({ success: true, coins: newBalance, message: `已赠送 ${receiver.username} ${coinAmount} 金币` });
});

// 根据 username 获取用户ID（用于联系作者）
router.get('/user-by-name/:username', (req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT id, username, avatar, bio FROM users WHERE username = ?').get(req.params.username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ user });
});

module.exports = router;
