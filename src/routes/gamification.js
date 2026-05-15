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
        SELECT ui.*, ci.name, ci.description, ci.icon, ci.category
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
    const items = db.prepare('SELECT * FROM coin_items WHERE is_active = 1 ORDER BY category, price ASC').all();
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
        SELECT ui.*, ci.category, ci.effect_type, ci.effect_value
        FROM user_items ui
        JOIN coin_items ci ON ui.item_id = ci.id
        WHERE ui.user_id = ? AND ui.item_id = ? AND ui.quantity > 0
    `).get(user.id, parseInt(itemId));

    if (!userItem) {
        return res.status(400).json({ error: '你没有该道具或已用完' });
    }

    // 根据道具类型执行效果
    let effectResult = {};

    switch (userItem.effect_type) {
        case 'late_pass': {
            // 迟交券：允许该作业延迟48小时提交
            if (!targetId) return res.status(400).json({ error: '请指定作业ID' });
            const hw = db.prepare('SELECT * FROM homework WHERE id = ?').get(parseInt(targetId));
            if (!hw) return res.status(404).json({ error: '作业不存在' });
            
            // 记录延期
            const newDue = new Date(new Date(hw.due_date).getTime() + 48 * 60 * 60 * 1000).toISOString();
            // 存个人延期记录（不影响全局截止时间）
            try {
                db.prepare('ALTER TABLE homework_submissions ADD COLUMN personal_due_date TEXT').run();
            } catch (e) { /* 列已存在 */ }
            db.prepare(`
                UPDATE homework_submissions SET personal_due_date = ? 
                WHERE homework_id = ? AND student_id = ?
            `).run(newDue, parseInt(targetId), user.id);
            effectResult = { newDueDate: newDue };
            break;
        }
        case 'redo_card': {
            // 重做卡：重置提交状态允许重新提交
            if (!targetId) return res.status(400).json({ error: '请指定提交ID' });
            db.prepare(`
                UPDATE homework_submissions SET status = 'draft', score = NULL, final_score = NULL
                WHERE id = ? AND student_id = ?
            `).run(parseInt(targetId), user.id);
            effectResult = { resetSubmission: targetId };
            break;
        }
        case 'cosmetic': {
            // 装饰类道具：存到用户的活跃装饰列表
            try {
                db.prepare('ALTER TABLE users ADD COLUMN active_cosmetics TEXT DEFAULT \'[]\'').run();
            } catch (e) { /* 列已存在 */ }
            const cosmetics = JSON.parse(
                (db.prepare('SELECT active_cosmetics FROM users WHERE id = ?').get(user.id)).active_cosmetics || '[]'
            );
            if (!cosmetics.includes(userItem.effect_value)) {
                cosmetics.push(userItem.effect_value);
                db.prepare('UPDATE users SET active_cosmetics = ? WHERE id = ?').run(JSON.stringify(cosmetics), user.id);
            }
            effectResult = { equipped: userItem.effect_value };
            break;
        }
        case 'hide_score': {
            // 隐匿分数：本次成绩不计入排行榜
            if (!targetId) return res.status(400).json({ error: '请指定提交ID' });
            try {
                db.prepare('ALTER TABLE homework_submissions ADD COLUMN hide_from_rank INTEGER DEFAULT 0').run();
            } catch (e) { /* 列已存在 */ }
            db.prepare('UPDATE homework_submissions SET hide_from_rank = 1 WHERE id = ? AND student_id = ?')
                .run(parseInt(targetId), user.id);
            effectResult = { hidden: true };
            break;
        }
        default:
            return res.status(400).json({ error: '未知道具类型' });
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
        progress: progressMap[m.id] ? progressMap[m.id].current_progress : 0,
        claimed: progressMap[m.id] ? !!progressMap[m.id].claimed_at : false,
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

    if (!progress || progress.current_progress < mission.target_value) {
        return res.status(400).json({ error: '任务未完成' });
    }
    if (progress.claimed_at) {
        return res.status(400).json({ error: '奖励已领取' });
    }

    // 发放金币
    db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(mission.reward_coins, user.id);
    db.prepare('UPDATE user_mission_progress SET claimed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND mission_id = ?')
        .run(user.id, missionId);

    // 检查是否升级
    const userInfo = db.prepare('SELECT coins, level FROM users WHERE id = ?').get(user.id);
    const newLevel = Math.floor(userInfo.coins / 100) + 1;
    if (newLevel > userInfo.level) {
        db.prepare('UPDATE users SET level = ? WHERE id = ?').run(newLevel, user.id);
    }

    res.json({ success: true, rewardCoins: mission.reward_coins, totalCoins: userInfo.coins });
});

// 触发任务进度更新（内部调用，由其他路由触发）
router.post('/missions/trigger', (req, res) => {
    const db = getDb();
    const user = req.user;
    const { event, value } = req.body;
    // events: 'login', 'submit_homework', 'help_others', 'peer_review', 'attendance', 'deploy'

    if (!event) return res.status(400).json({ error: '缺少事件类型' });

    // 查找匹配的任务
    const missions = db.prepare(
        'SELECT * FROM coin_missions WHERE trigger_event = ? AND is_active = 1'
    ).all(event);

    const updated = [];
    for (const mission of missions) {
        const existing = db.prepare(
            'SELECT * FROM user_mission_progress WHERE user_id = ? AND mission_id = ?'
        ).get(user.id, mission.id);

        if (!existing) {
            db.prepare(
                'INSERT INTO user_mission_progress (user_id, mission_id, current_progress) VALUES (?, ?, ?)'
            ).run(user.id, mission.id, parseInt(value) || 1);
        } else if (!existing.claimed_at) {
            // 对于 daily 类任务，检查今天是否已记录
            if (mission.reset_period === 'daily') {
                const today = new Date().toISOString().slice(0, 10);
                const lastUpdate = existing.last_updated ? existing.last_updated.slice(0, 10) : '';
                if (lastUpdate === today) continue;
                db.prepare(
                    'UPDATE user_mission_progress SET current_progress = current_progress + ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ? AND mission_id = ?'
                ).run(parseInt(value) || 1, user.id, mission.id);
            } else {
                db.prepare(
                    'UPDATE user_mission_progress SET current_progress = current_progress + ?, last_updated = CURRENT_TIMESTAMP WHERE user_id = ? AND mission_id = ?'
                ).run(parseInt(value) || 1, user.id, mission.id);
            }
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
