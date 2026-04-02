/**
 * 项目管理路由 - CRUD / 上传 / 部署
 */
const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');

const router = express.Router();

// 上传目录
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
const SITES_DIR = path.join(__dirname, '..', '..', 'data', 'sites');

// 确保目录存在
[UPLOADS_DIR, SITES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer 配置
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // 确保上传目录存在（防止运行期间目录被清理）
        if (!fs.existsSync(UPLOADS_DIR)) {
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${req.user.id}_${Date.now()}_${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/zip' ||
            file.mimetype === 'application/x-zip-compressed' ||
            file.originalname.endsWith('.zip')) {
            cb(null, true);
        } else {
            cb(new Error('仅支持 ZIP 文件'));
        }
    }
});

// 获取项目列表
router.get('/', (req, res) => {
    const db = getDb();
    const projects = db.prepare(`
        SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC
    `).all(req.user.id);

    res.json({ projects });
});

// 获取单个项目
router.get('/:id', (req, res) => {
    const db = getDb();
    const project = db.prepare(
        'SELECT * FROM projects WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    if (!project) {
        return res.status(404).json({ error: '项目不存在' });
    }

    // 获取文件列表
    const siteDir = path.join(SITES_DIR, req.user.username, project.slug);
    let files = [];
    if (fs.existsSync(siteDir)) {
        files = walkDir(siteDir, siteDir);
    }

    res.json({ project, files });
});

// 上传并部署项目
router.post('/deploy', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '请上传 ZIP 文件' });
        }

        const { name, description, isPublic } = req.body;
        let slug = (req.body.slug || name || '').toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        if (!slug) {
            slug = `project-${Date.now()}`;
        }

        const db = getDb();
        const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);

        // 部署目录
        const siteDir = path.join(SITES_DIR, user.username, slug);

        // 如果目录已存在，清空它（重新部署）
        if (fs.existsSync(siteDir)) {
            fs.rmSync(siteDir, { recursive: true, force: true });
        }
        fs.mkdirSync(siteDir, { recursive: true });

        // 解压 ZIP
        const zip = new AdmZip(req.file.path);
        const entries = zip.getEntries();

        // 过滤掉系统文件和无效条目
        const validEntries = entries.filter(e => {
            const name = e.entryName;
            if (e.isDirectory) return false;
            if (name.startsWith('__MACOSX/')) return false;
            if (name.startsWith('.')) return false;
            if (name.includes('/.')) return false;
            if (name.endsWith('.DS_Store')) return false;
            if (name.endsWith('Thumbs.db')) return false;
            if (name.endsWith('desktop.ini')) return false;
            if (!name || name.trim() === '') return false;
            return true;
        });

        // 检测是否所有文件都在一个根文件夹内
        let commonPrefix = '';
        if (validEntries.length > 0) {
            const firstParts = validEntries[0].entryName.split('/');
            if (firstParts.length > 1) {
                const potentialPrefix = firstParts[0] + '/';
                const allUnderPrefix = validEntries.every(e =>
                    e.entryName.startsWith(potentialPrefix)
                );
                if (allUnderPrefix) commonPrefix = potentialPrefix;
            }
        }

        // 解压文件
        let fileCount = 0;
        let totalSize = 0;

        validEntries.forEach(entry => {
            let targetName = entry.entryName;
            if (commonPrefix && targetName.startsWith(commonPrefix)) {
                targetName = targetName.substring(commonPrefix.length);
            }
            if (!targetName || targetName.trim() === '') return;

            const targetPath = path.join(siteDir, targetName);

            // 安全检查：防止路径穿越
            if (!targetPath.startsWith(siteDir)) return;

            const targetDir = path.dirname(targetPath);

            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            fs.writeFileSync(targetPath, entry.getData());
            fileCount++;
            totalSize += entry.header.size;
        });

        // 智能检测：如果 siteDir 下没有 index.html，自动修正
        if (!fs.existsSync(path.join(siteDir, 'index.html'))) {
            let fixed = false;

            // 策略1：检查子目录中是否有 index.html，将其提升到根目录
            const subdirs = fs.readdirSync(siteDir, { withFileTypes: true }).filter(d => d.isDirectory());
            for (const sub of subdirs) {
                const subIndex = path.join(siteDir, sub.name, 'index.html');
                if (fs.existsSync(subIndex)) {
                    const subDir = path.join(siteDir, sub.name);
                    const subFiles = walkDir(subDir, subDir);
                    for (const f of subFiles) {
                        const src = path.join(subDir, f.path);
                        const dest = path.join(siteDir, f.path);
                        const destDir = path.dirname(dest);
                        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                        fs.copyFileSync(src, dest);
                    }
                    fs.rmSync(subDir, { recursive: true, force: true });
                    fixed = true;
                    break;
                }
            }

            // 策略2：根目录有 HTML 文件但不叫 index.html → 自动生成 index.html
            if (!fixed && !fs.existsSync(path.join(siteDir, 'index.html'))) {
                const allFiles = fs.readdirSync(siteDir);
                const htmlFiles = allFiles.filter(f => f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm'));

                if (htmlFiles.length === 1) {
                    // 只有一个 HTML 文件 → 直接复制为 index.html
                    fs.copyFileSync(
                        path.join(siteDir, htmlFiles[0]),
                        path.join(siteDir, 'index.html')
                    );
                    fileCount++;
                } else if (htmlFiles.length > 1) {
                    // 多个 HTML 文件 → 生成一个索引目录页
                    const links = htmlFiles.map(f => `<li><a href="${encodeURIComponent(f)}">${f}</a></li>`).join('\n');
                    const indexHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>文件索引</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:40px 20px;max-width:600px;margin:0 auto}
h1{margin-bottom:20px;color:#818cf8}a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline}
li{margin:10px 0;font-size:1.1rem}</style></head>
<body><h1>📂 文件列表</h1><ul>${links}</ul></body></html>`;
                    fs.writeFileSync(path.join(siteDir, 'index.html'), indexHtml);
                    fileCount++;
                }
            }
        }

        // 清理上传的 ZIP
        try { fs.unlinkSync(req.file.path); } catch(e) {}

        // 数据库记录
        const existing = db.prepare(
            'SELECT id FROM projects WHERE user_id = ? AND slug = ?'
        ).get(req.user.id, slug);

        let projectId;
        if (existing) {
            db.prepare(`
                UPDATE projects SET 
                    name = ?, description = ?, is_public = ?,
                    file_count = ?, total_size = ?,
                    deployed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(name || slug, description || '', isPublic === 'true' ? 1 : 0, fileCount, totalSize, existing.id);
            projectId = existing.id;
        } else {
            const result = db.prepare(`
                INSERT INTO projects (user_id, name, slug, description, is_public, file_count, total_size)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(req.user.id, name || slug, slug, description || '', isPublic === 'true' ? 1 : 0, fileCount, totalSize);
            projectId = result.lastInsertRowid;
        }

        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);

        res.json({
            success: true,
            project,
            url: `/site/${user.username}/${slug}`,
            message: `部署成功！共 ${fileCount} 个文件`
        });
    } catch (err) {
        console.error('部署失败:', err);
        // 清理上传文件
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: '部署失败: ' + err.message });
    }
});

// 更新项目信息
router.put('/:id', (req, res) => {
    const { name, description, isPublic } = req.body;
    const db = getDb();

    const project = db.prepare(
        'SELECT * FROM projects WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    if (!project) {
        return res.status(404).json({ error: '项目不存在' });
    }

    db.prepare(`
        UPDATE projects SET name = ?, description = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        name || project.name,
        description !== undefined ? description : project.description,
        isPublic !== undefined ? (isPublic ? 1 : 0) : project.is_public,
        req.params.id
    );

    res.json({ success: true });
});

// 删除项目
router.delete('/:id', (req, res) => {
    const db = getDb();

    // 管理员可以删除任何项目
    const currentUser = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
    const isAdmin = currentUser && currentUser.role === 'admin';

    let project;
    if (isAdmin) {
        project = db.prepare(
            'SELECT p.*, u.username FROM projects p JOIN users u ON p.user_id = u.id WHERE p.id = ?'
        ).get(req.params.id);
    } else {
        project = db.prepare(
            'SELECT p.*, u.username FROM projects p JOIN users u ON p.user_id = u.id WHERE p.id = ? AND p.user_id = ?'
        ).get(req.params.id, req.user.id);
    }

    if (!project) {
        return res.status(404).json({ error: '项目不存在' });
    }

    // 删除文件
    const siteDir = path.join(SITES_DIR, project.username, project.slug);
    if (fs.existsSync(siteDir)) {
        fs.rmSync(siteDir, { recursive: true, force: true });
    }

    // 删除数据库记录
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);

    res.json({ success: true });
});

// 从编辑器部署（无需 ZIP，直接传文件内容）
router.post('/deploy-template', (req, res) => {
    try {
        const { name, slug: rawSlug, description, isPublic, files } = req.body;
        if (!files || !files['index.html']) {
            return res.status(400).json({ error: '缺少 index.html' });
        }

        let slug = (rawSlug || name || '').toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || `project-${Date.now()}`;

        const db = getDb();
        const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
        const siteDir = path.join(SITES_DIR, user.username, slug);

        if (fs.existsSync(siteDir)) {
            fs.rmSync(siteDir, { recursive: true, force: true });
        }
        fs.mkdirSync(siteDir, { recursive: true });

        let fileCount = 0;
        let totalSize = 0;

        for (const [fileName, content] of Object.entries(files)) {
            if (!content) continue;
            const filePath = path.join(siteDir, fileName);
            fs.writeFileSync(filePath, content, 'utf-8');
            fileCount++;
            totalSize += Buffer.byteLength(content, 'utf-8');
        }

        const existing = db.prepare(
            'SELECT id FROM projects WHERE user_id = ? AND slug = ?'
        ).get(req.user.id, slug);

        let projectId;
        if (existing) {
            db.prepare(`
                UPDATE projects SET name = ?, description = ?, is_public = ?,
                    file_count = ?, total_size = ?,
                    deployed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(name || slug, description || '', isPublic ? 1 : 0, fileCount, totalSize, existing.id);
            projectId = existing.id;
        } else {
            const result = db.prepare(`
                INSERT INTO projects (user_id, name, slug, description, is_public, file_count, total_size)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(req.user.id, name || slug, slug, description || '', isPublic ? 1 : 0, fileCount, totalSize);
            projectId = result.lastInsertRowid;
        }

        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
        res.json({ success: true, project, url: `/site/${user.username}/${slug}` });
    } catch (err) {
        console.error('模板部署失败:', err);
        res.status(500).json({ error: '部署失败: ' + err.message });
    }
});

// 递归遍历目录
function walkDir(dir, baseDir) {
    const files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
            files.push(...walkDir(fullPath, baseDir));
        } else {
            const stat = fs.statSync(fullPath);
            files.push({
                name: entry.name,
                path: relativePath,
                size: stat.size
            });
        }
    }

    return files;
}

// 获取项目源码（用于编辑器）
router.get('/:id/source', (req, res) => {
    const db = getDb();
    const project = db.prepare(
        'SELECT p.*, u.username FROM projects p JOIN users u ON p.user_id = u.id WHERE p.id = ? AND p.user_id = ?'
    ).get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const siteDir = path.join(SITES_DIR, project.username, project.slug);
    const result = { html: '', css: '', js: '' };

    // 读取 index.html
    const htmlPath = path.join(siteDir, 'index.html');
    if (fs.existsSync(htmlPath)) result.html = fs.readFileSync(htmlPath, 'utf-8');
    // 读取 style.css
    const cssPath = path.join(siteDir, 'style.css');
    if (fs.existsSync(cssPath)) result.css = fs.readFileSync(cssPath, 'utf-8');
    // 读取 script.js
    const jsPath = path.join(siteDir, 'script.js');
    if (fs.existsSync(jsPath)) result.js = fs.readFileSync(jsPath, 'utf-8');

    // 如果没有 style.css/script.js 但有其他同类型文件
    if (!result.css) {
        const cssFiles = fs.existsSync(siteDir) ? fs.readdirSync(siteDir).filter(f => f.endsWith('.css')) : [];
        if (cssFiles.length > 0) result.css = fs.readFileSync(path.join(siteDir, cssFiles[0]), 'utf-8');
    }
    if (!result.js) {
        const jsFiles = fs.existsSync(siteDir) ? fs.readdirSync(siteDir).filter(f => f.endsWith('.js')) : [];
        if (jsFiles.length > 0) result.js = fs.readFileSync(path.join(siteDir, jsFiles[0]), 'utf-8');
    }
    // 如果没有 index.html 但有其他 HTML 文件
    if (!result.html) {
        const htmlFiles = fs.existsSync(siteDir) ? fs.readdirSync(siteDir).filter(f => f.endsWith('.html') || f.endsWith('.htm')) : [];
        if (htmlFiles.length > 0) result.html = fs.readFileSync(path.join(siteDir, htmlFiles[0]), 'utf-8');
    }

    res.json({ project, source: result });
});

module.exports = router;
