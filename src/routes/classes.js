/**
 * 班级管理路由 - 创建班级/加入班级/管理学生
 */
const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// 生成邀请码
function generateInviteCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// 获取我的班级列表（教师：我创建的+加入的；学生：加入的）
router.get('/my', (req, res) => {
    const db = getDb();
    const user = req.user;

    if (user.role === 'teacher' || user.role === 'admin') {
        // 教师：我创建的班级
        const created = db.prepare(`
            SELECT c.*, 
                (SELECT COUNT(*) FROM class_members WHERE class_id = c.id AND role = 'student') as member_count,
                'owner' as my_role
            FROM classes c WHERE c.teacher_id = ?
            ORDER BY c.created_at DESC
        `).all(user.id);

        // 教师：我作为协作教师加入的班级
        const joined = db.prepare(`
            SELECT c.*, u.username as teacher_name,
                (SELECT COUNT(*) FROM class_members WHERE class_id = c.id AND role = 'student') as member_count,
                cm.role as my_role, cm.joined_at
            FROM class_members cm
            JOIN classes c ON cm.class_id = c.id
            JOIN users u ON c.teacher_id = u.id
            WHERE cm.user_id = ? AND cm.role = 'co_teacher'
            ORDER BY cm.joined_at DESC
        `).all(user.id);

        return res.json({ classes: [...created, ...joined] });
    }

    // 学生：获取加入的班级
    const classes = db.prepare(`
        SELECT c.*, u.username as teacher_name,
            (SELECT COUNT(*) FROM class_members WHERE class_id = c.id AND role = 'student') as member_count,
            cm.joined_at, cm.role as my_role
        FROM class_members cm
        JOIN classes c ON cm.class_id = c.id
        JOIN users u ON c.teacher_id = u.id
        WHERE cm.user_id = ?
        ORDER BY cm.joined_at DESC
    `).all(user.id);
    res.json({ classes });
});

// 创建班级（仅教师/管理员）
router.post('/create', (req, res) => {
    const db = getDb();
    const user = req.user;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以创建班级' });
    }

    const { name, description, schoolLevel, subject } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: '班级名称不能为空' });
    }

    const inviteCode = generateInviteCode();

    const result = db.prepare(
        'INSERT INTO classes (name, description, teacher_id, invite_code, school_level, subject) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name.trim(), description || '', user.id, inviteCode, schoolLevel || '', subject || '');

    res.json({
        success: true,
        class: { id: result.lastInsertRowid, name: name.trim(), invite_code: inviteCode }
    });
});

// 加入班级（学生或协作教师通过邀请码）
router.post('/join', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { inviteCode } = req.body;

    if (!inviteCode || !inviteCode.trim()) {
        return res.status(400).json({ error: '请输入邀请码' });
    }

    const cls = db.prepare('SELECT * FROM classes WHERE invite_code = ?').get(inviteCode.trim().toUpperCase());
    if (!cls) {
        return res.status(404).json({ error: '邀请码无效' });
    }

    if (cls.teacher_id === user.id) {
        return res.status(400).json({ error: '你是该班级的创建者，无需加入' });
    }

    const existing = db.prepare('SELECT id FROM class_members WHERE class_id = ? AND user_id = ?').get(cls.id, user.id);
    if (existing) {
        return res.status(400).json({ error: '你已经在该班级中' });
    }

    // 教师以协作教师身份加入，学生以学生身份加入
    const memberRole = (user.role === 'teacher' || user.role === 'admin') ? 'co_teacher' : 'student';
    db.prepare('INSERT INTO class_members (class_id, user_id, role) VALUES (?, ?, ?)').run(cls.id, user.id, memberRole);
    res.json({ success: true, class: { id: cls.id, name: cls.name }, role: memberRole });
});

// ==================== 学生学习概览 ====================
// 必须放在 /:id 路由之前，否则 'student' 会匹配 :id 参数
router.get('/student/overview', (req, res) => {
    const db = getDb();
    const user = req.user;

    // 我加入的班级
    const myClasses = db.prepare(`
        SELECT c.id, c.name, u.username as teacher_name
        FROM class_members cm
        JOIN classes c ON cm.class_id = c.id
        JOIN users u ON c.teacher_id = u.id
        WHERE cm.user_id = ? AND cm.role = 'student'
    `).all(user.id);

    const classIds = myClasses.map(c => c.id);

    if (classIds.length === 0) {
        return res.json({
            classes: [],
            homeworkStats: { total: 0, pending: 0, submitted: 0, graded: 0, overdue: 0 },
            recentGrades: [],
            announcements: [],
            avgScore: 0
        });
    }

    const placeholders = classIds.map(() => '?').join(',');

    // 作业统计
    const allHomework = db.prepare(`
        SELECT h.id, h.due_date, hs.status as my_status
        FROM homework h
        LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = ?
        WHERE h.class_id IN (${placeholders}) AND h.status = 'active'
    `).all(user.id, ...classIds);

    let pending = 0, submitted = 0, graded = 0, overdue = 0;
    allHomework.forEach(hw => {
        if (hw.my_status === 'graded') graded++;
        else if (hw.my_status === 'submitted') submitted++;
        else if (hw.due_date && new Date(hw.due_date) < new Date()) overdue++;
        else pending++;
    });

    // 最近成绩
    const recentGrades = db.prepare(`
        SELECT hs.score, h.max_score, h.title as homework_title, c.name as class_name, hs.graded_at
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        JOIN classes c ON h.class_id = c.id
        WHERE hs.student_id = ? AND hs.status = 'graded' AND h.class_id IN (${placeholders})
        ORDER BY hs.graded_at DESC
        LIMIT 10
    `).all(user.id, ...classIds);

    // 平均分
    const avgResult = db.prepare(`
        SELECT AVG(CAST(hs.score AS FLOAT) / h.max_score * 100) as avg_pct
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        WHERE hs.student_id = ? AND hs.status = 'graded' AND h.class_id IN (${placeholders})
    `).get(user.id, ...classIds);

    // 最近公告
    const announcements = db.prepare(`
        SELECT a.*, u.username as teacher_name, c.name as class_name
        FROM announcements a
        JOIN users u ON a.teacher_id = u.id
        JOIN classes c ON a.class_id = c.id
        WHERE a.class_id IN (${placeholders})
        ORDER BY a.created_at DESC
        LIMIT 10
    `).all(...classIds);

    res.json({
        classes: myClasses,
        homeworkStats: { total: allHomework.length, pending, submitted, graded, overdue },
        recentGrades,
        announcements,
        avgScore: Math.round(avgResult.avg_pct || 0)
    });
});

// 获取班级详情（含成员列表与统计）
router.get('/:id', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;

    const cls = db.prepare(`
        SELECT c.*, u.username as teacher_name
        FROM classes c JOIN users u ON c.teacher_id = u.id
        WHERE c.id = ?
    `).get(classId);

    if (!cls) return res.status(404).json({ error: '班级不存在' });

    // 验证权限：创建者、协作教师、班级成员或管理员
    const membership = db.prepare('SELECT id, role FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, user.id);
    const isTeacher = cls.teacher_id === user.id || (membership && membership.role === 'co_teacher') || user.role === 'admin';
    if (!isTeacher && !membership) {
        return res.status(403).json({ error: '无权访问该班级' });
    }

    const members = db.prepare(`
        SELECT u.id, u.username, u.avatar, u.role, u.email, u.school, u.bio, u.coins,
            u.created_at as register_time, cm.joined_at, cm.role as class_role,
            (SELECT COUNT(*) FROM homework_submissions hs 
             JOIN homework h ON hs.homework_id = h.id 
             WHERE hs.student_id = u.id AND h.class_id = ?) as submission_count,
            (SELECT COUNT(*) FROM homework h WHERE h.class_id = ? AND h.status = 'active') as total_homework,
            (SELECT ROUND(AVG(hs.score), 1) FROM homework_submissions hs 
             JOIN homework h ON hs.homework_id = h.id 
             WHERE hs.student_id = u.id AND h.class_id = ? AND hs.score IS NOT NULL) as avg_score,
            (SELECT MAX(hs.score) FROM homework_submissions hs 
             JOIN homework h ON hs.homework_id = h.id 
             WHERE hs.student_id = u.id AND h.class_id = ? AND hs.score IS NOT NULL) as max_score,
            (SELECT COUNT(*) FROM projects WHERE user_id = u.id) as project_count
        FROM class_members cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.class_id = ?
        ORDER BY cm.role ASC, cm.joined_at ASC
    `).all(classId, classId, classId, classId, classId);

    // 班级统计信息
    const studentMembers = members.filter(m => m.class_role === 'student');
    const totalHomework = studentMembers[0]?.total_homework || 0;
    const stats = {
        total_members: studentMembers.length,
        co_teachers: members.filter(m => m.class_role === 'co_teacher').length,
        total_homework: totalHomework,
        avg_score: null,
        completion_rate: 0
    };

    if (studentMembers.length > 0 && totalHomework > 0) {
        const totalSubmissions = studentMembers.reduce((sum, m) => sum + (m.submission_count || 0), 0);
        stats.completion_rate = Math.round((totalSubmissions / (studentMembers.length * totalHomework)) * 100);
        const scores = studentMembers.filter(m => m.avg_score != null).map(m => m.avg_score);
        if (scores.length) stats.avg_score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
    }

    res.json({ class: cls, members, stats, isTeacher });
});

// 更新班级信息
router.put('/:id', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });

    if (cls.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权修改该班级' });
    }

    const { name, description, schoolLevel, subject } = req.body;
    db.prepare(`
        UPDATE classes SET name = ?, description = ?, school_level = ?, subject = ?
        WHERE id = ?
    `).run(
        name ? name.trim() : cls.name,
        description !== undefined ? description : cls.description,
        schoolLevel !== undefined ? schoolLevel : (cls.school_level || ''),
        subject !== undefined ? subject : (cls.subject || ''),
        classId
    );

    res.json({ success: true });
});

// 更新成员角色（设置为协作教师或学生）
router.put('/:id/member/:userId/role', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const memberId = parseInt(req.params.userId);
    const user = req.user;
    const { role } = req.body;

    if (!['student', 'co_teacher'].includes(role)) {
        return res.status(400).json({ error: '无效角色' });
    }

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (cls.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权操作' });
    }

    db.prepare('UPDATE class_members SET role = ? WHERE class_id = ? AND user_id = ?').run(role, classId, memberId);
    res.json({ success: true });
});

// 移除班级成员（教师可操作）
router.delete('/:id/member/:userId', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const memberId = parseInt(req.params.userId);
    const user = req.user;

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });

    // 创建者、协作教师、管理员可以移除成员
    const membership = db.prepare('SELECT role FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, user.id);
    const canManage = cls.teacher_id === user.id || (membership && membership.role === 'co_teacher') || user.role === 'admin';
    if (!canManage) {
        return res.status(403).json({ error: '无权操作' });
    }

    db.prepare('DELETE FROM class_members WHERE class_id = ? AND user_id = ?').run(classId, memberId);
    res.json({ success: true });
});

// 重新生成邀请码
router.post('/:id/regenerate-code', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (cls.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权操作' });
    }

    const newCode = generateInviteCode();
    db.prepare('UPDATE classes SET invite_code = ? WHERE id = ?').run(newCode, classId);
    res.json({ success: true, invite_code: newCode });
});

// 删除班级（仅创建者/管理员）
router.delete('/:id', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (cls.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权操作' });
    }

    const transaction = db.transaction(() => {
        db.prepare('DELETE FROM class_members WHERE class_id = ?').run(classId);
        db.prepare('DELETE FROM homework_submissions WHERE homework_id IN (SELECT id FROM homework WHERE class_id = ?)').run(classId);
        db.prepare('DELETE FROM homework WHERE class_id = ?').run(classId);
        db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    });
    transaction();

    res.json({ success: true });
});

// 获取班级学生成绩分布数据（用于可视化）
router.get('/:id/analytics', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });

    const membership = db.prepare('SELECT role FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, user.id);
    const isTeacher = cls.teacher_id === user.id || (membership && membership.role === 'co_teacher') || user.role === 'admin';
    if (!isTeacher) return res.status(403).json({ error: '无权访问' });

    // 成绩分布
    const scoreDistribution = db.prepare(`
        SELECT 
            CASE 
                WHEN hs.score >= 90 THEN '优秀'
                WHEN hs.score >= 80 THEN '良好'
                WHEN hs.score >= 70 THEN '中等'
                WHEN hs.score >= 60 THEN '及格'
                ELSE '不及格'
            END as grade_range,
            COUNT(*) as count
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        WHERE h.class_id = ? AND hs.score IS NOT NULL
        GROUP BY grade_range
    `).all(classId);

    // 每次作业的平均分趋势
    const homeworkTrend = db.prepare(`
        SELECT h.title, h.created_at,
            ROUND(AVG(hs.score), 1) as avg_score,
            COUNT(hs.id) as submission_count,
            (SELECT COUNT(*) FROM class_members WHERE class_id = h.class_id AND role = 'student') as total_students
        FROM homework h
        LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.score IS NOT NULL
        WHERE h.class_id = ?
        GROUP BY h.id
        ORDER BY h.created_at ASC
    `).all(classId);

    // 学生活跃度（最近7天提交数）
    const recentActivity = db.prepare(`
        SELECT u.username, COUNT(hs.id) as recent_submissions
        FROM class_members cm
        JOIN users u ON cm.user_id = u.id
        LEFT JOIN homework_submissions hs ON hs.student_id = u.id 
            AND hs.homework_id IN (SELECT id FROM homework WHERE class_id = ?)
            AND hs.submitted_at >= datetime('now', '-7 days')
        WHERE cm.class_id = ? AND cm.role = 'student'
        GROUP BY u.id
        ORDER BY recent_submissions DESC
        LIMIT 20
    `).all(classId, classId);

    res.json({ scoreDistribution, homeworkTrend, recentActivity });
});

// ==================== 班级公告 ====================

// 获取班级公告列表
router.get('/:id/announcements', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;

    // 验证权限（班级成员或教师）
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });

    const isMember = db.prepare('SELECT id FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, user.id);
    if (!isMember && cls.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权查看该班级公告' });
    }

    const announcements = db.prepare(`
        SELECT a.*, u.username as teacher_name
        FROM announcements a
        JOIN users u ON a.teacher_id = u.id
        WHERE a.class_id = ?
        ORDER BY a.created_at DESC
        LIMIT 50
    `).all(classId);

    res.json({ announcements });
});

// 发布班级公告
router.post('/:id/announcements', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;
    const { title, content, priority } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以发布公告' });
    }

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });

    // 验证是班主或协作教师
    if (cls.teacher_id !== user.id && user.role !== 'admin') {
        const isCo = db.prepare('SELECT id FROM class_members WHERE class_id = ? AND user_id = ? AND role = ?').get(classId, user.id, 'co_teacher');
        if (!isCo) return res.status(403).json({ error: '无权在该班级发布公告' });
    }

    if (!title || !title.trim()) {
        return res.status(400).json({ error: '公告标题不能为空' });
    }

    const result = db.prepare(
        'INSERT INTO announcements (class_id, teacher_id, title, content, priority) VALUES (?, ?, ?, ?, ?)'
    ).run(classId, user.id, title.trim(), (content || '').trim(), priority || 'normal');

    res.json({ success: true, id: result.lastInsertRowid });
});

// 删除班级公告
router.delete('/:id/announcements/:annId', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const annId = parseInt(req.params.annId);
    const user = req.user;

    const ann = db.prepare('SELECT * FROM announcements WHERE id = ? AND class_id = ?').get(annId, classId);
    if (!ann) return res.status(404).json({ error: '公告不存在' });

    if (ann.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权删除该公告' });
    }

    db.prepare('DELETE FROM announcements WHERE id = ?').run(annId);
    res.json({ success: true });
});

// ==================== 助教(TA)管理 ====================

// 设置成员为助教
router.put('/:id/member/:userId/set-ta', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const memberId = parseInt(req.params.userId);
    const user = req.user;

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (cls.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '只有班级创建者可以设置助教' });
    }

    db.prepare('UPDATE class_members SET role = ? WHERE class_id = ? AND user_id = ?').run('ta', classId, memberId);
    res.json({ success: true });
});

// ==================== 学生分组 ====================

// 获取班级分组列表
router.get('/:id/groups', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);

    const groups = db.prepare(`
        SELECT sg.*, 
            (SELECT COUNT(*) FROM group_members WHERE group_id = sg.id) as member_count
        FROM student_groups sg
        WHERE sg.class_id = ?
        ORDER BY sg.created_at DESC
    `).all(classId);

    // 获取每个组的成员
    const getMembers = db.prepare(`
        SELECT gm.*, u.username, u.avatar
        FROM group_members gm
        JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = ?
    `);

    for (const group of groups) {
        group.members = getMembers.all(group.id);
    }

    res.json({ groups });
});

// 创建分组
router.post('/:id/groups', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;
    const { name, description, maxMembers } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: '分组名称不能为空' });
    }

    const result = db.prepare(
        'INSERT INTO student_groups (class_id, name, description, max_members, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(classId, name.trim(), description || '', maxMembers || 5, user.id);

    res.json({ success: true, groupId: result.lastInsertRowid });
});

// 加入分组
router.post('/:id/groups/:groupId/join', (req, res) => {
    const db = getDb();
    const groupId = parseInt(req.params.groupId);
    const user = req.user;

    const group = db.prepare('SELECT * FROM student_groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: '分组不存在' });

    const memberCount = db.prepare('SELECT COUNT(*) as c FROM group_members WHERE group_id = ?').get(groupId).c;
    if (memberCount >= group.max_members) {
        return res.status(400).json({ error: '该分组已满' });
    }

    const existing = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, user.id);
    if (existing) return res.status(400).json({ error: '你已在该分组中' });

    db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(groupId, user.id, 'member');
    res.json({ success: true });
});

// 退出分组
router.post('/:id/groups/:groupId/leave', (req, res) => {
    const db = getDb();
    const groupId = parseInt(req.params.groupId);
    const user = req.user;

    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, user.id);
    res.json({ success: true });
});

// 教师指定分组成员
router.post('/:id/groups/:groupId/assign', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const groupId = parseInt(req.params.groupId);
    const user = req.user;
    const { userIds } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以指定分组成员' });
    }

    if (!userIds || !Array.isArray(userIds)) {
        return res.status(400).json({ error: '请提供学生列表' });
    }

    const insert = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)');
    const transaction = db.transaction(() => {
        for (const uid of userIds) {
            insert.run(groupId, uid, 'member');
        }
    });
    transaction();

    res.json({ success: true });
});

// 删除分组
router.delete('/:id/groups/:groupId', (req, res) => {
    const db = getDb();
    const groupId = parseInt(req.params.groupId);
    const user = req.user;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以删除分组' });
    }

    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM student_groups WHERE id = ?').run(groupId);
    res.json({ success: true });
});

// ==================== 考勤签到系统 ====================

// 创建签到（教师发起）
router.post('/:id/attendance', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;
    const { title, duration } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以发起签到' });
    }

    // 生成随机6位签到码
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const durationMinutes = duration || 5; // 默认5分钟有效
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

    const result = db.prepare(
        'INSERT INTO attendance (class_id, teacher_id, code, title, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(classId, user.id, code, title || '课堂签到', expiresAt);

    res.json({ success: true, attendanceId: result.lastInsertRowid, code, expiresAt });
});

// 学生签到
router.post('/:id/attendance/:attendId/sign', (req, res) => {
    const db = getDb();
    const attendId = parseInt(req.params.attendId);
    const user = req.user;
    const { code } = req.body;

    const attendance = db.prepare('SELECT * FROM attendance WHERE id = ?').get(attendId);
    if (!attendance) return res.status(404).json({ error: '签到不存在' });

    // 检查签到码
    if (attendance.code !== (code || '').toUpperCase()) {
        return res.status(400).json({ error: '签到码错误' });
    }

    // 检查是否过期
    if (new Date(attendance.expires_at) < new Date()) {
        return res.status(400).json({ error: '签到已过期' });
    }

    // 检查是否已签到
    const existing = db.prepare('SELECT id FROM attendance_records WHERE attendance_id = ? AND student_id = ?').get(attendId, user.id);
    if (existing) return res.status(400).json({ error: '你已经签到过了' });

    db.prepare('INSERT INTO attendance_records (attendance_id, student_id) VALUES (?, ?)').run(attendId, user.id);
    res.json({ success: true });
});

// 获取签到列表和统计
router.get('/:id/attendance', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);

    const attendances = db.prepare(`
        SELECT a.*,
            (SELECT COUNT(*) FROM attendance_records WHERE attendance_id = a.id) as signed_count,
            (SELECT COUNT(*) FROM class_members WHERE class_id = a.class_id AND role = 'student') as total_students
        FROM attendance a
        WHERE a.class_id = ?
        ORDER BY a.created_at DESC
        LIMIT 50
    `).all(classId);

    res.json({ attendances });
});

// 获取某次签到的详细记录
router.get('/:id/attendance/:attendId', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const attendId = parseInt(req.params.attendId);

    const attendance = db.prepare('SELECT * FROM attendance WHERE id = ? AND class_id = ?').get(attendId, classId);
    if (!attendance) return res.status(404).json({ error: '签到不存在' });

    // 已签到的学生
    const signedStudents = db.prepare(`
        SELECT ar.signed_at, u.id as user_id, u.username, u.avatar
        FROM attendance_records ar
        JOIN users u ON ar.student_id = u.id
        WHERE ar.attendance_id = ?
        ORDER BY ar.signed_at ASC
    `).all(attendId);

    // 未签到的学生
    const absentStudents = db.prepare(`
        SELECT u.id as user_id, u.username, u.avatar
        FROM class_members cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.class_id = ? AND cm.role = 'student'
        AND cm.user_id NOT IN (SELECT student_id FROM attendance_records WHERE attendance_id = ?)
    `).all(classId, attendId);

    res.json({ attendance, signedStudents, absentStudents });
});

// ==================== 学期/班级切换 ====================

// 归档班级（学期结束）
router.post('/:id/archive', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (cls.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权操作' });
    }

    db.prepare('UPDATE classes SET archived = 1 WHERE id = ?').run(classId);
    res.json({ success: true });
});

// 复制班级（新学期使用同样设置）
router.post('/:id/duplicate', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;
    const { newName, newSemester } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以复制班级' });
    }

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!cls) return res.status(404).json({ error: '班级不存在' });

    const inviteCode = generateInviteCode();
    const result = db.prepare(
        'INSERT INTO classes (name, description, teacher_id, invite_code, school_level, subject, semester) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
        newName || cls.name + ' (副本)',
        cls.description,
        user.id,
        inviteCode,
        cls.school_level || '',
        cls.subject || '',
        newSemester || ''
    );

    res.json({ success: true, newClassId: result.lastInsertRowid, inviteCode });
});

// ==================== 智能分组（组内异质/组间同质）====================

// 基于成绩的智能分组
router.post('/:id/smart-group', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;
    const { groupCount, strategy, groupSize } = req.body;
    // strategy: 'heterogeneous'(组内异质) | 'homogeneous'(组内同质) | 'random'

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以执行智能分组' });
    }

    // 获取班级学生及其平均分
    const students = db.prepare(`
        SELECT u.id, u.username, u.avatar,
            (SELECT ROUND(AVG(hs.score), 1) FROM homework_submissions hs 
             JOIN homework h ON hs.homework_id = h.id 
             WHERE hs.student_id = u.id AND h.class_id = ? AND hs.score IS NOT NULL) as avg_score
        FROM class_members cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.class_id = ? AND cm.role = 'student'
    `).all(classId, classId);

    if (students.length < 2) {
        return res.status(400).json({ error: '学生人数不足' });
    }

    const targetGroupCount = groupCount || Math.ceil(students.length / (groupSize || 4));
    const mode = strategy || 'heterogeneous';

    // 按成绩排序
    students.sort((a, b) => (b.avg_score || 0) - (a.avg_score || 0));

    const groups = Array.from({ length: targetGroupCount }, (_, i) => ({
        name: `第 ${i + 1} 组`,
        members: []
    }));

    if (mode === 'random') {
        // 随机打乱
        const shuffled = students.sort(() => Math.random() - 0.5);
        shuffled.forEach((s, i) => groups[i % targetGroupCount].members.push(s));
    } else if (mode === 'heterogeneous') {
        // 组内异质：蛇形分配（1234, 4321, 1234...）
        let direction = 1;
        let groupIdx = 0;
        for (const student of students) {
            groups[groupIdx].members.push(student);
            groupIdx += direction;
            if (groupIdx >= targetGroupCount || groupIdx < 0) {
                direction *= -1;
                groupIdx += direction;
            }
        }
    } else {
        // 组内同质：按顺序分配
        students.forEach((s, i) => groups[i % targetGroupCount].members.push(s));
        // 重新按成绩分段
        const perGroup = Math.ceil(students.length / targetGroupCount);
        for (let i = 0; i < targetGroupCount; i++) {
            groups[i].members = students.slice(i * perGroup, (i + 1) * perGroup);
        }
    }

    // 写入数据库
    const deleteOldGroups = db.prepare('DELETE FROM group_members WHERE group_id IN (SELECT id FROM student_groups WHERE class_id = ? AND name LIKE ?)');
    const deleteGroups = db.prepare('DELETE FROM student_groups WHERE class_id = ? AND name LIKE ?');
    const insertGroup = db.prepare('INSERT INTO student_groups (class_id, name, description, max_members, created_by) VALUES (?, ?, ?, ?, ?)');
    const insertMember = db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)');

    const transaction = db.transaction(() => {
        // 清除旧的智能分组
        deleteOldGroups.run(classId, '第 % 组');
        deleteGroups.run(classId, '第 % 组');

        for (const group of groups) {
            const result = insertGroup.run(classId, group.name, `智能分组 (${mode})`, group.members.length + 2, user.id);
            const gid = result.lastInsertRowid;
            for (let i = 0; i < group.members.length; i++) {
                insertMember.run(gid, group.members[i].id, i === 0 ? 'leader' : 'member');
            }
        }
    });
    transaction();

    res.json({
        success: true,
        groups: groups.map(g => ({
            name: g.name,
            members: g.members.map(m => ({ id: m.id, username: m.username, avgScore: m.avg_score }))
        })),
        strategy: mode
    });
});

// 面向不同小组发布进阶挑战作业
router.post('/:id/group-homework', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.id);
    const user = req.user;
    const { title, description, groupId, dueDate, maxScore, difficultyLevel } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以发布作业' });
    }

    if (!title || !groupId) {
        return res.status(400).json({ error: '请填写标题并选择目标小组' });
    }

    const result = db.prepare(
        'INSERT INTO homework (title, description, class_id, teacher_id, due_date, max_score, type, difficulty_level, target_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(title.trim(), description || '', classId, user.id, dueDate || null, maxScore || 100, 'group_challenge', difficultyLevel || 'normal', parseInt(groupId));

    res.json({ success: true, homework: { id: result.lastInsertRowid } });
});

module.exports = router;
