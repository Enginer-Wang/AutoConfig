/**
 * 自动化测试与互评路由
 * - Auto-Grading: 教师配置 E2E 测试脚本，系统自动校验 DOM 结构
 * - Peer Review: 生生互评流转引擎
 * - 智能语法检测
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ==================== 自动化测试（Auto-Grading）====================

// 教师配置作业的测试脚本
router.post('/homework/:id/test-config', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);
    const user = req.user;
    const { testScript, testConfig } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以配置测试' });
    }

    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId);
    if (!hw) return res.status(404).json({ error: '作业不存在' });
    if (hw.teacher_id !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: '无权操作' });
    }

    db.prepare('UPDATE homework SET test_script = ?, test_config = ? WHERE id = ?')
        .run(testScript || '', JSON.stringify(testConfig || {}), homeworkId);

    res.json({ success: true });
});

// 执行自动化测试（基于 DOM 检查，非 Puppeteer）
router.post('/submission/:id/run-tests', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.id);
    const user = req.user;

    const submission = db.prepare(`
        SELECT hs.*, h.test_script, h.test_config, h.max_score, h.teacher_id
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        WHERE hs.id = ?
    `).get(submissionId);

    if (!submission) return res.status(404).json({ error: '提交记录不存在' });

    // 教师或系统可触发测试
    if (user.role !== 'teacher' && user.role !== 'admin' && user.id !== submission.student_id) {
        return res.status(403).json({ error: '无权操作' });
    }

    if (!submission.test_script && !submission.test_config) {
        return res.status(400).json({ error: '该作业未配置自动化测试' });
    }

    // 解析测试配置
    let config;
    try {
        config = JSON.parse(submission.test_config || '{}');
    } catch (e) {
        config = {};
    }

    // 执行 DOM 结构检查测试
    const testResults = runDOMTests(submission.content || '', config);

    // 清除旧结果
    db.prepare('DELETE FROM auto_test_results WHERE submission_id = ?').run(submissionId);

    // 保存测试结果
    const insert = db.prepare(
        'INSERT INTO auto_test_results (submission_id, test_name, passed, message, expected, actual, duration) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    let passedCount = 0;
    const transaction = db.transaction(() => {
        for (const result of testResults) {
            insert.run(
                submissionId,
                result.name,
                result.passed ? 1 : 0,
                result.message,
                result.expected || '',
                result.actual || '',
                result.duration || 0
            );
            if (result.passed) passedCount++;
        }
    });
    transaction();

    // 计算自动化测试分数
    const totalTests = testResults.length;
    const autoScore = totalTests > 0 ? Math.round((passedCount / totalTests) * submission.max_score) : 0;

    db.prepare('UPDATE homework_submissions SET auto_test_result = ?, auto_test_score = ? WHERE id = ?')
        .run(JSON.stringify({ total: totalTests, passed: passedCount }), autoScore, submissionId);

    res.json({
        success: true,
        results: testResults,
        score: autoScore,
        passed: passedCount,
        total: totalTests
    });
});

// 获取测试结果
router.get('/submission/:id/test-results', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.id);

    const results = db.prepare(
        'SELECT * FROM auto_test_results WHERE submission_id = ? ORDER BY id ASC'
    ).all(submissionId);

    res.json({ results });
});

// ==================== 互评系统（Peer Review）====================

// 启动互评分配（教师操作）
router.post('/homework/:id/start-peer-review', (req, res) => {
    const db = getDb();
    const homeworkId = parseInt(req.params.id);
    const user = req.user;
    const { checklist } = req.body; // 评分检查清单

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以启动互评' });
    }

    const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(homeworkId);
    if (!hw) return res.status(404).json({ error: '作业不存在' });

    // 获取所有已提交的作业
    const submissions = db.prepare(
        'SELECT id, student_id FROM homework_submissions WHERE homework_id = ? AND status IN (?, ?)'
    ).all(homeworkId, 'submitted', 'graded');

    if (submissions.length < 3) {
        return res.status(400).json({ error: '提交人数不足3人，无法启动互评' });
    }

    // 清除旧分配
    db.prepare('DELETE FROM peer_review_assignments WHERE homework_id = ?').run(homeworkId);

    // 随机分配：每人评审 N 份（默认3份），姓名隐去由前端处理
    const reviewCount = Math.min(hw.peer_review_count || 3, submissions.length - 1);
    const assignments = [];

    for (const submission of submissions) {
        // 随机选择其他学生作为评审者（排除自己）
        const others = submissions.filter(s => s.student_id !== submission.student_id);
        const shuffled = others.sort(() => Math.random() - 0.5).slice(0, reviewCount);

        for (const reviewer of shuffled) {
            assignments.push({
                homeworkId,
                reviewerId: reviewer.student_id,
                submissionId: submission.id
            });
        }
    }

    // 批量插入分配
    const insert = db.prepare(
        'INSERT INTO peer_review_assignments (homework_id, reviewer_id, submission_id) VALUES (?, ?, ?)'
    );

    const transaction = db.transaction(() => {
        for (const a of assignments) {
            insert.run(a.homeworkId, a.reviewerId, a.submissionId);
        }
    });
    transaction();

    // 更新作业配置
    db.prepare('UPDATE homework SET peer_review_enabled = 1 WHERE id = ?').run(homeworkId);

    res.json({ success: true, totalAssignments: assignments.length });
});

// 获取我需要互评的作业列表
router.get('/peer-reviews/my', (req, res) => {
    const db = getDb();
    const user = req.user;

    const reviews = db.prepare(`
        SELECT pra.*, h.title as homework_title, h.max_score,
            hs.content as submission_content, c.name as class_name
        FROM peer_review_assignments pra
        JOIN homework_submissions hs ON pra.submission_id = hs.id
        JOIN homework h ON pra.homework_id = h.id
        JOIN classes c ON h.class_id = c.id
        WHERE pra.reviewer_id = ?
        ORDER BY pra.status ASC, h.due_date ASC
    `).all(user.id);

    res.json({ reviews });
});

// 提交互评结果
router.post('/peer-reviews/:id/submit', (req, res) => {
    const db = getDb();
    const assignmentId = parseInt(req.params.id);
    const user = req.user;
    const { score, feedback, checklistResults } = req.body;

    const assignment = db.prepare('SELECT * FROM peer_review_assignments WHERE id = ?').get(assignmentId);
    if (!assignment) return res.status(404).json({ error: '互评任务不存在' });
    if (assignment.reviewer_id !== user.id) {
        return res.status(403).json({ error: '该任务不属于你' });
    }

    if (score === undefined || score === null) {
        return res.status(400).json({ error: '请给出评分' });
    }

    db.prepare(`
        UPDATE peer_review_assignments 
        SET score = ?, feedback = ?, checklist_results = ?, status = 'completed', reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        parseInt(score),
        feedback || '',
        JSON.stringify(checklistResults || []),
        assignmentId
    );

    // 检查该提交的所有互评是否完成，如果完成则计算平均分
    const allReviews = db.prepare(
        'SELECT score FROM peer_review_assignments WHERE submission_id = ? AND status = ?'
    ).all(assignment.submission_id, 'completed');

    if (allReviews.length >= 2) {
        const avgScore = Math.round(allReviews.reduce((sum, r) => sum + r.score, 0) / allReviews.length);
        db.prepare('UPDATE homework_submissions SET peer_avg_score = ? WHERE id = ?')
            .run(avgScore, assignment.submission_id);

        // 计算最终加权分数
        calculateFinalScore(db, assignment.submission_id);
    }

    res.json({ success: true });
});

// 学生自评
router.post('/submission/:id/self-review', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.id);
    const user = req.user;
    const { score } = req.body;

    const submission = db.prepare('SELECT * FROM homework_submissions WHERE id = ?').get(submissionId);
    if (!submission) return res.status(404).json({ error: '提交记录不存在' });
    if (submission.student_id !== user.id) {
        return res.status(403).json({ error: '只能对自己的作业自评' });
    }

    db.prepare('UPDATE homework_submissions SET self_score = ? WHERE id = ?')
        .run(parseInt(score), submissionId);

    calculateFinalScore(db, submissionId);

    res.json({ success: true });
});

// 获取互评详情（教师可看全部，学生只看自己收到的评价）
router.get('/submission/:id/peer-reviews', (req, res) => {
    const db = getDb();
    const submissionId = parseInt(req.params.id);
    const user = req.user;

    const submission = db.prepare('SELECT * FROM homework_submissions WHERE id = ?').get(submissionId);
    if (!submission) return res.status(404).json({ error: '不存在' });

    // 教师可以看到评审者姓名
    if (user.role === 'teacher' || user.role === 'admin') {
        const reviews = db.prepare(`
            SELECT pra.*, u.username as reviewer_name
            FROM peer_review_assignments pra
            JOIN users u ON pra.reviewer_id = u.id
            WHERE pra.submission_id = ?
        `).all(submissionId);
        return res.json({ reviews, anonymous: false });
    }

    // 学生只能看匿名评价（且只能看自己的）
    if (submission.student_id !== user.id) {
        return res.status(403).json({ error: '无权查看' });
    }

    const reviews = db.prepare(`
        SELECT pra.score, pra.feedback, pra.checklist_results, pra.reviewed_at
        FROM peer_review_assignments pra
        WHERE pra.submission_id = ? AND pra.status = 'completed'
    `).all(submissionId);

    res.json({ reviews, anonymous: true });
});

// ==================== 智能语法检测 ====================

// 对代码执行语法检测
router.post('/lint', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { code, fileType, submissionId, projectId } = req.body;

    if (!code) {
        return res.status(400).json({ error: '请提供代码' });
    }

    const type = fileType || 'html';
    const result = lintCode(code, type);

    // 保存检测结果
    db.prepare(
        'INSERT INTO lint_reports (submission_id, user_id, project_id, file_type, errors, warnings, error_count, warning_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
        submissionId || null,
        user.id,
        projectId || null,
        type,
        JSON.stringify(result.errors),
        JSON.stringify(result.warnings),
        result.errors.length,
        result.warnings.length
    );

    res.json({
        errors: result.errors,
        warnings: result.warnings,
        microLessons: result.microLessons
    });
});

// ==================== 辅助函数 ====================

// 计算最终加权分数
function calculateFinalScore(db, submissionId) {
    const submission = db.prepare(`
        SELECT hs.*, h.score_weights, h.max_score
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        WHERE hs.id = ?
    `).get(submissionId);

    if (!submission) return;

    let weights;
    try {
        weights = JSON.parse(submission.score_weights || '{"teacher":0.6,"peer":0.3,"self":0.1}');
    } catch (e) {
        weights = { teacher: 0.6, peer: 0.3, self: 0.1 };
    }

    const teacherScore = submission.score; // 师评分
    const peerScore = submission.peer_avg_score; // 互评平均分
    const selfScore = submission.self_score; // 自评分

    // 只有全部评分都存在时才计算最终分
    if (teacherScore !== null && peerScore !== null && selfScore !== null) {
        const finalScore = Math.round(
            teacherScore * weights.teacher +
            peerScore * weights.peer +
            selfScore * weights.self
        );
        db.prepare('UPDATE homework_submissions SET final_score = ? WHERE id = ?')
            .run(finalScore, submissionId);
    }
}

// DOM 结构检查测试引擎
function runDOMTests(htmlContent, config) {
    const results = [];
    const tests = config.tests || [];

    if (tests.length === 0 && config.requiredElements) {
        // 简易模式：检查必需元素
        for (const elem of config.requiredElements) {
            const regex = new RegExp(`<${elem.tag}[^>]*>`, 'i');
            const found = regex.test(htmlContent);
            results.push({
                name: `包含 <${elem.tag}> 元素`,
                passed: found,
                message: found ? '通过' : `缺少 <${elem.tag}> 元素`,
                expected: `存在 <${elem.tag}>`,
                actual: found ? '找到' : '未找到'
            });
        }
    }

    for (const test of tests) {
        const startTime = Date.now();
        let passed = false;
        let message = '';
        let actual = '';

        switch (test.type) {
            case 'element_exists': {
                const regex = new RegExp(`<${test.selector}[^>]*>`, 'gi');
                const matches = htmlContent.match(regex);
                const count = matches ? matches.length : 0;
                passed = count >= (test.minCount || 1);
                actual = `找到 ${count} 个`;
                message = passed ? '通过' : `期望至少 ${test.minCount || 1} 个 <${test.selector}>，实际找到 ${count} 个`;
                break;
            }
            case 'attribute_exists': {
                const regex = new RegExp(`<${test.element}[^>]*${test.attribute}\\s*=`, 'i');
                passed = regex.test(htmlContent);
                actual = passed ? '存在' : '不存在';
                message = passed ? '通过' : `<${test.element}> 缺少 ${test.attribute} 属性`;
                break;
            }
            case 'text_contains': {
                passed = htmlContent.includes(test.text);
                actual = passed ? '包含' : '不包含';
                message = passed ? '通过' : `页面中未找到文本: "${test.text}"`;
                break;
            }
            case 'css_property': {
                const regex = new RegExp(`${test.property}\\s*:\\s*${test.value}`, 'i');
                passed = regex.test(htmlContent);
                actual = passed ? '匹配' : '不匹配';
                message = passed ? '通过' : `未找到 CSS 属性 ${test.property}: ${test.value}`;
                break;
            }
            case 'js_function': {
                const regex = new RegExp(`function\\s+${test.name}|const\\s+${test.name}\\s*=|let\\s+${test.name}\\s*=|var\\s+${test.name}\\s*=`, 'i');
                passed = regex.test(htmlContent);
                actual = passed ? '存在' : '不存在';
                message = passed ? '通过' : `未找到函数/变量 "${test.name}"`;
                break;
            }
            case 'no_inline_style': {
                const regex = /style\s*=\s*"/gi;
                const matches = htmlContent.match(regex);
                const count = matches ? matches.length : 0;
                passed = count <= (test.maxAllowed || 0);
                actual = `${count} 个内联样式`;
                message = passed ? '通过' : `发现 ${count} 个内联样式，超过允许的 ${test.maxAllowed || 0} 个`;
                break;
            }
            case 'semantic_html': {
                const semanticTags = ['header', 'nav', 'main', 'footer', 'article', 'section', 'aside'];
                const found = semanticTags.filter(tag => new RegExp(`<${tag}[\\s>]`, 'i').test(htmlContent));
                passed = found.length >= (test.minCount || 2);
                actual = `使用了 ${found.length} 个语义标签: ${found.join(', ')}`;
                message = passed ? '通过' : `期望至少使用 ${test.minCount || 2} 个语义HTML标签`;
                break;
            }
            default:
                message = `未知测试类型: ${test.type}`;
        }

        results.push({
            name: test.name || test.type,
            passed,
            message,
            expected: test.expected || '',
            actual,
            duration: Date.now() - startTime
        });
    }

    return results;
}

// 简易语法检测引擎
function lintCode(code, fileType) {
    const errors = [];
    const warnings = [];
    const microLessons = [];

    if (fileType === 'html') {
        // 检测未闭合标签
        const selfClosing = ['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr'];
        const openTags = [];
        const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g;
        let match;
        let lineNum = 1;
        const lines = code.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineTagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g;
            let m;
            while ((m = lineTagRegex.exec(line)) !== null) {
                const tag = m[1].toLowerCase();
                if (selfClosing.includes(tag)) continue;
                if (m[0].startsWith('</')) {
                    if (openTags.length > 0 && openTags[openTags.length - 1].tag === tag) {
                        openTags.pop();
                    }
                } else if (!m[0].endsWith('/>')) {
                    openTags.push({ tag, line: i + 1 });
                }
            }
        }

        for (const unclosed of openTags) {
            errors.push({
                line: unclosed.line,
                message: `标签 <${unclosed.tag}> 未闭合`,
                rule: 'tag-not-closed',
                severity: 'error'
            });
            microLessons.push({
                rule: 'tag-not-closed',
                title: 'HTML 标签闭合',
                link: '/docs#html-tags',
                description: `每个非自闭合标签都需要对应的 </${unclosed.tag}> 闭合标签`
            });
        }

        // 检测缺少 DOCTYPE
        if (!code.trim().toLowerCase().startsWith('<!doctype')) {
            warnings.push({
                line: 1,
                message: '缺少 <!DOCTYPE html> 声明',
                rule: 'missing-doctype',
                severity: 'warning'
            });
        }

        // 检测缺少 meta viewport
        if (!/<meta[^>]*viewport/i.test(code)) {
            warnings.push({
                line: 1,
                message: '缺少 viewport meta 标签，移动端可能显示异常',
                rule: 'missing-viewport',
                severity: 'warning'
            });
            microLessons.push({
                rule: 'missing-viewport',
                title: '响应式设计基础',
                link: '/docs#responsive',
                description: '添加 <meta name="viewport" content="width=device-width, initial-scale=1.0"> 确保移动端适配'
            });
        }

        // 检测 img 缺少 alt
        const imgWithoutAlt = code.match(/<img(?![^>]*alt\s*=)[^>]*>/gi);
        if (imgWithoutAlt) {
            warnings.push({
                line: 0,
                message: `${imgWithoutAlt.length} 个 <img> 标签缺少 alt 属性`,
                rule: 'img-alt',
                severity: 'warning'
            });
        }
    }

    if (fileType === 'css') {
        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // 检测缺少分号
            if (line && !line.startsWith('/*') && !line.startsWith('//') &&
                !line.endsWith('{') && !line.endsWith('}') && !line.endsWith(',') &&
                !line.endsWith(';') && line.includes(':') && !line.startsWith('@')) {
                errors.push({
                    line: i + 1,
                    message: 'CSS 属性值末尾缺少分号',
                    rule: 'missing-semicolon',
                    severity: 'error'
                });
                microLessons.push({
                    rule: 'missing-semicolon',
                    title: 'CSS 语法基础',
                    link: '/docs#css-syntax',
                    description: 'CSS 每条属性声明必须以分号 ; 结尾'
                });
            }
        }

        // 检测 !important 过度使用
        const importantCount = (code.match(/!important/gi) || []).length;
        if (importantCount > 3) {
            warnings.push({
                line: 0,
                message: `使用了 ${importantCount} 次 !important，建议优化选择器优先级`,
                rule: 'too-many-important',
                severity: 'warning'
            });
        }
    }

    if (fileType === 'javascript' || fileType === 'js') {
        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // 检测 var 使用
            if (/\bvar\s+/.test(line)) {
                warnings.push({
                    line: i + 1,
                    message: '建议使用 let/const 替代 var',
                    rule: 'no-var',
                    severity: 'warning'
                });
            }

            // 检测 == 而非 ===
            if (/[^!=]==(?!=)/.test(line) && !/===/.test(line)) {
                warnings.push({
                    line: i + 1,
                    message: '建议使用 === 严格相等替代 ==',
                    rule: 'eqeqeq',
                    severity: 'warning'
                });
            }

            // 检测 console.log 残留
            if (/console\.(log|warn|error)/.test(line)) {
                warnings.push({
                    line: i + 1,
                    message: '提交代码中残留 console 调试语句',
                    rule: 'no-console',
                    severity: 'warning'
                });
            }
        }

        // 检测未使用 addEventListener 而是用内联事件
        if (/on(click|change|submit|load|keydown|keyup)\s*=/i.test(code)) {
            warnings.push({
                line: 0,
                message: '建议使用 addEventListener 替代内联事件处理',
                rule: 'no-inline-handler',
                severity: 'warning'
            });
            microLessons.push({
                rule: 'no-inline-handler',
                title: '事件绑定最佳实践',
                link: '/docs#events',
                description: '使用 element.addEventListener() 而非 onclick="" 可提升代码可维护性'
            });
        }
    }

    return { errors, warnings, microLessons };
}

module.exports = router;
