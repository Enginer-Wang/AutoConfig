/**
 * Autoconfig - 公共 JS 工具库
 */

// Toast 通知
function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

// API 请求封装
async function api(url, options = {}) {
    const defaults = {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin'
    };

    if (options.body && !(options.body instanceof FormData)) {
        options.body = JSON.stringify(options.body);
    } else if (options.body instanceof FormData) {
        delete defaults.headers['Content-Type'];
    }

    const res = await fetch(url, { ...defaults, ...options });
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error || '请求失败');
    }

    return data;
}

// 检查登录状态
async function checkAuth() {
    try {
        const data = await api('/api/auth/me');
        return data.user;
    } catch {
        return null;
    }
}

// 格式化文件大小
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

// 格式化时间
function formatDate(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';

    return d.toLocaleDateString('zh-CN');
}

// 跳转到登录
function redirectToLogin() {
    window.location.href = '/login';
}

// 登出
async function logout() {
    try {
        await api('/api/auth/logout', { method: 'POST' });
    } catch { }
    window.location.href = '/';
}
