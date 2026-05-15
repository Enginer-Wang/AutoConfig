/**
 * 班级学情管理路由 - 学情看板、危机预警、能力画像、动态分组
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ==================== 学情看板 ====================

// 获取代码活跃度雷达（GitHub 绿墙风格）
router.get('/:classId/activity-heatmap', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const user = req.user;
    const { days = 90 } = req.query;

    // 验证教师权限
    if (!isClassTeacher(db, classId, user)) {
        return res.status(403).json({ error: '无权访问' });
    }

    // 获取班级所有学生的代码活跃度（按日聚合）
    const students = db.prepare(`
        SELECT u.id, u.username, u.avatar
        FROM class_members cm JOIN users u ON cm.user_id = u.id
        WHERE cm.class_id = ? AND cm.role = 'student'
    `).all(classId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    const startStr = startDate.toISOString().split('T')[0];

    const activities = db.prepare(`
        SELECT user_id, date, SUM(lines_added) as total_lines, SUM(edit_duration) as total_duration
        FROM code_activity
        WHERE class_id = ? AND date >= ?
        GROUP BY user_id, date
        ORDER BY date ASC
    `).all(classId, startStr);

    // 组装每个学生的热力图数据
    const heatmap = {};
    for (const s of students) {
        heatmap[s.id] = { username: s.username, avatar: s.avatar, days: {} };
    }
    for (const a of activities) {
        if (heatmap[a.user_id]) {
            heatmap[a.user_id].days[a.date] = {
                lines: a.total_lines,
                duration: a.total_duration
            };
        }
    }

    res.json({ heatmap: Object.values(heatmap), startDate: startStr });
});

// 获取学业危机预警列表
router.get('/:classId/risk-alerts', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const user = req.user;

    if (!isClassTeacher(db, classId, user)) {
        return res.status(403).json({ error: '无权访问' });
    }

    // 先触发预警计算
    computeRiskAlerts(db, classId);

    // 返回未解决的预警
    const alerts = db.prepare(`
        SELECT ra.*, u.username as student_name, u.avatar as student_avatar
        FROM student_risk_alerts ra
        JOIN users u ON ra.student_id = u.id
        WHERE ra.class_id = ? AND ra.is_resolved = 0
        ORDER BY 
            CASE ra.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
            ra.created_at DESC
    `).all(classId);

    res.json({ alerts });
});

// 解除预警 / 标记已处理
router.post('/:classId/risk-alerts/:alertId/resolve', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const alertId = parseInt(req.params.alertId);
    const user = req.user;

    if (!isClassTeacher(db, classId, user)) {
        return res.status(403).json({ error: '无权操作' });
    }

    db.prepare('UPDATE student_risk_alerts SET is_resolved = 1, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND class_id = ?')
        .run(alertId, classId);
    res.json({ success: true });
});

// 一键发送催交/约谈通知
router.post('/:classId/risk-alerts/:alertId/notify', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const alertId = parseInt(req.params.alertId);
    const user = req.user;
    const { message } = req.body;

    if (!isClassTeacher(db, classId, user)) {
        return res.status(403).json({ error: '无权操作' });
    }

    const alert = db.prepare('SELECT * FROM student_risk_alerts WHERE id = ? AND class_id = ?').get(alertId, classId);
    if (!alert) return res.status(404).json({ error: '预警不存在' });

    // 发送站内通知（复用 messages 表）
    const notifyMsg = message || `[系统提醒] 老师关注到您近期学习状态有所下滑，请及时调整。预警原因：${alert.detail}`;
    db.prepare('INSERT INTO messages (from_id, to_id, content, type) VALUES (?, ?, ?, ?)')
        .run(user.id, alert.student_id, notifyMsg, 'system');

    db.prepare('UPDATE student_risk_alerts SET notified = 1 WHERE id = ?').run(alertId);
    res.json({ success: true });
});

// ==================== 学生能力画像 ====================

// 获取班级所有学生的能力雷达数据
router.get('/:classId/ability-profiles', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const user = req.user;

    if (!isClassTeacher(db, classId, user)) {
        return res.status(403).json({ error: '无权访问' });
    }

    const profiles = db.prepare(`
        SELECT sap.*, u.username, u.avatar
        FROM student_ability_profiles sap
        JOIN users u ON sap.student_id = u.id
        WHERE sap.class_id = ?
        ORDER BY u.username ASC
    `).all(classId);

    res.json({ profiles });
});

// 获取单个学生的能力画像
router.get('/:classId/ability-profiles/:studentId', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const studentId = parseInt(req.params.studentId);

    const profile = db.prepare(
        'SELECT * FROM student_ability_profiles WHERE student_id = ? AND class_id = ?'
    ).get(studentId, classId);

    if (!profile) {
        return res.json({ profile: { ui_design: 50, logic_design: 50, code_quality: 50, delivery_speed: 50, creativity: 50 } });
    }
    res.json({ profile });
});

// 教师手动更新学生能力维度（或系统自动计算后更新）
router.put('/:classId/ability-profiles/:studentId', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const studentId = parseInt(req.params.studentId);
    const user = req.user;
    const { ui_design, logic_design, code_quality, delivery_speed, creativity } = req.body;

    if (!isClassTeacher(db, classId, user)) {
        return res.status(403).json({ error: '无权操作' });
    }

    const clamp = (v) => Math.min(100, Math.max(0, parseInt(v) || 50));

    const existing = db.prepare('SELECT id FROM student_ability_profiles WHERE student_id = ? AND class_id = ?').get(studentId, classId);
    if (existing) {
        db.prepare(`UPDATE student_ability_profiles SET 
            ui_design = ?, logic_design = ?, code_quality = ?, delivery_speed = ?, creativity = ?, updated_at = CURRENT_TIMESTAMP
            WHERE student_id = ? AND class_id = ?`
        ).run(clamp(ui_design), clamp(logic_design), clamp(code_quality), clamp(delivery_speed), clamp(creativity), studentId, classId);
    } else {
        db.prepare(`INSERT INTO student_ability_profiles (student_id, class_id, ui_design, logic_design, code_quality, delivery_speed, creativity)
            VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(studentId, classId, clamp(ui_design), clamp(logic_design), clamp(code_quality), clamp(delivery_speed), clamp(creativity));
    }
    res.json({ success: true });
});

// ==================== 动态分组引擎 ====================

// 获取班级分组
router.get('/:classId/groups', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);

    const groups = db.prepare(`
        SELECT sg.*, 
            (SELECT COUNT(*) FROM group_members WHERE group_id = sg.id) as member_count
        FROM student_groups sg WHERE sg.class_id = ?
        ORDER BY sg.created_at ASC
    `).all(classId);

    // 获取每组的成员
    for (const g of groups) {
        g.members = db.prepare(`
            SELECT u.id, u.username, u.avatar, gm.role
            FROM group_members gm JOIN users u ON gm.user_id = u.id
            WHERE gm.group_id = ?
        `).all(g.id);
    }

    res.json({ groups });
});

// 智能分组 - 基于成绩的"组内异质、组间同质"
router.post('/:classId/groups/auto-generate', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const user = req.user;
    const { groupCount = 4, strategy = 'heterogeneous' } = req.body;

    if (!isClassTeacher(db, classId, user)) {
        return res.status(403).json({ error: '无权操作' });
    }

    // 获取班级学生及其平均分
    const students = db.prepare(`
        SELECT u.id, u.username,
            COALESCE(
                (SELECT AVG(CAST(hs.score AS FLOAT) / h.max_score * 100)
                 FROM homework_submissions hs
                 JOIN homework h ON hs.homework_id = h.id
                 WHERE hs.student_id = u.id AND h.class_id = ? AND hs.score IS NOT NULL), 50
            ) as avg_score
        FROM class_members cm JOIN users u ON cm.user_id = u.id
        WHERE cm.class_id = ? AND cm.role = 'student'
        ORDER BY avg_score DESC
    `).all(classId, classId);

    if (students.length < groupCount) {
        return res.status(400).json({ error: '学生人数不足以分为指定组数' });
    }

    // 清除旧的自动分组
    const oldGroups = db.prepare('SELECT id FROM student_groups WHERE class_id = ? AND name LIKE ?').all(classId, '自动分组%');
    for (const og of oldGroups) {
        db.prepare('DELETE FROM group_members WHERE group_id = ?').run(og.id);
        db.prepare('DELETE FROM student_groups WHERE id = ?').run(og.id);
    }

    // 蛇形分组法：组内异质、组间同质
    const groups = Array.from({ length: groupCount }, (_, i) => ({ name: `自动分组 ${i + 1}`, members: [] }));

    if (strategy === 'heterogeneous') {
        // 蛇形分配：1,2,3,4,4,3,2,1,1,2,3,4...
        let direction = 1;
        let gIdx = 0;
        for (const student of students) {
            groups[gIdx].members.push(student);
            gIdx += direction;
            if (gIdx >= groupCount) { gIdx = groupCount - 1; direction = -1; }
            if (gIdx < 0) { gIdx = 0; direction = 1; }
        }
    } else {
        // 同质分组：按水平段分
        const perGroup = Math.ceil(students.length / groupCount);
        for (let i = 0; i < students.length; i++) {
            groups[Math.min(Math.floor(i / perGroup), groupCount - 1)].members.push(students[i]);
        }
    }

    // 写入数据库
    const insertGroup = db.prepare('INSERT INTO student_groups (class_id, name, max_members, created_by) VALUES (?, ?, ?, ?)');
    const insertMember = db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)');

    const transaction = db.transaction(() => {
        for (const g of groups) {
            const r = insertGroup.run(classId, g.name, Math.ceil(students.length / groupCount) + 2, user.id);
            const groupId = r.lastInsertRowid;
            for (let i = 0; i < g.members.length; i++) {
                insertMember.run(groupId, g.members[i].id, i === 0 ? 'leader' : 'member');
            }
        }
    });
    transaction();

    // 保存分组策略
    db.prepare('INSERT INTO group_configs (class_id, strategy, group_count, config, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(classId, strategy, groupCount, JSON.stringify({ generated_at: new Date().toISOString() }), user.id);

    res.json({ success: true, groupCount, totalStudents: students.length });
});

// ==================== 统一成绩册 ====================

// 获取班级成绩册
router.get('/:classId/gradebook', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const user = req.user;

    if (!isClassTeacher(db, classId, user)) {
        return res.status(403).json({ error: '无权访问' });
    }

    const entries = db.prepare(`
        SELECT g.*, u.username as student_name
        FROM gradebook g
        JOIN users u ON g.student_id = u.id
        WHERE g.class_id = ?
        ORDER BY g.recorded_at DESC
    `).all(classId);

    // 按学生聚合
    const studentMap = {};
    for (const e of entries) {
        if (!studentMap[e.student_id]) {
            studentMap[e.student_id] = { student_name: e.student_name, entries: [], totalWeighted: 0, totalWeight: 0 };
        }
        studentMap[e.student_id].entries.push(e);
        studentMap[e.student_id].totalWeighted += (e.score / e.max_score) * e.weight;
        studentMap[e.student_id].totalWeight += e.weight;
    }

    // 计算加权平均
    const summary = Object.entries(studentMap).map(([id, data]) => ({
        student_id: parseInt(id),
        student_name: data.student_name,
        weighted_avg: data.totalWeight > 0 ? Math.round((data.totalWeighted / data.totalWeight) * 100) : 0,
        entry_count: data.entries.length
    })).sort((a, b) => b.weighted_avg - a.weighted_avg);

    res.json({ entries, summary });
});

// 手动向成绩册添加条目
router.post('/:classId/gradebook', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const user = req.user;
    const { student_id, title, score, max_score, weight, category, source_type, source_id } = req.body;

    if (!isClassTeacher(db, classId, user)) {
        return res.status(403).json({ error: '无权操作' });
    }

    db.prepare(`INSERT INTO gradebook (student_id, class_id, source_type, source_id, title, score, max_score, weight, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(student_id, classId, source_type || 'manual', source_id || 0, title, score, max_score || 100, weight || 1.0, category || 'homework');

    res.json({ success: true });
});

// ==================== 辅助函数 ====================

function isClassTeacher(db, classId, user) {
    if (user.role === 'admin') return true;
    const cls = db.prepare('SELECT teacher_id FROM classes WHERE id = ?').get(classId);
    if (cls && cls.teacher_id === user.id) return true;
    const membership = db.prepare('SELECT role FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, user.id);
    return membership && (membership.role === 'co_teacher' || membership.role === 'ta');
}

// 动态计算学业危机预警
function computeRiskAlerts(db, classId) {
    const students = db.prepare(`
        SELECT u.id FROM class_members cm JOIN users u ON cm.user_id = u.id
        WHERE cm.class_id = ? AND cm.role = 'student'
    `).all(classId);

    const recentHomework = db.prepare(`
        SELECT id, due_date FROM homework WHERE class_id = ? AND status = 'active'
        ORDER BY created_at DESC LIMIT 10
    `).all(classId);

    if (recentHomework.length === 0) return;

    const hwIds = recentHomework.map(h => h.id);
    const placeholders = hwIds.map(() => '?').join(',');

    for (const student of students) {
        const alerts = [];

        // 条件1：连续 2 次作业未交
        const submissions = db.prepare(`
            SELECT h.id, hs.id as sub_id
            FROM homework h
            LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = ?
            WHERE h.id IN (${placeholders})
            ORDER BY h.created_at DESC
        `).all(student.id, ...hwIds);

        let consecutiveMissing = 0;
        for (const s of submissions) {
            if (!s.sub_id) consecutiveMissing++;
            else break;
        }
        if (consecutiveMissing >= 2) {
            alerts.push({ type: 'missing_homework', severity: 'high', detail: `连续${consecutiveMissing}次作业未交` });
        }

        // 条件2：最近3次作业平均分环比下降20%
        const recentScores = db.prepare(`
            SELECT hs.score, h.max_score
            FROM homework_submissions hs
            JOIN homework h ON hs.homework_id = h.id
            WHERE hs.student_id = ? AND h.class_id = ? AND hs.score IS NOT NULL
            ORDER BY hs.graded_at DESC LIMIT 6
        `).all(student.id, classId);

        if (recentScores.length >= 6) {
            const recent3 = recentScores.slice(0, 3).reduce((s, r) => s + r.score / r.max_score, 0) / 3;
            const prev3 = recentScores.slice(3, 6).reduce((s, r) => s + r.score / r.max_score, 0) / 3;
            if (prev3 > 0 && (prev3 - recent3) / prev3 >= 0.2) {
                alerts.push({ type: 'score_decline', severity: 'medium', detail: `近3次平均分环比下降${Math.round((prev3 - recent3) / prev3 * 100)}%` });
            }
        }

        // 条件3：最近作业正确率 < 60%
        if (recentScores.length >= 3) {
            const avgRate = recentScores.slice(0, 3).reduce((s, r) => s + r.score / r.max_score, 0) / 3;
            if (avgRate < 0.6) {
                alerts.push({ type: 'low_accuracy', severity: 'medium', detail: `近3次作业正确率仅${Math.round(avgRate * 100)}%` });
            }
        }

        // 写入预警（去重：同一类型如果已有未解决的就不重复创建）
        for (const alert of alerts) {
            const existing = db.prepare(
                'SELECT id FROM student_risk_alerts WHERE student_id = ? AND class_id = ? AND alert_type = ? AND is_resolved = 0'
            ).get(student.id, classId, alert.type);
            if (!existing) {
                db.prepare(
                    'INSERT INTO student_risk_alerts (student_id, class_id, alert_type, severity, detail) VALUES (?, ?, ?, ?, ?)'
                ).run(student.id, classId, alert.type, alert.severity, alert.detail);
            }
        }
    }
}

module.exports = router;
