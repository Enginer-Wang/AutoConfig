/**
 * 课堂互动聊天室路由
 * 绑定班级「永久聊天室」(chat_rooms type=class)，与直播课堂联动。
 * 功能：实时消息(WS) / 代码块 / 文件传输 / 表态Reaction / 引用回复 /
 *       消息撤回删除 / 已读未读(教师) / DING强提醒 / 弹幕模式 /
 *       代码分享卡片 / 置顶公告 / 敏感词过滤 / 发言限流 / 课堂活跃度分析
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { notifyChat, sendToUser } = require('../websocket');

const router = express.Router();
router.use(authMiddleware);

// ===== 文件上传配置 =====
const UPLOAD_DIR = path.join(__dirname, '../../data/uploads/chat');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.zip', '.rar', '.txt', '.html', '.css', '.js', '.py', '.java', '.cpp', '.c', '.md', '.json', '.webm', '.mp3', '.wav', '.m4a'];
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, crypto.randomBytes(12).toString('hex') + ext);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED.includes(ext)) cb(null, true); else cb(new Error('不支持的文件类型: ' + ext));
    }
});

// ===== 敏感词过滤 =====
const SENSITIVE_WORDS = ['傻逼', 'sb', '去死', '滚蛋', '废物', '操你', '日你', '妈的', '法轮', '赌博', '色情', '枪支', '毒品'];
function filterSensitive(text) {
    if (!text) return { text, hit: false };
    let hit = false;
    let out = text;
    for (const w of SENSITIVE_WORDS) {
        if (!w) continue;
        const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        if (re.test(out)) { hit = true; out = out.replace(re, '*'.repeat(w.length)); }
    }
    return { text: out, hit };
}

// ===== 发言限流（内存：userId:roomId -> 上次发言时间） =====
const lastSpeak = new Map();
const RATE_MS = 800;

// ===== 工具：确保班级永久聊天室存在并保证成员关系 =====
function ensureClassRoom(db, classId, user) {
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return { error: '班级不存在', code: 404 };
    const isMember = cls.teacher_id === user.id ||
        db.prepare('SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, user.id);
    if (!isMember) return { error: '非本班成员', code: 403 };

    let room = db.prepare("SELECT * FROM chat_rooms WHERE class_id = ? AND type = 'class'").get(classId);
    if (!room) {
        const r = db.prepare('INSERT INTO chat_rooms (name, type, class_id, owner_id) VALUES (?, ?, ?, ?)')
            .run(cls.name + ' 班级群', 'class', classId, cls.teacher_id);
        const roomId = r.lastInsertRowid;
        db.prepare('INSERT OR IGNORE INTO chat_room_members (room_id, user_id, role) VALUES (?, ?, ?)')
            .run(roomId, cls.teacher_id, 'admin');
        const members = db.prepare('SELECT user_id FROM class_members WHERE class_id = ?').all(classId);
        const ins = db.prepare('INSERT OR IGNORE INTO chat_room_members (room_id, user_id, role) VALUES (?, ?, ?)');
        members.forEach(m => { if (m.user_id !== cls.teacher_id) ins.run(roomId, m.user_id, 'member'); });
        room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(roomId);
    }
    // 保证当前用户也是成员（新加入班级的学生）
    const role = cls.teacher_id === user.id ? 'admin' : 'member';
    db.prepare('INSERT OR IGNORE INTO chat_room_members (room_id, user_id, role) VALUES (?, ?, ?)')
        .run(room.id, user.id, role);
    return { room, cls, isTeacher: cls.teacher_id === user.id };
}

function getMember(db, roomId, userId) {
    return db.prepare('SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
}
function isAdmin(member) { return member && member.role === 'admin'; }

// 聚合消息的表态、回复预览、删除态
function decorateMessages(db, messages, viewerId) {
    if (!messages.length) return messages;
    const ids = messages.map(m => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const reactions = db.prepare(
        `SELECT message_id, emoji, COUNT(*) AS cnt, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine
         FROM chat_message_reactions WHERE message_id IN (${placeholders}) GROUP BY message_id, emoji`
    ).all(viewerId, ...ids);
    const rmap = {};
    reactions.forEach(r => {
        (rmap[r.message_id] = rmap[r.message_id] || []).push({ emoji: r.emoji, count: r.cnt, mine: r.mine > 0 });
    });
    const replyIds = messages.filter(m => m.reply_to).map(m => m.reply_to);
    let replyMap = {};
    if (replyIds.length) {
        const ph = replyIds.map(() => '?').join(',');
        const replies = db.prepare(
            `SELECT cm.id, cm.content, cm.is_deleted, u.username FROM chat_messages cm
             JOIN users u ON u.id = cm.sender_id WHERE cm.id IN (${ph})`
        ).all(...replyIds);
        replies.forEach(r => { replyMap[r.id] = r; });
    }
    return messages.map(m => {
        m.reactions = rmap[m.id] || [];
        if (m.reply_to && replyMap[m.reply_to]) {
            const r = replyMap[m.reply_to];
            m.reply_preview = { id: r.id, username: r.username, content: r.is_deleted ? '[消息已撤回]' : String(r.content).slice(0, 80) };
        }
        if (m.is_deleted) m.content = '[消息已撤回]';
        return m;
    });
}

// ==================== 进入课堂聊天室 ====================

// 获取/初始化班级聊天室
router.get('/room', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.query.classId);
    if (!classId) return res.status(400).json({ error: '请指定班级' });
    const r = ensureClassRoom(db, classId, req.user);
    if (r.error) return res.status(r.code).json({ error: r.error });
    const member = getMember(db, r.room.id, req.user.id);
    res.json({
        success: true,
        room: r.room,
        myRole: member.role,
        isTeacher: r.isTeacher,
        muted: !!r.room.is_muted,
        selfMuted: !!member.is_muted,
        announcement: r.room.announcement || '',
        danmakuOn: !!r.room.danmaku_on
    });
});

// 历史消息（默认最近 50 条，断线重连补上下文）
router.get('/room/:roomId/messages', (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const member = getMember(db, roomId, req.user.id);
    if (!member) return res.status(403).json({ error: '无权访问' });
    const before = req.query.before;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    let q = `SELECT cm.*, u.username AS sender_name, u.avatar AS sender_avatar
             FROM chat_messages cm JOIN users u ON u.id = cm.sender_id
             WHERE cm.room_id = ?`;
    const params = [roomId];
    if (before) { q += ' AND cm.id < ?'; params.push(parseInt(before)); }
    q += ' ORDER BY cm.id DESC LIMIT ?'; params.push(limit);
    let messages = db.prepare(q).all(...params).reverse();
    messages = decorateMessages(db, messages, req.user.id);

    // 附加签到/投票活动的实时结果
    messages.forEach(m => {
        if (m.type === 'activity') {
            try {
                const meta = JSON.parse(m.metadata || '{}');
                if (meta.activityId) {
                    const act = db.prepare('SELECT * FROM chat_activities WHERE id = ?').get(meta.activityId);
                    if (act) {
                        m.activity = computeActivityResults(db, act);
                        const mine = db.prepare('SELECT answer FROM chat_activity_responses WHERE activity_id = ? AND user_id = ?').get(act.id, req.user.id);
                        m.activity.myAnswer = mine ? mine.answer : null;
                    }
                }
            } catch (e) { /* ignore */ }
        }
    });

    if (messages.length) {
        const maxId = messages[messages.length - 1].id;
        db.prepare('UPDATE chat_room_members SET last_read_msg_id = MAX(last_read_msg_id, ?) WHERE room_id = ? AND user_id = ?')
            .run(maxId, roomId, req.user.id);
    }
    res.json({ success: true, messages, pinned: getPinned(db, roomId) });
});

function getPinned(db, roomId) {
    return db.prepare(`SELECT cm.*, u.username AS sender_name FROM chat_messages cm
        JOIN users u ON u.id = cm.sender_id
        WHERE cm.room_id = ? AND cm.is_pinned = 1 AND cm.is_deleted = 0
        ORDER BY cm.id DESC LIMIT 5`).all(roomId);
}

// ==================== 发送消息 ====================

router.post('/room/:roomId/messages', (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const user = req.user;
    let { content, type, metadata, replyTo, isDanmaku } = req.body;
    if (!content || !String(content).trim()) return res.status(400).json({ error: '消息不能为空' });
    if (content.length > 5000) return res.status(400).json({ error: '消息过长' });

    const member = getMember(db, roomId, user.id);
    if (!member) return res.status(403).json({ error: '无权发送' });
    const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(roomId);
    if (!room) return res.status(404).json({ error: '聊天室不存在' });

    // 下课后只读：若聊天室处于全员禁言且非管理员
    if (room.is_muted && member.role !== 'admin') return res.status(403).json({ error: '当前已全员禁言/只读' });
    if (member.is_muted) return res.status(403).json({ error: '你已被禁言' });

    // 发言限流
    const key = user.id + ':' + roomId;
    const now = Date.now();
    if (now - (lastSpeak.get(key) || 0) < RATE_MS) return res.status(429).json({ error: '发言太快，请稍候' });
    lastSpeak.set(key, now);

    // 敏感词过滤
    const filtered = filterSensitive(String(content).trim());

    const msgType = type || 'text';
    const msgMeta = metadata ? JSON.stringify(metadata) : '{}';
    const result = db.prepare(
        'INSERT INTO chat_messages (room_id, sender_id, content, type, metadata, reply_to) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(roomId, user.id, filtered.text, msgType, msgMeta, replyTo || null);

    let message = db.prepare(`SELECT cm.*, u.username AS sender_name, u.avatar AS sender_avatar
        FROM chat_messages cm JOIN users u ON u.id = cm.sender_id WHERE cm.id = ?`).get(result.lastInsertRowid);
    message = decorateMessages(db, [message], user.id)[0];

    db.prepare('UPDATE chat_room_members SET last_read_msg_id = ? WHERE room_id = ? AND user_id = ?')
        .run(message.id, roomId, user.id);

    // 实时广播（含发送者以多端同步）
    notifyChat(roomId, { type: 'chat_message', roomId, message, isDanmaku: !!isDanmaku && !!room.danmaku_on });
    res.json({ success: true, message, sensitiveHit: filtered.hit });
});

// 文件传输（图片/课件/语音）
router.post('/room/:roomId/upload', upload.single('file'), (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const user = req.user;
    if (!req.file) return res.status(400).json({ error: '请选择文件' });
    const member = getMember(db, roomId, user.id);
    if (!member) return res.status(403).json({ error: '无权发送' });

    const url = `/api/classroom-chat/files/${req.file.filename}`;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    const isAudio = ['.webm', '.mp3', '.wav', '.m4a'].includes(ext);
    const kind = isImage ? 'image' : (isAudio ? 'voice' : 'file');
    const meta = { url, originalName: req.file.originalname, size: req.file.size, ext };

    const result = db.prepare(
        'INSERT INTO chat_messages (room_id, sender_id, content, type, metadata) VALUES (?, ?, ?, ?, ?)'
    ).run(roomId, user.id, req.file.originalname, kind, JSON.stringify(meta));
    let message = db.prepare(`SELECT cm.*, u.username AS sender_name, u.avatar AS sender_avatar
        FROM chat_messages cm JOIN users u ON u.id = cm.sender_id WHERE cm.id = ?`).get(result.lastInsertRowid);
    message = decorateMessages(db, [message], user.id)[0];
    notifyChat(roomId, { type: 'chat_message', roomId, message });
    res.json({ success: true, message });
});

router.get('/files/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const fp = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: '文件不存在' });
    res.sendFile(fp);
});

// ==================== 代码分享卡片 ====================

// 学生分享自己的代码 / 老师广播优秀示范代码(broadcast=true)
router.post('/room/:roomId/code-share', (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const user = req.user;
    const { code, filename, language, broadcast, fromUsername } = req.body;
    if (!code || !String(code).trim()) return res.status(400).json({ error: '代码为空' });
    const member = getMember(db, roomId, user.id);
    if (!member) return res.status(403).json({ error: '无权发送' });
    if (broadcast && member.role !== 'admin') return res.status(403).json({ error: '只有教师可广播示范代码' });

    const meta = {
        code: String(code).slice(0, 6000),
        filename: filename || 'snippet.txt',
        language: language || 'javascript',
        broadcast: !!broadcast,
        author: fromUsername || user.username
    };
    const title = broadcast ? `⭐ 教师广播示范代码 · ${meta.author}` : `💻 ${user.username} 分享了代码`;
    const result = db.prepare(
        'INSERT INTO chat_messages (room_id, sender_id, content, type, metadata) VALUES (?, ?, ?, ?, ?)'
    ).run(roomId, user.id, title, 'code_card', JSON.stringify(meta));
    let message = db.prepare(`SELECT cm.*, u.username AS sender_name, u.avatar AS sender_avatar
        FROM chat_messages cm JOIN users u ON u.id = cm.sender_id WHERE cm.id = ?`).get(result.lastInsertRowid);
    message = decorateMessages(db, [message], user.id)[0];
    notifyChat(roomId, { type: 'chat_message', roomId, message });
    res.json({ success: true, message });
});

// ==================== 表态 Reaction ====================

router.post('/messages/:id/react', (req, res) => {
    const db = getDb();
    const msgId = parseInt(req.params.id);
    const user = req.user;
    const emoji = (req.body.emoji || '').slice(0, 8);
    if (!emoji) return res.status(400).json({ error: '缺少表态' });
    const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(msgId);
    if (!msg) return res.status(404).json({ error: '消息不存在' });
    if (!getMember(db, msg.room_id, user.id)) return res.status(403).json({ error: '无权操作' });

    const exist = db.prepare('SELECT id FROM chat_message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
        .get(msgId, user.id, emoji);
    if (exist) db.prepare('DELETE FROM chat_message_reactions WHERE id = ?').run(exist.id);
    else db.prepare('INSERT INTO chat_message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(msgId, user.id, emoji);

    const counts = db.prepare(
        'SELECT emoji, COUNT(*) AS cnt FROM chat_message_reactions WHERE message_id = ? GROUP BY emoji'
    ).all(msgId);
    notifyChat(msg.room_id, { type: 'chat_reaction', roomId: msg.room_id, messageId: msgId, reactions: counts });
    res.json({ success: true, reactions: counts, active: !exist });
});

// ==================== 撤回 / 删除 ====================

router.post('/messages/:id/recall', (req, res) => {
    const db = getDb();
    const msgId = parseInt(req.params.id);
    const user = req.user;
    const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(msgId);
    if (!msg) return res.status(404).json({ error: '消息不存在' });
    const member = getMember(db, msg.room_id, user.id);
    if (!member) return res.status(403).json({ error: '无权操作' });
    // 发送者可撤回自己消息；管理员(教师)可删除任意消息
    if (msg.sender_id !== user.id && member.role !== 'admin') return res.status(403).json({ error: '只能撤回自己的消息' });

    db.prepare('UPDATE chat_messages SET is_deleted = 1, is_pinned = 0 WHERE id = ?').run(msgId);
    notifyChat(msg.room_id, { type: 'chat_recall', roomId: msg.room_id, messageId: msgId });
    res.json({ success: true });
});

// ==================== 置顶公告 ====================

router.post('/room/:roomId/pin', (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const { messageId, pinned } = req.body;
    const member = getMember(db, roomId, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: '只有教师可置顶' });
    db.prepare('UPDATE chat_messages SET is_pinned = ? WHERE id = ? AND room_id = ?').run(pinned ? 1 : 0, parseInt(messageId), roomId);
    notifyChat(roomId, { type: 'chat_pin_update', roomId, pinned: getPinned(db, roomId) });
    res.json({ success: true });
});

router.post('/room/:roomId/announcement', (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const member = getMember(db, roomId, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: '只有教师可发布公告' });
    const text = (req.body.announcement || '').slice(0, 500);
    db.prepare('UPDATE chat_rooms SET announcement = ? WHERE id = ?').run(text, roomId);
    notifyChat(roomId, { type: 'chat_announcement', roomId, announcement: text });
    res.json({ success: true });
});

// ==================== 禁言 / 弹幕模式 ====================

router.post('/room/:roomId/mute-all', (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const member = getMember(db, roomId, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: '只有教师可操作' });
    const muted = req.body.muted ? 1 : 0;
    db.prepare('UPDATE chat_rooms SET is_muted = ? WHERE id = ?').run(muted, roomId);
    notifyChat(roomId, { type: 'chat_mute_all', roomId, muted: !!muted });
    res.json({ success: true, muted: !!muted });
});

router.post('/room/:roomId/mute-user', (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const member = getMember(db, roomId, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: '只有教师可操作' });
    const { targetUserId, muted } = req.body;
    db.prepare('UPDATE chat_room_members SET is_muted = ? WHERE room_id = ? AND user_id = ?')
        .run(muted ? 1 : 0, roomId, parseInt(targetUserId));
    sendToUser(parseInt(targetUserId), { type: 'chat_self_muted', roomId, muted: !!muted });
    res.json({ success: true });
});

router.post('/room/:roomId/danmaku', (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const member = getMember(db, roomId, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: '只有教师可操作' });
    const on = req.body.on ? 1 : 0;
    db.prepare('UPDATE chat_rooms SET danmaku_on = ? WHERE id = ?').run(on, roomId);
    notifyChat(roomId, { type: 'chat_danmaku_mode', roomId, on: !!on });
    res.json({ success: true, on: !!on });
});

// ==================== 已读未读 (教师) + DING ====================

// 某条消息的已读/未读名单
router.get('/messages/:id/receipts', (req, res) => {
    const db = getDb();
    const msgId = parseInt(req.params.id);
    const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(msgId);
    if (!msg) return res.status(404).json({ error: '消息不存在' });
    const member = getMember(db, msg.room_id, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: '仅教师可查看已读状态' });

    const members = db.prepare(`SELECT crm.user_id, crm.last_read_msg_id, u.username
        FROM chat_room_members crm JOIN users u ON u.id = crm.user_id
        WHERE crm.room_id = ? AND crm.user_id != ?`).all(msg.room_id, msg.sender_id);
    const read = [], unread = [];
    members.forEach(m => (m.last_read_msg_id >= msgId ? read : unread).push({ userId: m.user_id, username: m.username }));
    res.json({ success: true, read, unread, total: members.length });
});

// DING 强提醒（对未读学生触发系统级弹窗）
router.post('/room/:roomId/ding', (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const member = getMember(db, roomId, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: '只有教师可 DING' });
    const { messageId, userIds, text } = req.body;

    let targets = userIds;
    if (!targets && messageId) {
        targets = db.prepare(
            'SELECT user_id FROM chat_room_members WHERE room_id = ? AND user_id != ? AND last_read_msg_id < ?'
        ).all(roomId, req.user.id, parseInt(messageId)).map(r => r.user_id);
    }
    targets = targets || [];
    const payload = { type: 'chat_ding', roomId, text: text || '老师提醒你查看课堂重要消息！', from: req.user.username };
    targets.forEach(uid => sendToUser(parseInt(uid), payload));
    res.json({ success: true, notified: targets.length });
});

// ==================== 签到 / 投票活动（实时柱状图） ====================

// 聚合活动结果（柱状图数据）
function computeActivityResults(db, activity) {
    let cfg = {}; try { cfg = JSON.parse(activity.content || '{}'); } catch {}
    const responses = db.prepare(
        `SELECT r.user_id, r.answer, u.username FROM chat_activity_responses r
         JOIN users u ON u.id = r.user_id WHERE r.activity_id = ? ORDER BY r.responded_at`
    ).all(activity.id);
    const total = db.prepare('SELECT COUNT(*) AS c FROM chat_room_members WHERE room_id = ?').get(activity.room_id).c;

    if (activity.type === 'signin') {
        return {
            activityId: activity.id, type: 'signin', title: activity.title, status: activity.status,
            options: [], responded: responses.length, total,
            signed: responses.map(r => ({ userId: r.user_id, username: r.username }))
        };
    }
    // vote / poll
    const opts = (cfg.options || []).map(o => ({ label: o, count: 0 }));
    responses.forEach(r => { const i = parseInt(r.answer); if (opts[i]) opts[i].count++; });
    return {
        activityId: activity.id, type: 'vote', title: activity.title, status: activity.status,
        options: opts, responded: responses.length, total, question: cfg.question || activity.title
    };
}

// 教师发起 签到 / 投票
router.post('/room/:roomId/activity', (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const member = getMember(db, roomId, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: '只有教师可发起活动' });
    let { kind, title, question, options, duration } = req.body;
    kind = kind === 'signin' ? 'signin' : 'vote';
    if (kind === 'vote') {
        options = (options || []).map(o => String(o).trim()).filter(Boolean);
        if (options.length < 2) return res.status(400).json({ error: '投票至少需要两个选项' });
        if (options.length > 8) options = options.slice(0, 8);
    }
    const cfg = kind === 'vote' ? { question: question || title || '投票', options } : {};
    const actTitle = title || (kind === 'signin' ? '课堂签到' : (question || '课堂投票'));

    const result = db.prepare(
        'INSERT INTO chat_activities (room_id, teacher_id, type, title, content, status, duration) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(roomId, req.user.id, kind, actTitle, JSON.stringify(cfg), 'active', parseInt(duration) || 0);
    const activity = db.prepare('SELECT * FROM chat_activities WHERE id = ?').get(result.lastInsertRowid);

    // 作为一条聊天消息卡片落库 + 广播
    const meta = { activityId: activity.id, kind, title: actTitle, options: cfg.options || [] };
    const msgResult = db.prepare(
        'INSERT INTO chat_messages (room_id, sender_id, content, type, metadata) VALUES (?, ?, ?, ?, ?)'
    ).run(roomId, req.user.id, actTitle, 'activity', JSON.stringify(meta));
    let message = db.prepare(`SELECT cm.*, u.username AS sender_name, u.avatar AS sender_avatar
        FROM chat_messages cm JOIN users u ON u.id = cm.sender_id WHERE cm.id = ?`).get(msgResult.lastInsertRowid);
    message = decorateMessages(db, [message], req.user.id)[0];
    message.activity = computeActivityResults(db, activity);

    notifyChat(roomId, { type: 'chat_message', roomId, message });
    res.json({ success: true, message, activity: message.activity });
});

// 学生签到 / 投票
router.post('/activity/:id/respond', (req, res) => {
    const db = getDb();
    const actId = parseInt(req.params.id);
    const activity = db.prepare('SELECT * FROM chat_activities WHERE id = ?').get(actId);
    if (!activity) return res.status(404).json({ error: '活动不存在' });
    if (activity.status !== 'active') return res.status(400).json({ error: '活动已结束' });
    const member = getMember(db, activity.room_id, req.user.id);
    if (!member) return res.status(403).json({ error: '无权参与' });

    let answer = '';
    if (activity.type === 'vote') {
        const idx = parseInt(req.body.answer);
        let cfg = {}; try { cfg = JSON.parse(activity.content || '{}'); } catch {}
        if (isNaN(idx) || idx < 0 || idx >= (cfg.options || []).length) return res.status(400).json({ error: '无效选项' });
        answer = String(idx);
    }
    try {
        db.prepare('INSERT INTO chat_activity_responses (activity_id, user_id, answer) VALUES (?, ?, ?)')
            .run(actId, req.user.id, answer);
    } catch (e) {
        // 已参与 → 投票允许改票，签到忽略
        if (activity.type === 'vote') {
            db.prepare('UPDATE chat_activity_responses SET answer = ?, responded_at = CURRENT_TIMESTAMP WHERE activity_id = ? AND user_id = ?')
                .run(answer, actId, req.user.id);
        } else {
            return res.json({ success: true, results: computeActivityResults(db, activity), already: true });
        }
    }
    const results = computeActivityResults(db, activity);
    notifyChat(activity.room_id, { type: 'chat_activity_update', roomId: activity.room_id, activityId: actId, results });
    res.json({ success: true, results });
});

// 教师结束活动
router.post('/activity/:id/end', (req, res) => {
    const db = getDb();
    const actId = parseInt(req.params.id);
    const activity = db.prepare('SELECT * FROM chat_activities WHERE id = ?').get(actId);
    if (!activity) return res.status(404).json({ error: '活动不存在' });
    const member = getMember(db, activity.room_id, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: '只有教师可结束活动' });
    db.prepare("UPDATE chat_activities SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE id = ?").run(actId);
    activity.status = 'ended';
    const results = computeActivityResults(db, activity);
    notifyChat(activity.room_id, { type: 'chat_activity_update', roomId: activity.room_id, activityId: actId, results });
    res.json({ success: true, results });
});

// 获取活动当前结果（卡片渲染 / 断线补全）
router.get('/activity/:id', (req, res) => {
    const db = getDb();
    const actId = parseInt(req.params.id);
    const activity = db.prepare('SELECT * FROM chat_activities WHERE id = ?').get(actId);
    if (!activity) return res.status(404).json({ error: '活动不存在' });
    const member = getMember(db, activity.room_id, req.user.id);
    if (!member) return res.status(403).json({ error: '无权查看' });
    const mine = db.prepare('SELECT answer FROM chat_activity_responses WHERE activity_id = ? AND user_id = ?').get(actId, req.user.id);
    res.json({ success: true, results: computeActivityResults(db, activity), myAnswer: mine ? mine.answer : null });
});

// ==================== 课堂活跃度分析 ====================

// 供结课报告/教师查看：发言活跃度 + 热词 + 类型分布
router.get('/room/:roomId/analytics', (req, res) => {
    const db = getDb();
    const roomId = parseInt(req.params.roomId);
    const member = getMember(db, roomId, req.user.id);
    if (!isAdmin(member)) return res.status(403).json({ error: '仅教师可查看' });
    const since = req.query.since; // 可选时间窗口起点
    res.json({ success: true, analytics: computeChatAnalytics(db, roomId, since) });
});

// 导出：供 live 报告复用
function computeChatAnalytics(db, roomId, sinceIso) {
    const params = [roomId];
    let where = 'room_id = ? AND is_deleted = 0';
    if (sinceIso) { where += ' AND created_at >= ?'; params.push(sinceIso); }

    // 发言活跃度（每生总发言数 + 有效提问数：含代码块/问号）
    const speakers = db.prepare(`
        SELECT cm.sender_id AS userId, u.username,
            COUNT(*) AS messages,
            SUM(CASE WHEN cm.type IN ('code_card','error_share') OR cm.content LIKE '%\`\`\`%'
                     OR cm.content LIKE '%?%' OR cm.content LIKE '%？%' THEN 1 ELSE 0 END) AS questions
        FROM chat_messages cm JOIN users u ON u.id = cm.sender_id
        WHERE ${where} AND cm.type != 'system'
        GROUP BY cm.sender_id ORDER BY messages DESC
    `).all(...params);

    // 消息类型分布
    const typeRows = db.prepare(
        `SELECT type, COUNT(*) AS cnt FROM chat_messages WHERE ${where} AND type != 'system' GROUP BY type`
    ).all(...params);
    const typeDist = {};
    typeRows.forEach(t => { typeDist[t.type] = t.cnt; });

    // 互动热词（简易中文/英文分词 + 停用词过滤）
    const texts = db.prepare(
        `SELECT content FROM chat_messages WHERE ${where} AND type IN ('text','error_share') LIMIT 2000`
    ).all(...params);
    const STOP = new Set(['的', '了', '是', '我', '你', '他', '在', '和', '就', '都', '也', '吗', '吧', '啊', '这', '那', '一个', 'the', 'a', 'to', 'is', 'and']);
    const freq = {};
    texts.forEach(r => {
        const words = String(r.content || '')
            .replace(/```[\s\S]*?```/g, ' ')
            .match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,}/g) || [];
        words.forEach(w => { const k = w.toLowerCase(); if (!STOP.has(k)) freq[k] = (freq[k] || 0) + 1; });
    });
    const hotWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word, count]) => ({ word, count }));

    const total = typeRows.reduce((a, t) => a + t.cnt, 0);
    return { totalMessages: total, speakers, typeDist, hotWords };
}

router.computeChatAnalytics = computeChatAnalytics;
router.ensureClassRoomForClass = ensureClassRoom;
module.exports = router;
