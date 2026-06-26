/**
 * 错题本路由 - 学校教学闭环的关键一环
 * 业务流：学生测验答错 → 自动归集错题 → 错题本重练 → 掌握度跟踪 → 教师查看班级高频错题
 * 数据复用：quiz_questions / quiz_responses / mistake_notebook
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// 代码标准化（与即时测验判分保持一致）
function normalizeCode(code) {
    return (code || '').trim().replace(/\s+/g, ' ').replace(/\s*([{};,():])\s*/g, '$1');
}

// 错题重练判分（支持选择/判断/代码填空）
function judgeAnswer(question, answer) {
    if (answer == null) return false;
    switch (question.question_type) {
        case 'mcq':
        case 'true_false':
            return String(answer).trim().toUpperCase() === String(question.correct_answer).trim().toUpperCase();
        case 'code_fill': {
            const valid = String(question.correct_answer).split('|||').map(a => normalizeCode(a));
            return valid.includes(normalizeCode(answer));
        }
        default:
            return String(answer).trim() === String(question.correct_answer).trim();
    }
}

// 班级教师权限校验
function isClassTeacher(db, classId, user) {
    if (user.role === 'admin') return true;
    const cls = db.prepare('SELECT teacher_id FROM classes WHERE id = ?').get(classId);
    if (cls && cls.teacher_id === user.id) return true;
    const membership = db.prepare('SELECT role FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, user.id);
    return membership && (membership.role === 'co_teacher' || membership.role === 'ta');
}

// ==================== 学生错题本 ====================

// 获取我的错题列表（可按掌握度/学科筛选）
router.get('/', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { status, subject } = req.query;

    const filters = ['m.student_id = ?'];
    const params = [user.id];
    if (status && ['unmastered', 'reviewing', 'mastered'].includes(status)) {
        filters.push('m.mastery_status = ?');
        params.push(status);
    }
    if (subject) {
        filters.push('m.subject = ?');
        params.push(subject);
    }

    const rows = db.prepare(`
        SELECT m.id, m.question_id, m.quiz_id, m.class_id, m.subject,
               m.wrong_answer, m.mastery_status, m.wrong_count, m.retry_count,
               m.note, m.first_wrong_at, m.last_review_at,
               q.question_type, q.title, q.content, q.options, q.correct_answer,
               q.code_template, q.points,
               qz.title as quiz_title,
               c.name as class_name
        FROM mistake_notebook m
        JOIN quiz_questions q ON m.question_id = q.id
        LEFT JOIN instant_quizzes qz ON m.quiz_id = qz.id
        LEFT JOIN classes c ON m.class_id = c.id
        WHERE ${filters.join(' AND ')}
        ORDER BY
            CASE m.mastery_status WHEN 'unmastered' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
            m.wrong_count DESC, m.first_wrong_at DESC
    `).all(...params);

    const mistakes = rows.map(r => ({
        ...r,
        options: JSON.parse(r.options || '[]')
    }));

    res.json({ mistakes });
});

// 错题本统计概览
router.get('/stats', (req, res) => {
    const db = getDb();
    const user = req.user;

    const byStatus = db.prepare(`
        SELECT mastery_status, COUNT(*) as count
        FROM mistake_notebook WHERE student_id = ?
        GROUP BY mastery_status
    `).all(user.id);

    const bySubject = db.prepare(`
        SELECT CASE WHEN subject = '' OR subject IS NULL THEN '未分类' ELSE subject END as subject,
               COUNT(*) as count,
               SUM(CASE WHEN mastery_status = 'mastered' THEN 1 ELSE 0 END) as mastered
        FROM mistake_notebook WHERE student_id = ?
        GROUP BY subject
        ORDER BY count DESC
    `).all(user.id);

    const total = db.prepare('SELECT COUNT(*) as c FROM mistake_notebook WHERE student_id = ?').get(user.id).c;
    const mastered = db.prepare("SELECT COUNT(*) as c FROM mistake_notebook WHERE student_id = ? AND mastery_status = 'mastered'").get(user.id).c;

    const statusMap = { unmastered: 0, reviewing: 0, mastered: 0 };
    byStatus.forEach(s => { statusMap[s.mastery_status] = s.count; });

    res.json({
        total,
        mastered,
        masteryRate: total > 0 ? Math.round((mastered / total) * 100) : 0,
        byStatus: statusMap,
        bySubject
    });
});

// 重练某道错题（实时判分 + 掌握度更新）
router.post('/:id/retry', (req, res) => {
    const db = getDb();
    const user = req.user;
    const mistakeId = parseInt(req.params.id);
    const { answer } = req.body;

    const mistake = db.prepare('SELECT * FROM mistake_notebook WHERE id = ? AND student_id = ?').get(mistakeId, user.id);
    if (!mistake) return res.status(404).json({ error: '错题不存在' });

    const question = db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(mistake.question_id);
    if (!question) return res.status(404).json({ error: '题目已被删除' });

    const isCorrect = judgeAnswer(question, answer);

    // 掌握度状态机：答对一次→reviewing；连续答对（reviewing再答对）→mastered；答错→回到unmastered
    let newStatus = mistake.mastery_status;
    if (isCorrect) {
        newStatus = mistake.mastery_status === 'reviewing' || mistake.mastery_status === 'mastered'
            ? 'mastered' : 'reviewing';
    } else {
        newStatus = 'unmastered';
    }

    db.prepare(`
        UPDATE mistake_notebook
        SET retry_count = retry_count + 1, mastery_status = ?, last_review_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(newStatus, mistakeId);

    // 首次攻克错题（变为 mastered）奖励 1 金币
    let rewarded = false;
    if (isCorrect && newStatus === 'mastered' && mistake.mastery_status !== 'mastered') {
        db.prepare('UPDATE users SET coins = coins + 1 WHERE id = ?').run(user.id);
        db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
            .run(user.id, 1, 'mistake_mastered', `攻克错题"${question.title.slice(0, 20)}"`);
        rewarded = true;
    }

    res.json({
        success: true,
        is_correct: isCorrect,
        mastery_status: newStatus,
        correct_answer: question.correct_answer,
        rewarded
    });
});

// 保存错题个人笔记
router.put('/:id/note', (req, res) => {
    const db = getDb();
    const user = req.user;
    const mistakeId = parseInt(req.params.id);
    const { note } = req.body;

    const mistake = db.prepare('SELECT id FROM mistake_notebook WHERE id = ? AND student_id = ?').get(mistakeId, user.id);
    if (!mistake) return res.status(404).json({ error: '错题不存在' });

    db.prepare('UPDATE mistake_notebook SET note = ? WHERE id = ?').run((note || '').slice(0, 2000), mistakeId);
    res.json({ success: true });
});

// 从错题本移除（已掌握后清理）
router.delete('/:id', (req, res) => {
    const db = getDb();
    const user = req.user;
    const mistakeId = parseInt(req.params.id);

    const result = db.prepare('DELETE FROM mistake_notebook WHERE id = ? AND student_id = ?').run(mistakeId, user.id);
    if (result.changes === 0) return res.status(404).json({ error: '错题不存在' });
    res.json({ success: true });
});

// ==================== 教师视角：班级高频错题 ====================

// 班级高频错题排行（教学讲评依据）
router.get('/class/:classId', (req, res) => {
    const db = getDb();
    const user = req.user;
    const classId = parseInt(req.params.classId);

    if (!isClassTeacher(db, classId, user)) {
        return res.status(403).json({ error: '需要教师权限' });
    }

    const hotQuestions = db.prepare(`
        SELECT q.id as question_id, q.title, q.question_type, q.correct_answer, q.points,
               qz.title as quiz_title,
               COUNT(DISTINCT m.student_id) as wrong_students,
               SUM(m.wrong_count) as total_wrongs,
               SUM(CASE WHEN m.mastery_status = 'mastered' THEN 1 ELSE 0 END) as mastered_students
        FROM mistake_notebook m
        JOIN quiz_questions q ON m.question_id = q.id
        LEFT JOIN instant_quizzes qz ON m.quiz_id = qz.id
        WHERE m.class_id = ?
        GROUP BY m.question_id
        ORDER BY wrong_students DESC, total_wrongs DESC
        LIMIT 30
    `).all(classId);

    const totalStudents = db.prepare(
        "SELECT COUNT(*) as c FROM class_members WHERE class_id = ? AND role = 'student'"
    ).get(classId).c;

    res.json({ hotQuestions, totalStudents });
});

module.exports = router;
