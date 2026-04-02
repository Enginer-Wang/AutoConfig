/**
 * 社区广场路由 - 公开项目展示 / 点赞 / 评论
 */
const express = require('express');
const { getDb } = require('../database');
const { optionalAuth, authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 获取公开项目列表
router.get('/projects', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    const db = getDb();

    let query = `
        SELECT p.*, u.username, u.avatar
        FROM projects p
        JOIN users u ON p.user_id = u.id
        WHERE p.is_public = 1
    `;
    let countQuery = `
        SELECT COUNT(*) as total
        FROM projects p
        JOIN users u ON p.user_id = u.id
        WHERE p.is_public = 1
    `;
    const params = [];
    const countParams = [];

    if (search) {
        query += ` AND (p.name LIKE ? OR p.description LIKE ? OR u.username LIKE ?)`;
        countQuery += ` AND (p.name LIKE ? OR p.description LIKE ? OR u.username LIKE ?)`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
        countParams.push(searchTerm, searchTerm, searchTerm);
    }

    query += ` ORDER BY p.visit_count DESC, p.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const projects = db.prepare(query).all(...params);
    const { total } = db.prepare(countQuery).get(...countParams);

    res.json({
        projects,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
        }
    });
});

// 获取社区统计
router.get('/stats', (req, res) => {
    const db = getDb();

    const stats = db.prepare(`
        SELECT 
            (SELECT COUNT(*) FROM users) as user_count,
            (SELECT COUNT(*) FROM projects) as project_count,
            (SELECT COUNT(*) FROM projects WHERE is_public = 1) as public_count,
            (SELECT COALESCE(SUM(visit_count), 0) FROM projects) as total_visits
    `).get();

    res.json(stats);
});

// 获取单个项目详情（作品展示页）
router.get('/project/:username/:slug', optionalAuth, (req, res) => {
    const { username, slug } = req.params;
    const db = getDb();

    const project = db.prepare(`
        SELECT p.*, u.username, u.avatar, u.bio, u.created_at as user_joined
        FROM projects p
        JOIN users u ON p.user_id = u.id
        WHERE u.username = ? AND p.slug = ?
    `).get(username, slug);

    if (!project) {
        return res.status(404).json({ error: '项目不存在' });
    }

    // 增加访问量
    db.prepare('UPDATE projects SET visit_count = visit_count + 1 WHERE id = ?').run(project.id);
    project.visit_count++;

    // 获取点赞数
    const likeCount = db.prepare('SELECT COUNT(*) as count FROM likes WHERE project_id = ?').get(project.id).count;

    // 当前用户是否点赞
    let hasLiked = false;
    if (req.user) {
        const like = db.prepare('SELECT id FROM likes WHERE user_id = ? AND project_id = ?').get(req.user.id, project.id);
        hasLiked = !!like;
    }

    // 获取评论
    const comments = db.prepare(`
        SELECT c.*, u.username, u.avatar
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.project_id = ?
        ORDER BY c.created_at DESC
        LIMIT 50
    `).all(project.id);

    // 作者项目总数
    const authorProjectCount = db.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id = ?').get(project.user_id).count;

    // 用户加入天数
    const joinedDays = Math.floor((Date.now() - new Date(project.user_joined).getTime()) / 86400000);

    res.json({
        project,
        likeCount,
        hasLiked,
        comments,
        author: {
            username: project.username,
            avatar: project.avatar,
            bio: project.bio,
            joined_days: joinedDays,
            project_count: authorProjectCount
        }
    });
});

// 点赞 / 取消点赞
router.post('/project/:id/like', authMiddleware, (req, res) => {
    const db = getDb();
    const projectId = parseInt(req.params.id);

    const existing = db.prepare('SELECT id FROM likes WHERE user_id = ? AND project_id = ?').get(req.user.id, projectId);

    if (existing) {
        db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
        const count = db.prepare('SELECT COUNT(*) as count FROM likes WHERE project_id = ?').get(projectId).count;
        return res.json({ liked: false, count });
    } else {
        db.prepare('INSERT INTO likes (user_id, project_id) VALUES (?, ?)').run(req.user.id, projectId);
        const count = db.prepare('SELECT COUNT(*) as count FROM likes WHERE project_id = ?').get(projectId).count;
        return res.json({ liked: true, count });
    }
});

// 发表评论
router.post('/project/:id/comment', authMiddleware, (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim()) {
        return res.status(400).json({ error: '评论内容不能为空' });
    }
    if (content.length > 500) {
        return res.status(400).json({ error: '评论不能超过500字' });
    }

    const db = getDb();
    const projectId = parseInt(req.params.id);

    db.prepare('INSERT INTO comments (user_id, project_id, content) VALUES (?, ?, ?)').run(req.user.id, projectId, content.trim());

    const comment = db.prepare(`
        SELECT c.*, u.username, u.avatar
        FROM comments c JOIN users u ON c.user_id = u.id
        WHERE c.id = last_insert_rowid()
    `).get();

    res.json({ success: true, comment });
});

// 删除评论（自己的评论或管理员）
router.delete('/comment/:id', authMiddleware, (req, res) => {
    const db = getDb();
    // 检查是否为管理员
    const currentUser = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
    const isAdmin = currentUser && currentUser.role === 'admin';

    let comment;
    if (isAdmin) {
        comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
    } else {
        comment = db.prepare('SELECT * FROM comments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    }
    if (!comment) return res.status(404).json({ error: '评论不存在' });

    db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

module.exports = router;
