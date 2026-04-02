/**
 * 已部署站点路由 - 访问用户部署的静态文件
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');

const router = express.Router();

const SITES_DIR = path.join(__dirname, '..', '..', 'data', 'sites');

// 访问 /site/:username/:project 或 /site/:username/:project/subpath
router.get('/:username/:project', serveSite);
router.get('/:username/:project/{*filePath}', serveSite);

function serveSite(req, res) {
    const { username, project } = req.params;
    // Express v5 wildcard 参数可能为 string、array 或 undefined
    let rawPath = req.params.filePath;
    let filePath = '';
    if (Array.isArray(rawPath)) {
        filePath = rawPath.join('/');
    } else if (typeof rawPath === 'string') {
        filePath = rawPath;
    }
    // 清理路径（移除开头的斜杠和空白）
    filePath = filePath.replace(/^\/+/, '').trim();
    if (!filePath) filePath = 'index.html';

    const siteDir = path.join(SITES_DIR, username, project);

    if (!fs.existsSync(siteDir)) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html><head><meta charset="UTF-8"><title>404</title>
            <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a1a;color:#f1f5f9;}
            .c{text-align:center;}.c h1{font-size:4rem;background:linear-gradient(135deg,#6366f1,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
            .c p{color:#94a3b8;margin:16px 0;}.c a{color:#818cf8;}</style></head>
            <body><div class="c"><h1>404</h1><p>项目 ${username}/${project} 不存在</p><a href="/">返回首页</a></div></body></html>
        `);
    }

    // 增加访问计数
    try {
        const db = getDb();
        db.prepare(`
            UPDATE projects SET visit_count = visit_count + 1 
            WHERE slug = ? AND user_id = (SELECT id FROM users WHERE username = ?)
        `).run(project, username);
    } catch (e) { /* ignore */ }

    let targetPath = path.join(siteDir, filePath);

    // 安全检查：防止路径穿越
    if (!targetPath.startsWith(siteDir)) {
        return res.status(403).send('禁止访问');
    }

    // 如果是目录，尝试 index.html
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        targetPath = path.join(targetPath, 'index.html');
    }

    if (!fs.existsSync(targetPath)) {
        if (filePath === 'index.html') {
            try {
                const entries = fs.readdirSync(siteDir, { withFileTypes: true });

                // fallback 1: 子目录中有 index.html
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const subIndex = path.join(siteDir, entry.name, 'index.html');
                        if (fs.existsSync(subIndex)) {
                            return res.sendFile(subIndex);
                        }
                    }
                }

                // fallback 2: 根目录有其他 HTML 文件 → 直接 serve 第一个
                const htmlFiles = entries
                    .filter(e => !e.isDirectory() && (e.name.toLowerCase().endsWith('.html') || e.name.toLowerCase().endsWith('.htm')))
                    .map(e => e.name);
                if (htmlFiles.length === 1) {
                    return res.sendFile(path.join(siteDir, htmlFiles[0]));
                } else if (htmlFiles.length > 1) {
                    // 多个 HTML → 返回一个目录页
                    const links = htmlFiles.map(f => `<li><a href="/site/${username}/${project}/${encodeURIComponent(f)}">${f}</a></li>`).join('');
                    return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>文件索引</title><style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:40px 20px;max-width:600px;margin:0 auto}h1{margin-bottom:20px;color:#818cf8}a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline}li{margin:10px 0;font-size:1.1rem}</style></head><body><h1>📂 文件列表</h1><ul>${links}</ul></body></html>`);
                }
            } catch (e) { /* ignore */ }
        }

        // SPA fallback: 尝试 index.html
        const indexPath = path.join(siteDir, 'index.html');
        if (fs.existsSync(indexPath)) {
            return res.sendFile(indexPath);
        }
        return res.status(404).send('文件未找到');
    }

    res.sendFile(targetPath);
}

module.exports = router;
