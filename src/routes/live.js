/**
 * 在线直播课堂 / 数字巡课墙 路由
 * - 开课/结课（教师）
 * - 学生进入课堂、心跳上报（专注度/切屏/编码活跃度）
 * - 一键呼叫老师 + 求助处理
 * - 巡课墙数据（网格 + 动态排序）
 * - 单人聚焦视野 + 师生互动记录
 * - 结课教学质量报告
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { notifyLive } = require('../websocket');

const router = express.Router();
router.use(authMiddleware);

// 校验当前用户是某节课的授课教师
function assertTeacher(db, sessionId, userId) {
    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(sessionId);
    if (!session) return { error: '课堂不存在', code: 404 };
    if (session.teacher_id !== userId) return { error: '只有授课教师可操作', code: 403 };
    return { session };
}

// 校验用户是该课堂所属班级成员或教师
function isClassMember(db, classId, userId) {
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (cls && cls.teacher_id === userId) return true;
    const m = db.prepare('SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, userId);
    return !!m;
}

// ==================== 开课 / 结课 ====================

// 开始上课（教师）
router.post('/start', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { classId, title, avMode } = req.body;
    if (!classId) return res.status(400).json({ error: '请指定班级' });

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (cls.teacher_id !== user.id) return res.status(403).json({ error: '只有班主任可开课' });

    // 若已有进行中的课堂，直接复用
    const existing = db.prepare(
        "SELECT * FROM live_sessions WHERE class_id = ? AND status = 'live'"
    ).get(classId);
    if (existing) return res.json({ success: true, session: existing, reused: true });

    const result = db.prepare(
        'INSERT INTO live_sessions (class_id, teacher_id, title, av_mode) VALUES (?, ?, ?, ?)'
    ).run(classId, user.id, title || `${cls.name} 直播课堂`, avMode || 'screen');
    const sessionId = result.lastInsertRowid;

    // 初始化全班学生的巡课墙状态行
    const students = db.prepare(
        "SELECT user_id FROM class_members WHERE class_id = ? AND role = 'student'"
    ).all(classId);
    const insertStatus = db.prepare(
        'INSERT OR IGNORE INTO live_student_status (session_id, user_id) VALUES (?, ?)'
    );
    const tx = db.transaction(() => {
        students.forEach(s => insertStatus.run(sessionId, s.user_id));
    });
    tx();

    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(sessionId);
    notifyLive(sessionId, { type: 'live_started', session });
    res.json({ success: true, session });
});

// 下课（教师）
router.post('/:id/end', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const check = assertTeacher(db, sessionId, req.user.id);
    if (check.error) return res.status(check.code).json({ error: check.error });

    const replayUrl = `/playback?session=${sessionId}`;
    db.prepare(
        "UPDATE live_sessions SET status = 'ended', ended_at = CURRENT_TIMESTAMP, replay_url = ? WHERE id = ?"
    ).run(replayUrl, sessionId);
    db.prepare(
        "UPDATE live_participants SET left_at = CURRENT_TIMESTAMP WHERE session_id = ? AND left_at IS NULL"
    ).run(sessionId);
    db.prepare("UPDATE live_student_status SET focus_state = 'offline' WHERE session_id = ?").run(sessionId);

    notifyLive(sessionId, { type: 'live_ended', replayUrl });
    res.json({ success: true, replayUrl });
});

// 查询班级当前进行中的课堂
router.get('/active', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.query.classId);
    if (!classId) return res.status(400).json({ error: '请指定班级' });
    if (!isClassMember(db, classId, req.user.id)) return res.status(403).json({ error: '非本班成员' });
    const session = db.prepare(
        "SELECT * FROM live_sessions WHERE class_id = ? AND status = 'live' ORDER BY id DESC LIMIT 1"
    ).get(classId);
    res.json({ success: true, session: session || null });
});

// ==================== 学生进入课堂 ====================

router.post('/:id/join', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const user = req.user;
    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(sessionId);
    if (!session) return res.status(404).json({ error: '课堂不存在' });
    if (session.status !== 'live') return res.status(400).json({ error: '课堂已结束' });
    if (!isClassMember(db, session.class_id, user.id)) return res.status(403).json({ error: '非本班成员，禁止进入' });

    db.prepare(
        'INSERT OR IGNORE INTO live_participants (session_id, user_id, role) VALUES (?, ?, ?)'
    ).run(sessionId, user.id, user.id === session.teacher_id ? 'teacher' : 'student');
    db.prepare(
        'INSERT OR IGNORE INTO live_student_status (session_id, user_id) VALUES (?, ?)'
    ).run(sessionId, user.id);
    db.prepare(
        "UPDATE live_student_status SET focus_state = 'focused', updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND user_id = ?"
    ).run(sessionId, user.id);

    res.json({ success: true, session });
});

// ==================== 心跳 / 状态上报（学生）====================

router.post('/:id/heartbeat', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const user = req.user;
    const {
        focusState, tabSwitchDelta, awaySecondsDelta, watchSecondsDelta,
        codeLines, currentFile, currentLine, hasKeystroke, thumbnail
    } = req.body;

    const row = db.prepare(
        'SELECT * FROM live_student_status WHERE session_id = ? AND user_id = ?'
    ).get(sessionId, user.id);
    if (!row) return res.status(404).json({ error: '状态不存在，请重新进入课堂' });

    const now = Date.now();
    const newTabSwitches = row.tab_switches + (parseInt(tabSwitchDelta) || 0);
    const newAway = row.away_seconds + (parseInt(awaySecondsDelta) || 0);
    const newLines = codeLines != null ? parseInt(codeLines) : row.code_lines;
    const lastKs = hasKeystroke ? now : row.last_keystroke_at;

    db.prepare(`
        UPDATE live_student_status SET
            focus_state = ?, tab_switches = ?, away_seconds = ?,
            code_lines = ?, current_file = ?, current_line = ?,
            thumbnail = ?, last_keystroke_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND user_id = ?
    `).run(
        focusState || row.focus_state, newTabSwitches, newAway,
        newLines, currentFile != null ? currentFile : row.current_file,
        currentLine != null ? parseInt(currentLine) : row.current_line,
        thumbnail != null ? String(thumbnail).slice(0, 4000) : row.thumbnail,
        lastKs, sessionId, user.id
    );

    if (watchSecondsDelta) {
        db.prepare(
            'UPDATE live_participants SET watch_seconds = watch_seconds + ? WHERE session_id = ? AND user_id = ?'
        ).run(parseInt(watchSecondsDelta) || 0, sessionId, user.id);
    }

    res.json({ success: true });
});

// 编译失败上报（学生）
router.post('/:id/compile-fail', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    db.prepare(
        'UPDATE live_student_status SET compile_fails = compile_fails + 1 WHERE session_id = ? AND user_id = ?'
    ).run(sessionId, req.user.id);
    res.json({ success: true });
});

// ==================== 一键呼叫老师 ====================

router.post('/:id/help', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const user = req.user;
    const { message } = req.body;

    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(sessionId);
    if (!session || session.status !== 'live') return res.status(400).json({ error: '课堂不可用' });

    const result = db.prepare(
        'INSERT INTO live_help_requests (session_id, user_id, message) VALUES (?, ?, ?)'
    ).run(sessionId, user.id, message || '我需要帮助');
    db.prepare(
        'UPDATE live_student_status SET help_count = help_count + 1 WHERE session_id = ? AND user_id = ?'
    ).run(sessionId, user.id);

    notifyLive(sessionId, {
        type: 'help_request',
        helpId: result.lastInsertRowid,
        userId: user.id,
        username: user.username,
        message: message || '我需要帮助'
    });
    res.json({ success: true, helpId: result.lastInsertRowid });
});

// 处理求助（教师）
router.post('/:id/help/:helpId/resolve', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const check = assertTeacher(db, sessionId, req.user.id);
    if (check.error) return res.status(check.code).json({ error: check.error });

    db.prepare(
        "UPDATE live_help_requests SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?"
    ).run(parseInt(req.params.helpId), sessionId);
    notifyLive(sessionId, { type: 'help_resolved', helpId: parseInt(req.params.helpId) });
    res.json({ success: true });
});

// ==================== 巡课墙数据（教师）====================

router.get('/:id/wall', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const check = assertTeacher(db, sessionId, req.user.id);
    if (check.error) return res.status(check.code).json({ error: check.error });

    const sort = req.query.sort || 'default'; // default | code | help | abnormal
    const students = db.prepare(`
        SELECT s.user_id, u.username, u.avatar,
               s.focus_state, s.tab_switches, s.away_seconds, s.code_lines,
               s.compile_fails, s.help_count, s.current_file, s.current_line,
               s.thumbnail, s.last_keystroke_at, s.updated_at
        FROM live_student_status s
        JOIN users u ON u.id = s.user_id
        WHERE s.session_id = ?
    `).all(sessionId);

    const now = Date.now();
    students.forEach(s => {
        // 60 秒内无键盘输入 → 卡顿提示
        s.idle = s.last_keystroke_at > 0 && (now - s.last_keystroke_at) > 60000;
        s.hasPendingHelp = false;
    });

    // 标记待处理求助
    const pendingHelps = db.prepare(
        "SELECT user_id FROM live_help_requests WHERE session_id = ? AND status = 'pending'"
    ).all(sessionId);
    const helpSet = new Set(pendingHelps.map(h => h.user_id));
    students.forEach(s => { s.hasPendingHelp = helpSet.has(s.user_id); });

    // 动态排序
    const rank = (s) => {
        if (sort === 'code') return -s.code_lines;
        if (sort === 'help') return s.hasPendingHelp ? -1 : 1;
        if (sort === 'abnormal') {
            let score = 0;
            if (s.focus_state === 'away' || s.focus_state === 'offline') score -= 3;
            if (s.idle) score -= 2;
            if (s.hasPendingHelp) score -= 4;
            return score;
        }
        return 0;
    };
    if (sort !== 'default') students.sort((a, b) => rank(a) - rank(b));

    const session = db.prepare('SELECT * FROM live_sessions WHERE id = ?').get(sessionId);
    res.json({ success: true, session, students, sort });
});

// 单人聚焦视野（教师）
router.get('/:id/student/:uid', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const check = assertTeacher(db, sessionId, req.user.id);
    if (check.error) return res.status(check.code).json({ error: check.error });

    const detail = db.prepare(`
        SELECT s.*, u.username, u.avatar FROM live_student_status s
        JOIN users u ON u.id = s.user_id
        WHERE s.session_id = ? AND s.user_id = ?
    `).get(sessionId, parseInt(req.params.uid));
    if (!detail) return res.status(404).json({ error: '学生状态不存在' });

    const helps = db.prepare(
        'SELECT * FROM live_help_requests WHERE session_id = ? AND user_id = ? ORDER BY id DESC'
    ).all(sessionId, parseInt(req.params.uid));
    res.json({ success: true, detail, helps });
});

// 记录师生互动（教师进入编辑器 / 接管）
router.post('/:id/intervention', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const check = assertTeacher(db, sessionId, req.user.id);
    if (check.error) return res.status(check.code).json({ error: check.error });

    const { studentId, kind, durationSeconds } = req.body;
    db.prepare(
        'INSERT INTO live_interventions (session_id, teacher_id, student_id, kind, duration_seconds) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, req.user.id, parseInt(studentId), kind || 'focus', parseInt(durationSeconds) || 0);
    res.json({ success: true });
});

// ==================== 结课教学质量报告（教师）====================

router.get('/:id/report', (req, res) => {
    const db = getDb();
    const sessionId = parseInt(req.params.id);
    const check = assertTeacher(db, sessionId, req.user.id);
    if (check.error) return res.status(check.code).json({ error: check.error });
    const session = check.session;

    // 课堂总时长（秒）
    const durationSec = session.ended_at
        ? Math.max(1, Math.round((new Date(session.ended_at) - new Date(session.started_at)) / 1000))
        : Math.max(1, Math.round((Date.now() - new Date(session.started_at)) / 1000));

    // 学生维度
    const students = db.prepare(`
        SELECT s.user_id, u.username,
               s.tab_switches, s.away_seconds, s.code_lines, s.compile_fails, s.help_count,
               COALESCE(p.watch_seconds, 0) AS watch_seconds
        FROM live_student_status s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN live_participants p ON p.session_id = s.session_id AND p.user_id = s.user_id
        WHERE s.session_id = ?
    `).all(sessionId);

    students.forEach(s => {
        const effectiveWatch = Math.min(s.watch_seconds, durationSec);
        // 专注度 = (听课时长 - 切屏时长) / 课堂总时长
        const focusPct = Math.max(0, Math.min(100,
            Math.round(((effectiveWatch - s.away_seconds) / durationSec) * 100)
        ));
        s.watch_seconds = effectiveWatch;
        s.focus_percent = isNaN(focusPct) ? 0 : focusPct;
    });

    // 班级维度：互动频率
    const interv = db.prepare(`
        SELECT COUNT(*) AS enter_count, COALESCE(AVG(duration_seconds), 0) AS avg_assist
        FROM live_interventions WHERE session_id = ?
    `).get(sessionId);

    // 知识点卡点：报错最多 / 求助最多的文件
    const hotspots = db.prepare(`
        SELECT current_file AS file, SUM(compile_fails) AS fails, SUM(help_count) AS helps
        FROM live_student_status
        WHERE session_id = ? AND current_file != ''
        GROUP BY current_file
        ORDER BY (SUM(compile_fails) + SUM(help_count)) DESC
        LIMIT 5
    `).all(sessionId);

    const classSummary = {
        studentCount: students.length,
        avgFocus: students.length
            ? Math.round(students.reduce((a, s) => a + s.focus_percent, 0) / students.length) : 0,
        totalHelps: students.reduce((a, s) => a + s.help_count, 0),
        totalCodeLines: students.reduce((a, s) => a + s.code_lines, 0),
        teacherEnterCount: interv.enter_count,
        avgAssistSeconds: Math.round(interv.avg_assist),
        hotspots
    };

    // 课堂互动聊天室活跃度（绑定班级永久聊天室，按本节课时间窗口统计）
    let chatAnalytics = null;
    try {
        const chatRoom = db.prepare("SELECT id FROM chat_rooms WHERE class_id = ? AND type = 'class'").get(session.class_id);
        if (chatRoom) {
            const { computeChatAnalytics } = require('./classroomChat');
            chatAnalytics = computeChatAnalytics(db, chatRoom.id, session.started_at);
        }
    } catch (e) { /* 聊天分析失败不影响主报告 */ }

    res.json({
        success: true,
        session,
        durationSeconds: durationSec,
        students,
        classSummary,
        chatAnalytics
    });
});

module.exports = router;
