/**
 * 学科浏览路由 - 按学段/学科分类浏览共享课件
 */
const express = require('express');
const { getDb } = require('../database');
const { optionalAuth, authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 学段和学科定义
const SCHOOL_LEVELS = {
    elementary: {
        name: '小学',
        subjects: ['语文', '数学', '英语', '科学', '道德与法治', '音乐', '美术', '体育', '信息技术']
    },
    middle: {
        name: '初中',
        subjects: ['语文', '数学', '英语', '物理', '化学', '道德与法治', '历史', '地理', '生物', '信息技术']
    },
    high: {
        name: '高中',
        subjects: ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '信息技术', '通用技术']
    }
};

// 获取学段和学科结构（含每个学科的课件数量）
router.get('/structure', (req, res) => {
    const db = getDb();

    const result = {};
    for (const [levelKey, levelInfo] of Object.entries(SCHOOL_LEVELS)) {
        result[levelKey] = {
            name: levelInfo.name,
            subjects: levelInfo.subjects.map(subj => {
                const count = db.prepare(`
                    SELECT COUNT(*) as count FROM projects 
                    WHERE is_public = 1 AND school_level = ? AND subject = ?
                `).get(levelKey, subj);
                return { name: subj, count: count.count };
            })
        };
    }

    res.json({ levels: result });
});

// 按学科获取共享课件列表（按访问量排序）
router.get('/list', (req, res) => {
    const { level, subject, page: rawPage, limit: rawLimit, search } = req.query;
    const page = parseInt(rawPage) || 1;
    const limit = parseInt(rawLimit) || 12;
    const offset = (page - 1) * limit;

    const db = getDb();

    let query = `
        SELECT p.*, u.username, u.avatar, u.school,
            (SELECT COUNT(*) FROM likes WHERE project_id = p.id) as like_count
        FROM projects p
        JOIN users u ON p.user_id = u.id
        WHERE p.is_public = 1
    `;
    let countQuery = `
        SELECT COUNT(*) as total FROM projects p
        JOIN users u ON p.user_id = u.id
        WHERE p.is_public = 1
    `;
    const params = [];
    const countParams = [];

    if (level) {
        query += ' AND p.school_level = ?';
        countQuery += ' AND p.school_level = ?';
        params.push(level);
        countParams.push(level);
    }

    if (subject) {
        query += ' AND p.subject = ?';
        countQuery += ' AND p.subject = ?';
        params.push(subject);
        countParams.push(subject);
    }

    if (search) {
        query += ' AND (p.name LIKE ? OR p.description LIKE ? OR u.username LIKE ?)';
        countQuery += ' AND (p.name LIKE ? OR p.description LIKE ? OR u.username LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
        countParams.push(searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY p.visit_count DESC, p.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const projects = db.prepare(query).all(...params);
    const { total } = db.prepare(countQuery).get(...countParams);

    res.json({
        projects,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
});

// 获取某学科的统计信息
router.get('/stats', (req, res) => {
    const db = getDb();

    // 各学科课件数量和总访问量
    const subjectStats = db.prepare(`
        SELECT school_level, subject, 
            COUNT(*) as project_count,
            COALESCE(SUM(visit_count), 0) as total_visits
        FROM projects
        WHERE is_public = 1 AND school_level != '' AND subject != ''
        GROUP BY school_level, subject
        ORDER BY total_visits DESC
    `).all();

    // 总体统计
    const overall = db.prepare(`
        SELECT 
            (SELECT COUNT(*) FROM projects WHERE is_public = 1) as total_projects,
            (SELECT COALESCE(SUM(visit_count), 0) FROM projects) as total_visits,
            (SELECT COUNT(*) FROM users WHERE role = 'teacher') as teacher_count,
            (SELECT COUNT(*) FROM users WHERE role = 'student') as student_count
    `).get();

    res.json({ subjectStats, overall });
});

// 获取热门课件（首页展示用）
router.get('/hot', (req, res) => {
    const limit = parseInt(req.query.limit) || 8;
    const db = getDb();

    const projects = db.prepare(`
        SELECT p.*, u.username, u.avatar,
            (SELECT COUNT(*) FROM likes WHERE project_id = p.id) as like_count
        FROM projects p
        JOIN users u ON p.user_id = u.id
        WHERE p.is_public = 1
        ORDER BY p.visit_count DESC
        LIMIT ?
    `).all(limit);

    res.json({ projects });
});

module.exports = router;
module.exports.SCHOOL_LEVELS = SCHOOL_LEVELS;
