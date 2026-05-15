/**
 * 作业管理路由 - 教师发布/批改作业，学生提交作业
 * 升级版：多维度批改、逐行点评、打回重做、查重检测、催交、文件上传
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ===== 文件上传配置 =====
const UPLOAD_DIR = path.join(__dirname, '../../data/uploads/homework');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.zip', '.rar', '.txt', '.html', '.css', '.js', '.py', '.java', '.cpp', '.c', '.md'];

const hwStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeName = crypto.randomBytes(12).toString('hex') + ext;
        cb(null, safeName);
    }
});

const hwUpload = multer({
    storage: hwStorage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_EXTENSIONS.includes(ext)) cb(null, true);
        else cb(new Error('不支持的文件类型: ' + ext));
    }
});

// 文件上传接口
router.post('/upload', hwUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请选择文件' });
    const url = `/api/homework/files/${req.file.filename}`;
    res.json({ success: true, url, filename: req.file.filename, originalName: req.file.originalname, size: req.file.size });
});

// 文件访问接口
router.get('/files/:filename', (req, res) => {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    res.sendFile(filePath);
});

// 获取我的作业列表
// 教师：我发布的作业；学生：我需要完成的作业
router.get('/my', (req, res) => {
    const db = getDb();
    const user = req.user;

    if (user.role === 'teacher' || user.role === 'admin') {
        const homework = db.prepare(`
            SELECT h.*, c.name as class_name,
                (SELECT COUNT(*) FROM homework_submissions WHERE homework_id = h.id) as submission_count,
                (SELECT COUNT(*) FROM homework_submissions WHERE homework_id = h.id AND status = 'graded') as graded_count,
                (SELECT COUNT(*) FROM class_members WHERE class_id = h.class_id) as total_students
            FROM homework h
            JOIN classes c ON h.class_id = c.id
            WHERE h.teacher_id = ?
            ORDER BY h.created_at DESC
        `).all(user.id);
        return res.json({ homework });
    }

    // 学生：获取所在班级的作业
    const homework = db.prepare(`
        SELECT h.*, c.name as class_name, u.username as teacher_name,
            hs.status as my_status, hs.score as my_score, hs.submitted_at as my_submitted_at
        FROM homework h
        JOIN classes c ON h.class_id = c.id
        JOIN users u ON h.teacher_id = u.id
        JOIN class_members cm ON cm.class_id = h.class_id AND cm.user_id = ?
        LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = ?
        WHERE h.status = 'active'
        ORDER BY h.due_date ASC, h.created_at DESC
    `).all(user.id, user.id);
    res.json({ homework });
});

// 发布作业（仅教师）
router.post('/create', (req, res) => {
    const db = getDb();
    const user = req.user;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以发布作业' });
    }

    const { title, description, classId, dueDate, maxScore, type, gradingDimensions, allowResubmit, attachments } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ error: '作业标题不能为空' });
    }
    if (!classId) {
        return res.status(400).json({ error: '请选择班级' });
    }

    // 验证班级归属
    const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').get(parseInt(classId), user.id);
    if (!cls && user.role !== 'admin') {
        // 也检查是否为协作教师/TA
        const membership = db.prepare('SELECT role FROM class_members WHERE class_id = ? AND user_id = ?').get(parseInt(classId), user.id);
        if (!membership || (membership.role !== 'co_teacher' && membership.role !== 'ta')) {
            return res.status(403).json({ error: '无权在该班级发布作业' });
        }
    }

    const dimensions = gradingDimensions ? JSON.stringify(gradingDimensions) : '[]';
    const homeworkType = type || 'individual'; // individual | group
    const attachmentUrl = attachments && attachments.length ? JSON.stringify(attachments) : '';

    const result = db.prepare(
        'INSERT INTO homework (title, description, class_id, teacher_id, due_date, max_score, type, grading_dimensions, allow_resubmit, attachment_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(title.trim(), description || '', parseInt(classId), user.id, dueDate || null, maxScore || 100, homeworkType, dimensions, allowResubmit !== false ? 1 : 0, attachmentUrl);

    res.json({ success: true, homework: { id: result.lastInsertRowid } });
});

// 获取作业详情（含提交列表—教师可看全部，学生只看自己）
router.get('/:id', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);
    const user = req.user;

    const hw = db.prepare(`
        SELECT h.*, c.name as class_name, u.username as teacher_name
        FROM homework h
        JOIN classes c ON h.class_id = c.id
        JOIN users u ON h.teacher_id = u.id
        WHERE h.id = ?
    `).get(homeworkId);

    if (!hw) return res.status(404).json({ error: '作业不存在' });

    // 教师或管理员可以看所有提交
    if (hw.teacher_id === user.id || user.role === 'admin') {
        const submissions = db.prepare(`
            SELECT hs.*, u.username as student_name, u.avatar as student_avatar
            FROM homework_submissions hs
            JOIN users u ON hs.student_id = u.id
            WHERE hs.homework_id = ?
            ORDER BY hs.submitted_at DESC
        `).all(homeworkId);

        const totalStudents = db.prepare(
            'SELECT COUNT(*) as count FROM class_members WHERE class_id = ?'
        ).get(hw.class_id).count;

        return res.json({ homework: hw, submissions, totalStudents });
    }

    // 学生只能看自己的提交
    const isMember = db.prepare(
        'SELECT id FROM class_members WHERE class_id = ? AND user_id = ?'
    ).get(hw.class_id, user.id);

    if (!isMember) {
        return res.status(403).json({ error: '无权查看该作业' });
    }

    const mySubmission = db.prepare(
        'SELECT * FROM homework_submissions WHERE homework_id = ? AND student_id = ?'
    ).get(homeworkId, user.id);

    res.json({ homework: hw, mySubmission });
});

// 学生提交作业
router.post('/:id/submit', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);
    const user = req.user;
    const { content, groupId, attachments } = req.body;

    if ((!content || !content.trim()) && (!attachments || !attachments.length)) {
        return res.status(400).json({ error: '请提交内容或附件' });
    }

    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId);
    if (!hw) return res.status(404).json({ error: '作业不存在' });

    // 验证是否为该班级成员
    const isMember = db.prepare(
        'SELECT id FROM class_members WHERE class_id = ? AND user_id = ?'
    ).get(hw.class_id, user.id);
    if (!isMember) {
        return res.status(403).json({ error: '你不是该班级成员' });
    }

    // 检查是否已提交
    const existing = db.prepare(
        'SELECT id, status, submit_count FROM homework_submissions WHERE homework_id = ? AND student_id = ?'
    ).get(homeworkId, user.id);

    if (existing) {
        // 如果被打回则允许重新提交，否则检查 allow_resubmit
        if (existing.status === 'rejected' || hw.allow_resubmit) {
            const newCount = (existing.submit_count || 1) + 1;
            const attachUrl = attachments && attachments.length ? JSON.stringify(attachments) : '';
            db.prepare(
                'UPDATE homework_submissions SET content = ?, status = ?, submitted_at = CURRENT_TIMESTAMP, submit_count = ?, reject_reason = ?, attachment_url = ? WHERE id = ?'
            ).run((content || '').trim(), 'submitted', newCount, '', attachUrl, existing.id);
        } else {
            return res.status(400).json({ error: '该作业不允许重复提交' });
        }
    } else {
        const attachUrl = attachments && attachments.length ? JSON.stringify(attachments) : '';
        db.prepare(
            'INSERT INTO homework_submissions (homework_id, student_id, content, status, group_id, submit_count, attachment_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(homeworkId, user.id, (content || '').trim(), 'submitted', groupId || null, 1, attachUrl);
    }

    res.json({ success: true });
});

// 教师批改作业（支持多维度打分）
router.post('/:id/grade', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.id);
    const user = req.user;
    const { score, feedback, dimensionScores } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        // 也允许 TA 批改
        const taCheck = db.prepare(`
            SELECT cm.role FROM homework_submissions hs
            JOIN homework h ON hs.homework_id = h.id
            JOIN class_members cm ON cm.class_id = h.class_id AND cm.user_id = ?
            WHERE hs.id = ?
        `).get(user.id, submissionId);
        if (!taCheck || (taCheck.role !== 'co_teacher' && taCheck.role !== 'ta')) {
            return res.status(403).json({ error: '只有教师或助教可以批改作业' });
        }
    }

    const submission = db.prepare(`
        SELECT hs.*, h.teacher_id, h.max_score
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        WHERE hs.id = ?
    `).get(submissionId);

    if (!submission) return res.status(404).json({ error: '提交记录不存在' });
    if (submission.teacher_id !== user.id && user.role !== 'admin') {
        // 检查是否为协作教师或TA
        const hw = db.prepare('SELECT class_id FROM homework WHERE id = ?').get(submission.homework_id);
        const membership = db.prepare('SELECT role FROM class_members WHERE class_id = ? AND user_id = ?').get(hw.class_id, user.id);
        if (!membership || (membership.role !== 'co_teacher' && membership.role !== 'ta')) {
            return res.status(403).json({ error: '无权批改该作业' });
        }
    }

    const gradeScore = Math.min(Math.max(parseInt(score) || 0, 0), submission.max_score);

    db.prepare(
        'UPDATE homework_submissions SET score = ?, feedback = ?, status = ?, graded_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(gradeScore, feedback || '', 'graded', submissionId);

    // 保存分项评分
    if (dimensionScores && Array.isArray(dimensionScores)) {
        // 先清除旧的分项评分
        db.prepare('DELETE FROM homework_dimension_scores WHERE submission_id = ?').run(submissionId);
        const insertDim = db.prepare(
            'INSERT INTO homework_dimension_scores (submission_id, dimension, score, max_score, comment) VALUES (?, ?, ?, ?, ?)'
        );
        for (const dim of dimensionScores) {
            insertDim.run(submissionId, dim.dimension, dim.score || 0, dim.maxScore || 100, dim.comment || '');
        }
    }

    res.json({ success: true, score: gradeScore });
});

// 教师打回作业（驳回重做）
router.post('/:id/reject', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.id);
    const user = req.user;
    const { reason } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以打回作业' });
    }

    const submission = db.prepare(`
        SELECT hs.*, h.teacher_id, h.class_id
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        WHERE hs.id = ?
    `).get(submissionId);

    if (!submission) return res.status(404).json({ error: '提交记录不存在' });

    // 权限校验
    if (submission.teacher_id !== user.id && user.role !== 'admin') {
        const membership = db.prepare('SELECT role FROM class_members WHERE class_id = ? AND user_id = ?').get(submission.class_id, user.id);
        if (!membership || (membership.role !== 'co_teacher' && membership.role !== 'ta')) {
            return res.status(403).json({ error: '无权操作' });
        }
    }

    db.prepare(
        'UPDATE homework_submissions SET status = ?, reject_reason = ?, score = NULL, graded_at = NULL WHERE id = ?'
    ).run('rejected', reason || '请根据要求修改后重新提交', submissionId);

    res.json({ success: true });
});

// 添加代码批注（逐行点评）
router.post('/:id/annotations', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.id);
    const user = req.user;
    const { annotations } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        const taCheck = db.prepare(`
            SELECT cm.role FROM homework_submissions hs
            JOIN homework h ON hs.homework_id = h.id
            JOIN class_members cm ON cm.class_id = h.class_id AND cm.user_id = ?
            WHERE hs.id = ?
        `).get(user.id, submissionId);
        if (!taCheck || (taCheck.role !== 'co_teacher' && taCheck.role !== 'ta')) {
            return res.status(403).json({ error: '无权添加批注' });
        }
    }

    if (!annotations || !Array.isArray(annotations)) {
        return res.status(400).json({ error: '批注数据格式错误' });
    }

    const insert = db.prepare(
        'INSERT INTO code_annotations (submission_id, file_type, line_start, line_end, content, severity, teacher_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    const transaction = db.transaction(() => {
        for (const ann of annotations) {
            if (!ann.lineStart || !ann.content) continue;
            insert.run(
                submissionId,
                ann.fileType || 'html',
                ann.lineStart,
                ann.lineEnd || ann.lineStart,
                ann.content.trim(),
                ann.severity || 'info',
                user.id
            );
        }
    });
    transaction();

    res.json({ success: true });
});

// 获取代码批注
router.get('/:id/annotations', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.id);

    const annotations = db.prepare(`
        SELECT ca.*, u.username as teacher_name
        FROM code_annotations ca
        JOIN users u ON ca.teacher_id = u.id
        WHERE ca.submission_id = ?
        ORDER BY ca.file_type, ca.line_start ASC
    `).all(submissionId);

    res.json({ annotations });
});

// 删除单条批注
router.delete('/annotations/:annotationId', (req, res) => {
    const db = getDb();
    const annotationId = parseInt(req.params.annotationId);
    const user = req.user;

    const ann = db.prepare('SELECT * FROM code_annotations WHERE id = ?').get(annotationId);
    if (!ann) return res.status(404).json({ error: '批注不存在' });
    if (ann.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权删除该批注' });
    }

    db.prepare('DELETE FROM code_annotations WHERE id = ?').run(annotationId);
    res.json({ success: true });
});

// 查重检测（对比班级内学生代码相似度）
router.post('/:id/plagiarism-check', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);
    const user = req.user;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以执行查重' });
    }

    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId);
    if (!hw) return res.status(404).json({ error: '作业不存在' });

    // 获取所有提交
    const submissions = db.prepare(`
        SELECT hs.id, hs.student_id, hs.content, u.username as student_name
        FROM homework_submissions hs
        JOIN users u ON hs.student_id = u.id
        WHERE hs.homework_id = ? AND hs.content != ''
    `).all(homeworkId);

    if (submissions.length < 2) {
        return res.json({ reports: [], message: '提交人数不足，无法进行查重' });
    }

    // 清除旧报告
    db.prepare('DELETE FROM plagiarism_reports WHERE homework_id = ?').run(homeworkId);

    // 简单的代码相似度计算（基于 n-gram 相似度）
    function tokenize(code) {
        return code.replace(/\s+/g, ' ').replace(/[{}()\[\];,.<>]/g, ' ')
            .trim().toLowerCase().split(/\s+/).filter(t => t.length > 2);
    }

    function ngramSimilarity(tokensA, tokensB, n = 3) {
        if (tokensA.length < n || tokensB.length < n) return 0;
        const ngramsA = new Set();
        for (let i = 0; i <= tokensA.length - n; i++) {
            ngramsA.add(tokensA.slice(i, i + n).join(' '));
        }
        const ngramsB = new Set();
        for (let i = 0; i <= tokensB.length - n; i++) {
            ngramsB.add(tokensB.slice(i, i + n).join(' '));
        }
        let intersection = 0;
        for (const ng of ngramsA) {
            if (ngramsB.has(ng)) intersection++;
        }
        const union = ngramsA.size + ngramsB.size - intersection;
        return union === 0 ? 0 : intersection / union;
    }

    const reports = [];
    const insertReport = db.prepare(
        'INSERT INTO plagiarism_reports (homework_id, student_a_id, student_b_id, similarity, matched_lines, status) VALUES (?, ?, ?, ?, ?, ?)'
    );

    const transaction = db.transaction(() => {
        for (let i = 0; i < submissions.length; i++) {
            for (let j = i + 1; j < submissions.length; j++) {
                const tokensA = tokenize(submissions[i].content);
                const tokensB = tokenize(submissions[j].content);
                const similarity = ngramSimilarity(tokensA, tokensB);

                if (similarity > 0.3) { // 超过30%相似度才记录
                    const status = similarity > 0.7 ? 'high_risk' : similarity > 0.5 ? 'medium_risk' : 'low_risk';
                    insertReport.run(
                        homeworkId,
                        submissions[i].student_id,
                        submissions[j].student_id,
                        Math.round(similarity * 100),
                        '[]',
                        status
                    );
                    reports.push({
                        studentA: submissions[i].student_name,
                        studentB: submissions[j].student_name,
                        similarity: Math.round(similarity * 100),
                        status
                    });
                }
            }
        }
    });
    transaction();

    res.json({ reports, total: reports.length });
});

// 获取查重报告
router.get('/:id/plagiarism-reports', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);

    const reports = db.prepare(`
        SELECT pr.*, 
            ua.username as student_a_name, ub.username as student_b_name
        FROM plagiarism_reports pr
        JOIN users ua ON pr.student_a_id = ua.id
        JOIN users ub ON pr.student_b_id = ub.id
        WHERE pr.homework_id = ?
        ORDER BY pr.similarity DESC
    `).all(homeworkId);

    res.json({ reports });
});

// 作业催交（对未提交学生发送提醒）
router.post('/:id/remind', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);
    const user = req.user;
    const { studentIds, message } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以催交作业' });
    }

    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId);
    if (!hw) return res.status(404).json({ error: '作业不存在' });

    let targetStudents = studentIds;
    if (!targetStudents || targetStudents.length === 0) {
        // 自动找出未提交的学生
        targetStudents = db.prepare(`
            SELECT cm.user_id FROM class_members cm
            WHERE cm.class_id = ? AND cm.role = 'student'
            AND cm.user_id NOT IN (
                SELECT student_id FROM homework_submissions WHERE homework_id = ?
            )
        `).all(hw.class_id, homeworkId).map(r => r.user_id);
    }

    if (targetStudents.length === 0) {
        return res.json({ success: true, reminded: 0, message: '所有学生都已提交' });
    }

    const reminderMsg = message || '请尽快提交作业「' + hw.title + '」';
    const insertReminder = db.prepare(
        'INSERT INTO homework_reminders (homework_id, student_id, teacher_id, message) VALUES (?, ?, ?, ?)'
    );
    // 同时发送站内消息
    const insertMessage = db.prepare(
        'INSERT INTO messages (from_id, to_id, content, type) VALUES (?, ?, ?, ?)'
    );

    const transaction = db.transaction(() => {
        for (const sid of targetStudents) {
            insertReminder.run(homeworkId, sid, user.id, reminderMsg);
            insertMessage.run(user.id, sid, '📢 作业催交：' + reminderMsg, 'system');
        }
    });
    transaction();

    res.json({ success: true, reminded: targetStudents.length });
});

// 复制作业到其他班级
router.post('/:id/copy', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);
    const user = req.user;
    const { targetClassId } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以操作' });
    }

    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId);
    if (!hw) return res.status(404).json({ error: '作业不存在' });

    // 验证目标班级归属
    const targetCls = db.prepare('SELECT * FROM classes WHERE id = ?').get(parseInt(targetClassId));
    if (!targetCls) return res.status(404).json({ error: '目标班级不存在' });
    if (targetCls.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权操作目标班级' });
    }

    const result = db.prepare(
        'INSERT INTO homework (title, description, class_id, teacher_id, due_date, max_score, type, grading_dimensions, allow_resubmit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(hw.title, hw.description, parseInt(targetClassId), user.id, hw.due_date, hw.max_score, hw.type || 'individual', hw.grading_dimensions || '[]', hw.allow_resubmit || 1);

    res.json({ success: true, newHomeworkId: result.lastInsertRowid });
});

// 编辑作业（仅教师）
router.put('/:id', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);
    const user = req.user;
    const { title, description, dueDate, maxScore } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以编辑作业' });
    }

    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId);
    if (!hw) return res.status(404).json({ error: '作业不存在' });
    if (hw.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权编辑该作业' });
    }

    const updates = [];
    const values = [];
    if (title !== undefined) { updates.push('title = ?'); values.push(title.trim()); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (dueDate !== undefined) { updates.push('due_date = ?'); values.push(dueDate || null); }
    if (maxScore !== undefined) { updates.push('max_score = ?'); values.push(parseInt(maxScore) || 100); }

    if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(homeworkId);
        db.prepare(`UPDATE homework SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    res.json({ success: true });
});

// 删除作业（仅教师）
router.delete('/:id', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);
    const user = req.user;

    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId);
    if (!hw) return res.status(404).json({ error: '作业不存在' });
    if (hw.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权删除该作业' });
    }

    db.prepare('DELETE FROM homework WHERE id = ?').run(homeworkId);
    res.json({ success: true });
});

// ==================== 三栏批改工作台 API ====================

// 获取批改工作台数据（含提交列表、当前学生源码、维度评分）
router.get('/:id/grading-workspace', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);
    const user = req.user;
    const { submissionId } = req.query;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        const taCheck = db.prepare(`
            SELECT cm.role FROM homework h
            JOIN class_members cm ON cm.class_id = h.class_id AND cm.user_id = ?
            WHERE h.id = ?
        `).get(user.id, homeworkId);
        if (!taCheck || (taCheck.role !== 'co_teacher' && taCheck.role !== 'ta')) {
            return res.status(403).json({ error: '无权访问批改工作台' });
        }
    }

    const hw = db.prepare(`
        SELECT h.*, c.name as class_name
        FROM homework h JOIN classes c ON h.class_id = c.id
        WHERE h.id = ?
    `).get(homeworkId);
    if (!hw) return res.status(404).json({ error: '作业不存在' });

    // 左栏：学生提交列表（含状态）
    const submissions = db.prepare(`
        SELECT hs.id, hs.student_id, hs.status, hs.score, hs.submitted_at, hs.graded_at,
            hs.submit_count, hs.reject_reason,
            u.username as student_name, u.avatar as student_avatar
        FROM homework_submissions hs
        JOIN users u ON hs.student_id = u.id
        WHERE hs.homework_id = ?
        ORDER BY 
            CASE hs.status WHEN 'submitted' THEN 0 WHEN 'rejected' THEN 1 WHEN 'graded' THEN 2 END,
            hs.submitted_at ASC
    `).all(homeworkId);

    // 未提交学生列表
    const notSubmitted = db.prepare(`
        SELECT u.id, u.username, u.avatar
        FROM class_members cm JOIN users u ON cm.user_id = u.id
        WHERE cm.class_id = ? AND cm.role = 'student'
        AND u.id NOT IN (SELECT student_id FROM homework_submissions WHERE homework_id = ?)
    `).all(hw.class_id, homeworkId);

    // 中栏：当前选中提交的详情
    let currentSubmission = null;
    let annotations = [];
    let dimensionScores = [];

    if (submissionId) {
        currentSubmission = db.prepare(`
            SELECT hs.*, u.username as student_name, u.avatar as student_avatar
            FROM homework_submissions hs
            JOIN users u ON hs.student_id = u.id
            WHERE hs.id = ?
        `).get(parseInt(submissionId));

        if (currentSubmission) {
            // 获取批注
            annotations = db.prepare(`
                SELECT ca.*, u.username as teacher_name
                FROM code_annotations ca
                JOIN users u ON ca.teacher_id = u.id
                WHERE ca.submission_id = ?
                ORDER BY ca.file_type, ca.line_start ASC
            `).all(parseInt(submissionId));

            // 获取维度评分
            dimensionScores = db.prepare(
                'SELECT * FROM homework_dimension_scores WHERE submission_id = ?'
            ).all(parseInt(submissionId));
        }
    }

    // 解析批改维度配置
    let gradingDimensions = [];
    try { gradingDimensions = JSON.parse(hw.grading_dimensions || '[]'); } catch (e) {}

    res.json({
        homework: hw,
        submissions,
        notSubmitted,
        currentSubmission,
        annotations,
        dimensionScores,
        gradingDimensions,
        stats: {
            total: submissions.length + notSubmitted.length,
            submitted: submissions.filter(s => s.status === 'submitted').length,
            graded: submissions.filter(s => s.status === 'graded').length,
            rejected: submissions.filter(s => s.status === 'rejected').length,
            not_submitted: notSubmitted.length
        }
    });
});

// 获取学生提交的源码文件列表（用于源码查看器）
router.get('/submission/:id/files', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.id);
    const user = req.user;

    const submission = db.prepare(`
        SELECT hs.*, h.teacher_id, h.class_id
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        WHERE hs.id = ?
    `).get(submissionId);

    if (!submission) return res.status(404).json({ error: '提交不存在' });

    // 如果有 attachment_url（ZIP部署后），读取部署的文件列表
    if (submission.attachment_url) {
        const fs = require('fs');
        const path = require('path');
        const siteDir = path.join(__dirname, '..', '..', 'data', 'sites', submission.attachment_url);

        if (fs.existsSync(siteDir)) {
            const files = [];
            function walkDir(dir, prefix = '') {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
                    if (entry.isDirectory()) {
                        walkDir(path.join(dir, entry.name), relPath);
                    } else {
                        const stat = fs.statSync(path.join(dir, entry.name));
                        files.push({
                            path: relPath,
                            name: entry.name,
                            size: stat.size,
                            ext: path.extname(entry.name).slice(1)
                        });
                    }
                }
            }
            walkDir(siteDir);
            return res.json({ files, siteUrl: `/site/${submission.attachment_url}` });
        }
    }

    // 如果没有部署文件，返回提交内容作为单文件
    res.json({
        files: [{ path: 'index.html', name: 'index.html', size: (submission.content || '').length, ext: 'html' }],
        content: submission.content
    });
});

// 获取学生提交的单个源码文件内容
router.get('/submission/:id/file-content', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.id);
    const { filePath } = req.query;

    const submission = db.prepare(`
        SELECT hs.*, h.teacher_id, h.class_id
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        WHERE hs.id = ?
    `).get(submissionId);

    if (!submission) return res.status(404).json({ error: '提交不存在' });

    if (submission.attachment_url && filePath) {
        const fs = require('fs');
        const path = require('path');
        const siteDir = path.join(__dirname, '..', '..', 'data', 'sites', submission.attachment_url);
        const targetFile = path.join(siteDir, filePath);

        // 安全检查：防止路径穿越
        const resolvedPath = path.resolve(targetFile);
        if (!resolvedPath.startsWith(path.resolve(siteDir))) {
            return res.status(403).json({ error: '非法路径' });
        }

        if (fs.existsSync(targetFile)) {
            const content = fs.readFileSync(targetFile, 'utf-8');
            return res.json({ content, filePath });
        }
        return res.status(404).json({ error: '文件不存在' });
    }

    res.json({ content: submission.content || '', filePath: 'index.html' });
});

// 批量批改（快速打分）
router.post('/:id/batch-grade', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);
    const user = req.user;
    const { grades } = req.body; // [{ submissionId, score, feedback }]

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '无权操作' });
    }

    if (!grades || !Array.isArray(grades)) {
        return res.status(400).json({ error: '数据格式错误' });
    }

    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId);
    if (!hw) return res.status(404).json({ error: '作业不存在' });

    const update = db.prepare(
        'UPDATE homework_submissions SET score = ?, feedback = ?, status = ?, graded_at = CURRENT_TIMESTAMP WHERE id = ? AND homework_id = ?'
    );

    let graded = 0;
    const transaction = db.transaction(() => {
        for (const g of grades) {
            const score = Math.min(Math.max(parseInt(g.score) || 0, 0), hw.max_score);
            update.run(score, g.feedback || '', 'graded', g.submissionId, homeworkId);
            graded++;
        }
    });
    transaction();

    res.json({ success: true, graded });
});

// 获取作业提交历史记录（对比用）
router.get('/submission/:id/history', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.id);

    const submission = db.prepare('SELECT * FROM homework_submissions WHERE id = ?').get(submissionId);
    if (!submission) return res.status(404).json({ error: '提交不存在' });

    // 如果有多次提交，返回提交次数和时间线
    res.json({
        current: {
            content: submission.content,
            submitted_at: submission.submitted_at,
            submit_count: submission.submit_count || 1,
            status: submission.status,
            reject_reason: submission.reject_reason
        }
    });
});

module.exports = router;
