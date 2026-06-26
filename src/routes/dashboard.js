/**
 * 教师专属数据大屏 (Dashboard) 路由
 * 作业完成度漏斗、成绩正态分布、学生画像预警、知识点掌握度
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// 教师权限中间件
function teacherOnly(req, res, next) {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
        return res.status(403).json({ error: '需要教师权限' });
    }
    next();
}

// ==================== 作业完成度漏斗 ====================
// 实时展示"已提交、批改中、已完成、已打回"的人数比例
router.get('/homework-funnel', teacherOnly, (req, res) => {
    const db = getDb();
    const user = req.user;
    const { classId } = req.query;

    let classFilter = '';
    let params = [user.id];

    if (classId) {
        classFilter = 'AND h.class_id = ?';
        params.push(parseInt(classId));
    }

    // 获取教师的所有班级作业的提交统计
    const funnelData = db.prepare(`
        SELECT 
            h.id as homework_id,
            h.title,
            h.class_id,
            c.name as class_name,
            h.due_date,
            (SELECT COUNT(*) FROM class_members WHERE class_id = h.class_id AND role = 'student') as total_students,
            (SELECT COUNT(*) FROM homework_submissions WHERE homework_id = h.id AND status = 'submitted') as submitted_count,
            (SELECT COUNT(*) FROM homework_submissions WHERE homework_id = h.id AND status = 'graded') as graded_count,
            (SELECT COUNT(*) FROM homework_submissions WHERE homework_id = h.id AND status = 'rejected') as rejected_count,
            (SELECT COUNT(*) FROM homework_submissions WHERE homework_id = h.id) as total_submissions
        FROM homework h
        JOIN classes c ON h.class_id = c.id
        WHERE h.teacher_id = ? ${classFilter} AND h.status = 'active'
        ORDER BY h.created_at DESC
        LIMIT 20
    `).all(...params);

    // 计算总体漏斗
    const totalStudents = funnelData.reduce((sum, h) => sum + h.total_students, 0);
    const totalSubmitted = funnelData.reduce((sum, h) => sum + h.submitted_count, 0);
    const totalGraded = funnelData.reduce((sum, h) => sum + h.graded_count, 0);
    const totalRejected = funnelData.reduce((sum, h) => sum + h.rejected_count, 0);
    const totalNotSubmitted = totalStudents - funnelData.reduce((sum, h) => sum + h.total_submissions, 0);

    res.json({
        funnel: {
            not_submitted: totalNotSubmitted,
            submitted: totalSubmitted,
            graded: totalGraded,
            rejected: totalRejected
        },
        homeworkList: funnelData
    });
});

// ==================== 成绩正态分布 ====================
// 每次作业的最高分、最低分、平均分及分数段分布直方图
router.get('/grade-distribution', teacherOnly, (req, res) => {
    const db = getDb();
    const user = req.user;
    const { homeworkId, classId } = req.query;

    if (homeworkId) {
        // 单次作业的分数分布
        const stats = db.prepare(`
            SELECT 
                MIN(hs.score) as min_score,
                MAX(hs.score) as max_score,
                ROUND(AVG(hs.score), 1) as avg_score,
                COUNT(hs.id) as total_graded,
                h.max_score,
                h.title
            FROM homework_submissions hs
            JOIN homework h ON hs.homework_id = h.id
            WHERE hs.homework_id = ? AND hs.score IS NOT NULL
        `).get(parseInt(homeworkId));

        // 分数段分布
        const distribution = db.prepare(`
            SELECT 
                CASE 
                    WHEN (CAST(hs.score AS FLOAT) / h.max_score * 100) >= 90 THEN '90-100'
                    WHEN (CAST(hs.score AS FLOAT) / h.max_score * 100) >= 80 THEN '80-89'
                    WHEN (CAST(hs.score AS FLOAT) / h.max_score * 100) >= 70 THEN '70-79'
                    WHEN (CAST(hs.score AS FLOAT) / h.max_score * 100) >= 60 THEN '60-69'
                    WHEN (CAST(hs.score AS FLOAT) / h.max_score * 100) >= 50 THEN '50-59'
                    ELSE '0-49'
                END as range,
                COUNT(*) as count
            FROM homework_submissions hs
            JOIN homework h ON hs.homework_id = h.id
            WHERE hs.homework_id = ? AND hs.score IS NOT NULL
            GROUP BY range
            ORDER BY range DESC
        `).all(parseInt(homeworkId));

        // 每个学生的分数（用于直方图）
        const scores = db.prepare(`
            SELECT hs.score, u.username
            FROM homework_submissions hs
            JOIN users u ON hs.student_id = u.id
            WHERE hs.homework_id = ? AND hs.score IS NOT NULL
            ORDER BY hs.score DESC
        `).all(parseInt(homeworkId));

        return res.json({ stats, distribution, scores });
    }

    // 按班级汇总所有作业成绩
    let filter = 'WHERE h.teacher_id = ?';
    let params = [user.id];
    if (classId) {
        filter += ' AND h.class_id = ?';
        params.push(parseInt(classId));
    }

    const overview = db.prepare(`
        SELECT 
            h.id, h.title, h.max_score, c.name as class_name,
            MIN(hs.score) as min_score,
            MAX(hs.score) as max_score,
            ROUND(AVG(hs.score), 1) as avg_score,
            COUNT(hs.id) as graded_count
        FROM homework h
        JOIN classes c ON h.class_id = c.id
        LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.score IS NOT NULL
        ${filter}
        GROUP BY h.id
        HAVING graded_count > 0
        ORDER BY h.created_at DESC
        LIMIT 30
    `).all(...params);

    res.json({ overview });
});

// ==================== 学生画像与预警 ====================
// 标记"连续3次未交作业"或"近期成绩大幅下滑"的边缘学生
router.get('/student-alerts', teacherOnly, (req, res) => {
    const db = getDb();
    const user = req.user;
    const { classId } = req.query;

    if (!classId) {
        return res.status(400).json({ error: '请指定班级' });
    }

    const cid = parseInt(classId);

    // 获取班级所有学生
    const students = db.prepare(`
        SELECT u.id, u.username, u.avatar, u.email
        FROM class_members cm
        JOIN users u ON cm.user_id = u.id
        WHERE cm.class_id = ? AND cm.role = 'student'
    `).all(cid);

    // 获取班级所有作业（按时间排序）
    const homeworkList = db.prepare(`
        SELECT id, title, due_date FROM homework 
        WHERE class_id = ? AND status = 'active'
        ORDER BY created_at ASC
    `).all(cid);

    const alerts = [];

    for (const student of students) {
        const alertReasons = [];

        // 检查连续未交作业
        const submissions = db.prepare(`
            SELECT h.id as homework_id, hs.id as submission_id
            FROM homework h
            LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = ?
            WHERE h.class_id = ? AND h.status = 'active'
            ORDER BY h.created_at DESC
        `).all(student.id, cid);

        let consecutiveMissed = 0;
        for (const s of submissions) {
            if (!s.submission_id) consecutiveMissed++;
            else break;
        }

        if (consecutiveMissed >= 3) {
            alertReasons.push({ type: 'missing_homework', message: `连续 ${consecutiveMissed} 次未交作业`, severity: 'high' });
        } else if (consecutiveMissed >= 2) {
            alertReasons.push({ type: 'missing_homework', message: `连续 ${consecutiveMissed} 次未交作业`, severity: 'medium' });
        }

        // 检查成绩下滑
        const recentScores = db.prepare(`
            SELECT hs.score, h.max_score, h.created_at
            FROM homework_submissions hs
            JOIN homework h ON hs.homework_id = h.id
            WHERE hs.student_id = ? AND h.class_id = ? AND hs.score IS NOT NULL
            ORDER BY h.created_at DESC
            LIMIT 6
        `).all(student.id, cid);

        if (recentScores.length >= 4) {
            // 对比前半和后半的平均分
            const half = Math.floor(recentScores.length / 2);
            const recentAvg = recentScores.slice(0, half).reduce((s, r) => s + (r.score / r.max_score * 100), 0) / half;
            const olderAvg = recentScores.slice(half).reduce((s, r) => s + (r.score / r.max_score * 100), 0) / (recentScores.length - half);

            const decline = olderAvg - recentAvg;
            if (decline >= 20) {
                alertReasons.push({ type: 'grade_decline', message: `成绩大幅下滑 (下降${Math.round(decline)}%)`, severity: 'high' });
            } else if (decline >= 10) {
                alertReasons.push({ type: 'grade_decline', message: `成绩下滑 (下降${Math.round(decline)}%)`, severity: 'medium' });
            }
        }

        // 检查出勤率
        const totalAttendances = db.prepare('SELECT COUNT(*) as c FROM attendance WHERE class_id = ?').get(cid).c;
        if (totalAttendances > 0) {
            const signedCount = db.prepare(`
                SELECT COUNT(*) as c FROM attendance_records ar
                JOIN attendance a ON ar.attendance_id = a.id
                WHERE a.class_id = ? AND ar.student_id = ?
            `).get(cid, student.id).c;

            const attendanceRate = signedCount / totalAttendances;
            if (attendanceRate < 0.5) {
                alertReasons.push({ type: 'low_attendance', message: `出勤率仅 ${Math.round(attendanceRate * 100)}%`, severity: 'high' });
            } else if (attendanceRate < 0.7) {
                alertReasons.push({ type: 'low_attendance', message: `出勤率偏低 ${Math.round(attendanceRate * 100)}%`, severity: 'medium' });
            }
        }

        if (alertReasons.length > 0) {
            const maxSeverity = alertReasons.some(a => a.severity === 'high') ? 'high' : 'medium';
            alerts.push({
                student: { id: student.id, username: student.username, avatar: student.avatar },
                alerts: alertReasons,
                severity: maxSeverity
            });
        }
    }

    // 按严重程度排序
    alerts.sort((a, b) => (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0));

    res.json({ alerts, totalStudents: students.length });
});

// ==================== 知识点掌握度分析 ====================
// 根据练习系统的答题情况分析全班在特定 HTML/CSS/JS 的错误率
router.get('/knowledge-mastery', teacherOnly, (req, res) => {
    const db = getDb();
    const user = req.user;
    const { classId } = req.query;

    if (!classId) {
        return res.status(400).json({ error: '请指定班级' });
    }

    const cid = parseInt(classId);

    // 获取班级学生ID
    const studentIds = db.prepare(
        'SELECT user_id FROM class_members WHERE class_id = ? AND role = ?'
    ).all(cid, 'student').map(r => r.user_id);

    if (studentIds.length === 0) {
        return res.json({ mastery: [], studentCount: 0 });
    }

    const placeholders = studentIds.map(() => '?').join(',');

    // 从练习记录获取按项目/知识点的完成情况
    const exerciseStats = db.prepare(`
        SELECT 
            p.name as project_name,
            p.subject,
            COUNT(er.id) as attempt_count,
            SUM(CASE WHEN er.completed = 1 THEN 1 ELSE 0 END) as completed_count,
            ROUND(AVG(er.score), 1) as avg_score,
            ROUND(AVG(er.max_score), 1) as avg_max_score,
            COUNT(DISTINCT er.user_id) as student_count
        FROM exercise_records er
        JOIN projects p ON er.project_id = p.id
        WHERE er.user_id IN (${placeholders})
        GROUP BY p.id
        ORDER BY avg_score ASC
    `).all(...studentIds);

    // 计算掌握度
    const mastery = exerciseStats.map(stat => ({
        topic: stat.project_name,
        subject: stat.subject,
        avgScore: stat.avg_score,
        maxScore: stat.avg_max_score,
        masteryRate: stat.avg_max_score > 0 ? Math.round((stat.avg_score / stat.avg_max_score) * 100) : 0,
        completionRate: Math.round((stat.completed_count / stat.attempt_count) * 100),
        participationRate: Math.round((stat.student_count / studentIds.length) * 100),
        studentCount: stat.student_count
    }));

    // 按维度汇总（HTML/CSS/JS）分析
    const homeworkAnalysis = db.prepare(`
        SELECT 
            h.title,
            ROUND(AVG(hs.score), 1) as avg_score,
            h.max_score,
            COUNT(hs.id) as graded_count
        FROM homework h
        JOIN homework_submissions hs ON hs.homework_id = h.id
        WHERE h.class_id = ? AND hs.score IS NOT NULL
        GROUP BY h.id
        ORDER BY avg_score ASC
        LIMIT 20
    `).all(cid);

    // 分项评分维度分析（如果有多维度批改数据）
    const dimensionAnalysis = db.prepare(`
        SELECT 
            ds.dimension,
            ROUND(AVG(ds.score), 1) as avg_score,
            ROUND(AVG(ds.max_score), 1) as avg_max_score,
            COUNT(ds.id) as count
        FROM homework_dimension_scores ds
        JOIN homework_submissions hs ON ds.submission_id = hs.id
        JOIN homework h ON hs.homework_id = h.id
        WHERE h.class_id = ?
        GROUP BY ds.dimension
        ORDER BY avg_score ASC
    `).all(cid);

    res.json({
        mastery,
        homeworkAnalysis,
        dimensionAnalysis,
        studentCount: studentIds.length
    });
});

// ==================== 综合概览 ====================
router.get('/overview', teacherOnly, (req, res) => {
    const db = getDb();
    const user = req.user;

    // 我管理的班级
    const myClasses = db.prepare(`
        SELECT c.id, c.name, c.semester, c.archived,
            (SELECT COUNT(*) FROM class_members WHERE class_id = c.id AND role = 'student') as student_count,
            (SELECT COUNT(*) FROM homework WHERE class_id = c.id AND status = 'active') as homework_count
        FROM classes c
        WHERE c.teacher_id = ? AND c.archived = 0
        ORDER BY c.created_at DESC
    `).all(user.id);

    // 待批改作业数
    const pendingGrading = db.prepare(`
        SELECT COUNT(*) as count
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        WHERE h.teacher_id = ? AND hs.status = 'submitted'
    `).get(user.id).count;

    // 今日新提交
    const todaySubmissions = db.prepare(`
        SELECT COUNT(*) as count
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        WHERE h.teacher_id = ? AND date(hs.submitted_at) = date('now')
    `).get(user.id).count;

    // 总学生数
    const totalStudents = db.prepare(`
        SELECT COUNT(DISTINCT cm.user_id) as count
        FROM class_members cm
        JOIN classes c ON cm.class_id = c.id
        WHERE c.teacher_id = ? AND cm.role = 'student'
    `).get(user.id).count;

    // 全班平均分趋势（最近10次作业）
    const scoreTrend = db.prepare(`
        SELECT h.title, h.created_at,
            ROUND(AVG(hs.score), 1) as avg_score,
            h.max_score
        FROM homework h
        JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.score IS NOT NULL
        WHERE h.teacher_id = ?
        GROUP BY h.id
        ORDER BY h.created_at DESC
        LIMIT 10
    `).all(user.id).reverse();

    // 近期预警学生数
    let alertCount = 0;
    for (const cls of myClasses) {
        const missed = db.prepare(`
            SELECT cm.user_id, 
                (SELECT COUNT(*) FROM homework h 
                 LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = cm.user_id
                 WHERE h.class_id = ? AND h.status = 'active' AND hs.id IS NULL
                 ORDER BY h.created_at DESC LIMIT 3) as missed_count
            FROM class_members cm
            WHERE cm.class_id = ? AND cm.role = 'student'
        `).all(cls.id, cls.id);
        alertCount += missed.filter(m => m.missed_count >= 3).length;
    }

    res.json({
        classes: myClasses,
        stats: {
            totalClasses: myClasses.length,
            totalStudents,
            pendingGrading,
            todaySubmissions,
            alertCount
        },
        scoreTrend
    });
});

// ==================== 全景学情数字大屏 ====================

// 班级代码活跃度（每日代码行数趋势、夜猫排行）
router.get('/analytics/code-activity/:classId', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const user = req.user;
    const { days } = req.query;
    const lookbackDays = parseInt(days) || 30;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '无权访问' });
    }

    // 每日代码活跃度趋势（按日聚合）
    const dailyActivity = db.prepare(`
        SELECT date,
            SUM(lines_added) as total_lines_added,
            SUM(lines_deleted) as total_lines_deleted,
            COUNT(DISTINCT user_id) as active_students,
            SUM(lines_added + lines_deleted) as total_keystrokes
        FROM code_activity
        WHERE class_id = ? AND date >= date('now', ?)
        GROUP BY date
        ORDER BY date ASC
    `).all(classId, `-${lookbackDays} days`);

    // 夜猫排行（22:00~06:00 活动最多的学生）
    const nightOwlRanking = db.prepare(`
        SELECT u.id, u.username, u.avatar,
            SUM(ca.lines_added + ca.lines_deleted) as night_keystrokes,
            COUNT(*) as night_sessions
        FROM code_activity ca
        JOIN users u ON ca.user_id = u.id
        WHERE ca.class_id = ?
            AND (ca.hour >= 22 OR ca.hour < 6)
            AND ca.date >= date('now', '-30 days')
        GROUP BY ca.user_id
        ORDER BY night_keystrokes DESC
        LIMIT 10
    `).all(classId);

    // 每小时分布
    const hourlyDistribution = db.prepare(`
        SELECT hour,
            SUM(lines_added + lines_deleted) as keystrokes
        FROM code_activity
        WHERE class_id = ? AND date >= date('now', '-30 days')
        GROUP BY hour
        ORDER BY hour ASC
    `).all(classId);

    // 人均代码量排行
    const studentRanking = db.prepare(`
        SELECT u.id, u.username, u.avatar,
            SUM(ca.lines_added) as total_lines,
            SUM(ca.lines_added + ca.lines_deleted) as total_keystrokes,
            COUNT(DISTINCT ca.date) as active_days
        FROM code_activity ca
        JOIN users u ON ca.user_id = u.id
        WHERE ca.class_id = ? AND ca.date >= date('now', ?)
        GROUP BY ca.user_id
        ORDER BY total_lines DESC
        LIMIT 20
    `).all(classId, `-${lookbackDays} days`);

    res.json({
        dailyActivity,
        nightOwlRanking,
        hourlyDistribution,
        studentRanking
    });
});

// 常见错误归因统计
router.get('/analytics/errors/:classId', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const user = req.user;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '无权访问' });
    }

    // 按 lint 错误类型聚合
    const errorStats = db.prepare(`
        SELECT lr.file_type, lr.error_count, lr.warning_count, lr.errors, lr.warnings
        FROM lint_reports lr
        JOIN users u ON lr.user_id = u.id
        JOIN class_members cm ON cm.user_id = u.id AND cm.class_id = ?
        WHERE lr.created_at >= datetime('now', '-30 days')
        ORDER BY lr.created_at DESC
        LIMIT 500
    `).all(classId);

    // 归因统计
    const ruleCount = {};
    for (const report of errorStats) {
        try {
            const errors = JSON.parse(report.errors || '[]');
            const warnings = JSON.parse(report.warnings || '[]');
            for (const e of [...errors, ...warnings]) {
                const rule = e.rule || 'unknown';
                ruleCount[rule] = (ruleCount[rule] || 0) + 1;
            }
        } catch (e) { /* skip */ }
    }

    // 排序
    const topErrors = Object.entries(ruleCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([rule, count]) => ({ rule, count }));

    res.json({ topErrors, totalReports: errorStats.length });
});

// 测试通过率趋势
router.get('/analytics/tests/:classId', (req, res) => {
    const db = getDb();
    const classId = parseInt(req.params.classId);
    const user = req.user;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '无权访问' });
    }

    const testPassRate = db.prepare(`
        SELECT h.title as homework_title, h.id as homework_id,
            COUNT(atr.id) as total_tests,
            SUM(CASE WHEN atr.passed = 1 THEN 1 ELSE 0 END) as passed_tests,
            ROUND(SUM(CASE WHEN atr.passed = 1 THEN 1.0 ELSE 0 END) / COUNT(atr.id) * 100, 1) as pass_rate
        FROM auto_test_results atr
        JOIN homework_submissions hs ON atr.submission_id = hs.id
        JOIN homework h ON hs.homework_id = h.id
        WHERE h.class_id = ?
        GROUP BY h.id
        ORDER BY h.created_at DESC
        LIMIT 20
    `).all(classId);

    // 按测试名称归因（哪些测试最容易失败）
    const hardestTests = db.prepare(`
        SELECT atr.test_name,
            COUNT(*) as total_runs,
            SUM(CASE WHEN atr.passed = 0 THEN 1 ELSE 0 END) as fail_count,
            ROUND(SUM(CASE WHEN atr.passed = 0 THEN 1.0 ELSE 0 END) / COUNT(*) * 100, 1) as fail_rate
        FROM auto_test_results atr
        JOIN homework_submissions hs ON atr.submission_id = hs.id
        JOIN homework h ON hs.homework_id = h.id
        WHERE h.class_id = ?
        GROUP BY atr.test_name
        HAVING total_runs >= 3
        ORDER BY fail_rate DESC
        LIMIT 15
    `).all(classId);

    res.json({ testPassRate, hardestTests });
});

// 学生综合学情画像
router.get('/analytics/student-profile/:userId', (req, res) => {
    const db = getDb();
    const userId = parseInt(req.params.userId);
    const user = req.user;

    // 教师或本人可查看
    if (user.role !== 'teacher' && user.role !== 'admin' && user.id !== userId) {
        return res.status(403).json({ error: '无权访问' });
    }

    const profile = db.prepare('SELECT id, username, avatar, created_at FROM users WHERE id = ?').get(userId);
    if (!profile) return res.status(404).json({ error: '用户不存在' });

    // 作业成绩趋势
    const scoreTrend = db.prepare(`
        SELECT h.title, hs.score, hs.final_score, hs.peer_avg_score, hs.self_score, hs.submitted_at
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        WHERE hs.student_id = ?
        ORDER BY hs.submitted_at DESC
        LIMIT 30
    `).all(userId);

    // 代码活跃度
    const codeActivity = db.prepare(`
        SELECT date, SUM(lines_added) as lines, SUM(lines_added + lines_deleted) as keystrokes
        FROM code_activity
        WHERE user_id = ?
        GROUP BY date
        ORDER BY date DESC
        LIMIT 30
    `).all(userId);

    // 互评参与度
    const peerReviewStats = db.prepare(`
        SELECT 
            COUNT(*) as total_assigned,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            ROUND(AVG(CASE WHEN score IS NOT NULL THEN score END), 1) as avg_given_score
        FROM peer_review_assignments
        WHERE reviewer_id = ?
    `).get(userId);

    // 金币和等级
    const coinInfo = db.prepare('SELECT coins, level FROM users WHERE id = ?').get(userId);

    res.json({
        profile,
        scoreTrend,
        codeActivity,
        peerReviewStats,
        coins: coinInfo ? coinInfo.coins : 0,
        level: coinInfo ? coinInfo.level : 1
    });
});

module.exports = router;
