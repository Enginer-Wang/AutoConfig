/**
 * 教学级 IM 聊天系统路由
 * - 聊天室 CRUD（私信/班级群/小组群/答疑Ticket）
 * - 群组消息（代码片段、Markdown、系统消息）
 * - 金币悬赏提问 & 打赏
 * - 课堂抢答 & 签到活动
 * - 答疑排行榜
 * - 兼容旧版私信接口
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 所有路由需登录
router.use(authMiddleware);

// ==================== 聊天室管理 ====================

// 获取我的所有聊天室
router.get('/rooms', (req, res) => {
    const db = getDb();
    const userId = req.user.id;

    const rooms = db.prepare(`
        SELECT cr.*, crm.role as my_role, crm.last_read_msg_id,
            (SELECT COUNT(*) FROM chat_messages cm WHERE cm.room_id = cr.id AND cm.id > crm.last_read_msg_id) as unread,
            (SELECT content FROM chat_messages WHERE room_id = cr.id ORDER BY id DESC LIMIT 1) as last_message,
            (SELECT created_at FROM chat_messages WHERE room_id = cr.id ORDER BY id DESC LIMIT 1) as last_time,
            (SELECT COUNT(*) FROM chat_room_members WHERE room_id = cr.id) as member_count
        FROM chat_rooms cr
        JOIN chat_room_members crm ON cr.id = crm.room_id AND crm.user_id = ?
        ORDER BY last_time DESC NULLS LAST
    `).all(userId);

    // 对私信房间附加对方用户信息
    rooms.forEach(r => {
        if (r.type === 'dm') {
            const other = db.prepare(`
                SELECT u.id, u.username, u.avatar FROM chat_room_members crm
                JOIN users u ON crm.user_id = u.id
                WHERE crm.room_id = ? AND crm.user_id != ?
                LIMIT 1
            `).get(r.id, userId);
            r.dm_user = other || null;
        }
    });

    res.json({ rooms });
});

// 获取/创建与某用户的私信房间
router.post('/rooms/dm', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const { targetUserId } = req.body;

    if (!targetUserId || parseInt(targetUserId) === userId) {
        return res.status(400).json({ error: '无效的目标用户' });
    }

    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(parseInt(targetUserId));
    if (!target) return res.status(404).json({ error: '用户不存在' });

    // 检查是否已有DM房间
    const existing = db.prepare(`
        SELECT cr.id FROM chat_rooms cr
        WHERE cr.type = 'dm' AND cr.id IN (
            SELECT room_id FROM chat_room_members WHERE user_id = ?
        ) AND cr.id IN (
            SELECT room_id FROM chat_room_members WHERE user_id = ?
        )
    `).get(userId, target.id);

    if (existing) {
        return res.json({ roomId: existing.id });
    }

    // 创建新的DM房间
    const result = db.prepare(
        'INSERT INTO chat_rooms (name, type, owner_id) VALUES (?, ?, ?)'
    ).run('', 'dm', userId);

    const roomId = result.lastInsertRowid;
    db.prepare('INSERT INTO chat_room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(roomId, userId, 'member');
    db.prepare('INSERT INTO chat_room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(roomId, target.id, 'member');

    res.json({ roomId });
});

// 创建班级群聊（教师）
router.post('/rooms/class', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const { classId } = req.body;

    if (!classId) return res.status(400).json({ error: '缺少班级ID' });

    const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(parseInt(classId), userId);
    if (!cls) return res.status(403).json({ error: '你不是该班级的教师' });

    const existing = db.prepare('SELECT id FROM chat_rooms WHERE class_id = ? AND type = ?').get(cls.id, 'class');
    if (existing) return res.json({ roomId: existing.id });

    const result = db.prepare(
        'INSERT INTO chat_rooms (name, type, class_id, owner_id) VALUES (?, ?, ?, ?)'
    ).run(cls.name + ' 班级群', 'class', cls.id, userId);

    const roomId = result.lastInsertRowid;
    db.prepare('INSERT INTO chat_room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(roomId, userId, 'admin');

    const members = db.prepare('SELECT user_id FROM class_members WHERE class_id = ?').all(cls.id);
    const insertMember = db.prepare('INSERT OR IGNORE INTO chat_room_members (room_id, user_id, role) VALUES (?, ?, ?)');
    members.forEach(m => {
        if (m.user_id !== userId) insertMember.run(roomId, m.user_id, 'member');
    });

    res.json({ roomId });
});

// 创建小组群聊
router.post('/rooms/group', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const { groupId, name } = req.body;

    if (!groupId) return res.status(400).json({ error: '缺少小组ID' });

    const membership = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(parseInt(groupId), userId);
    if (!membership) return res.status(403).json({ error: '你不是该小组的成员' });

    const grp = db.prepare('SELECT * FROM student_groups WHERE id = ?').get(parseInt(groupId));
    if (!grp) return res.status(404).json({ error: '小组不存在' });

    const existing = db.prepare('SELECT id FROM chat_rooms WHERE group_id = ? AND type = ?').get(grp.id, 'group');
    if (existing) return res.json({ roomId: existing.id });

    const result = db.prepare(
        'INSERT INTO chat_rooms (name, type, group_id, owner_id) VALUES (?, ?, ?, ?)'
    ).run(name || grp.name + ' 小组群', 'group', grp.id, userId);

    const roomId = result.lastInsertRowid;
    const groupMembers = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(grp.id);
    const insertMbr = db.prepare('INSERT OR IGNORE INTO chat_room_members (room_id, user_id, role) VALUES (?, ?, ?)');
    groupMembers.forEach(m => {
        insertMbr.run(roomId, m.user_id, m.user_id === grp.created_by ? 'admin' : 'member');
    });

    res.json({ roomId });
});

// 获取房间详情（含成员列表）
router.get('/rooms/:roomId', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const roomId = parseInt(req.params.roomId);

    const memberCheck = db.prepare('SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    if (!memberCheck) return res.status(403).json({ error: '你不是该聊天室的成员' });

    const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(roomId);
    if (!room) return res.status(404).json({ error: '聊天室不存在' });

    const members = db.prepare(`
        SELECT u.id, u.username, u.avatar, u.bio, crm.role, crm.is_muted
        FROM chat_room_members crm
        JOIN users u ON crm.user_id = u.id
        WHERE crm.room_id = ?
    `).all(roomId);

    const bounties = db.prepare(`
        SELECT cb.*, u.username as author_name
        FROM chat_bounties cb
        JOIN users u ON cb.author_id = u.id
        WHERE cb.room_id = ? AND cb.status = 'open'
        ORDER BY cb.created_at DESC
    `).all(roomId);

    const activities = db.prepare(`
        SELECT * FROM chat_activities
        WHERE room_id = ? AND status = 'active'
        ORDER BY created_at DESC
    `).all(roomId);

    res.json({ room, members, bounties, activities, myRole: memberCheck.role });
});

// ==================== 群组消息 ====================

// 获取房间消息（分页）
router.get('/rooms/:roomId/messages', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const roomId = parseInt(req.params.roomId);
    const before = req.query.before;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const memberCheck = db.prepare('SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    if (!memberCheck) return res.status(403).json({ error: '无权访问' });

    let query = `
        SELECT cm.*, u.username as sender_name, u.avatar as sender_avatar,
            (SELECT COALESCE(SUM(amount),0) FROM chat_tips WHERE message_id = cm.id) as tip_total
        FROM chat_messages cm
        JOIN users u ON cm.sender_id = u.id
        WHERE cm.room_id = ?
    `;
    const params = [roomId];

    if (before) {
        query += ' AND cm.id < ?';
        params.push(parseInt(before));
    }
    query += ' ORDER BY cm.id DESC LIMIT ?';
    params.push(limit);

    const messages = db.prepare(query).all(...params);

    if (messages.length > 0) {
        const maxId = messages[0].id;
        db.prepare('UPDATE chat_room_members SET last_read_msg_id = MAX(last_read_msg_id, ?) WHERE room_id = ? AND user_id = ?')
            .run(maxId, roomId, userId);
    }

    res.json({ messages: messages.reverse() });
});

// 发送消息到房间
router.post('/rooms/:roomId/messages', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const roomId = parseInt(req.params.roomId);
    const { content, type, metadata, replyTo } = req.body;

    if (!content?.trim()) return res.status(400).json({ error: '消息不能为空' });
    if (content.length > 5000) return res.status(400).json({ error: '消息不能超过5000字' });

    const memberCheck = db.prepare('SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    if (!memberCheck) return res.status(403).json({ error: '无权发送' });

    const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(roomId);
    if (room.is_muted && memberCheck.role === 'member') {
        return res.status(403).json({ error: '当前聊天室已全员禁言' });
    }
    if (memberCheck.is_muted) {
        return res.status(403).json({ error: '你已被禁言' });
    }

    const msgType = type || 'text';
    const msgMeta = metadata ? JSON.stringify(metadata) : '{}';

    const result = db.prepare(
        'INSERT INTO chat_messages (room_id, sender_id, content, type, metadata, reply_to) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(roomId, userId, content.trim(), msgType, msgMeta, replyTo || null);

    const message = db.prepare(`
        SELECT cm.*, u.username as sender_name, u.avatar as sender_avatar
        FROM chat_messages cm
        JOIN users u ON cm.sender_id = u.id
        WHERE cm.id = ?
    `).get(result.lastInsertRowid);

    db.prepare('UPDATE chat_room_members SET last_read_msg_id = ? WHERE room_id = ? AND user_id = ?')
        .run(message.id, roomId, userId);

    res.json({ success: true, message });
});

// ==================== 教师管理功能 ====================

// 全员禁言/解除禁言
router.post('/rooms/:roomId/mute-all', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const roomId = parseInt(req.params.roomId);
    const { muted } = req.body;

    const memberCheck = db.prepare('SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    if (!memberCheck || memberCheck.role !== 'admin') {
        return res.status(403).json({ error: '只有管理员可以操作' });
    }

    db.prepare('UPDATE chat_rooms SET is_muted = ? WHERE id = ?').run(muted ? 1 : 0, roomId);
    db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type) VALUES (?, ?, ?, ?)')
        .run(roomId, userId, muted ? '🔇 教师已开启全员禁言' : '🔊 教师已解除全员禁言', 'system');

    res.json({ success: true, muted: !!muted });
});

// 禁言/解禁某个成员
router.post('/rooms/:roomId/mute-user', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const roomId = parseInt(req.params.roomId);
    const { targetUserId, muted } = req.body;

    const memberCheck = db.prepare('SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    if (!memberCheck || memberCheck.role !== 'admin') {
        return res.status(403).json({ error: '只有管理员可以操作' });
    }

    db.prepare('UPDATE chat_room_members SET is_muted = ? WHERE room_id = ? AND user_id = ?')
        .run(muted ? 1 : 0, roomId, parseInt(targetUserId));

    res.json({ success: true });
});

// 发布公告
router.post('/rooms/:roomId/announcement', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const roomId = parseInt(req.params.roomId);
    const { announcement } = req.body;

    const memberCheck = db.prepare('SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
    if (!memberCheck || memberCheck.role !== 'admin') {
        return res.status(403).json({ error: '只有管理员可以操作' });
    }

    db.prepare('UPDATE chat_rooms SET announcement = ? WHERE id = ?').run(announcement || '', roomId);
    db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type) VALUES (?, ?, ?, ?)')
        .run(roomId, userId, '📢 公告已更新: ' + (announcement || '(已清空)'), 'system');

    res.json({ success: true });
});

// ==================== 答疑工单 (Ticket) ====================

// 创建答疑工单
router.post('/tickets', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const { classId, title, projectUrl, errorLog } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: '标题不能为空' });

    let roomId;
    if (classId) {
        const classRoom = db.prepare('SELECT id FROM chat_rooms WHERE class_id = ? AND type = ?').get(parseInt(classId), 'class');
        if (classRoom) roomId = classRoom.id;
    }

    if (!roomId) {
        const result = db.prepare('INSERT INTO chat_rooms (name, type, owner_id) VALUES (?, ?, ?)')
            .run('答疑: ' + title.trim(), 'ticket', userId);
        roomId = result.lastInsertRowid;
        db.prepare('INSERT INTO chat_room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(roomId, userId, 'member');
    }

    const result = db.prepare(`
        INSERT INTO chat_tickets (room_id, student_id, title, project_url, error_log)
        VALUES (?, ?, ?, ?, ?)
    `).run(roomId, userId, title.trim(), projectUrl || '', errorLog || '');

    let ticketMsg = `🎫 **答疑工单** #${result.lastInsertRowid}\n**${title.trim()}**`;
    if (projectUrl) ticketMsg += `\n🔗 项目链接: ${projectUrl}`;
    if (errorLog) ticketMsg += `\n\`\`\`\n${errorLog.substring(0, 500)}\n\`\`\``;

    db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type, metadata) VALUES (?, ?, ?, ?, ?)')
        .run(roomId, userId, ticketMsg, 'ticket', JSON.stringify({ ticketId: result.lastInsertRowid }));

    res.json({ success: true, ticketId: result.lastInsertRowid, roomId });
});

// 获取答疑工单列表
router.get('/tickets', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const status = req.query.status || 'all';
    const classId = req.query.classId;

    let query = `
        SELECT ct.*, u.username as student_name, au.username as assignee_name
        FROM chat_tickets ct
        JOIN users u ON ct.student_id = u.id
        LEFT JOIN users au ON ct.assignee_id = au.id
        WHERE 1=1
    `;
    const params = [];

    if (classId) {
        query += ' AND ct.room_id IN (SELECT id FROM chat_rooms WHERE class_id = ?)';
        params.push(parseInt(classId));
    }
    if (status !== 'all') {
        query += ' AND ct.status = ?';
        params.push(status);
    }

    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (user.role !== 'teacher' && user.role !== 'admin') {
        query += ' AND ct.student_id = ?';
        params.push(userId);
    }

    query += ' ORDER BY ct.created_at DESC LIMIT 50';
    const tickets = db.prepare(query).all(...params);
    res.json({ tickets });
});

// 接单/转交/结单
router.post('/tickets/:ticketId/status', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const ticketId = parseInt(req.params.ticketId);
    const { action, assigneeId } = req.body;

    const ticket = db.prepare('SELECT * FROM chat_tickets WHERE id = ?').get(ticketId);
    if (!ticket) return res.status(404).json({ error: '工单不存在' });

    switch (action) {
        case 'accept':
            db.prepare('UPDATE chat_tickets SET assignee_id = ?, status = ? WHERE id = ?')
                .run(userId, 'in_progress', ticketId);
            db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type) VALUES (?, ?, ?, ?)')
                .run(ticket.room_id, userId, `✅ 已接单工单 #${ticketId}`, 'system');
            break;
        case 'transfer':
            if (!assigneeId) return res.status(400).json({ error: '需要指定转交人' });
            db.prepare('UPDATE chat_tickets SET assignee_id = ? WHERE id = ?').run(parseInt(assigneeId), ticketId);
            const transferee = db.prepare('SELECT username FROM users WHERE id = ?').get(parseInt(assigneeId));
            db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type) VALUES (?, ?, ?, ?)')
                .run(ticket.room_id, userId, `🔄 工单 #${ticketId} 已转交给 ${transferee?.username}`, 'system');
            break;
        case 'resolve':
            db.prepare('UPDATE chat_tickets SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run('resolved', ticketId);
            db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type) VALUES (?, ?, ?, ?)')
                .run(ticket.room_id, userId, `🎉 工单 #${ticketId} 已解决`, 'system');
            break;
        case 'close':
            db.prepare('UPDATE chat_tickets SET status = ? WHERE id = ?').run('closed', ticketId);
            break;
        default:
            return res.status(400).json({ error: '无效操作' });
    }

    res.json({ success: true });
});

// ==================== 金币悬赏 ====================

// 发布悬赏提问
router.post('/bounties', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const { roomId, title, content, amount } = req.body;
    const bountyAmount = parseInt(amount);

    if (!roomId || !title?.trim() || !bountyAmount || bountyAmount <= 0) {
        return res.status(400).json({ error: '参数不完整' });
    }
    if (bountyAmount > 100) {
        return res.status(400).json({ error: '单次悬赏不超过100金币' });
    }

    const memberCheck = db.prepare('SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(parseInt(roomId), userId);
    if (!memberCheck) return res.status(403).json({ error: '无权发布' });

    const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(userId);
    if (user.coins < bountyAmount) {
        return res.status(400).json({ error: '金币不足' });
    }

    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(bountyAmount, userId);
    db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
        .run(userId, -bountyAmount, 'bounty_freeze', `悬赏提问: ${title.trim()}`);

    const result = db.prepare(`
        INSERT INTO chat_bounties (room_id, author_id, title, content, amount)
        VALUES (?, ?, ?, ?, ?)
    `).run(parseInt(roomId), userId, title.trim(), content || '', bountyAmount);

    db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type, metadata) VALUES (?, ?, ?, ?, ?)')
        .run(parseInt(roomId), userId, `🏆 **悬赏 ${bountyAmount} 金币** | ${title.trim()}\n${content || ''}`, 'bounty',
            JSON.stringify({ bountyId: result.lastInsertRowid, amount: bountyAmount }));

    res.json({ success: true, bountyId: result.lastInsertRowid });
});

// 采纳答案（悬赏发起人）
router.post('/bounties/:bountyId/accept', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const bountyId = parseInt(req.params.bountyId);
    const { messageId } = req.body;

    const bounty = db.prepare('SELECT * FROM chat_bounties WHERE id = ?').get(bountyId);
    if (!bounty) return res.status(404).json({ error: '悬赏不存在' });
    if (bounty.author_id !== userId) return res.status(403).json({ error: '只有发起人可以采纳' });
    if (bounty.status !== 'open') return res.status(400).json({ error: '悬赏已结束' });

    const answerMsg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(parseInt(messageId));
    if (!answerMsg) return res.status(404).json({ error: '回答消息不存在' });

    const winnerId = answerMsg.sender_id;

    const transaction = db.transaction(() => {
        db.prepare('UPDATE chat_bounties SET status = ?, winner_id = ?, winner_msg_id = ? WHERE id = ?')
            .run('resolved', winnerId, parseInt(messageId), bountyId);
        db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(bounty.amount, winnerId);
        db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
            .run(winnerId, bounty.amount, 'bounty_won', `悬赏回答被采纳: ${bounty.title}`);

        const quarter = getQuarter();
        db.prepare(`
            INSERT INTO chat_helper_stats (user_id, bounties_won, quarter) VALUES (?, ?, ?)
            ON CONFLICT(user_id, quarter) DO UPDATE SET bounties_won = bounties_won + ?
        `).run(winnerId, bounty.amount, quarter, bounty.amount);
    });
    transaction();

    const winner = db.prepare('SELECT username FROM users WHERE id = ?').get(winnerId);
    db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type) VALUES (?, ?, ?, ?)')
        .run(bounty.room_id, userId, `🎉 悬赏已结束！${winner.username} 获得 ${bounty.amount} 金币`, 'system');

    res.json({ success: true });
});

// ==================== 消息打赏 ====================

// 对消息打赏金币
router.post('/tips', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const { messageId, amount } = req.body;
    const tipAmount = parseInt(amount);

    if (!messageId || !tipAmount || tipAmount <= 0 || tipAmount > 50) {
        return res.status(400).json({ error: '打赏金额需在1-50之间' });
    }

    const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(parseInt(messageId));
    if (!msg) return res.status(404).json({ error: '消息不存在' });
    if (msg.sender_id === userId) return res.status(400).json({ error: '不能打赏自己' });

    const sender = db.prepare('SELECT coins FROM users WHERE id = ?').get(userId);
    if (sender.coins < tipAmount) return res.status(400).json({ error: '金币不足' });

    const transaction = db.transaction(() => {
        db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(tipAmount, userId);
        db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(tipAmount, msg.sender_id);
        db.prepare('INSERT INTO chat_tips (message_id, from_id, to_id, amount) VALUES (?, ?, ?, ?)')
            .run(parseInt(messageId), userId, msg.sender_id, tipAmount);
        db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
            .run(userId, -tipAmount, 'tip_sent', '聊天打赏');
        db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
            .run(msg.sender_id, tipAmount, 'tip_received', '收到聊天打赏');

        const quarter = getQuarter();
        db.prepare(`
            INSERT INTO chat_helper_stats (user_id, tips_received, quarter) VALUES (?, ?, ?)
            ON CONFLICT(user_id, quarter) DO UPDATE SET tips_received = tips_received + ?
        `).run(msg.sender_id, tipAmount, quarter, tipAmount);
    });
    transaction();

    res.json({ success: true, remaining: sender.coins - tipAmount });
});

// ==================== 课堂互动活动 ====================

// 教师发起抢答/签到
router.post('/activities', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const { roomId, type, title, content, duration, rewards } = req.body;

    if (!roomId || !type) return res.status(400).json({ error: '参数不完整' });

    const memberCheck = db.prepare('SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(parseInt(roomId), userId);
    if (!memberCheck || memberCheck.role !== 'admin') {
        return res.status(403).json({ error: '只有管理员/教师可以发起' });
    }

    const result = db.prepare(`
        INSERT INTO chat_activities (room_id, teacher_id, type, title, content, duration, rewards)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(parseInt(roomId), userId, type, title || '', JSON.stringify(content || {}), duration || 60, JSON.stringify(rewards || [5, 3, 2]));

    const activityId = result.lastInsertRowid;

    let activityMsg = '';
    if (type === 'quiz') {
        activityMsg = `🎯 **抢答题** | ${title}\n${typeof content === 'object' ? content.question || '' : ''}\n⏱️ 限时 ${duration || 60} 秒`;
    } else if (type === 'checkin') {
        activityMsg = `✋ **课堂签到** | 限时 ${duration || 60} 秒\n请在倒计时结束前点击签到！`;
    } else if (type === 'code_fill') {
        activityMsg = `💻 **代码填空** | ${title}\n⏱️ 限时 ${duration || 60} 秒`;
    }

    db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type, metadata) VALUES (?, ?, ?, ?, ?)')
        .run(parseInt(roomId), userId, activityMsg, 'activity', JSON.stringify({ activityId, type, duration: duration || 60 }));

    res.json({ success: true, activityId });
});

// 学生参与活动（抢答/签到）
router.post('/activities/:activityId/respond', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const activityId = parseInt(req.params.activityId);
    const { answer } = req.body;

    const activity = db.prepare('SELECT * FROM chat_activities WHERE id = ?').get(activityId);
    if (!activity) return res.status(404).json({ error: '活动不存在' });
    if (activity.status !== 'active') return res.status(400).json({ error: '活动已结束' });

    const startTime = new Date(activity.created_at).getTime();
    const now = Date.now();
    if (now - startTime > activity.duration * 1000) {
        db.prepare('UPDATE chat_activities SET status = ? WHERE id = ?').run('ended', activityId);
        return res.status(400).json({ error: '活动已超时' });
    }

    const existing = db.prepare('SELECT * FROM chat_activity_responses WHERE activity_id = ? AND user_id = ?').get(activityId, userId);
    if (existing) return res.status(400).json({ error: '你已经参与过了' });

    const currentCount = db.prepare('SELECT COUNT(*) as c FROM chat_activity_responses WHERE activity_id = ?').get(activityId).c;
    const rank = currentCount + 1;

    let isCorrect = 0;
    let coinsEarned = 0;
    const rewards = JSON.parse(activity.rewards || '[5,3,2]');

    if (activity.type === 'quiz' || activity.type === 'code_fill') {
        const contentObj = JSON.parse(activity.content || '{}');
        const correctAnswer = contentObj.answer || '';
        isCorrect = answer?.trim().toLowerCase() === correctAnswer.trim().toLowerCase() ? 1 : 0;

        if (isCorrect && rank <= rewards.length) {
            coinsEarned = rewards[rank - 1];
            db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(coinsEarned, userId);
            db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
                .run(userId, coinsEarned, 'quiz_reward', `抢答第${rank}名奖励`);
        }
    } else if (activity.type === 'checkin') {
        isCorrect = 1;
        if (rank <= 3) {
            coinsEarned = rewards[rank - 1] || 1;
            db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(coinsEarned, userId);
            db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
                .run(userId, coinsEarned, 'checkin_reward', `签到速度第${rank}名`);
        }
    }

    db.prepare(`
        INSERT INTO chat_activity_responses (activity_id, user_id, answer, is_correct, rank_position, coins_earned)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(activityId, userId, answer || '', isCorrect, rank, coinsEarned);

    if (isCorrect && rank <= 3) {
        const username = db.prepare('SELECT username FROM users WHERE id = ?').get(userId).username;
        db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type, metadata) VALUES (?, ?, ?, ?, ?)')
            .run(activity.room_id, activity.teacher_id,
                `🏅 ${username} 以第${rank}名正确${activity.type === 'checkin' ? '签到' : '回答'}，获得 ${coinsEarned} 金币！`,
                'system', JSON.stringify({ type: 'celebration', rank }));
    }

    res.json({ success: true, rank, isCorrect: !!isCorrect, coinsEarned });
});

// 结束活动
router.post('/activities/:activityId/end', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const activityId = parseInt(req.params.activityId);

    const activity = db.prepare('SELECT * FROM chat_activities WHERE id = ?').get(activityId);
    if (!activity) return res.status(404).json({ error: '活动不存在' });
    if (activity.teacher_id !== userId) return res.status(403).json({ error: '只有发起者可以结束' });

    db.prepare('UPDATE chat_activities SET status = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?').run('ended', activityId);

    const responses = db.prepare('SELECT COUNT(*) as total, SUM(is_correct) as correct FROM chat_activity_responses WHERE activity_id = ?').get(activityId);
    db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type) VALUES (?, ?, ?, ?)')
        .run(activity.room_id, userId, `📊 活动结束！参与人数: ${responses.total}，正确: ${responses.correct || 0}`, 'system');

    res.json({ success: true });
});

// ==================== 报错一键求助 ====================

router.post('/share-error', (req, res) => {
    const db = getDb();
    const userId = req.user.id;
    const { roomId, errorMessage, codeSnippet, projectUrl } = req.body;

    if (!roomId || !errorMessage) return res.status(400).json({ error: '参数不完整' });

    const memberCheck = db.prepare('SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(parseInt(roomId), userId);
    if (!memberCheck) return res.status(403).json({ error: '无权发送' });

    let content = `🚨 **报错求助**\n`;
    content += `\`\`\`\n${errorMessage.substring(0, 1000)}\n\`\`\`\n`;
    if (codeSnippet) content += `**相关代码:**\n\`\`\`\n${codeSnippet.substring(0, 2000)}\n\`\`\`\n`;
    if (projectUrl) content += `🔗 [查看项目](${projectUrl})`;

    db.prepare('INSERT INTO chat_messages (room_id, sender_id, content, type, metadata) VALUES (?, ?, ?, ?, ?)')
        .run(parseInt(roomId), userId, content, 'error_share',
            JSON.stringify({ errorMessage: errorMessage.substring(0, 500), projectUrl }));

    res.json({ success: true });
});

// ==================== 答疑排行榜 ====================

router.get('/leaderboard', (req, res) => {
    const db = getDb();
    const quarter = req.query.quarter || getQuarter();

    const leaderboard = db.prepare(`
        SELECT chs.*, u.username, u.avatar
        FROM chat_helper_stats chs
        JOIN users u ON chs.user_id = u.id
        WHERE chs.quarter = ?
        ORDER BY (chs.accepted_count * 10 + chs.tips_received + chs.bounties_won) DESC
        LIMIT 20
    `).all(quarter);

    res.json({ leaderboard, quarter });
});

// ==================== 兼容旧版私信接口 ====================

// 获取会话列表（兼容旧版）
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

// 获取与某个用户的消息记录（兼容旧版）
router.get('/messages/:userId', (req, res) => {
    const db = getDb();
    const myId = req.user.id;
    const otherId = parseInt(req.params.userId);
    const before = req.query.before;
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
    db.prepare('UPDATE messages SET is_read = 1 WHERE from_id = ? AND to_id = ? AND is_read = 0')
        .run(otherId, myId);

    const otherUser = db.prepare('SELECT id, username, avatar, bio FROM users WHERE id = ?').get(otherId);
    res.json({ messages: messages.reverse(), user: otherUser });
});

// 发送消息（兼容旧版）
router.post('/send', (req, res) => {
    const db = getDb();
    const { toUserId, content, type } = req.body;

    if (!toUserId || !content?.trim()) {
        return res.status(400).json({ error: '消息内容不能为空' });
    }
    if (content.length > 5000) {
        return res.status(400).json({ error: '消息不能超过5000字' });
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
    const userId = req.user.id;
    const oldUnread = db.prepare('SELECT COUNT(*) as count FROM messages WHERE to_id = ? AND is_read = 0').get(userId);
    const newUnread = db.prepare(`
        SELECT COALESCE(SUM(
            (SELECT COUNT(*) FROM chat_messages WHERE room_id = crm.room_id AND id > crm.last_read_msg_id)
        ), 0) as count
        FROM chat_room_members crm WHERE crm.user_id = ?
    `).get(userId);

    res.json({ unread: (oldUnread?.count || 0) + (newUnread?.count || 0) });
});

// 赠送金币（兼容旧版）
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
        db.prepare('INSERT INTO messages (from_id, to_id, content, type) VALUES (?, ?, ?, ?)').run(
            req.user.id, receiver.id, `🎁 赠送了 ${coinAmount} 金币`, 'gift'
        );
    });
    transaction();

    const newBalance = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id).coins;
    res.json({ success: true, coins: newBalance, message: `已赠送 ${receiver.username} ${coinAmount} 金币` });
});

// 根据 username 获取用户ID
router.get('/user-by-name/:username', (req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT id, username, avatar, bio FROM users WHERE username = ?').get(req.params.username);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ user });
});

// ==================== 好友系统 ====================

// 计算两个用户的好友关系状态
function friendStatus(db, meId, otherId) {
    if (meId === otherId) return 'self';
    const row = db.prepare(
        `SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`
    ).get(meId, otherId, otherId, meId);
    if (!row) return 'none';
    if (row.status === 'accepted') return 'friends';
    if (row.status === 'pending') return row.requester_id === meId ? 'requested' : 'incoming';
    return 'none';
}

// 搜索用户（按用户名/邮箱模糊，返回好友状态）
router.get('/users/search', (req, res) => {
    const db = getDb();
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ users: [] });
    const meId = req.user.id;
    const rows = db.prepare(
        `SELECT id, username, avatar, bio, role FROM users
         WHERE (username LIKE ? OR email LIKE ?) AND id != ? LIMIT 20`
    ).all(`%${q}%`, `%${q}%`, meId);
    const users = rows.map(u => ({ ...u, status: friendStatus(db, meId, u.id) }));
    res.json({ users });
});

// 发送好友请求
router.post('/friends/request', (req, res) => {
    const db = getDb();
    const meId = req.user.id;
    const targetId = parseInt(req.body.userId);
    if (!targetId || targetId === meId) return res.status(400).json({ error: '无效的用户' });
    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: '用户不存在' });

    const status = friendStatus(db, meId, targetId);
    if (status === 'friends') return res.status(400).json({ error: '你们已经是好友' });
    if (status === 'requested') return res.status(400).json({ error: '已发送过请求，等待对方确认' });
    if (status === 'incoming') {
        // 对方已请求过我 → 直接互相成为好友
        db.prepare("UPDATE friendships SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE requester_id = ? AND addressee_id = ?")
            .run(targetId, meId);
        notifyFriend(targetId, { type: 'friend_accepted', user: { id: meId, username: req.user.username } });
        return res.json({ success: true, status: 'friends', message: '已添加为好友' });
    }
    db.prepare('INSERT INTO friendships (requester_id, addressee_id, status, remark) VALUES (?, ?, ?, ?)')
        .run(meId, targetId, 'pending', (req.body.remark || '').slice(0, 100));
    notifyFriend(targetId, { type: 'friend_request', user: { id: meId, username: req.user.username } });
    res.json({ success: true, status: 'requested', message: '好友请求已发送' });
});

// 收到的好友请求列表
router.get('/friends/requests', (req, res) => {
    const db = getDb();
    const meId = req.user.id;
    const incoming = db.prepare(
        `SELECT f.id, f.remark, f.created_at, u.id AS user_id, u.username, u.avatar, u.bio
         FROM friendships f JOIN users u ON u.id = f.requester_id
         WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`
    ).all(meId);
    const outgoing = db.prepare(
        `SELECT f.id, f.created_at, u.id AS user_id, u.username, u.avatar
         FROM friendships f JOIN users u ON u.id = f.addressee_id
         WHERE f.requester_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`
    ).all(meId);
    res.json({ incoming, outgoing });
});

// 接受/拒绝好友请求
router.post('/friends/respond', (req, res) => {
    const db = getDb();
    const meId = req.user.id;
    const requestId = parseInt(req.body.requestId);
    const accept = !!req.body.accept;
    const fr = db.prepare('SELECT * FROM friendships WHERE id = ? AND addressee_id = ? AND status = ?')
        .get(requestId, meId, 'pending');
    if (!fr) return res.status(404).json({ error: '请求不存在或已处理' });

    if (accept) {
        db.prepare("UPDATE friendships SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(requestId);
        notifyFriend(fr.requester_id, { type: 'friend_accepted', user: { id: meId, username: req.user.username } });
        res.json({ success: true, status: 'friends' });
    } else {
        db.prepare('DELETE FROM friendships WHERE id = ?').run(requestId);
        res.json({ success: true, status: 'rejected' });
    }
});

// 好友列表（含在线/资料）
router.get('/friends', (req, res) => {
    const db = getDb();
    const meId = req.user.id;
    const friends = db.prepare(
        `SELECT u.id, u.username, u.avatar, u.bio, u.role, f.created_at AS since
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
         WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
         ORDER BY u.username`
    ).all(meId, meId, meId);
    res.json({ friends });
});

// 删除好友
router.delete('/friends/:userId', (req, res) => {
    const db = getDb();
    const meId = req.user.id;
    const otherId = parseInt(req.params.userId);
    db.prepare(
        `DELETE FROM friendships WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)) AND status = 'accepted'`
    ).run(meId, otherId, otherId, meId);
    res.json({ success: true });
});

// 好友请求实时通知
function notifyFriend(userId, payload) {
    try {
        const { sendToUser } = require('../websocket');
        if (sendToUser) sendToUser(userId, payload);
    } catch (e) { /* ws 不可用时忽略 */ }
}

// ==================== 辅助函数 ====================
function getQuarter() {
    const now = new Date();
    const q = Math.ceil((now.getMonth() + 1) / 3);
    return `${now.getFullYear()}-Q${q}`;
}

module.exports = router;
