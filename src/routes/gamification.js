/**
 * 教学积分（金币）银行 + 积分消费闭环
 * - 金币任务系统（每日签到、连续提交、帮助他人等）
 * - 积分商店（迟交券、重做卡、彩虹边框、主题色等）
 * - 道具使用逻辑
 */
const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ==================== 金币查询 ====================

// 获取我的金币和等级信息
router.get('/my-coins', (req, res) => {
    const db = getDb();
    const user = req.user;

    const info = db.prepare('SELECT coins, level FROM users WHERE id = ?').get(user.id);
    const items = db.prepare(`
        SELECT ui.*, ci.name, ci.description, ci.icon, ci.type AS category, ci.slug, ci.effect
        FROM user_items ui
        JOIN coin_items ci ON ui.item_id = ci.id
        WHERE ui.user_id = ? AND ui.quantity > 0
    `).all(user.id);

    res.json({
        coins: info ? info.coins : 0,
        level: info ? info.level : 1,
        items
    });
});

// ==================== 金币商店 ====================

// 获取商店物品列表
router.get('/shop', (req, res) => {
    const db = getDb();
    const items = db.prepare('SELECT * FROM coin_items WHERE is_active = 1 ORDER BY type, price ASC').all();
    res.json({ items });
});

// 购买物品
router.post('/shop/buy', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { itemId, quantity } = req.body;
    const qty = parseInt(quantity) || 1;

    const item = db.prepare('SELECT * FROM coin_items WHERE id = ? AND is_active = 1').get(parseInt(itemId));
    if (!item) return res.status(404).json({ error: '物品不存在或已下架' });

    const totalCost = item.price * qty;
    const userInfo = db.prepare('SELECT coins FROM users WHERE id = ?').get(user.id);

    if (userInfo.coins < totalCost) {
        return res.status(400).json({ error: '金币不足', need: totalCost, have: userInfo.coins });
    }

    // 扣除金币
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(totalCost, user.id);

    // 添加或增加物品
    const existing = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_id = ?').get(user.id, item.id);
    if (existing) {
        db.prepare('UPDATE user_items SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
    } else {
        db.prepare('INSERT INTO user_items (user_id, item_id, quantity) VALUES (?, ?, ?)').run(user.id, item.id, qty);
    }

    res.json({ success: true, spent: totalCost, remaining: userInfo.coins - totalCost });
});

// ==================== 道具使用 ====================

// 使用道具
router.post('/items/use', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { itemId, targetId, context } = req.body;
    // targetId: 作业/提交 ID (可选)
    // context: 使用场景 (可选)

    const userItem = db.prepare(`
        SELECT ui.*, ci.slug, ci.type, ci.effect, ci.name
        FROM user_items ui
        JOIN coin_items ci ON ui.item_id = ci.id
        WHERE ui.user_id = ? AND ui.item_id = ? AND ui.quantity > 0
    `).get(user.id, parseInt(itemId));

    if (!userItem) {
        return res.status(400).json({ error: '你没有该道具或已用完' });
    }

    // 解析道具效果（存储为 JSON）
    let effect = {};
    try { effect = JSON.parse(userItem.effect || '{}'); } catch (e) { effect = {}; }

    // 根据道具效果执行
    let effectResult = {};

    if (effect.extend_days) {
        // 迟交券：允许该作业个人延期 N 天提交（不影响全局截止时间）
        if (!targetId) return res.status(400).json({ error: '请指定作业ID' });
        const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(parseInt(targetId));
        if (!hw) return res.status(404).json({ error: '作业不存在' });
        const baseDue = hw.due_date ? new Date(hw.due_date).getTime() : Date.now();
        const newDue = new Date(baseDue + effect.extend_days * 24 * 60 * 60 * 1000).toISOString();
        try { db.prepare('ALTER TABLE homework_submissions ADD COLUMN personal_due_date TEXT').run(); } catch (e) { /* 列已存在 */ }
        // 若尚无提交记录则插入占位，确保延期生效
        const sub = db.prepare('SELECT id FROM homework_submissions WHERE homework_id = ? AND student_id = ?')
            .get(parseInt(targetId), user.id);
        if (sub) {
            db.prepare('UPDATE homework_submissions SET personal_due_date = ? WHERE homework_id = ? AND student_id = ?')
                .run(newDue, parseInt(targetId), user.id);
        } else {
            db.prepare('INSERT INTO homework_submissions (homework_id, student_id, status, personal_due_date) VALUES (?, ?, ?, ?)')
                .run(parseInt(targetId), user.id, 'draft', newDue);
        }
        effectResult = { newDueDate: newDue };
    } else if (effect.allow_redo) {
        // 重做卡：重置提交状态允许重新提交
        if (!targetId) return res.status(400).json({ error: '请指定提交ID' });
        const info = db.prepare(`
            UPDATE homework_submissions SET status = 'draft', score = NULL
            WHERE id = ? AND student_id = ?
        `).run(parseInt(targetId), user.id);
        if (info.changes === 0) return res.status(404).json({ error: '提交不存在' });
        effectResult = { resetSubmission: targetId };
    } else if (effect.hide_score) {
        // 隐匿分数：本次成绩不计入排行榜
        if (!targetId) return res.status(400).json({ error: '请指定提交ID' });
        try { db.prepare('ALTER TABLE homework_submissions ADD COLUMN hide_from_rank INTEGER DEFAULT 0').run(); } catch (e) { /* 列已存在 */ }
        const info = db.prepare('UPDATE homework_submissions SET hide_from_rank = 1 WHERE id = ? AND student_id = ?')
            .run(parseInt(targetId), user.id);
        if (info.changes === 0) return res.status(404).json({ error: '提交不存在' });
        effectResult = { hidden: true };
    } else if (effect.border || effect.theme || effect.badge) {
        // 装饰类道具：存到用户的活跃装饰列表
        try { db.prepare('ALTER TABLE users ADD COLUMN active_cosmetics TEXT DEFAULT \'[]\'').run(); } catch (e) { /* 列已存在 */ }
        const cosmetics = JSON.parse(
            (db.prepare('SELECT active_cosmetics FROM users WHERE id = ?').get(user.id)).active_cosmetics || '[]'
        );
        const tag = effect.border ? ('border:' + effect.border)
            : effect.theme ? ('theme:' + effect.theme)
            : ('badge:' + effect.badge);
        if (!cosmetics.includes(tag)) {
            cosmetics.push(tag);
            db.prepare('UPDATE users SET active_cosmetics = ? WHERE id = ?').run(JSON.stringify(cosmetics), user.id);
        }
        effectResult = { equipped: tag };
    } else {
        return res.status(400).json({ error: '该道具暂无可用效果' });
    }

    // 扣除道具数量
    db.prepare('UPDATE user_items SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?')
        .run(user.id, parseInt(itemId));

    res.json({ success: true, effect: effectResult });
});

// ==================== 任务系统 ====================

// 获取任务列表和进度
router.get('/missions', (req, res) => {
    const db = getDb();
    const user = req.user;

    const missions = db.prepare('SELECT * FROM coin_missions WHERE is_active = 1 ORDER BY sort_order ASC').all();

    // 获取用户的任务进度
    const progress = db.prepare('SELECT * FROM user_mission_progress WHERE user_id = ?').all(user.id);
    const progressMap = {};
    for (const p of progress) {
        progressMap[p.mission_id] = p;
    }

    const result = missions.map(m => ({
        ...m,
        progress: progressMap[m.id] ? progressMap[m.id].progress : 0,
        completed: progressMap[m.id] ? !!progressMap[m.id].completed : false,
        claimed: progressMap[m.id] ? !!progressMap[m.id].claimed : false,
        lastUpdated: progressMap[m.id] ? progressMap[m.id].last_updated : null
    }));

    res.json({ missions: result });
});

// 领取任务奖励
router.post('/missions/:id/claim', (req, res) => {
    const db = getDb();
    const missionId = parseInt(req.params.id);
    const user = req.user;

    const mission = db.prepare('SELECT * FROM coin_missions WHERE id = ?').get(missionId);
    if (!mission) return res.status(404).json({ error: '任务不存在' });

    const progress = db.prepare(
        'SELECT * FROM user_mission_progress WHERE user_id = ? AND mission_id = ?'
    ).get(user.id, missionId);

    if (!progress || progress.progress < mission.condition_value) {
        return res.status(400).json({ error: '任务未完成' });
    }
    if (progress.claimed) {
        return res.status(400).json({ error: '奖励已领取' });
    }

    // 发放金币
    db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(mission.reward, user.id);
    db.prepare('UPDATE user_mission_progress SET claimed = 1, last_updated = CURRENT_TIMESTAMP WHERE user_id = ? AND mission_id = ?')
        .run(user.id, missionId);

    // 检查是否升级
    const userInfo = db.prepare('SELECT coins, level FROM users WHERE id = ?').get(user.id);
    const newLevel = Math.floor(userInfo.coins / 100) + 1;
    if (newLevel > userInfo.level) {
        db.prepare('UPDATE users SET level = ? WHERE id = ?').run(newLevel, user.id);
    }

    res.json({ success: true, rewardCoins: mission.reward, totalCoins: userInfo.coins });
});

// 触发任务进度更新（内部调用，由其他路由触发）
router.post('/missions/trigger', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { event, value } = req.body;
    // events: 'login', 'submit_homework', 'help_others', 'peer_review', 'attendance', 'deploy'

    if (!event) return res.status(400).json({ error: '缺少事件类型' });

    // 查找匹配的任务（按条件类型匹配）
    const missions = db.prepare(
        'SELECT * FROM coin_missions WHERE condition_type = ? AND is_active = 1'
    ).all(event);

    const updated = [];
    for (const mission of missions) {
        const existing = db.prepare(
            'SELECT * FROM user_mission_progress WHERE user_id = ? AND mission_id = ?'
        ).get(user.id, mission.id);

        const inc = parseInt(value) || 1;
        let newProgress;
        if (!existing) {
            newProgress = inc;
            db.prepare(
                'INSERT INTO user_mission_progress (user_id, mission_id, progress) VALUES (?, ?, ?)'
            ).run(user.id, mission.id, newProgress);
        } else if (!existing.claimed) {
            // 对于 daily 类任务，检查今天是否已记录
            if (mission.type === 'daily') {
                const today = new Date().toISOString().slice(0, 10);
                const lastUpdate = existing.last_updated ? existing.last_updated.slice(0, 10) : '';
                if (lastUpdate === today) continue;
            }
            newProgress = existing.progress + inc;
            db.prepare(
                'UPDATE user_mission_progress SET progress = ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ? AND mission_id = ?'
            ).run(newProgress, user.id, mission.id);
        } else {
            continue;
        }

        // 达成条件时标记完成
        if (newProgress >= mission.condition_value) {
            db.prepare('UPDATE user_mission_progress SET completed = 1 WHERE user_id = ? AND mission_id = ?')
                .run(user.id, mission.id);
        }
        updated.push(mission.id);
    }

    res.json({ success: true, triggeredMissions: updated });
});

// ==================== 排行榜 ====================

// 金币排行榜
router.get('/leaderboard', (req, res) => {
    const db = getDb();
    const { classId, limit } = req.query;

    let query;
    let params;

    if (classId) {
        query = `
            SELECT u.id, u.username, u.avatar, u.coins, u.level
            FROM users u
            JOIN class_members cm ON cm.user_id = u.id
            WHERE cm.class_id = ? AND cm.role = 'student'
            ORDER BY u.coins DESC
            LIMIT ?
        `;
        params = [parseInt(classId), parseInt(limit) || 20];
    } else {
        query = `
            SELECT id, username, avatar, coins, level
            FROM users
            WHERE role IN ('user', 'student')
            ORDER BY coins DESC
            LIMIT ?
        `;
        params = [parseInt(limit) || 20];
    }

    const leaderboard = db.prepare(query).all(...params);
    res.json({ leaderboard });
});

// ==================== 教师奖励金币（手动） ====================

router.post('/award', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { targetUserId, amount, reason } = req.body;

    if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: '只有教师可以奖励金币' });
    }

    if (!targetUserId || !amount || parseInt(amount) <= 0) {
        return res.status(400).json({ error: '请指定学生和金币数量' });
    }

    db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(parseInt(amount), parseInt(targetUserId));

    res.json({ success: true, awarded: parseInt(amount), to: parseInt(targetUserId), reason: reason || '' });
});

module.exports = router;
