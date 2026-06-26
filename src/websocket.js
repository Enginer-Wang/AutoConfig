/**
 * WebSocket 实时通讯层
 * - 房间消息推送
 * - 在线状态
 * - 活动实时通知（抢答/签到）
 * - 打赏动效广播
 */
const { WebSocketServer } = require('ws');
const { getDb } = require('./database');
// 复用签发端的 token 校验，确保密钥与 auth 中间件一致（避免密钥漂移导致 WS 鉴权失败）
const { verifyToken } = require('./middleware/auth');

// userId -> Set<WebSocket>
const clients = new Map();
// roomId -> Set<userId>
const roomSubscriptions = new Map();
// 直播课堂订阅: sessionId -> Map<userId, role>
const liveSubscriptions = new Map();

function initWebSocket(server) {
    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws, req) => {
        let userId = null;
        const setUserId = (id) => { userId = id; };

        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        // 自动鉴权：token 以 httpOnly cookie 形式随握手发送，前端 JS 无法读取，
        // 因此在服务端直接从握手 cookie 中解析并完成鉴权（修复实时巡课/聊天/WebRTC 全部失效）。
        const cookieToken = parseCookieToken(req.headers && req.headers.cookie);
        if (cookieToken) authenticateSocket(ws, cookieToken, setUserId);

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                handleMessage(ws, msg, () => userId, (id) => { userId = id; });
            } catch (e) {
                ws.send(JSON.stringify({ type: 'error', message: '无效消息格式' }));
            }
        });

        ws.on('close', () => {
            if (userId) {
                const userSockets = clients.get(userId);
                if (userSockets) {
                    userSockets.delete(ws);
                    if (userSockets.size === 0) {
                        clients.delete(userId);
                        broadcastPresence(userId, false);
                        // 从所有直播课堂订阅中移除并通知
                        liveSubscriptions.forEach((subs, sid) => {
                            if (subs.has(userId)) {
                                subs.delete(userId);
                                broadcastToLive(sid, { type: 'live_presence', sessionId: sid, userId, online: false }, userId);
                            }
                        });
                    }
                }
            }
        });
    });

    // 心跳检测
    const heartbeat = setInterval(() => {
        wss.clients.forEach(ws => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => clearInterval(heartbeat));

    console.log('  🔌 WebSocket 实时通讯已启动 (/ws)');
    return wss;
}

// 从握手 cookie 头中解析 token
function parseCookieToken(cookieHeader) {
    if (!cookieHeader) return null;
    const m = String(cookieHeader).match(/(?:^|;\s*)token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
}

// 校验 token 并完成 socket 注册、房间订阅、上线广播。成功返回 userId，失败返回 null。
function authenticateSocket(ws, token, setUserId) {
    if (!token) return null;
    const decoded = verifyToken(token);
    if (!decoded) return null;
    const userId = decoded.userId || decoded.id;
    if (!userId) return null;
    setUserId(userId);

    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(ws);

    // 自动订阅用户的所有房间
    try {
        const db = getDb();
        const rooms = db.prepare('SELECT room_id FROM chat_room_members WHERE user_id = ?').all(userId);
        rooms.forEach(r => {
            if (!roomSubscriptions.has(r.room_id)) roomSubscriptions.set(r.room_id, new Set());
            roomSubscriptions.get(r.room_id).add(userId);
        });
    } catch (e) { /* 房间订阅失败不影响鉴权 */ }

    ws.send(JSON.stringify({ type: 'auth_ok', userId }));
    broadcastPresence(userId, true);
    return userId;
}

function handleMessage(ws, msg, getUserId, setUserId) {
    switch (msg.type) {
        case 'auth': {
            // 鉴权: { type: 'auth', token: '...' }（兼容前端主动传 token 的场景）
            const uid = authenticateSocket(ws, msg.token, setUserId);
            if (!uid) ws.send(JSON.stringify({ type: 'auth_fail', message: '鉴权失败' }));
            break;
        }

        case 'join_room': {
            // 加入房间实时推送: { type: 'join_room', roomId: 1 }
            const userId = getUserId();
            if (!userId) return ws.send(JSON.stringify({ type: 'error', message: '未鉴权' }));

            const roomId = msg.roomId;
            if (!roomSubscriptions.has(roomId)) roomSubscriptions.set(roomId, new Set());
            roomSubscriptions.get(roomId).add(userId);
            break;
        }

        case 'leave_room': {
            const userId = getUserId();
            if (!userId) return;
            const roomId = msg.roomId;
            const subs = roomSubscriptions.get(roomId);
            if (subs) subs.delete(userId);
            break;
        }

        case 'typing': {
            // 打字状态: { type: 'typing', roomId: 1 }
            const userId = getUserId();
            if (!userId) return;
            broadcastToRoom(msg.roomId, {
                type: 'typing',
                roomId: msg.roomId,
                userId
            }, userId);
            break;
        }

        case 'live_subscribe': {
            // 加入直播课堂: { type:'live_subscribe', sessionId, role:'teacher'|'student' }
            const userId = getUserId();
            if (!userId) return ws.send(JSON.stringify({ type: 'error', message: '未鉴权' }));
            const sid = msg.sessionId;
            if (!liveSubscriptions.has(sid)) liveSubscriptions.set(sid, new Map());
            liveSubscriptions.get(sid).set(userId, msg.role === 'teacher' ? 'teacher' : 'student');
            // 通知教师该生上线 / 通知该生当前在线教师
            broadcastToLive(sid, { type: 'live_presence', sessionId: sid, userId, online: true }, userId);
            break;
        }

        case 'live_unsubscribe': {
            const userId = getUserId();
            if (!userId) return;
            const subs = liveSubscriptions.get(msg.sessionId);
            if (subs) {
                subs.delete(userId);
                broadcastToLive(msg.sessionId, { type: 'live_presence', sessionId: msg.sessionId, userId, online: false }, userId);
            }
            break;
        }

        case 'live_status': {
            // 学生上报巡课墙状态，仅推给教师: { type:'live_status', sessionId, status:{...} }
            const userId = getUserId();
            if (!userId) return;
            sendToLiveTeachers(msg.sessionId, {
                type: 'live_status',
                sessionId: msg.sessionId,
                userId,
                status: msg.status || {}
            });
            break;
        }

        case 'webrtc_signal': {
            // WebRTC 信令中继: { type:'webrtc_signal', sessionId, targetUserId, signal, kind }
            const userId = getUserId();
            if (!userId) return;
            sendToUser(msg.targetUserId, {
                type: 'webrtc_signal',
                sessionId: msg.sessionId,
                fromUserId: userId,
                kind: msg.kind,
                signal: msg.signal
            });
            break;
        }

        case 'takeover': {
            // 教师切换接管学生编辑器: { type:'takeover', sessionId, targetUserId, on }
            const userId = getUserId();
            if (!userId) return;
            sendToUser(msg.targetUserId, {
                type: 'takeover',
                sessionId: msg.sessionId,
                fromUserId: userId,
                on: !!msg.on
            });
            break;
        }

        case 'code_sync': {
            // 师生协同编辑器同步（代码/光标）中继: { type:'code_sync', sessionId, targetUserId, patch, cursor }
            const userId = getUserId();
            if (!userId) return;
            sendToUser(msg.targetUserId, {
                type: 'code_sync',
                sessionId: msg.sessionId,
                fromUserId: userId,
                patch: msg.patch,
                cursor: msg.cursor
            });
            break;
        }
    }
}

// 向房间内所有在线成员广播消息
function broadcastToRoom(roomId, payload, excludeUserId) {
    const subs = roomSubscriptions.get(roomId);
    if (!subs) return;

    const data = JSON.stringify(payload);
    subs.forEach(userId => {
        if (userId === excludeUserId) return;
        const userSockets = clients.get(userId);
        if (userSockets) {
            userSockets.forEach(ws => {
                if (ws.readyState === 1) ws.send(data);
            });
        }
    });
}

// 向指定用户发送消息
function sendToUser(userId, payload) {
    const userSockets = clients.get(userId);
    if (!userSockets) return;
    const data = JSON.stringify(payload);
    userSockets.forEach(ws => {
        if (ws.readyState === 1) ws.send(data);
    });
}

// 广播在线/离线状态
function broadcastPresence(userId, online) {
    const db = getDb();
    const rooms = db.prepare('SELECT room_id FROM chat_room_members WHERE user_id = ?').all(userId);
    rooms.forEach(r => {
        broadcastToRoom(r.room_id, {
            type: 'presence',
            userId,
            online
        }, userId);
    });
}

// 广播新消息到房间（供路由调用）
function notifyNewMessage(roomId, message) {
    broadcastToRoom(roomId, {
        type: 'new_message',
        roomId,
        message
    }, message.sender_id);
}

// 广播活动事件
function notifyActivity(roomId, activity) {
    broadcastToRoom(roomId, {
        type: 'activity',
        roomId,
        activity
    });
}

// 广播打赏动效
function notifyTip(roomId, tip) {
    broadcastToRoom(roomId, {
        type: 'tip',
        roomId,
        tip
    });
}

// 广播抢答结果（飘窗）
function notifyCelebration(roomId, data) {
    broadcastToRoom(roomId, {
        type: 'celebration',
        roomId,
        ...data
    });
}

// ==================== 直播课堂广播 ====================

// 向直播课堂内所有成员广播
function broadcastToLive(sessionId, payload, excludeUserId) {
    const subs = liveSubscriptions.get(sessionId);
    if (!subs) return;
    const data = JSON.stringify(payload);
    subs.forEach((role, userId) => {
        if (userId === excludeUserId) return;
        const userSockets = clients.get(userId);
        if (userSockets) userSockets.forEach(ws => { if (ws.readyState === 1) ws.send(data); });
    });
}

// 仅向直播课堂内的教师推送（巡课墙状态）
function sendToLiveTeachers(sessionId, payload) {
    const subs = liveSubscriptions.get(sessionId);
    if (!subs) return;
    const data = JSON.stringify(payload);
    subs.forEach((role, userId) => {
        if (role !== 'teacher') return;
        const userSockets = clients.get(userId);
        if (userSockets) userSockets.forEach(ws => { if (ws.readyState === 1) ws.send(data); });
    });
}

// 供路由调用：直播课堂事件广播（求助、开课、结课等）
function notifyLive(sessionId, payload) {
    broadcastToLive(sessionId, { sessionId, ...payload });
}

// ==================== 课堂互动聊天室广播 ====================

// 向聊天室房间广播（默认包含发送者，便于多端同步）
function notifyChat(roomId, payload, excludeUserId) {
    const subs = roomSubscriptions.get(roomId);
    if (!subs) return;
    const data = JSON.stringify(payload);
    subs.forEach(userId => {
        if (excludeUserId != null && userId === excludeUserId) return;
        const userSockets = clients.get(userId);
        if (userSockets) userSockets.forEach(ws => { if (ws.readyState === 1) ws.send(data); });
    });
}

module.exports = {
    initWebSocket,
    broadcastToRoom,
    sendToUser,
    notifyNewMessage,
    notifyActivity,
    notifyTip,
    notifyCelebration,
    notifyLive,
    notifyChat
};
