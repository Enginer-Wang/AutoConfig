/**
 * 用户认证路由 - 注册 / 登录 / 登出 / 个人信息
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../database');
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

const VALID_LEVELS = ['elementary', 'middle', 'high'];

// 生成班级邀请码
function genInviteCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// 公开班级搜索（注册时使用，无需登录）。按名称模糊匹配，可按学段过滤。
router.get('/classes/search', (req, res) => {
    try {
        const db = getDb();
        const q = String(req.query.q || '').trim();
        const level = VALID_LEVELS.includes(req.query.level) ? req.query.level : null;

        let sql = `
            SELECT c.id, c.name, c.school_level, u.username AS teacher_name,
                   (SELECT COUNT(*) FROM class_members WHERE class_id = c.id AND role = 'student') AS member_count
            FROM classes c JOIN users u ON c.teacher_id = u.id
            WHERE 1=1
        `;
        const params = [];
        if (q) { sql += ' AND c.name LIKE ?'; params.push('%' + q + '%'); }
        if (level) { sql += ' AND c.school_level = ?'; params.push(level); }
        sql += ' ORDER BY c.created_at DESC LIMIT 20';

        const classes = db.prepare(sql).all(...params);
        res.json({ classes });
    } catch (err) {
        console.error('班级搜索失败:', err);
        res.status(500).json({ error: '搜索失败' });
    }
});

// 注册
router.post('/register', async (req, res) => {
    try {
        const { username, email, password, role, school, inviteCode, schoolLevel, classId, className } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: '请填写所有必填字段' });
        }

        // 验证角色
        const validRoles = ['teacher', 'student'];
        const userRole = validRoles.includes(role) ? role : 'teacher';

        // 验证学段
        const userLevel = VALID_LEVELS.includes(schoolLevel) ? schoolLevel : '';

        if (username.length < 2 || username.length > 20) {
            return res.status(400).json({ error: '用户名长度需在2-20个字符之间' });
        }

        if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(username)) {
            return res.status(400).json({ error: '用户名只能包含中文、字母、数字、下划线和连字符' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: '密码至少6个字符' });
        }

        const db = getDb();

        // 教师注册需校验管理员提供的邀请码
        let teacherInvite = null;
        if (userRole === 'teacher') {
            const code = String(inviteCode || '').trim();
            if (!code) {
                return res.status(400).json({ error: '教师注册需要邀请码，请向管理员索取' });
            }
            teacherInvite = db.prepare('SELECT * FROM teacher_invite_codes WHERE code = ?').get(code);
            if (!teacherInvite || !teacherInvite.is_active) {
                return res.status(400).json({ error: '邀请码无效或已停用' });
            }
            if (teacherInvite.expires_at && new Date(teacherInvite.expires_at) < new Date()) {
                return res.status(400).json({ error: '邀请码已过期' });
            }
            if (teacherInvite.max_uses > 0 && teacherInvite.used_count >= teacherInvite.max_uses) {
                return res.status(400).json({ error: '邀请码使用次数已达上限' });
            }
        }

        // 校验拟加入的班级（学生必须选择已有班级；教师可选已有班级或新建）
        let targetClass = null;
        const newClassName = String(className || '').trim();
        if (classId) {
            targetClass = db.prepare('SELECT * FROM classes WHERE id = ?').get(parseInt(classId));
            if (!targetClass) {
                return res.status(400).json({ error: '所选班级不存在，请重新选择' });
            }
        } else if (userRole === 'student') {
            return res.status(400).json({ error: '学生注册需选择一个班级加入' });
        } else if (userRole === 'teacher' && !newClassName) {
            return res.status(400).json({ error: '教师注册请选择已有班级或填写新班级名称' });
        }

        // 检查用户名和邮箱是否已存在
        const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
        if (existing) {
            return res.status(400).json({ error: '用户名或邮箱已被注册' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = db.prepare(
            'INSERT INTO users (username, email, password, role, school, school_level) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(username, email, hashedPassword, userRole, school || '', userLevel);
        const newUserId = result.lastInsertRowid;

        // 记录邀请码使用次数
        if (teacherInvite) {
            db.prepare('UPDATE teacher_invite_codes SET used_count = used_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(teacherInvite.id);
        }

        // 班级归属处理
        let joinedClass = null;
        try {
            if (targetClass) {
                // 加入已有班级：教师→协作教师，学生→学生
                const memberRole = userRole === 'teacher' ? 'co_teacher' : 'student';
                db.prepare('INSERT OR IGNORE INTO class_members (class_id, user_id, role) VALUES (?, ?, ?)')
                    .run(targetClass.id, newUserId, memberRole);
                joinedClass = { id: targetClass.id, name: targetClass.name, role: memberRole };
            } else if (userRole === 'teacher' && newClassName) {
                // 教师新建班级并成为班主任
                const code = genInviteCode();
                const cr = db.prepare(
                    'INSERT INTO classes (name, description, teacher_id, invite_code, school_level) VALUES (?, ?, ?, ?, ?)'
                ).run(newClassName, '', newUserId, code, userLevel);
                joinedClass = { id: cr.lastInsertRowid, name: newClassName, role: 'owner', invite_code: code };
            }
        } catch (e) {
            console.error('注册时班级处理失败:', e);
        }

        const user = { id: newUserId, username, email };
        const token = generateToken(user);

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        });

        res.json({ success: true, user: { id: user.id, username, email, role: userRole, school_level: userLevel }, class: joinedClass, token });
    } catch (err) {
        console.error('注册失败:', err);
        res.status(500).json({ error: '注册失败，请稍后重试' });
    }
});

// 登录
router.post('/login', async (req, res) => {
    try {
        const { login, password } = req.body;

        if (!login || !password) {
            return res.status(400).json({ error: '请填写用户名/邮箱和密码' });
        }

        const db = getDb();
        const user = db.prepare(
            'SELECT * FROM users WHERE username = ? OR email = ?'
        ).get(login, login);

        if (!user) {
            return res.status(400).json({ error: '用户名或密码错误' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(400).json({ error: '用户名或密码错误' });
        }

        const token = generateToken(user);

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax'
        });

        res.json({
            success: true,
            user: { id: user.id, username: user.username, email: user.email },
            token
        });
    } catch (err) {
        console.error('登录失败:', err);
        res.status(500).json({ error: '登录失败，请稍后重试' });
    }
});

// 登出
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

// 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
    const db = getDb();
    const user = db.prepare(
        'SELECT id, username, email, avatar, bio, coins, role, school, school_level, created_at FROM users WHERE id = ?'
    ).get(req.user.id);

    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    // 获取项目统计
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as project_count,
            COALESCE(SUM(visit_count), 0) as total_visits,
            COALESCE(SUM(total_size), 0) as total_storage
        FROM projects WHERE user_id = ?
    `).get(req.user.id);

    res.json({ user: { ...user, ...stats } });
});

// 更新个人信息
router.put('/profile', authMiddleware, (req, res) => {
    const { bio, avatar } = req.body;
    const db = getDb();

    db.prepare('UPDATE users SET bio = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(bio || '', avatar || '', req.user.id);

    res.json({ success: true });
});

module.exports = router;
