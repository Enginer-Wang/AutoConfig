/**
 * 课堂互动聊天室 - 共享前端模块
 * 教师端(live-console)与学生端(live-classroom)复用。
 * 用法：
 *   ClassroomChat.init({ mountEl, classId, me, isTeacher, getWS, onEnterEditor });
 *   在页面 WebSocket onmessage 中调用 ClassroomChat.handleWS(msg) 委派处理。
 */
(function () {
    const EMOJIS = ['😀', '😂', '👍', '🎉', '😮', '😢', '🤔', '❤️'];
    const CLASS_EMOJIS = ['听懂了', '没懂', '老师太快了', '再讲一遍', '👏', '🙋'];
    const REACTIONS = ['👍', '+1', '懂了', '❤️', '🎉'];

    const S = {
        roomId: null, classId: null, me: null, isTeacher: false,
        getWS: null, onEnterEditor: null, mountEl: null,
        replyTo: null, danmakuOn: false, danmakuLayer: null, msgIds: new Set(), myVotes: {}
    };

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
    async function api(url, opts = {}) {
        const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'HTTP ' + res.status); }
        return res.json();
    }
    function wsSend(o) { const ws = S.getWS && S.getWS(); if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

    // 极简 Markdown：代码块 + 行内代码 + 粗体 + 链接
    function renderMarkdown(text) {
        let h = esc(text);
        h = h.replace(/```([\s\S]*?)```/g, (m, c) => `<pre class="cc-code">${c.replace(/^\n/, '')}</pre>`);
        h = h.replace(/`([^`]+)`/g, '<code class="cc-inline">$1</code>');
        h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        h = h.replace(/\n/g, '<br>');
        return h;
    }

    function html() {
        return `
        <div class="cc-wrap">
            <div class="cc-pinned" id="ccPinned" style="display:none"></div>
            <div class="cc-announce" id="ccAnnounce" style="display:none"></div>
            ${S.isTeacher ? `<div class="cc-admin">
                <button class="cc-abtn" id="ccMuteAll">全员禁言</button>
                <button class="cc-abtn" id="ccDanmaku">弹幕:关</button>
                <button class="cc-abtn" id="ccAnnounceBtn">发布公告</button>
                <button class="cc-abtn" id="ccBroadcastBtn">广播示范代码</button>
                <button class="cc-abtn" id="ccSigninBtn">发起签到</button>
                <button class="cc-abtn" id="ccVoteBtn">发起投票</button>
            </div>` : ''}
            <div class="cc-list" id="ccList"></div>
            <div class="cc-reply" id="ccReply" style="display:none"></div>
            <div class="cc-input">
                <div class="cc-tools">
                    <button class="cc-tbtn" id="ccEmojiBtn" title="表情">😀</button>
                    <button class="cc-tbtn" id="ccCodeBtn" title="插入代码块">&lt;/&gt;</button>
                    <button class="cc-tbtn" id="ccFileBtn" title="发送文件/图片">📎</button>
                    <button class="cc-tbtn" id="ccShareCodeBtn" title="分享我的代码">💻</button>
                    <input type="file" id="ccFile" style="display:none">
                </div>
                <div class="cc-emoji-pop" id="ccEmojiPop" style="display:none"></div>
                <div class="cc-row">
                    <textarea id="ccText" rows="1" placeholder="输入消息，支持 Markdown 与 \`\`\`代码块\`\`\`…"></textarea>
                    <button class="cc-send" id="ccSend">发送</button>
                </div>
            </div>
        </div>`;
    }

    function styles() {
        if (document.getElementById('cc-style')) return;
        const css = `
        .cc-wrap{display:flex;flex-direction:column;height:100%;background:#15191e;border:1px solid #2d3640;border-radius:12px;overflow:hidden}
        .cc-pinned{background:rgba(29,155,240,0.08);border-bottom:1px solid #2d3640;padding:8px 12px;font-size:12px;color:#1d9bf0}
        .cc-pinned .pin-item{display:flex;justify-content:space-between;gap:8px;margin:2px 0}
        .cc-announce{background:rgba(255,184,0,0.1);border-bottom:1px solid #2d3640;padding:8px 12px;font-size:12px;color:#ffb800}
        .cc-admin{display:flex;gap:6px;padding:8px;border-bottom:1px solid #2d3640;flex-wrap:wrap}
        .cc-abtn{padding:5px 10px;background:#2d3640;color:#e7e9ea;border:none;border-radius:6px;font-size:11px;cursor:pointer}
        .cc-abtn.on{background:#1d9bf0;color:#fff}
        .cc-list{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:10px}
        .cc-msg{display:flex;gap:8px;font-size:13px}
        .cc-msg .av{width:28px;height:28px;border-radius:50%;background:#2d3640;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
        .cc-msg .body{flex:1;min-width:0}
        .cc-msg .nm{font-size:11px;color:#8b98a5;margin-bottom:2px;display:flex;gap:6px;align-items:center}
        .cc-msg .nm .role{background:#1d9bf0;color:#fff;border-radius:6px;padding:0 5px;font-size:10px}
        .cc-bubble{background:#0d1117;border:1px solid #2d3640;border-radius:8px;padding:8px 10px;word-break:break-word;color:#e7e9ea}
        .cc-bubble.sys{background:transparent;border:none;color:#8b98a5;font-size:12px;text-align:center}
        .cc-bubble.deleted{color:#5c6b7a;font-style:italic}
        .cc-reply-quote{border-left:2px solid #1d9bf0;padding-left:6px;margin-bottom:4px;font-size:11px;color:#8b98a5}
        .cc-code{background:#0a0d12;border-radius:6px;padding:8px;font-family:'JetBrains Mono',monospace;font-size:12px;white-space:pre-wrap;overflow-x:auto;color:#9ad}
        .cc-inline{background:#0a0d12;border-radius:4px;padding:1px 5px;font-family:monospace;font-size:12px}
        .cc-card{background:#0a0d12;border:1px solid #1d9bf0;border-radius:8px;padding:10px;margin-top:2px}
        .cc-card .ch{font-size:12px;color:#1d9bf0;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center}
        .cc-card pre{font-family:'JetBrains Mono',monospace;font-size:11px;max-height:160px;overflow:auto;color:#cdd;white-space:pre-wrap}
        .cc-card .cbtn{font-size:10px;padding:3px 8px;background:#1d9bf0;color:#fff;border:none;border-radius:5px;cursor:pointer}
        .cc-activity{background:#0a0d12;border:1px solid #1d9bf0;border-radius:8px;padding:10px;margin-top:2px}
        .cc-act-head{font-size:13px;color:#e7e9ea;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
        .cc-act-tag{font-size:10px;background:#2d3640;color:#8b98a5;border-radius:6px;padding:1px 6px}
        .cc-act-tag.live{background:#00ba7c;color:#fff}
        .cc-act-sign{font-size:13px;color:#1d9bf0;margin-bottom:4px}
        .cc-act-names{font-size:11px;color:#8b98a5;margin-bottom:8px;max-height:48px;overflow:auto}
        .cc-act-btn,.cc-act-end{font-size:12px;padding:6px 14px;border:none;border-radius:6px;cursor:pointer;margin-top:4px}
        .cc-act-btn{background:#1d9bf0;color:#fff}
        .cc-act-btn:disabled{background:#2d3640;color:#8b98a5;cursor:default}
        .cc-act-end{background:transparent;border:1px solid #f4212e;color:#f4212e;margin-left:6px}
        .cc-bars{display:flex;flex-direction:column;gap:6px;margin-bottom:6px}
        .cc-bar-row{display:flex;align-items:center;gap:8px;cursor:pointer}
        .cc-bar-row.picked .cc-bar-label{color:#1d9bf0;font-weight:600}
        .cc-bar-label{width:84px;font-size:12px;color:#e7e9ea;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cc-bar-track{flex:1;height:16px;background:#15191e;border-radius:8px;overflow:hidden}
        .cc-bar-fill{height:100%;background:linear-gradient(90deg,#1d9bf0,#00ba7c);border-radius:8px;transition:width .4s ease}
        .cc-bar-val{width:64px;text-align:right;font-size:11px;color:#8b98a5;flex-shrink:0}
        .cc-act-foot{font-size:11px;color:#8b98a5}
        .cc-img{max-width:200px;border-radius:8px;cursor:pointer;display:block}
        .cc-file{display:flex;align-items:center;gap:8px}
        .cc-file a{color:#1d9bf0}
        .cc-react{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap}
        .cc-chip{font-size:11px;padding:1px 8px;background:#1a1f26;border:1px solid #2d3640;border-radius:12px;cursor:pointer;color:#8b98a5}
        .cc-chip.mine{border-color:#1d9bf0;color:#1d9bf0}
        .cc-msg .acts{display:flex;gap:8px;margin-top:3px;opacity:0;transition:.15s}
        .cc-msg:hover .acts{opacity:1}
        .cc-msg .acts span{font-size:11px;color:#8b98a5;cursor:pointer}
        .cc-reply{padding:6px 10px;background:#0d1117;border-top:1px solid #2d3640;font-size:11px;color:#8b98a5;display:flex;justify-content:space-between}
        .cc-input{border-top:1px solid #2d3640;padding:8px;position:relative}
        .cc-tools{display:flex;gap:6px;margin-bottom:6px}
        .cc-tbtn{background:#2d3640;border:none;color:#e7e9ea;border-radius:6px;padding:4px 9px;cursor:pointer;font-size:13px}
        .cc-emoji-pop{position:absolute;bottom:90px;left:8px;background:#1a1f26;border:1px solid #2d3640;border-radius:10px;padding:8px;display:flex;flex-wrap:wrap;gap:6px;width:240px;z-index:20}
        .cc-emoji-pop span{cursor:pointer;font-size:18px;padding:2px}
        .cc-emoji-pop .ce{font-size:12px;background:#2d3640;border-radius:6px;padding:3px 7px}
        .cc-row{display:flex;gap:8px}
        .cc-row textarea{flex:1;background:#0d1117;border:1px solid #2d3640;border-radius:8px;color:#e7e9ea;padding:8px;font-family:inherit;font-size:13px;resize:none;outline:none;max-height:120px}
        .cc-row textarea:focus{border-color:#1d9bf0}
        .cc-send{background:#1d9bf0;color:#fff;border:none;border-radius:8px;padding:0 16px;cursor:pointer;font-weight:600;font-size:13px}
        .cc-send:disabled{opacity:.4;cursor:not-allowed}
        .cc-danmaku{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:5}
        .cc-bullet{position:absolute;white-space:nowrap;color:#fff;font-weight:600;text-shadow:0 1px 3px #000;font-size:16px;animation:ccfly linear forwards}
        @keyframes ccfly{from{left:100%;transform:translateX(0)}to{left:0;transform:translateX(-100%)}}
        .cc-ding-mask{position:fixed;inset:0;background:rgba(244,33,46,0.25);z-index:9999;display:flex;align-items:center;justify-content:center}
        .cc-ding-box{background:#1a1f26;border:2px solid #f4212e;border-radius:14px;padding:28px 32px;text-align:center;max-width:420px}
        .cc-ding-box h2{color:#f4212e;margin-bottom:10px}
        .cc-ding-box button{margin-top:16px;background:#f4212e;color:#fff;border:none;border-radius:8px;padding:10px 24px;cursor:pointer;font-weight:600}`;
        const el = document.createElement('style'); el.id = 'cc-style'; el.textContent = css; document.head.appendChild(el);
    }

    async function init(opts) {
        S.classId = opts.classId; S.me = opts.me; S.isTeacher = !!opts.isTeacher;
        S.getWS = opts.getWS; S.onEnterEditor = opts.onEnterEditor; S.mountEl = opts.mountEl;
        S.danmakuLayer = opts.danmakuLayer || null;
        styles();
        S.mountEl.innerHTML = html();
        bindUI();
        try {
            const r = await api('/api/classroom-chat/room?classId=' + S.classId);
            S.roomId = r.room.id; S.danmakuOn = r.danmakuOn;
            setAnnounce(r.announcement);
            updateDanmakuBtn();
            wsSend({ type: 'join_room', roomId: S.roomId });
            await loadMessages();
        } catch (e) { console.warn('聊天室初始化失败', e); }
    }

    function bindUI() {
        const $ = id => document.getElementById(id);
        $('ccSend').onclick = sendText;
        $('ccText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } });
        $('ccEmojiBtn').onclick = toggleEmoji;
        $('ccCodeBtn').onclick = () => { const t = $('ccText'); t.value += '\n```\n\n```'; t.focus(); };
        $('ccFileBtn').onclick = () => $('ccFile').click();
        $('ccFile').onchange = uploadFile;
        $('ccShareCodeBtn').onclick = shareMyCode;
        if (S.isTeacher) {
            $('ccMuteAll').onclick = toggleMuteAll;
            $('ccDanmaku').onclick = toggleDanmaku;
            $('ccAnnounceBtn').onclick = publishAnnounce;
            $('ccBroadcastBtn').onclick = broadcastCode;
            $('ccSigninBtn').onclick = launchSignin;
            $('ccVoteBtn').onclick = launchVote;
        }
    }

    function toggleEmoji() {
        const pop = document.getElementById('ccEmojiPop');
        if (pop.style.display === 'flex') { pop.style.display = 'none'; return; }
        pop.innerHTML = EMOJIS.map(e => `<span data-e="${e}">${e}</span>`).join('') +
            CLASS_EMOJIS.map(e => `<span class="ce" data-e="${esc(e)}">${esc(e)}</span>`).join('');
        pop.querySelectorAll('span').forEach(s => s.onclick = () => {
            const t = document.getElementById('ccText'); t.value += s.dataset.e; t.focus(); pop.style.display = 'none';
        });
        pop.style.display = 'flex';
    }

    async function loadMessages() {
        const d = await api('/api/classroom-chat/room/' + S.roomId + '/messages');
        const list = document.getElementById('ccList'); list.innerHTML = '';
        S.msgIds.clear();
        d.messages.forEach(m => appendMessage(m, false));
        renderPinned(d.pinned || []);
        scrollBottom();
    }

    function roleTag(m) { return ''; }

    function appendMessage(m, animate) {
        if (S.msgIds.has(m.id)) return;
        S.msgIds.add(m.id);
        const list = document.getElementById('ccList');
        if (m.type === 'system') {
            const d = document.createElement('div'); d.className = 'cc-msg'; d.dataset.id = m.id;
            d.innerHTML = `<div class="cc-bubble sys" style="flex:1">${esc(m.content)}</div>`;
            list.appendChild(d); return;
        }
        const mine = m.sender_id === (S.me.id || S.me.userId);
        const d = document.createElement('div'); d.className = 'cc-msg'; d.dataset.id = m.id;
        d.innerHTML = `
            <div class="av">${esc((m.sender_name || '?')[0])}</div>
            <div class="body">
                <div class="nm"><span>${esc(m.sender_name)}</span></div>
                ${m.reply_preview ? `<div class="cc-reply-quote">↪ ${esc(m.reply_preview.username)}: ${esc(m.reply_preview.content)}</div>` : ''}
                <div class="cc-bubble ${m.is_deleted ? 'deleted' : ''}">${renderBody(m)}</div>
                <div class="cc-react"></div>
                <div class="acts">
                    <span data-act="reply">回复</span>
                    ${REACTIONS.slice(0, 3).map(r => `<span data-react="${esc(r)}">${esc(r)}</span>`).join('')}
                    ${(mine || S.isTeacher) ? `<span data-act="recall">${S.isTeacher && !mine ? '删除' : '撤回'}</span>` : ''}
                    ${S.isTeacher ? `<span data-act="pin">置顶</span><span data-act="receipts">已读</span><span data-act="ding">DING</span>` : ''}
                </div>
            </div>`;
        bindMsgActions(d, m);
        renderReactions(d, m.reactions || []);
        list.appendChild(d);
        if (m.type === 'activity' && m.activity) renderActivity(m.activity.activityId, m.activity, m.activity.myAnswer);
        if (animate) scrollBottom();
    }

    function renderBody(m) {
        if (m.is_deleted) return '[消息已撤回]';
        let meta = {}; try { meta = JSON.parse(m.metadata || '{}'); } catch {}
        if (m.type === 'image') return `<img class="cc-img" src="${esc(meta.url)}" onclick="window.open('${esc(meta.url)}')">`;
        if (m.type === 'voice') return `<audio controls src="${esc(meta.url)}" style="height:32px"></audio>`;
        if (m.type === 'file') return `<div class="cc-file">📄 <a href="${esc(meta.url)}" download="${esc(meta.originalName)}">${esc(meta.originalName)}</a> <span style="color:#8b98a5">${fmtSize(meta.size)}</span></div>`;
        if (m.type === 'code_card') {
            return `<div class="cc-card">
                <div class="ch"><span>${esc(m.content)} · ${esc(meta.filename || '')}</span>
                <button class="cbtn" data-code="1">查看代码</button></div>
                <pre style="display:none">${esc(meta.code || '')}</pre></div>`;
        }
        if (m.type === 'activity') {
            return `<div class="cc-activity" data-act-id="${meta.activityId}"></div>`;
        }
        return renderMarkdown(m.content);
    }

    function bindMsgActions(d, m) {
        d.querySelectorAll('[data-react]').forEach(s => s.onclick = () => react(m.id, s.dataset.react));
        const reply = d.querySelector('[data-act="reply"]'); if (reply) reply.onclick = () => setReply(m);
        const recall = d.querySelector('[data-act="recall"]'); if (recall) recall.onclick = () => recallMsg(m.id);
        const pin = d.querySelector('[data-act="pin"]'); if (pin) pin.onclick = () => pinMsg(m.id);
        const rec = d.querySelector('[data-act="receipts"]'); if (rec) rec.onclick = () => showReceipts(m.id);
        const ding = d.querySelector('[data-act="ding"]'); if (ding) ding.onclick = () => dingMsg(m.id);
        const cb = d.querySelector('[data-code]'); if (cb) cb.onclick = () => { const pre = cb.closest('.cc-card').querySelector('pre'); pre.style.display = pre.style.display === 'none' ? 'block' : 'none'; };
    }

    function renderReactions(d, reactions) {
        const box = d.querySelector('.cc-react'); if (!box) return;
        box.innerHTML = reactions.map(r => `<span class="cc-chip ${r.mine ? 'mine' : ''}" data-e="${esc(r.emoji)}">${esc(r.emoji)} ${r.count}</span>`).join('');
        box.querySelectorAll('.cc-chip').forEach(c => c.onclick = () => react(d.dataset.id, c.dataset.e));
    }

    function fmtSize(b) { b = b || 0; return b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'KB' : (b / 1048576).toFixed(1) + 'MB'; }
    function scrollBottom() { const l = document.getElementById('ccList'); l.scrollTop = l.scrollHeight; }

    async function sendText() {
        const t = document.getElementById('ccText'); const content = t.value.trim();
        if (!content || !S.roomId) return;
        const btn = document.getElementById('ccSend'); btn.disabled = true;
        try {
            await api('/api/classroom-chat/room/' + S.roomId + '/messages', {
                method: 'POST',
                body: JSON.stringify({ content, replyTo: S.replyTo, isDanmaku: true })
            });
            t.value = ''; clearReply();
        } catch (e) { alert(e.message); }
        finally { btn.disabled = false; }
    }

    async function uploadFile(e) {
        const f = e.target.files[0]; if (!f || !S.roomId) return;
        const fd = new FormData(); fd.append('file', f);
        try { await fetch('/api/classroom-chat/room/' + S.roomId + '/upload', { method: 'POST', body: fd }); }
        catch (err) { alert('上传失败'); }
        e.target.value = '';
    }

    async function shareMyCode() {
        const code = window.__getMyCode ? window.__getMyCode() : '';
        if (!code) return alert('当前没有可分享的代码');
        await api('/api/classroom-chat/room/' + S.roomId + '/code-share', {
            method: 'POST', body: JSON.stringify({ code, filename: 'main.js', language: 'javascript' })
        }).catch(e => alert(e.message));
    }

    async function broadcastCode() {
        const code = prompt('粘贴要广播给全班的示范代码：'); if (!code) return;
        const author = prompt('示范作者（学生姓名，可留空）：') || '';
        await api('/api/classroom-chat/room/' + S.roomId + '/code-share', {
            method: 'POST', body: JSON.stringify({ code, filename: 'demo.js', broadcast: true, fromUsername: author })
        }).catch(e => alert(e.message));
    }

    async function react(id, emoji) {
        try { await api('/api/classroom-chat/messages/' + id + '/react', { method: 'POST', body: JSON.stringify({ emoji }) }); }
        catch (e) { /* ignore */ }
    }
    function setReply(m) {
        S.replyTo = m.id;
        const r = document.getElementById('ccReply'); r.style.display = 'flex';
        r.innerHTML = `<span>↪ 回复 ${esc(m.sender_name)}: ${esc(String(m.content).slice(0, 40))}</span><span id="ccReplyX" style="cursor:pointer">✕</span>`;
        document.getElementById('ccReplyX').onclick = clearReply;
        document.getElementById('ccText').focus();
    }
    function clearReply() { S.replyTo = null; document.getElementById('ccReply').style.display = 'none'; }
    async function recallMsg(id) { if (confirm('确认撤回/删除该消息？')) await api('/api/classroom-chat/messages/' + id + '/recall', { method: 'POST' }).catch(e => alert(e.message)); }
    async function pinMsg(id) { await api('/api/classroom-chat/room/' + S.roomId + '/pin', { method: 'POST', body: JSON.stringify({ messageId: id, pinned: true }) }).catch(e => alert(e.message)); }
    async function dingMsg(id) {
        const r = await api('/api/classroom-chat/room/' + S.roomId + '/ding', { method: 'POST', body: JSON.stringify({ messageId: id }) }).catch(e => { alert(e.message); return null; });
        if (r) alert('已 DING ' + r.notified + ' 名未读学生');
    }
    async function showReceipts(id) {
        try {
            const d = await api('/api/classroom-chat/messages/' + id + '/receipts');
            alert(`已读 ${d.read.length}/${d.total}\n未读: ${d.unread.map(u => u.username).join('、') || '无'}`);
        } catch (e) { alert(e.message); }
    }

    async function toggleMuteAll() {
        const btn = document.getElementById('ccMuteAll');
        const on = !btn.classList.contains('on');
        await api('/api/classroom-chat/room/' + S.roomId + '/mute-all', { method: 'POST', body: JSON.stringify({ muted: on }) }).catch(e => alert(e.message));
    }
    async function toggleDanmaku() {
        await api('/api/classroom-chat/room/' + S.roomId + '/danmaku', { method: 'POST', body: JSON.stringify({ on: !S.danmakuOn }) }).catch(e => alert(e.message));
    }
    function updateDanmakuBtn() {
        const b = document.getElementById('ccDanmaku'); if (!b) return;
        b.textContent = '弹幕:' + (S.danmakuOn ? '开' : '关'); b.classList.toggle('on', S.danmakuOn);
    }
    async function publishAnnounce() {
        const text = prompt('发布课堂公告/任务（如：实现一个九九乘法表）：'); if (text == null) return;
        await api('/api/classroom-chat/room/' + S.roomId + '/announcement', { method: 'POST', body: JSON.stringify({ announcement: text }) }).catch(e => alert(e.message));
    }
    function setAnnounce(text) {
        const el = document.getElementById('ccAnnounce'); if (!el) return;
        if (text) { el.style.display = 'block'; el.innerHTML = '📌 ' + esc(text); } else el.style.display = 'none';
    }
    function renderPinned(pinned) {
        const el = document.getElementById('ccPinned'); if (!el) return;
        if (!pinned.length) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.innerHTML = pinned.map(p => `<div class="pin-item">📍 ${esc(p.sender_name)}: ${esc(String(p.content).slice(0, 60))}
            ${S.isTeacher ? `<span style="cursor:pointer" data-unpin="${p.id}">✕</span>` : ''}</div>`).join('');
        el.querySelectorAll('[data-unpin]').forEach(s => s.onclick = () =>
            api('/api/classroom-chat/room/' + S.roomId + '/pin', { method: 'POST', body: JSON.stringify({ messageId: parseInt(s.dataset.unpin), pinned: false }) }));
    }

    // ===== 签到 / 投票活动 =====
    async function launchSignin() {
        const title = prompt('签到标题：', '课堂签到');
        if (title == null) return;
        await api('/api/classroom-chat/room/' + S.roomId + '/activity', {
            method: 'POST', body: JSON.stringify({ kind: 'signin', title: title || '课堂签到' })
        }).catch(e => alert(e.message));
    }
    async function launchVote() {
        const question = prompt('投票问题：'); if (question == null || !question.trim()) return;
        const optStr = prompt('选项（用逗号分隔，2-8 个）：', '选项A,选项B,选项C');
        if (optStr == null) return;
        const options = optStr.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        if (options.length < 2) return alert('至少两个选项');
        await api('/api/classroom-chat/room/' + S.roomId + '/activity', {
            method: 'POST', body: JSON.stringify({ kind: 'vote', question, options })
        }).catch(e => alert(e.message));
    }

    async function respondActivity(actId, answer) {
        try {
            const d = await api('/api/classroom-chat/activity/' + actId + '/respond', {
                method: 'POST', body: JSON.stringify({ answer })
            });
            S.myVotes[actId] = answer == null ? 'signed' : String(answer);
            renderActivity(actId, d.results, S.myVotes[actId]);
        } catch (e) { alert(e.message); }
    }
    async function endActivity(actId) {
        const d = await api('/api/classroom-chat/activity/' + actId + '/end', { method: 'POST' }).catch(e => { alert(e.message); return null; });
        if (d) renderActivity(actId, d.results, S.myVotes[actId]);
    }

    function renderActivity(actId, r, myAnswer) {
        const box = document.querySelector('.cc-activity[data-act-id="' + actId + '"]');
        if (!box || !r) return;
        if (myAnswer != null) S.myVotes[actId] = String(myAnswer);
        const mine = S.myVotes[actId];
        const ended = r.status === 'ended';
        if (r.type === 'signin') {
            const done = mine != null;
            box.innerHTML = `<div class="cc-act-head">📋 ${esc(r.title)} ${ended ? '<span class="cc-act-tag">已结束</span>' : ''}</div>
                <div class="cc-act-sign">已签到 <b>${r.responded}</b> / ${r.total}</div>
                <div class="cc-act-names">${r.signed.map(s => esc(s.username)).join('、') || '暂无'}</div>
                ${(!S.isTeacher && !ended) ? `<button class="cc-act-btn" ${done ? 'disabled' : ''}>${done ? '✓ 已签到' : '点击签到'}</button>` : ''}
                ${(S.isTeacher && !ended) ? `<button class="cc-act-end">结束签到</button>` : ''}`;
            const b = box.querySelector('.cc-act-btn'); if (b && !done) b.onclick = () => respondActivity(actId, null);
            const e = box.querySelector('.cc-act-end'); if (e) e.onclick = () => endActivity(actId);
            return;
        }
        // vote 柱状图
        const max = Math.max(1, ...r.options.map(o => o.count));
        const bars = r.options.map((o, i) => {
            const pct = r.responded ? Math.round(o.count / r.responded * 100) : 0;
            const w = Math.round(o.count / max * 100);
            const picked = String(i) === mine;
            return `<div class="cc-bar-row ${picked ? 'picked' : ''}" data-i="${i}">
                <div class="cc-bar-label">${esc(o.label)}${picked ? ' ✓' : ''}</div>
                <div class="cc-bar-track"><div class="cc-bar-fill" style="width:${w}%"></div></div>
                <div class="cc-bar-val">${o.count} · ${pct}%</div></div>`;
        }).join('');
        box.innerHTML = `<div class="cc-act-head">🗳️ ${esc(r.question || r.title)} ${ended ? '<span class="cc-act-tag">已结束</span>' : '<span class="cc-act-tag live">进行中</span>'}</div>
            <div class="cc-bars">${bars}</div>
            <div class="cc-act-foot">${r.responded} 人已投票${(!S.isTeacher && !ended) ? ' · 点击选项投票/改票' : ''}</div>
            ${(S.isTeacher && !ended) ? `<button class="cc-act-end">结束投票</button>` : ''}`;
        if (!S.isTeacher && !ended) {
            box.querySelectorAll('.cc-bar-row').forEach(row => row.onclick = () => respondActivity(actId, parseInt(row.dataset.i)));
        }
        const e = box.querySelector('.cc-act-end'); if (e) e.onclick = () => endActivity(actId);
    }

    function flyDanmaku(text) {
        const layer = S.danmakuLayer; if (!layer || !S.danmakuOn) return;
        const b = document.createElement('div'); b.className = 'cc-bullet'; b.textContent = text;
        b.style.top = Math.random() * 70 + 5 + '%';
        b.style.animationDuration = (6 + Math.random() * 4) + 's';
        layer.appendChild(b);
        setTimeout(() => b.remove(), 11000);
    }

    function showDing(text, from) {
        const mask = document.createElement('div'); mask.className = 'cc-ding-mask';
        mask.innerHTML = `<div class="cc-ding-box"><h2>🔔 DING 强提醒</h2><p>${esc(text)}</p>
            <p style="color:#8b98a5;font-size:12px;margin-top:6px">来自 ${esc(from || '老师')}</p>
            <button>我知道了</button></div>`;
        mask.querySelector('button').onclick = () => mask.remove();
        document.body.appendChild(mask);
        try { new AudioContext(); } catch {}
    }

    // 由页面 WS 委派
    function handleWS(m) {
        if (!m || !m.roomId || m.roomId !== S.roomId) {
            if (m && m.type === 'chat_ding') { showDing(m.text, m.from); }
            return;
        }
        switch (m.type) {
            case 'chat_message':
                appendMessage(m.message, true);
                if (m.isDanmaku && m.message.type === 'text') flyDanmaku(m.message.content);
                break;
            case 'chat_reaction': {
                const d = document.querySelector('.cc-msg[data-id="' + m.messageId + '"]');
                if (d) { const rs = m.reactions.map(r => ({ emoji: r.emoji, count: r.cnt, mine: false })); renderReactions(d, rs); }
                break;
            }
            case 'chat_recall': {
                const d = document.querySelector('.cc-msg[data-id="' + m.messageId + '"] .cc-bubble');
                if (d) { d.classList.add('deleted'); d.textContent = '[消息已撤回]'; }
                break;
            }
            case 'chat_pin_update': renderPinned(m.pinned || []); break;
            case 'chat_announcement': setAnnounce(m.announcement); break;
            case 'chat_mute_all': {
                const b = document.getElementById('ccMuteAll'); if (b) { b.classList.toggle('on', m.muted); b.textContent = m.muted ? '解除禁言' : '全员禁言'; }
                break;
            }
            case 'chat_danmaku_mode': S.danmakuOn = m.on; updateDanmakuBtn(); break;
            case 'chat_ding': showDing(m.text, m.from); break;
            case 'chat_activity_update': renderActivity(m.activityId, m.results, S.myVotes[m.activityId]); break;
        }
    }

    window.ClassroomChat = { init, handleWS, flyDanmaku, getRoomId: () => S.roomId };
})();
