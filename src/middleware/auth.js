/**
 * JWT 认证中间件
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'autoconfig-secret-key-2026';
const JWT_EXPIRES = '7d';

function generateToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, email: user.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
}

function authMiddleware(req, res, next) {
    // 从 cookie 或 header 获取 token
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ error: '请先登录' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
    }

    // 获取用户最新角色信息
    const { getDb } = require('../database');
    const db = getDb();
    const user = db.prepare('SELECT id, username, email, role, coins FROM users WHERE id = ?').get(decoded.id);
    if (!user) {
        return res.status(401).json({ error: '用户不存在' });
    }

    req.user = user;
    next();
}

function optionalAuth(req, res, next) {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (token) {
        const decoded = verifyToken(token);
        if (decoded) {
            const { getDb } = require('../database');
            const db = getDb();
            const user = db.prepare('SELECT id, username, email, role, coins FROM users WHERE id = ?').get(decoded.id);
            if (user) req.user = user;
            else req.user = decoded;
        }
    }
    next();
}

function adminMiddleware(req, res, next) {
    // 必须先经过 authMiddleware
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: '请先登录' });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
    }

    // 获取用户信息
    const { getDb } = require('../database');
    const db = getDb();
    const user = db.prepare('SELECT id, username, email, role, coins FROM users WHERE id = ?').get(decoded.id);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: '需要管理员权限' });
    }
    req.user = user;
    next();
}

module.exports = { generateToken, verifyToken, authMiddleware, optionalAuth, adminMiddleware, JWT_SECRET };
