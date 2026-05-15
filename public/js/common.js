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

// 用户角色标签
function getRoleBadge(role) {
    const badges = {
        admin: '<span class="role-badge role-admin">管理员</span>',
        teacher: '<span class="role-badge role-teacher">教师</span>',
        student: '<span class="role-badge role-student">学生</span>',
        user: '<span class="role-badge role-user">用户</span>'
    };
    return badges[role] || badges.user;
}

// SPA 导航：拦截链接点击，平滑过渡避免白屏闪烁
function setupSpaNavigation() {
    // 注入过渡样式
    if (!document.getElementById('spa-transition-style')) {
        const style = document.createElement('style');
        style.id = 'spa-transition-style';
        style.textContent = `
            .spa-navigating { pointer-events: none; }
            .spa-fade-out { opacity: 0; transition: opacity .15s ease-out; }
            .spa-fade-in { animation: spaFadeIn .2s ease-in; }
            @keyframes spaFadeIn { from { opacity: 0; } to { opacity: 1; } }
            .spa-loading-bar { position: fixed; top: 0; left: 0; height: 2px; background: linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7); z-index: 99999; transition: width .3s ease; }
        `;
        document.head.appendChild(style);
    }

    document.addEventListener('click', function(e) {
        const link = e.target.closest('a[href]');
        if (!link) return;
        const href = link.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('http') || link.target === '_blank') return;
        // 站内链接：平滑导航
        if (href.startsWith('/') && !href.startsWith('/api/') && !href.startsWith('/site/')) {
            if (window.location.pathname === href) { e.preventDefault(); return; }
            e.preventDefault();
            // 顶部加载条
            let bar = document.querySelector('.spa-loading-bar');
            if (!bar) { bar = document.createElement('div'); bar.className = 'spa-loading-bar'; document.body.appendChild(bar); }
            bar.style.width = '0%';
            requestAnimationFrame(() => { bar.style.width = '30%'; });
            // 淡出当前页面
            document.body.classList.add('spa-fade-out');
            setTimeout(() => {
                bar.style.width = '70%';
                window.location.href = href;
            }, 150);
        }
    });

    // 新页面加载时淡入
    document.body.classList.add('spa-fade-in');
    // 清理前一页的加载条
    const oldBar = document.querySelector('.spa-loading-bar');
    if (oldBar) oldBar.remove();
}

// 统一导航栏渲染
function renderNavbar(activePage) {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    const currentPath = window.location.pathname;
    const isActive = (page) => activePage === page || currentPath === page ? 'class="active"' : '';

    navbar.classList.add('scrolled');

    navbar.innerHTML = `
        <div class="nav-container">
            <a href="/" class="nav-logo">
                <span class="logo-icon">⚡</span>
                <span class="logo-text">Autoconfig</span>
            </a>
            <div class="nav-links" id="navLinks">
                <a href="/subjects" ${isActive('/subjects')}>学科课件</a>
                <a href="/community" ${isActive('/community')}>社区广场</a>
                <a href="/templates" ${isActive('/templates')}>模板商城</a>
                <a href="/leaderboard" ${isActive('/leaderboard')}>排行榜</a>
                <a href="/homework" ${isActive('/homework')}>作业中心</a>
                <a href="/classes" ${isActive('/classes')}>班级管理</a>
            </div>
            <div class="nav-actions" id="navActions">
                <a href="/login" class="btn-login">登录</a>
                <a href="/register" class="btn-register">免费注册</a>
            </div>
            <button class="nav-toggle" id="navToggle" aria-label="切换导航">
                <span></span><span></span><span></span>
            </button>
        </div>
    `;

    // 绑定移动端菜单切换
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');
    if (toggle && links) {
        toggle.addEventListener('click', () => {
            links.classList.toggle('active');
            toggle.classList.toggle('active');
        });
    }
}

// 根据登录状态更新导航栏
async function updateNavAuth(user) {
    const navActions = document.getElementById('navActions');
    if (!navActions) return;

    if (!user) user = await checkAuth();
    if (user) {
        navActions.innerHTML = `
            <a href="/chat" class="btn-nav-link nav-chat-link" style="position:relative">💬<span class="nav-chat-badge" id="navChatBadge" style="display:none"></span></a>
            <a href="/dashboard" class="btn-register">控制台</a>
            <span class="nav-user-info">
                ${getRoleBadge(user.role)}
                <span class="nav-username">${user.username}</span>
            </span>
            <a href="javascript:void(0)" onclick="logout()" class="btn-nav-link btn-nav-logout" title="退出登录">🚪</a>
        `;
        // 检查未读消息
        try {
            const unreadData = await api('/api/chat/unread');
            if (unreadData.unread > 0) {
                const badge = document.getElementById('navChatBadge');
                if (badge) {
                    badge.textContent = unreadData.unread > 99 ? '99+' : unreadData.unread;
                    badge.style.display = 'inline-block';
                }
            }
        } catch {}
    }
    return user;
}

// 统一导航栏初始化
async function initNavbar(activePage) {
    renderNavbar(activePage);
    setupSpaNavigation();
    return await updateNavAuth();
}
