/**
 * 协作编程路由（Pair Programming）
 * 基于 Yjs CRDT 的师生双人协同模式
 * - 创建/加入协作会话
 * - WebSocket 信令（实际 CRDT 同步通过前端 Yjs 完成）
 * - 教师远程进入学生编辑器
 */
const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// 创建协作会话
router.post('/create', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { projectId, mode } = req.body;

    if (!projectId) {
        return res.status(400).json({ error: '请指定项目' });
    }

    // 生成唯一会话码
    const sessionCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    const result = db.prepare(
        'INSERT INTO collab_sessions (project_id, host_id, session_code, mode) VALUES (?, ?, ?, ?)'
    ).run(parseInt(projectId), user.id, sessionCode, mode || 'pair');

    // 主持人自动加入
    db.prepare(
        'INSERT INTO collab_participants (session_id, user_id, role) VALUES (?, ?, ?)'
    ).run(result.lastInsertRowid, user.id, 'host');

    res.json({
        success: true,
        session: {
            id: result.lastInsertRowid,
            sessionCode,
            mode: mode || 'pair'
        }
    });
});

// 加入协作会话
router.post('/join', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { sessionCode } = req.body;

    if (!sessionCode) {
        return res.status(400).json({ error: '请输入会话码' });
    }

    const session = db.prepare(
        'SELECT * FROM collab_sessions WHERE session_code = ? AND status = ?'
    ).get(sessionCode.toUpperCase(), 'active');

    if (!session) {
        return res.status(404).json({ error: '会话不存在或已结束' });
    }

    // 检查是否已加入
    const existing = db.prepare(
        'SELECT id FROM collab_participants WHERE session_id = ? AND user_id = ? AND left_at IS NULL'
    ).get(session.id, user.id);

    if (existing) {
        return res.json({ success: true, session: { id: session.id, alreadyJoined: true } });
    }

    // 确定角色：教师进入为 editor，学生为 viewer（教师可提升）
    const role = (user.role === 'teacher' || user.role === 'admin') ? 'editor' : 'viewer';

    db.prepare(
        'INSERT INTO collab_participants (session_id, user_id, role) VALUES (?, ?, ?)'
    ).run(session.id, user.id, role);

    res.json({
        success: true,
        session: {
            id: session.id,
            projectId: session.project_id,
            hostId: session.host_id,
            mode: session.mode,
            role
        }
    });
});

// 教师远程进入学生编辑器（创建协作会话并自动邀请）
router.post('/remote-enter', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { studentId, projectId } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以远程进入' });
    }

    if (!studentId || !projectId) {
        return res.status(400).json({ error: '请指定学生和项目' });
    }

    const sessionCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    const result = db.prepare(
        'INSERT INTO collab_sessions (project_id, host_id, session_code, mode) VALUES (?, ?, ?, ?)'
    ).run(parseInt(projectId), user.id, sessionCode, 'teacher_assist');

    // 教师以 editor 身份加入
    db.prepare(
        'INSERT INTO collab_participants (session_id, user_id, role) VALUES (?, ?, ?)'
    ).run(result.lastInsertRowid, user.id, 'editor');

    // 学生以 host 身份加入（他是项目所有者）
    db.prepare(
        'INSERT INTO collab_participants (session_id, user_id, role) VALUES (?, ?, ?)'
    ).run(result.lastInsertRowid, parseInt(studentId), 'host');

    // 发送系统消息通知学生
    db.prepare(
        'INSERT INTO messages (from_id, to_id, content, type) VALUES (?, ?, ?, ?)'
    ).run(user.id, parseInt(studentId), `📡 教师 ${user.username} 正在进入你的编辑器进行远程指导，会话码：${sessionCode}`, 'system');

    res.json({
        success: true,
        session: { id: result.lastInsertRowid, sessionCode }
    });
});

// 获取当前活跃会话
router.get('/active', (req, res) => {
    const db = getDb();
    const user = req.user;

    const sessions = db.prepare(`
        SELECT cs.*, p.name as project_name, u.username as host_name,
            (SELECT COUNT(*) FROM collab_participants WHERE session_id = cs.id AND left_at IS NULL) as participant_count
        FROM collab_sessions cs
        JOIN projects p ON cs.project_id = p.id
        JOIN users u ON cs.host_id = u.id
        WHERE cs.id IN (
            SELECT session_id FROM collab_participants WHERE user_id = ? AND left_at IS NULL
        ) AND cs.status = 'active'
        ORDER BY cs.created_at DESC
    `).all(user.id);

    res.json({ sessions });
});

// 获取会话详情与参与者
router.get('/:id', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);

    const session = db.prepare(`
        SELECT cs.*, p.name as project_name, u.username as host_name
        FROM collab_sessions cs
        JOIN projects p ON cs.project_id = p.id
        JOIN users u ON cs.host_id = u.id
        WHERE cs.id = ?
    `).get(sessionId);

    if (!session) return res.status(404).json({ error: '会话不存在' });

    const participants = db.prepare(`
        SELECT cp.*, u.username, u.avatar, u.role as user_role
        FROM collab_participants cp
        JOIN users u ON cp.user_id = u.id
        WHERE cp.session_id = ? AND cp.left_at IS NULL
    `).all(sessionId);

    res.json({ session, participants });
});

// 更新参与者角色（提升/降低权限）
router.put('/:id/participant/:userId/role', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const targetUserId = parseInt(req.params.userId);
    const user = req.user;
    const { role } = req.body;

    if (!['editor', 'viewer'].includes(role)) {
        return res.status(400).json({ error: '无效角色' });
    }

    const session = db.prepare('SELECT * FROM collab_sessions WHERE id = ?').get(sessionId);
    if (!session) return res.status(404).json({ error: '会话不存在' });

    // 只有 host 或教师可以修改角色
    if (session.host_id !== user.id && user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '无权操作' });
    }

    db.prepare(
        'UPDATE collab_participants SET role = ? WHERE session_id = ? AND user_id = ?'
    ).run(role, sessionId, targetUserId);

    res.json({ success: true });
});

// 结束协作会话
router.post('/:id/end', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const user = req.user;

    const session = db.prepare('SELECT * FROM collab_sessions WHERE id = ?').get(sessionId);
    if (!session) return res.status(404).json({ error: '会话不存在' });

    if (session.host_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '只有主持人可以结束会话' });
    }

    db.prepare('UPDATE collab_sessions SET status = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('ended', sessionId);
    db.prepare('UPDATE collab_participants SET left_at = CURRENT_TIMESTAMP WHERE session_id = ? AND left_at IS NULL')
        .run(sessionId);

    res.json({ success: true });
});

// 离开协作会话
router.post('/:id/leave', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const user = req.user;

    db.prepare(
        'UPDATE collab_participants SET left_at = CURRENT_TIMESTAMP WHERE session_id = ? AND user_id = ? AND left_at IS NULL'
    ).run(sessionId, user.id);

    res.json({ success: true });
});

module.exports = router;
