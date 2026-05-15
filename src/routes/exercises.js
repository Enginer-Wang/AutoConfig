/**
 * 练习记录路由 - 学生练习过关记录与排名
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// 提交/更新练习记录
router.post('/submit', authMiddleware, (req, res) => {
    const { projectId, score, maxScore, levelReached, completed, timeSpent } = req.body;

    if (!projectId) {
        return res.status(400).json({ error: '缺少项目ID' });
    }

    const db = getDb();

    // 检查项目是否存在
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(parseInt(projectId));
    if (!project) {
        return res.status(404).json({ error: '项目不存在' });
    }

    // 查找已有记录
    const existing = db.prepare(
        'SELECT id, score, level_reached FROM exercise_records WHERE user_id = ? AND project_id = ?'
    ).get(req.user.id, parseInt(projectId));

    if (existing) {
        // 只更新更好的成绩
        const newScore = Math.max(existing.score, parseInt(score) || 0);
        const newLevel = Math.max(existing.level_reached, parseInt(levelReached) || 0);

        db.prepare(`
            UPDATE exercise_records SET 
                score = ?, max_score = ?, level_reached = ?,
                completed = ?, time_spent = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            newScore,
            parseInt(maxScore) || 100,
            newLevel,
            completed ? 1 : 0,
            parseInt(timeSpent) || 0,
            existing.id
        );

        const record = db.prepare('SELECT * FROM exercise_records WHERE id = ?').get(existing.id);
        return res.json({ success: true, record });
    }

    // 新建记录
    const result = db.prepare(`
        INSERT INTO exercise_records (user_id, project_id, score, max_score, level_reached, completed, time_spent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        req.user.id,
        parseInt(projectId),
        parseInt(score) || 0,
        parseInt(maxScore) || 100,
        parseInt(levelReached) || 0,
        completed ? 1 : 0,
        parseInt(timeSpent) || 0
    );

    const record = db.prepare('SELECT * FROM exercise_records WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, record });
});

// 获取当前用户的所有练习记录
router.get('/my', authMiddleware, (req, res) => {
    const db = getDb();

    const records = db.prepare(`
        SELECT er.*, p.name as project_name, p.slug, p.school_level, p.subject,
            u.username as author
        FROM exercise_records er
        JOIN projects p ON er.project_id = p.id
        JOIN users u ON p.user_id = u.id
        WHERE er.user_id = ?
        ORDER BY er.updated_at DESC
    `).all(req.user.id);

    res.json({ records });
});

// 获取某个项目的排行榜
router.get('/ranking/:projectId', (req, res) => {
    const db = getDb();
    const projectId = parseInt(req.params.projectId);

    const rankings = db.prepare(`
        SELECT er.score, er.level_reached, er.completed, er.time_spent, er.updated_at,
            u.username, u.avatar
        FROM exercise_records er
        JOIN users u ON er.user_id = u.id
        WHERE er.project_id = ?
        ORDER BY er.score DESC, er.level_reached DESC, er.time_spent ASC
        LIMIT 50
    `).all(projectId);

    res.json({ rankings });
});

// 获取全站优秀学生排行
router.get('/top-students', (req, res) => {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 20;

    const students = db.prepare(`
        SELECT u.id, u.username, u.avatar, u.school,
            COUNT(DISTINCT er.project_id) as exercises_done,
            SUM(er.completed) as exercises_completed,
            COALESCE(SUM(er.score), 0) as total_score,
            COALESCE(AVG(er.score), 0) as avg_score
        FROM users u
        JOIN exercise_records er ON u.id = er.user_id
        WHERE u.role = 'student'
        GROUP BY u.id
        ORDER BY total_score DESC, exercises_completed DESC
        LIMIT ?
    `).all(limit);

    res.json({ students });
});

// 获取统计报表数据
router.get('/report', (req, res) => {
    const db = getDb();

    // 各学科练习完成情况
    const subjectReport = db.prepare(`
        SELECT p.school_level, p.subject,
            COUNT(DISTINCT er.user_id) as student_count,
            COUNT(er.id) as attempt_count,
            SUM(er.completed) as completed_count,
            COALESCE(AVG(er.score), 0) as avg_score
        FROM exercise_records er
        JOIN projects p ON er.project_id = p.id
        WHERE p.school_level != '' AND p.subject != ''
        GROUP BY p.school_level, p.subject
        ORDER BY attempt_count DESC
    `).all();

    // 热门练习项目
    const hotExercises = db.prepare(`
        SELECT p.id, p.name, p.slug, p.school_level, p.subject,
            u.username as author,
            COUNT(er.id) as attempt_count,
            COUNT(DISTINCT er.user_id) as student_count,
            SUM(er.completed) as completed_count,
            COALESCE(AVG(er.score), 0) as avg_score
        FROM projects p
        JOIN exercise_records er ON p.id = er.project_id
        JOIN users u ON p.user_id = u.id
        GROUP BY p.id
        ORDER BY student_count DESC
        LIMIT 10
    `).all();

    // 总体统计
    const overall = db.prepare(`
        SELECT
            (SELECT COUNT(DISTINCT user_id) FROM exercise_records) as active_students,
            (SELECT COUNT(*) FROM exercise_records) as total_attempts,
            (SELECT SUM(completed) FROM exercise_records) as total_completed,
            (SELECT COUNT(DISTINCT project_id) FROM exercise_records) as exercises_used
    `).get();

    res.json({ subjectReport, hotExercises, overall });
});

module.exports = router;
