/**
 * 代码回放路由（Code Playback）
 * - 记录学生编辑器中的敲击轨迹
 * - 教师批改时可回放学生编码过程
 * - 检测"直接粘贴"行为
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// 批量记录按键操作（学生端定期上传）
router.post('/record', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { keystrokes, submissionId, projectId } = req.body;

    if (!keystrokes || !Array.isArray(keystrokes) || keystrokes.length === 0) {
        return res.status(400).json({ error: '无操作数据' });
    }

    // 限制单次上传量防滥用
    const batch = keystrokes.slice(0, 500);

    const insert = db.prepare(`
        INSERT INTO code_keystrokes (submission_id, user_id, project_id, file_type, action, position, content, timestamp, session_start)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
        for (const ks of batch) {
            insert.run(
                submissionId || null,
                user.id,
                projectId || null,
                ks.fileType || 'html',
                ks.action || 'insert', // insert | delete | paste | replace | select
                ks.position || 0,
                ks.content || '',
                ks.timestamp || Date.now(),
                ks.sessionStart || batch[0].timestamp || Date.now()
            );
        }
    });
    transaction();

    res.json({ success: true, recorded: batch.length });
});

// 获取回放数据（教师查看学生的编码过程）
router.get('/playback/:submissionId', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.submissionId);
    const user = req.user;

    // 验证权限：教师或管理员
    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以查看回放' });
    }

    const keystrokes = db.prepare(`
        SELECT file_type, action, position, content, timestamp, session_start
        FROM code_keystrokes
        WHERE submission_id = ?
        ORDER BY timestamp ASC
    `).all(submissionId);

    // 分析统计数据
    const analysis = analyzeKeystrokes(keystrokes);

    res.json({ keystrokes, analysis });
});

// 获取用户某项目的编辑轨迹
router.get('/project/:projectId/user/:userId', (req, res) => {
    const db = getDb();
    const projectId = parseInt(req.params.projectId);
    const targetUserId = parseInt(req.params.userId);
    const user = req.user;

    if (user.role !== 'teacher' && user.role !== 'admin' && user.id !== targetUserId) {
        return res.status(403).json({ error: '无权查看' });
    }

    const keystrokes = db.prepare(`
        SELECT file_type, action, position, content, timestamp, session_start
        FROM code_keystrokes
        WHERE project_id = ? AND user_id = ?
        ORDER BY timestamp ASC
        LIMIT 5000
    `).all(projectId, targetUserId);

    const analysis = analyzeKeystrokes(keystrokes);

    res.json({ keystrokes, analysis });
});

// 记录代码活跃度
router.post('/activity', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { linesAdded, linesDeleted, editDuration, classId } = req.body;

    const today = new Date().toISOString().split('T')[0];
    const hour = new Date().getHours();

    // 更新或插入今日活跃度
    const existing = db.prepare(
        'SELECT id, lines_added, lines_deleted, edit_duration FROM code_activity WHERE user_id = ? AND date = ? AND hour = ?'
    ).get(user.id, today, hour);

    if (existing) {
        db.prepare(
            'UPDATE code_activity SET lines_added = lines_added + ?, lines_deleted = lines_deleted + ?, edit_duration = edit_duration + ? WHERE id = ?'
        ).run(linesAdded || 0, linesDeleted || 0, editDuration || 0, existing.id);
    } else {
        db.prepare(
            'INSERT INTO code_activity (user_id, class_id, lines_added, lines_deleted, edit_duration, date, hour) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(user.id, classId || null, linesAdded || 0, linesDeleted || 0, editDuration || 0, today, hour);
    }

    res.json({ success: true });
});

// 获取代码活跃度统计（教师查看全班）
router.get('/activity/class/:classId', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const user = req.user;
    const { days } = req.query;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '需要教师权限' });
    }

    const daysBack = parseInt(days) || 7;

    // 每人的总代码行数
    const studentActivity = db.prepare(`
        SELECT u.id, u.username, u.avatar,
            SUM(ca.lines_added) as total_lines_added,
            SUM(ca.lines_deleted) as total_lines_deleted,
            SUM(ca.edit_duration) as total_duration,
            COUNT(DISTINCT ca.date) as active_days
        FROM class_members cm
        JOIN users u ON cm.user_id = u.id
        LEFT JOIN code_activity ca ON ca.user_id = u.id AND ca.date >= date('now', '-' || ? || ' days')
        WHERE cm.class_id = ? AND cm.role = 'student'
        GROUP BY u.id
        ORDER BY total_lines_added DESC
    `).all(daysBack, classId);

    // 深夜敲代码排行（22:00-6:00）
    const nightOwls = db.prepare(`
        SELECT u.username, u.avatar,
            SUM(ca.lines_added) as night_lines
        FROM code_activity ca
        JOIN users u ON ca.user_id = u.id
        JOIN class_members cm ON cm.user_id = u.id AND cm.class_id = ?
        WHERE ca.date >= date('now', '-' || ? || ' days')
        AND (ca.hour >= 22 OR ca.hour <= 6)
        GROUP BY u.id
        ORDER BY night_lines DESC
        LIMIT 10
    `).all(classId, daysBack);

    // 按小时的活跃度分布
    const hourlyDistribution = db.prepare(`
        SELECT ca.hour, SUM(ca.lines_added) as total_lines
        FROM code_activity ca
        JOIN class_members cm ON cm.user_id = ca.user_id AND cm.class_id = ?
        WHERE ca.date >= date('now', '-' || ? || ' days')
        GROUP BY ca.hour
        ORDER BY ca.hour ASC
    `).all(classId, daysBack);

    res.json({ studentActivity, nightOwls, hourlyDistribution });
});

// 分析按键操作，检测异常行为
function analyzeKeystrokes(keystrokes) {
    if (!keystrokes || keystrokes.length === 0) {
        return { totalActions: 0, pasteRatio: 0, suspiciousPastes: [], avgSpeed: 0 };
    }

    let insertCount = 0;
    let deleteCount = 0;
    let pasteCount = 0;
    let totalCharsTyped = 0;
    let totalCharsPasted = 0;
    const suspiciousPastes = [];
    const sessions = new Set();

    for (const ks of keystrokes) {
        sessions.add(ks.session_start);
        if (ks.action === 'insert') {
            insertCount++;
            totalCharsTyped += (ks.content || '').length;
        } else if (ks.action === 'delete') {
            deleteCount++;
        } else if (ks.action === 'paste') {
            pasteCount++;
            const pastedLen = (ks.content || '').length;
            totalCharsPasted += pastedLen;
            // 大段粘贴（超过100字符）标记为可疑
            if (pastedLen > 100) {
                suspiciousPastes.push({
                    timestamp: ks.timestamp,
                    length: pastedLen,
                    fileType: ks.file_type,
                    preview: (ks.content || '').substring(0, 80) + '...'
                });
            }
        }
    }

    const totalChars = totalCharsTyped + totalCharsPasted;
    const pasteRatio = totalChars > 0 ? Math.round((totalCharsPasted / totalChars) * 100) : 0;

    // 计算平均输入速度（字符/分钟）
    let avgSpeed = 0;
    if (keystrokes.length >= 2) {
        const duration = (keystrokes[keystrokes.length - 1].timestamp - keystrokes[0].timestamp) / 60000;
        if (duration > 0) avgSpeed = Math.round(totalCharsTyped / duration);
    }

    return {
        totalActions: keystrokes.length,
        insertCount,
        deleteCount,
        pasteCount,
        pasteRatio,
        suspiciousPastes,
        avgSpeed,
        sessionCount: sessions.size,
        totalCharsTyped,
        totalCharsPasted
    };
}

module.exports = router;
