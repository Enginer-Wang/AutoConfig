/**
 * 即时作业系统路由 - 免批改的课堂练习
 * 支持：代码填空 (Code Fill-in-the-blank)、限时选择题、单元测试作业
 * 业务流：学生做完 → 系统自动判分 → 实时写入成绩册 → 解锁金币奖励
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ==================== 即时测验/限时练 ====================

// 教师发布即时测验
router.post('/quiz/create', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { classId, title, description, quizType, timeLimit, questions } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以发布测验' });
    }

    if (!classId || !title || !questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: '请填写完整的测验信息' });
    }

    // 验证班级权限
    if (!isClassTeacher(db, parseInt(classId), user)) {
        return res.status(403).json({ error: '无权在该班级发布测验' });
    }

    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 10), 0);

    const result = db.prepare(
        `INSERT INTO instant_quizzes (class_id, teacher_id, title, description, quiz_type, time_limit, max_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(parseInt(classId), user.id, title.trim(), description || '', quizType || 'mcq', timeLimit || 300, totalPoints);

    const quizId = result.lastInsertRowid;

    // 插入题目
    const insertQ = db.prepare(
        `INSERT INTO quiz_questions (quiz_id, question_type, title, content, options, correct_answer, code_template, test_cases, points, order_num)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const transaction = db.transaction(() => {
        questions.forEach((q, idx) => {
            insertQ.run(
                quizId,
                q.type || quizType || 'mcq',
                q.title || `第${idx + 1}题`,
                q.content || '',
                JSON.stringify(q.options || []),
                q.correctAnswer || '',
                q.codeTemplate || '',
                JSON.stringify(q.testCases || []),
                q.points || 10,
                idx
            );
        });
    });
    transaction();

    res.json({ success: true, quiz: { id: quizId, title, questionCount: questions.length } });
});

// 教师开启/关闭测验
router.post('/quiz/:id/toggle', (req, res) => {
    const db = getDb();
    const quizId = parseInt(req.params.id);
    const user = req.user;
    const { active } = req.body;

    const quiz = db.prepare('SELECT * FROM instant_quizzes WHERE id = ?').get(quizId);
    if (!quiz) return res.status(404).json({ error: '测验不存在' });
    if (!isClassTeacher(db, quiz.class_id, user)) {
        return res.status(403).json({ error: '无权操作' });
    }

    if (active) {
        db.prepare('UPDATE instant_quizzes SET is_active = 1, started_at = CURRENT_TIMESTAMP WHERE id = ?').run(quizId);
    } else {
        db.prepare('UPDATE instant_quizzes SET is_active = 0, ended_at = CURRENT_TIMESTAMP WHERE id = ?').run(quizId);
    }

    res.json({ success: true, is_active: active ? 1 : 0 });
});

// 获取测验列表（教师看所有，学生看已开启的）
router.get('/quiz/list', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { classId } = req.query;

    if (!classId) return res.status(400).json({ error: '缺少班级ID' });

    if (user.role === 'teacher' || user.role === 'admin') {
        const quizzes = db.prepare(`
            SELECT iq.*, c.name as class_name,
                (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = iq.id) as question_count,
                (SELECT COUNT(DISTINCT student_id) FROM quiz_responses WHERE quiz_id = iq.id) as response_count
            FROM instant_quizzes iq
            JOIN classes c ON iq.class_id = c.id
            WHERE iq.class_id = ? AND iq.teacher_id = ?
            ORDER BY iq.created_at DESC
        `).all(parseInt(classId), user.id);
        return res.json({ quizzes });
    }

    // 学生只能看已开启的测验
    const quizzes = db.prepare(`
        SELECT iq.*, c.name as class_name,
            (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = iq.id) as question_count,
            (SELECT SUM(score) FROM quiz_responses WHERE quiz_id = iq.id AND student_id = ?) as my_score
        FROM instant_quizzes iq
        JOIN classes c ON iq.class_id = c.id
        WHERE iq.class_id = ? AND iq.is_active = 1
        ORDER BY iq.started_at DESC
    `).all(user.id, parseInt(classId));

    res.json({ quizzes });
});

// 获取测验详情（含题目）
router.get('/quiz/:id', (req, res) => {
    const db = getDb();
    const quizId = parseInt(req.params.id);
    const user = req.user;

    const quiz = db.prepare('SELECT * FROM instant_quizzes WHERE id = ?').get(quizId);
    if (!quiz) return res.status(404).json({ error: '测验不存在' });

    const questions = db.prepare(
        'SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_num ASC'
    ).all(quizId);

    // 如果是学生，隐藏正确答案
    const isTeacher = isClassTeacher(db, quiz.class_id, user);
    const safeQuestions = questions.map(q => {
        const parsed = { ...q, options: JSON.parse(q.options || '[]'), testCases: JSON.parse(q.test_cases || '[]') };
        if (!isTeacher) {
            delete parsed.correct_answer;
            parsed.testCases = parsed.testCases.map(tc => ({ ...tc, expected: undefined }));
        }
        return parsed;
    });

    // 如果是学生，获取已作答记录
    let myResponses = [];
    if (!isTeacher) {
        myResponses = db.prepare('SELECT * FROM quiz_responses WHERE quiz_id = ? AND student_id = ?').all(quizId, user.id);
    }

    res.json({ quiz, questions: safeQuestions, myResponses });
});

// 学生提交单题答案（实时判分）
router.post('/quiz/:id/answer', (req, res) => {
    const db = getDb();
    const quizId = parseInt(req.params.id);
    const user = req.user;
    const { questionId, answer, timeSpent } = req.body;

    const quiz = db.prepare('SELECT * FROM instant_quizzes WHERE id = ?').get(quizId);
    if (!quiz) return res.status(404).json({ error: '测验不存在' });
    if (!quiz.is_active) return res.status(400).json({ error: '测验未开启或已结束' });

    const question = db.prepare('SELECT * FROM quiz_questions WHERE id = ? AND quiz_id = ?').get(parseInt(questionId), quizId);
    if (!question) return res.status(404).json({ error: '题目不存在' });

    // 检查是否已作答
    const existing = db.prepare('SELECT id FROM quiz_responses WHERE question_id = ? AND student_id = ?').get(question.id, user.id);
    if (existing) return res.status(400).json({ error: '该题已作答，不可重复提交' });

    // 判分逻辑
    let isCorrect = false;
    let score = 0;

    switch (question.question_type) {
        case 'mcq':
        case 'true_false':
            // 精确匹配
            isCorrect = answer.trim().toUpperCase() === question.correct_answer.trim().toUpperCase();
            score = isCorrect ? question.points : 0;
            break;

        case 'code_fill':
            // 代码填空：支持精确匹配或正则匹配
            isCorrect = matchCodeAnswer(answer, question.correct_answer);
            score = isCorrect ? question.points : 0;
            break;

        case 'unit_test':
            // 单元测试：运行测试用例
            const testCases = JSON.parse(question.test_cases || '[]');
            const testResult = runUnitTests(answer, testCases);
            isCorrect = testResult.passRate >= 1.0;
            score = Math.round(testResult.passRate * question.points);
            break;

        default:
            isCorrect = answer.trim() === question.correct_answer.trim();
            score = isCorrect ? question.points : 0;
    }

    // 记录作答
    db.prepare(
        `INSERT INTO quiz_responses (quiz_id, question_id, student_id, answer, is_correct, score, time_spent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(quizId, question.id, user.id, answer, isCorrect ? 1 : 0, score, timeSpent || 0);

    // 检查是否全部答完，如果是则自动写入成绩册
    const totalQuestions = db.prepare('SELECT COUNT(*) as c FROM quiz_questions WHERE quiz_id = ?').get(quizId).c;
    const answeredCount = db.prepare('SELECT COUNT(*) as c FROM quiz_responses WHERE quiz_id = ? AND student_id = ?').get(quizId, user.id).c;

    let totalScore = null;
    if (answeredCount >= totalQuestions) {
        // 全部答完，计算总分并写入成绩册
        totalScore = db.prepare('SELECT SUM(score) as total FROM quiz_responses WHERE quiz_id = ? AND student_id = ?').get(quizId, user.id).total;

        if (quiz.auto_record) {
            // 写入统一成绩册
            const existingGrade = db.prepare(
                'SELECT id FROM gradebook WHERE source_type = ? AND source_id = ? AND student_id = ?'
            ).get('quiz', quizId, user.id);

            if (!existingGrade) {
                db.prepare(
                    `INSERT INTO gradebook (student_id, class_id, source_type, source_id, title, score, max_score, category)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(user.id, quiz.class_id, 'quiz', quizId, quiz.title, totalScore, quiz.max_score, 'quiz');
            }

            // 奖励金币（答对超过80%奖励2金币）
            const passRate = totalScore / quiz.max_score;
            if (passRate >= 0.8) {
                db.prepare('UPDATE users SET coins = coins + 2 WHERE id = ?').run(user.id);
                db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
                    .run(user.id, 2, 'quiz_reward', `测验"${quiz.title}"优秀完成奖励`);
            }
        }
    }

    res.json({
        success: true,
        is_correct: isCorrect,
        score,
        correct_answer: quiz.show_answers ? question.correct_answer : undefined,
        completed: answeredCount >= totalQuestions,
        totalScore
    });
});

// 获取测验成绩排行（教师和学生都可看）
router.get('/quiz/:id/leaderboard', (req, res) => {
    const db = getDb();
    const quizId = parseInt(req.params.id);

    const leaderboard = db.prepare(`
        SELECT u.id, u.username, u.avatar,
            SUM(qr.score) as total_score,
            SUM(qr.is_correct) as correct_count,
            COUNT(qr.id) as answer_count,
            SUM(qr.time_spent) as total_time
        FROM quiz_responses qr
        JOIN users u ON qr.student_id = u.id
        WHERE qr.quiz_id = ?
        GROUP BY qr.student_id
        ORDER BY total_score DESC, total_time ASC
        LIMIT 50
    `).all(quizId);

    res.json({ leaderboard });
});

// ==================== 代码填空作业 ====================

// 教师发布代码填空作业
router.post('/code-fill/create', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { classId, title, description, language, codeTemplate, blanks, matchMode, maxScore, timeLimit } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以发布作业' });
    }

    if (!classId || !title || !codeTemplate || !blanks || blanks.length === 0) {
        return res.status(400).json({ error: '请填写完整信息（含代码模板和空白位）' });
    }

    if (!isClassTeacher(db, parseInt(classId), user)) {
        return res.status(403).json({ error: '无权操作' });
    }

    const result = db.prepare(
        `INSERT INTO code_fill_assignments (class_id, teacher_id, title, description, language, code_template, blanks, match_mode, max_score, time_limit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(parseInt(classId), user.id, title.trim(), description || '', language || 'html',
        codeTemplate, JSON.stringify(blanks), matchMode || 'exact', maxScore || 100, timeLimit || 0);

    res.json({ success: true, assignment: { id: result.lastInsertRowid } });
});

// 获取代码填空作业列表
router.get('/code-fill/list', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { classId } = req.query;

    if (!classId) return res.status(400).json({ error: '缺少班级ID' });

    const assignments = db.prepare(`
        SELECT cfa.*,
            (SELECT COUNT(*) FROM code_fill_submissions WHERE assignment_id = cfa.id) as submission_count,
            (SELECT COUNT(*) FROM code_fill_submissions WHERE assignment_id = cfa.id AND is_correct = 1) as correct_count
        FROM code_fill_assignments cfa
        WHERE cfa.class_id = ? AND cfa.is_active = 1
        ORDER BY cfa.created_at DESC
    `).all(parseInt(classId));

    // 如果是学生，添加自己的提交状态
    if (user.role !== 'teacher' && user.role !== 'admin') {
        for (const a of assignments) {
            const mySub = db.prepare(
                'SELECT score, is_correct FROM code_fill_submissions WHERE assignment_id = ? AND student_id = ?'
            ).get(a.id, user.id);
            a.my_score = mySub ? mySub.score : null;
            a.my_completed = !!mySub;
        }
    }

    res.json({ assignments });
});

// 获取代码填空作业详情
router.get('/code-fill/:id', (req, res) => {
    const db = getDb();
    const assignmentId = parseInt(req.params.id);
    const user = req.user;

    const assignment = db.prepare('SELECT * FROM code_fill_assignments WHERE id = ?').get(assignmentId);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });

    const parsed = {
        ...assignment,
        blanks: JSON.parse(assignment.blanks || '[]')
    };

    // 学生看不到正确答案
    const isTeacher = isClassTeacher(db, assignment.class_id, user);
    if (!isTeacher) {
        parsed.blanks = parsed.blanks.map(b => ({ ...b, answer: undefined }));
    }

    // 获取学生已有提交
    let mySubmission = null;
    if (!isTeacher) {
        mySubmission = db.prepare(
            'SELECT * FROM code_fill_submissions WHERE assignment_id = ? AND student_id = ?'
        ).get(assignmentId, user.id);
    }

    res.json({ assignment: parsed, mySubmission });
});

// 学生提交代码填空答案
router.post('/code-fill/:id/submit', (req, res) => {
    const db = getDb();
    const assignmentId = parseInt(req.params.id);
    const user = req.user;
    const { answers, timeSpent } = req.body;

    const assignment = db.prepare('SELECT * FROM code_fill_assignments WHERE id = ?').get(assignmentId);
    if (!assignment) return res.status(404).json({ error: '作业不存在' });
    if (!assignment.is_active) return res.status(400).json({ error: '作业未开放' });

    // 检查是否已提交
    const existing = db.prepare('SELECT id FROM code_fill_submissions WHERE assignment_id = ? AND student_id = ?').get(assignmentId, user.id);
    if (existing) return res.status(400).json({ error: '已提交过，不可重复提交' });

    if (!answers || !Array.isArray(answers)) {
        return res.status(400).json({ error: '答案格式错误' });
    }

    const blanks = JSON.parse(assignment.blanks || '[]');
    let correctCount = 0;

    // 逐空校验
    for (let i = 0; i < blanks.length; i++) {
        const expected = blanks[i].answer || '';
        const studentAnswer = answers[i] || '';

        let matched = false;
        if (assignment.match_mode === 'regex') {
            try {
                const regex = new RegExp(expected.trim());
                matched = regex.test(studentAnswer.trim());
            } catch (e) {
                matched = studentAnswer.trim() === expected.trim();
            }
        } else {
            // 精确匹配（忽略首尾空白）
            matched = normalizeCode(studentAnswer) === normalizeCode(expected);
        }

        if (matched) correctCount++;
    }

    const totalBlanks = blanks.length;
    const score = totalBlanks > 0 ? Math.round((correctCount / totalBlanks) * assignment.max_score) : 0;
    const isAllCorrect = correctCount === totalBlanks;

    // 记录提交
    db.prepare(
        `INSERT INTO code_fill_submissions (assignment_id, student_id, answers, score, max_score, is_correct, time_spent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(assignmentId, user.id, JSON.stringify(answers), score, assignment.max_score, isAllCorrect ? 1 : 0, timeSpent || 0);

    // 写入成绩册
    db.prepare(
        `INSERT INTO gradebook (student_id, class_id, source_type, source_id, title, score, max_score, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(user.id, assignment.class_id, 'code_fill', assignmentId, assignment.title, score, assignment.max_score, 'exercise');

    // 全对奖励金币
    if (isAllCorrect) {
        db.prepare('UPDATE users SET coins = coins + 1 WHERE id = ?').run(user.id);
        db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
            .run(user.id, 1, 'code_fill_perfect', `代码填空"${assignment.title}"全对奖励`);
    }

    res.json({
        success: true,
        score,
        max_score: assignment.max_score,
        correct_count: correctCount,
        total_blanks: totalBlanks,
        is_all_correct: isAllCorrect
    });
});

// ==================== 辅助函数 ====================

function isClassTeacher(db, classId, user) {
    if (user.role === 'admin') return true;
    const cls = db.prepare('SELECT teacher_id FROM classes WHERE id = ?').get(classId);
    if (cls && cls.teacher_id === user.id) return true;
    const membership = db.prepare('SELECT role FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, user.id);
    return membership && (membership.role === 'co_teacher' || membership.role === 'ta');
}

// 代码标准化（去除多余空白、统一换行）
function normalizeCode(code) {
    return code.trim().replace(/\s+/g, ' ').replace(/\s*([{};,():])\s*/g, '$1');
}

// 代码填空匹配
function matchCodeAnswer(studentAnswer, correctAnswer) {
    // 支持多个正确答案（用 ||| 分隔）
    const validAnswers = correctAnswer.split('|||').map(a => a.trim());
    const normalized = normalizeCode(studentAnswer);
    return validAnswers.some(a => normalizeCode(a) === normalized);
}

// 简易单元测试运行器（安全沙箱模拟）
function runUnitTests(code, testCases) {
    let passed = 0;
    const results = [];

    for (const tc of testCases) {
        try {
            // 安全沙箱：使用 Function 构造器隔离作用域
            // 注意：生产环境应使用 vm2 或 isolated-vm
            const wrappedCode = `
                'use strict';
                ${code}
                return (${tc.call || 'null'});
            `;
            const fn = new Function(wrappedCode);
            const result = fn();
            const expected = JSON.parse(tc.expected);
            const pass = JSON.stringify(result) === JSON.stringify(expected);
            if (pass) passed++;
            results.push({ name: tc.name, passed: pass, expected: tc.expected, actual: JSON.stringify(result) });
        } catch (err) {
            results.push({ name: tc.name, passed: false, expected: tc.expected, actual: `Error: ${err.message}` });
        }
    }

    return {
        passRate: testCases.length > 0 ? passed / testCases.length : 0,
        passed,
        total: testCases.length,
        results
    };
}

module.exports = router;
