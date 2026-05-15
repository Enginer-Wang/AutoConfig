/**
 * WebSocket 实时通讯层
 * - 房间消息推送
 * - 在线状态
 * - 活动实时通知（抢答/签到）
 * - 打赏动效广播
 */
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { getDb } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'autoconfig-secret-key-2024';

// userId -> Set<WebSocket>
const clients = new Map();
// roomId -> Set<userId>
const roomSubscriptions = new Map();

function initWebSocket(server) {
    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws, req) => {
        let userId = null;

        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

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

function handleMessage(ws, msg, getUserId, setUserId) {
    switch (msg.type) {
        case 'auth': {
            // 鉴权: { type: 'auth', token: '...' }
            try {
                const decoded = jwt.verify(msg.token, JWT_SECRET);
                const userId = decoded.userId || decoded.id;
                setUserId(userId);

                if (!clients.has(userId)) clients.set(userId, new Set());
                clients.get(userId).add(ws);

                // 自动订阅用户的所有房间
                const db = getDb();
                const rooms = db.prepare('SELECT room_id FROM chat_room_members WHERE user_id = ?').all(userId);
                rooms.forEach(r => {
                    if (!roomSubscriptions.has(r.room_id)) roomSubscriptions.set(r.room_id, new Set());
                    roomSubscriptions.get(r.room_id).add(userId);
                });

                ws.send(JSON.stringify({ type: 'auth_ok', userId }));
                broadcastPresence(userId, true);
            } catch (e) {
                ws.send(JSON.stringify({ type: 'auth_fail', message: '鉴权失败' }));
            }
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

module.exports = {
    initWebSocket,
    broadcastToRoom,
    sendToUser,
    notifyNewMessage,
    notifyActivity,
    notifyTip,
    notifyCelebration
};
