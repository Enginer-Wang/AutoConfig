/**
 * 示例课件种子数据
 * 自动创建几位示例教师账号和分学段/学科的演示课件
 * 真实生成 data/sites/<teacher>/<slug>/index.html 文件，确保可访问 / 下载 / 编辑
 */
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const SITES_DIR = path.join(__dirname, '..', 'data', 'sites');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ========== 课件 HTML 生成器 ==========

function quizPage(opts) {
    const { title, subject, level, description, questions, theme = '#6366f1' } = opts;
    const qsJson = JSON.stringify(questions);
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Microsoft YaHei",system-ui,sans-serif;background:linear-gradient(135deg,#0f172a,#1e1b4b);color:#e2e8f0;min-height:100vh;padding:20px}
.app{max-width:720px;margin:0 auto;background:rgba(30,41,59,.7);border-radius:20px;padding:32px;box-shadow:0 20px 60px rgba(0,0,0,.4);backdrop-filter:blur(10px)}
.header{text-align:center;margin-bottom:24px;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:20px}
.header .badge{display:inline-block;padding:4px 12px;background:${theme};color:#fff;border-radius:12px;font-size:.8rem;margin-bottom:12px}
h1{font-size:1.6rem;margin-bottom:8px;background:linear-gradient(135deg,${theme},#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.desc{color:#94a3b8;font-size:.95rem}
.progress{height:8px;background:rgba(255,255,255,.08);border-radius:4px;margin:20px 0;overflow:hidden}
.progress-fill{height:100%;background:linear-gradient(90deg,${theme},#ec4899);transition:width .3s}
.score-bar{display:flex;justify-content:space-between;color:#94a3b8;font-size:.9rem;margin-bottom:20px}
.q-card{background:rgba(15,23,42,.6);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:24px;margin-bottom:16px}
.q-num{color:${theme};font-size:.85rem;font-weight:700;margin-bottom:8px}
.q-text{font-size:1.1rem;margin-bottom:18px;line-height:1.6}
.options{display:grid;gap:10px}
.opt{padding:12px 16px;background:rgba(255,255,255,.05);border:2px solid transparent;border-radius:10px;cursor:pointer;transition:all .2s;font-size:.95rem}
.opt:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.15)}
.opt.selected{border-color:${theme};background:rgba(99,102,241,.15)}
.opt.correct{border-color:#22c55e;background:rgba(34,197,94,.15)}
.opt.wrong{border-color:#ef4444;background:rgba(239,68,68,.15)}
.actions{display:flex;justify-content:space-between;gap:12px;margin-top:20px}
.btn{padding:12px 28px;border:none;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
.btn-primary{background:${theme};color:#fff}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 10px 25px rgba(99,102,241,.3)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-ghost{background:transparent;color:#94a3b8;border:1px solid rgba(255,255,255,.15)}
.result{text-align:center;padding:40px 20px}
.result .icon{font-size:5rem;margin-bottom:16px}
.result h2{font-size:1.8rem;margin-bottom:8px}
.result .score{font-size:3rem;font-weight:800;background:linear-gradient(135deg,${theme},#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:16px 0}
.feedback{margin-top:14px;padding:12px;border-radius:8px;font-size:.9rem;display:none}
.feedback.ok{background:rgba(34,197,94,.1);color:#86efac;display:block}
.feedback.no{background:rgba(239,68,68,.1);color:#fca5a5;display:block}
.exp{margin-top:8px;color:#94a3b8;font-size:.85rem;font-style:italic}
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <div class="badge">${level} · ${subject}</div>
    <h1>${title}</h1>
    <div class="desc">${description}</div>
  </div>
  <div id="game"></div>
</div>
<script>
const QUESTIONS = ${qsJson};
const game = document.getElementById('game');
let cur = 0, score = 0, picked = null, locked = false;

function render() {
  if (cur >= QUESTIONS.length) return finish();
  const q = QUESTIONS[cur];
  const pct = Math.round(cur/QUESTIONS.length*100);
  game.innerHTML = \`
    <div class="score-bar"><span>题目 \${cur+1}/\${QUESTIONS.length}</span><span>当前得分: \${score}</span></div>
    <div class="progress"><div class="progress-fill" style="width:\${pct}%"></div></div>
    <div class="q-card">
      <div class="q-num">第 \${cur+1} 题</div>
      <div class="q-text">\${q.q}</div>
      <div class="options" id="opts">
        \${q.options.map((o,i)=>\`<div class="opt" data-i="\${i}" onclick="pick(\${i})">\${String.fromCharCode(65+i)}. \${o}</div>\`).join('')}
      </div>
      <div class="feedback" id="fb"></div>
      <div class="actions">
        <button class="btn btn-ghost" onclick="skip()">跳过</button>
        <button class="btn btn-primary" id="okBtn" disabled onclick="confirm()">确认提交</button>
      </div>
    </div>
  \`;
  picked = null; locked = false;
}
function pick(i) {
  if (locked) return;
  picked = i;
  document.querySelectorAll('.opt').forEach((el,idx)=>{
    el.classList.toggle('selected', idx===i);
  });
  document.getElementById('okBtn').disabled = false;
}
function confirm() {
  if (locked || picked === null) return;
  locked = true;
  const q = QUESTIONS[cur];
  const ok = picked === q.answer;
  const opts = document.querySelectorAll('.opt');
  opts[q.answer].classList.add('correct');
  if (!ok) opts[picked].classList.add('wrong');
  const fb = document.getElementById('fb');
  fb.className = 'feedback ' + (ok?'ok':'no');
  fb.innerHTML = (ok?'✅ 回答正确！':'❌ 回答错误') + (q.explain?'<div class="exp">💡 '+q.explain+'</div>':'');
  if (ok) score += 10;
  document.getElementById('okBtn').textContent = cur+1>=QUESTIONS.length?'查看成绩':'下一题 →';
  document.getElementById('okBtn').onclick = ()=>{cur++;render();};
  document.getElementById('okBtn').disabled = false;
  reportProgress(false);
}
function skip() { cur++; render(); }
function finish() {
  const max = QUESTIONS.length * 10;
  const pct = Math.round(score/max*100);
  const emoji = pct>=90?'🏆':pct>=70?'🎉':pct>=50?'👍':'💪';
  game.innerHTML = \`
    <div class="result">
      <div class="icon">\${emoji}</div>
      <h2>练习完成！</h2>
      <div class="score">\${score} / \${max}</div>
      <div class="desc">正确率 \${pct}%</div>
      <button class="btn btn-primary" onclick="cur=0;score=0;render();" style="margin-top:24px">🔄 再来一次</button>
    </div>
  \`;
  reportProgress(true);
}
function reportProgress(completed) {
  // 自动上报学生练习记录（同源 cookie 携带）
  try {
    const m = location.pathname.match(/^\\/site\\/[^\\/]+\\/[^\\/]+/);
    fetch('/api/exercises/submit', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      credentials: 'same-origin',
      body: JSON.stringify({
        projectId: window.__PROJECT_ID__ || 0,
        score: score,
        maxScore: QUESTIONS.length*10,
        levelReached: cur,
        completed: completed?1:0,
        timeSpent: Math.floor((Date.now()-startTs)/1000)
      })
    }).catch(()=>{});
  } catch(e) {}
}
const startTs = Date.now();
render();
</script>
</body>
</html>`;
}

function infoPage(opts) {
    const { title, subject, level, description, sections, theme = '#6366f1' } = opts;
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Microsoft YaHei",system-ui,sans-serif;background:linear-gradient(180deg,#f8fafc,#e0e7ff);color:#1e293b;min-height:100vh}
.hero{padding:60px 20px;text-align:center;background:linear-gradient(135deg,${theme},#8b5cf6);color:#fff}
.hero .badge{display:inline-block;padding:4px 14px;background:rgba(255,255,255,.2);border-radius:14px;font-size:.85rem;margin-bottom:16px}
.hero h1{font-size:2.4rem;margin-bottom:12px;font-weight:800}
.hero p{font-size:1.05rem;opacity:.9;max-width:600px;margin:0 auto;line-height:1.6}
.container{max-width:840px;margin:-20px auto 40px;padding:0 20px;position:relative}
.section{background:#fff;border-radius:16px;padding:32px;margin-bottom:20px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
.section h2{color:${theme};font-size:1.4rem;margin-bottom:16px;border-bottom:2px solid #f1f5f9;padding-bottom:10px}
.section .body{font-size:1rem;line-height:1.8;color:#334155}
.section .body p{margin-bottom:12px}
.section .body ul,.section .body ol{margin:12px 0 12px 24px}
.section .body li{margin-bottom:6px}
.section .body strong{color:${theme}}
.formula{background:#f8fafc;border-left:4px solid ${theme};padding:14px 18px;margin:14px 0;border-radius:6px;font-family:"Cambria Math",serif;font-size:1.1rem}
.tip{background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin:12px 0;border-radius:6px;color:#78350f}
.example{background:#dbeafe;border-left:4px solid #3b82f6;padding:14px 18px;margin:14px 0;border-radius:6px;color:#1e3a8a}
footer{text-align:center;padding:30px;color:#64748b;font-size:.85rem}
</style>
</head>
<body>
<div class="hero">
  <div class="badge">📖 ${level} · ${subject}</div>
  <h1>${title}</h1>
  <p>${description}</p>
</div>
<div class="container">
${sections.map(s => `  <div class="section"><h2>${s.h}</h2><div class="body">${s.body}</div></div>`).join('\n')}
</div>
<footer>📚 课件由临港区教师网页课件共享平台提供</footer>
</body>
</html>`;
}

// ========== 课件数据 ==========
function buildCourseware() {
    return [
        // ===== 小学 =====
        {
            teacher: 'teacher_yuwen',
            level: 'elementary', subject: '语文',
            slug: 'gushi-jingsong',
            name: '古诗背诵小测验',
            description: '小学语文经典古诗背诵闯关，10道精选题目，配以注解。',
            html: quizPage({
                title: '🌸 古诗背诵小测验', subject: '语文', level: '小学',
                description: '挑战经典古诗，看看你能记住多少？',
                theme: '#ec4899',
                questions: [
                    { q: '"床前明月光，疑是地上霜"出自哪首诗？', options: ['静夜思', '春晓', '咏鹅', '登鹳雀楼'], answer: 0, explain: '出自李白《静夜思》。' },
                    { q: '"两个黄鹂鸣翠柳"的下一句是？', options: ['一行白鹭上青天', '门泊东吴万里船', '窗含西岭千秋雪', '日照香炉生紫烟'], answer: 0, explain: '出自杜甫《绝句》。' },
                    { q: '"鹅鹅鹅，曲项向天歌"的作者是？', options: ['骆宾王', '李白', '杜甫', '王维'], answer: 0, explain: '《咏鹅》是骆宾王7岁所作。' },
                    { q: '"白日依山尽"的下一句是？', options: ['黄河入海流', '更上一层楼', '欲穷千里目', '海上明月生'], answer: 0 },
                    { q: '"春眠不觉晓"出自哪首诗？', options: ['春晓', '春望', '春行', '春归'], answer: 0, explain: '孟浩然《春晓》。' },
                    { q: '"谁知盘中餐"的下一句是？', options: ['粒粒皆辛苦', '日日皆耕耘', '滴滴是汗水', '颗颗都珍贵'], answer: 0, explain: '李绅《悯农》。' },
                    { q: '"举头望明月"的下一句是？', options: ['低头思故乡', '低头看月光', '低头默无言', '低头念家乡'], answer: 0 },
                    { q: '"红掌拨清波"前一句是？', options: ['白毛浮绿水', '曲项向天歌', '鹅鹅鹅', '一行白鹭飞'], answer: 0 },
                    { q: '"小荷才露尖尖角"出自？', options: ['《小池》', '《晓出净慈寺》', '《池上》', '《荷花》'], answer: 0, explain: '杨万里《小池》。' },
                    { q: '"夜来风雨声"的下一句是？', options: ['花落知多少', '处处闻啼鸟', '春眠不觉晓', '吹梦到江南'], answer: 0 }
                ]
            })
        },
        {
            teacher: 'teacher_shuxue',
            level: 'elementary', subject: '数学',
            slug: 'jiufa-koujue',
            name: '九九乘法口诀挑战',
            description: '小学数学经典：九九乘法口诀闯关练习，提高计算速度。',
            html: quizPage({
                title: '🔢 九九乘法口诀挑战', subject: '数学', level: '小学',
                description: '看看你的乘法口诀掌握得怎么样？',
                theme: '#3b82f6',
                questions: [
                    { q: '6 × 7 = ?', options: ['42', '36', '48', '49'], answer: 0, explain: '六七四十二' },
                    { q: '8 × 9 = ?', options: ['72', '64', '81', '63'], answer: 0, explain: '八九七十二' },
                    { q: '7 × 8 = ?', options: ['56', '54', '49', '64'], answer: 0, explain: '七八五十六' },
                    { q: '9 × 9 = ?', options: ['81', '72', '99', '90'], answer: 0, explain: '九九八十一' },
                    { q: '5 × 6 = ?', options: ['30', '25', '36', '35'], answer: 0 },
                    { q: '4 × 8 = ?', options: ['32', '24', '36', '28'], answer: 0 },
                    { q: '3 × 9 = ?', options: ['27', '21', '24', '36'], answer: 0 },
                    { q: '7 × 7 = ?', options: ['49', '42', '56', '63'], answer: 0 },
                    { q: '6 × 8 = ?', options: ['48', '54', '42', '56'], answer: 0 },
                    { q: '4 × 9 = ?', options: ['36', '32', '40', '45'], answer: 0 }
                ]
            })
        },
        {
            teacher: 'teacher_yingyu',
            level: 'elementary', subject: '英语',
            slug: 'animals-vocab',
            name: '动物英语单词学习',
            description: '通过有趣的图文，认识 10 种常见动物的英文名。',
            html: infoPage({
                title: '🐾 动物英语单词学习', subject: '英语', level: '小学',
                description: '一起来认识可爱的小动物吧！点击页面下方按钮可以做配套练习。',
                theme: '#22c55e',
                sections: [
                    { h: '🐱 宠物类 Pets', body: '<ul><li><strong>cat</strong> [kæt] - 猫 🐱</li><li><strong>dog</strong> [dɔːɡ] - 狗 🐶</li><li><strong>rabbit</strong> [ˈræbɪt] - 兔子 🐰</li><li><strong>hamster</strong> [ˈhæmstər] - 仓鼠 🐹</li></ul><div class="example">📌 示例: I have a cute <strong>cat</strong>. (我有一只可爱的猫。)</div>' },
                    { h: '🐘 野生动物 Wild Animals', body: '<ul><li><strong>elephant</strong> [ˈeləfənt] - 大象 🐘</li><li><strong>tiger</strong> [ˈtaɪɡər] - 老虎 🐯</li><li><strong>lion</strong> [ˈlaɪən] - 狮子 🦁</li><li><strong>monkey</strong> [ˈmʌŋki] - 猴子 🐵</li></ul><div class="tip">💡 记忆小窍门：把单词和图片一起记，效率更高！</div>' },
                    { h: '🐦 鸟类 Birds', body: '<ul><li><strong>bird</strong> [bɜːrd] - 鸟 🐦</li><li><strong>duck</strong> [dʌk] - 鸭子 🦆</li><li><strong>chicken</strong> [ˈtʃɪkɪn] - 鸡 🐔</li><li><strong>owl</strong> [aʊl] - 猫头鹰 🦉</li></ul>' }
                ]
            })
        },
        {
            teacher: 'teacher_kexue',
            level: 'elementary', subject: '科学',
            slug: 'siji-bianhua',
            name: '四季的变化',
            description: '小学科学：探索春夏秋冬的奥秘，了解四季变化原因。',
            html: infoPage({
                title: '🌸 四季的变化', subject: '科学', level: '小学',
                description: '为什么会有春夏秋冬？让我们一起来探究自然的奥秘吧！',
                theme: '#10b981',
                sections: [
                    { h: '🌍 地球公转与四季', body: '<p>地球围绕<strong>太阳公转</strong>一周大约需要 365 天（一年）。</p><p>由于地球的自转轴是<strong>倾斜</strong>的，所以阳光照射地球不同地方的角度不同，这就形成了四季。</p><div class="formula">地球自转轴倾角 ≈ 23.5°</div>' },
                    { h: '🌸 春天的特征', body: '<ul><li>气温慢慢回升</li><li>植物发芽、开花 🌷</li><li>动物从冬眠中苏醒 🐻</li><li>白天慢慢变长</li></ul>' },
                    { h: '☀️ 夏天的特征', body: '<ul><li>天气炎热，多雨 🌧️</li><li>植物茂盛生长</li><li>白天最长，黑夜最短</li><li>很多昆虫活跃 🦋</li></ul>' },
                    { h: '🍂 秋天的特征', body: '<ul><li>气温下降，凉爽宜人</li><li>树叶变黄、变红、落下 🍁</li><li>是收获的季节 🌾</li></ul>' },
                    { h: '❄️ 冬天的特征', body: '<ul><li>天气寒冷，可能下雪 ❄️</li><li>很多动物冬眠</li><li>白天最短，黑夜最长</li></ul><div class="tip">💡 思考：为什么南半球和北半球的季节是相反的？</div>' }
                ]
            })
        },

        // ===== 初中 =====
        {
            teacher: 'teacher_wuli',
            level: 'middle', subject: '物理',
            slug: 'niudun-dingli',
            name: '牛顿三大定律详解',
            description: '初中物理：系统讲解牛顿三大运动定律，配公式和实例。',
            html: infoPage({
                title: '⚛️ 牛顿三大定律', subject: '物理', level: '初中',
                description: '经典力学的基石——牛顿三大运动定律，请仔细阅读并理解。',
                theme: '#6366f1',
                sections: [
                    { h: '第一定律：惯性定律', body: '<p>一切物体在<strong>没有受到外力作用</strong>时，总保持<strong>静止状态或匀速直线运动状态</strong>。</p><div class="formula">∑F = 0 ⇒ v = 常量（包括 v=0）</div><div class="example">📌 例子：行驶的汽车突然刹车，乘客会向前倾，这是因为身体的惯性。</div>' },
                    { h: '第二定律：F = ma', body: '<p>物体加速度的<strong>大小</strong>跟作用力成正比，跟物体的质量成反比；加速度的<strong>方向</strong>跟作用力的方向相同。</p><div class="formula">F = m·a　（单位：N = kg·m/s²）</div><div class="tip">💡 单位换算：1 N = 1 kg·m/s²</div><div class="example">📌 例子：用同样的力推一辆小车比推一辆大车，小车获得的加速度更大。</div>' },
                    { h: '第三定律：作用与反作用', body: '<p>两个物体之间的作用力和反作用力，总是大小相等，方向相反，作用在<strong>同一条直线</strong>上。</p><div class="formula">F<sub>AB</sub> = -F<sub>BA</sub></div><div class="example">📌 例子：你拍桌子，桌子也在拍你（所以会疼）。火箭发射也是反作用力的应用。</div>' }
                ]
            })
        },
        {
            teacher: 'teacher_huaxue',
            level: 'middle', subject: '化学',
            slug: 'yuansu-zhouqibiao',
            name: '元素周期表小测',
            description: '初中化学：检验你对常见元素符号和性质的掌握程度。',
            html: quizPage({
                title: '🧪 元素周期表小测', subject: '化学', level: '初中',
                description: '回忆常见元素的符号、原子序数与性质。',
                theme: '#f59e0b',
                questions: [
                    { q: '元素 H 代表什么？', options: ['氢', '氦', '硫', '汞'], answer: 0, explain: 'H = Hydrogen（氢）' },
                    { q: '钠的元素符号是？', options: ['Na', 'N', 'K', 'Ca'], answer: 0, explain: 'Na 来自拉丁语 Natrium' },
                    { q: '空气中含量最多的气体是？', options: ['氮气', '氧气', '二氧化碳', '氩气'], answer: 0, explain: '氮气约占 78%' },
                    { q: '水的化学式是？', options: ['H₂O', 'HO', 'OH', 'H₂O₂'], answer: 0 },
                    { q: '氯化钠俗称什么？', options: ['食盐', '碱面', '味精', '小苏打'], answer: 0 },
                    { q: '原子序数为 6 的元素是？', options: ['碳', '氧', '氮', '氟'], answer: 0 },
                    { q: '酸雨的主要成分是？', options: ['硫酸', '盐酸', '硝酸', '醋酸'], answer: 0 },
                    { q: '可以用来灭火的常见气体是？', options: ['二氧化碳', '一氧化碳', '甲烷', '氢气'], answer: 0 },
                    { q: '哪种元素是人体骨骼的主要成分？', options: ['钙', '铁', '钾', '钠'], answer: 0 },
                    { q: '黄金的元素符号是？', options: ['Au', 'Ag', 'Al', 'As'], answer: 0, explain: 'Au 来自拉丁语 Aurum' }
                ]
            })
        },
        {
            teacher: 'teacher_shengwu',
            level: 'middle', subject: '生物',
            slug: 'xibao-jiegou',
            name: '细胞结构图解',
            description: '初中生物：通过图文了解动植物细胞的基本结构和功能。',
            html: infoPage({
                title: '🧬 细胞结构图解', subject: '生物', level: '初中',
                description: '细胞是生物体结构和功能的基本单位。',
                theme: '#10b981',
                sections: [
                    { h: '🌱 植物细胞结构', body: '<p>植物细胞主要由以下部分组成：</p><ul><li><strong>细胞壁</strong>：保护和支持细胞</li><li><strong>细胞膜</strong>：控制物质进出</li><li><strong>细胞质</strong>：进行各种生化反应</li><li><strong>细胞核</strong>：含有遗传物质</li><li><strong>叶绿体</strong>：进行光合作用 🌿</li><li><strong>液泡</strong>：储存水分和营养物质</li></ul>' },
                    { h: '🐾 动物细胞结构', body: '<p>动物细胞与植物细胞的区别：</p><ul><li><strong>没有</strong>细胞壁</li><li><strong>没有</strong>叶绿体</li><li><strong>没有</strong>大液泡</li><li>有<strong>中心体</strong>（参与细胞分裂）</li></ul><div class="example">📌 思考：为什么动物细胞没有细胞壁却能保持形状？</div>' },
                    { h: '⚡ 细胞的生命活动', body: '<ul><li>呼吸作用：分解营养物质，释放能量</li><li>光合作用（仅植物）：制造有机物</li><li>分裂：细胞数量增加</li><li>分化：细胞形成不同类型组织</li></ul><div class="tip">💡 一切生命活动都以细胞为基础。</div>' }
                ]
            })
        },
        {
            teacher: 'teacher_lishi',
            level: 'middle', subject: '历史',
            slug: 'sichouzhilu-quiz',
            name: '丝绸之路知识闯关',
            description: '初中历史：通过 10 道题了解古代丝绸之路的历史与文化。',
            html: quizPage({
                title: '📜 丝绸之路知识闯关', subject: '历史', level: '初中',
                description: '探索古代东西方文明交流的伟大通道。',
                theme: '#a855f7',
                questions: [
                    { q: '丝绸之路是哪个朝代开辟的？', options: ['汉朝', '唐朝', '宋朝', '元朝'], answer: 0, explain: '汉武帝时期由张骞开辟。' },
                    { q: '开辟丝绸之路的是哪位历史人物？', options: ['张骞', '玄奘', '郑和', '霍去病'], answer: 0 },
                    { q: '丝绸之路的起点是？', options: ['长安', '洛阳', '咸阳', '北京'], answer: 0 },
                    { q: '丝绸之路主要运往西方的商品是？', options: ['丝绸', '茶叶', '瓷器', '铁器'], answer: 0 },
                    { q: '从西方传入中国的农作物有？', options: ['葡萄、核桃、苜蓿', '水稻、小麦', '玉米、土豆', '高粱、大豆'], answer: 0 },
                    { q: '海上丝绸之路兴盛于哪个朝代？', options: ['唐宋', '秦汉', '元明', '清朝'], answer: 0 },
                    { q: '丝绸之路对世界文明的贡献主要是？', options: ['促进东西方经济文化交流', '改变了世界版图', '推广了汉语', '传播了佛教'], answer: 0 },
                    { q: '丝绸之路上重要的中转城市有？', options: ['敦煌', '上海', '南京', '广州'], answer: 0 },
                    { q: '"丝绸之路"这个名称是谁提出的？', options: ['德国地理学家李希霍芬', '马可波罗', '哥伦布', '玄奘'], answer: 0, explain: '1877年由德国地理学家李希霍芬提出。' },
                    { q: '现代"一带一路"中的"一带"指？', options: ['丝绸之路经济带', '海上丝绸之路', '欧亚大陆桥', '中欧班列'], answer: 0 }
                ]
            })
        },

        // ===== 高中 =====
        {
            teacher: 'teacher_gaoshu',
            level: 'high', subject: '数学',
            slug: 'sanjiaohanshu',
            name: '三角函数基础',
            description: '高中数学：三角函数的定义、性质与基本公式总结。',
            html: infoPage({
                title: '📐 三角函数基础', subject: '数学', level: '高中',
                description: '本课件系统介绍三角函数的定义和重要公式。',
                theme: '#6366f1',
                sections: [
                    { h: '一、基本定义', body: '<p>在直角三角形中，对于角 θ：</p><div class="formula">sin θ = 对边/斜边<br>cos θ = 邻边/斜边<br>tan θ = 对边/邻边 = sin θ / cos θ</div><p>在<strong>单位圆</strong>中：点 P(x, y) 在单位圆上对应角度 θ，则 sin θ = y, cos θ = x.</p>' },
                    { h: '二、特殊角的三角函数值', body: '<ul><li>sin 0° = 0, cos 0° = 1</li><li>sin 30° = 1/2, cos 30° = √3/2</li><li>sin 45° = cos 45° = √2/2</li><li>sin 60° = √3/2, cos 60° = 1/2</li><li>sin 90° = 1, cos 90° = 0</li></ul>' },
                    { h: '三、基本恒等式', body: '<div class="formula">sin²θ + cos²θ = 1<br>1 + tan²θ = sec²θ<br>tan θ = sin θ / cos θ</div>' },
                    { h: '四、和角公式', body: '<div class="formula">sin(α±β) = sin α cos β ± cos α sin β<br>cos(α±β) = cos α cos β ∓ sin α sin β<br>tan(α±β) = (tan α ± tan β) / (1 ∓ tan α tan β)</div><div class="tip">💡 记忆口诀："正余余正符号同, 余余正正符号反"</div>' },
                    { h: '五、二倍角公式', body: '<div class="formula">sin 2α = 2 sin α cos α<br>cos 2α = cos²α − sin²α = 2cos²α − 1 = 1 − 2sin²α<br>tan 2α = 2 tan α / (1 − tan²α)</div>' }
                ]
            })
        },
        {
            teacher: 'teacher_gaowuli',
            level: 'high', subject: '物理',
            slug: 'donglixue-quiz',
            name: '高中力学练习',
            description: '高中物理力学综合练习题，涵盖运动学、动力学。',
            html: quizPage({
                title: '⚛️ 高中力学练习', subject: '物理', level: '高中',
                description: '检验你的力学知识，难度逐步提升。',
                theme: '#3b82f6',
                questions: [
                    { q: '关于自由落体运动，下列说法正确的是？', options: ['加速度大小为 g, 方向竖直向下', '初速度不为零', '时间越长，加速度越大', '物体越重，下落越快'], answer: 0, explain: '自由落体加速度恒为 g ≈ 9.8 m/s²' },
                    { q: '一个质量为 2 kg 的物体受到 10 N 的合力，加速度为？', options: ['5 m/s²', '20 m/s²', '0.2 m/s²', '12 m/s²'], answer: 0, explain: 'a = F/m = 10/2 = 5' },
                    { q: '匀速圆周运动的物体所受合力方向？', options: ['指向圆心', '沿切线方向', '与运动方向相同', '为零'], answer: 0 },
                    { q: '关于摩擦力，下列说法正确的是？', options: ['摩擦力可能是动力', '摩擦力总是阻力', '摩擦力方向与运动方向相同', '摩擦力大小与接触面积成正比'], answer: 0, explain: '例如传送带上随之运动的物体' },
                    { q: '动量守恒定律成立的条件是？', options: ['系统不受外力或合外力为零', '系统内部无相互作用', '物体匀速运动', '物体处于平衡状态'], answer: 0 },
                    { q: '功的计算公式 W = ?', options: ['F·s·cosθ', 'F·s', 'F/s', 'm·v'], answer: 0, explain: 'θ 为力与位移的夹角' },
                    { q: '动能的表达式是？', options: ['½mv²', 'mv', 'mgh', 'F·s'], answer: 0 },
                    { q: '机械能守恒定律的条件是？', options: ['只有重力或弹力做功', '系统不受任何外力', '物体匀速运动', '没有摩擦'], answer: 0 },
                    { q: '简谐振动的周期与什么有关？', options: ['仅与回复力系数和质量有关', '与振幅有关', '与初相有关', '与重力有关'], answer: 0 },
                    { q: '万有引力定律的表达式 F = ?', options: ['G·m₁m₂/r²', 'G·m₁m₂/r', 'G·m₁/m₂', 'G·m·r²'], answer: 0 }
                ]
            })
        },
        {
            teacher: 'teacher_gaoyu',
            level: 'high', subject: '语文',
            slug: 'wenyanwen-changshi',
            name: '文言文常识精要',
            description: '高中语文：常见文言文实词、虚词、句式归纳。',
            html: infoPage({
                title: '📖 文言文常识精要', subject: '语文', level: '高中',
                description: '掌握高考必考的文言文基础知识。',
                theme: '#ec4899',
                sections: [
                    { h: '一、常见实词', body: '<ul><li><strong>之</strong>：①往；②的；③代词；④主谓间取消独立性</li><li><strong>而</strong>：①表并列；②表承接；③表转折；④表修饰</li><li><strong>以</strong>：①用、拿；②因为；③认为；④来、用来</li><li><strong>于</strong>：①在、从；②向、对；③比；④被</li><li><strong>为</strong>：①做、当作；②被；③替、给；④因为</li></ul>' },
                    { h: '二、特殊句式', body: '<p>文言文中常见特殊句式：</p><ul><li><strong>判断句</strong>："...者...也" 例：陈胜者，阳城人也。</li><li><strong>被动句</strong>："为...所..." "见..." 例：吾长见笑于大方之家。</li><li><strong>倒装句</strong>：宾语前置、定语后置、状语后置</li><li><strong>省略句</strong>：省略主语、宾语、介词等</li></ul>' },
                    { h: '三、词类活用', body: '<ul><li>名词作动词：例 "沛公军霸上"（军=驻扎）</li><li>名词作状语：例 "其一犬坐于前"（犬=像狗一样）</li><li>使动用法：例 "项伯杀人，臣活之"（活=使...活）</li><li>意动用法：例 "渔人甚异之"（异=以...为奇）</li></ul><div class="tip">💡 判断词类活用，关键看语境和词在句中的位置。</div>' }
                ]
            })
        },
        {
            teacher: 'teacher_gaoying',
            level: 'high', subject: '英语',
            slug: 'gaokao-cihui',
            name: '高考核心词汇练习',
            description: '高中英语：高考高频词汇辨析训练。',
            html: quizPage({
                title: '🔤 高考核心词汇练习', subject: '英语', level: '高中',
                description: '辨析常见易混词，提升阅读和写作能力。',
                theme: '#22c55e',
                questions: [
                    { q: 'Choose the correct word: She ___ in Beijing for ten years.', options: ['has lived', 'lived', 'lives', 'is living'], answer: 0, explain: '现在完成时表示持续到现在的动作' },
                    { q: '"effect" 与 "affect" 的区别是？', options: ['effect是名词，affect是动词', '都是动词', '都是名词', '没有区别'], answer: 0 },
                    { q: 'The book is ___. (有趣的)', options: ['interesting', 'interested', 'interest', 'interestingly'], answer: 0, explain: '描述事物用 -ing 形式' },
                    { q: 'I am ___ in physics. (感兴趣)', options: ['interested', 'interesting', 'interest', 'interestly'], answer: 0, explain: '描述人感受用 -ed 形式' },
                    { q: '"either... or..." 谓语动词遵循?', options: ['就近原则', '就远原则', '都用单数', '都用复数'], answer: 0 },
                    { q: '"despite" 后面接？', options: ['名词或动名词', '从句', '动词原形', '形容词'], answer: 0, explain: 'despite 是介词' },
                    { q: 'It is high time that we ___.', options: ['went', 'go', 'will go', 'have gone'], answer: 0, explain: '虚拟语气用过去式' },
                    { q: '"borrow" 和 "lend" 的区别？', options: ['borrow 是借入，lend 是借出', '都是借入', '都是借出', '没区别'], answer: 0 },
                    { q: 'Not only ___ he clever, but also hardworking.', options: ['is', 'he is', 'does', 'was'], answer: 0, explain: 'Not only 置于句首要倒装' },
                    { q: 'The reason ___ he was late was that the bus broke down.', options: ['why', 'which', 'that', 'where'], answer: 0 }
                ]
            })
        },
        {
            teacher: 'teacher_gaodili',
            level: 'high', subject: '地理',
            slug: 'qihou-leixing',
            name: '世界主要气候类型',
            description: '高中地理：系统了解全球 11 种主要气候类型及其分布。',
            html: infoPage({
                title: '🌍 世界主要气候类型', subject: '地理', level: '高中',
                description: '掌握气候类型对解答区域地理题非常重要。',
                theme: '#0ea5e9',
                sections: [
                    { h: '一、热带气候', body: '<ul><li><strong>热带雨林气候</strong>：终年高温多雨，分布于赤道附近，如亚马孙</li><li><strong>热带草原气候</strong>：干湿季分明，分布于热带雨林两侧</li><li><strong>热带季风气候</strong>：季节降水显著，主要在南亚、东南亚</li><li><strong>热带沙漠气候</strong>：终年炎热干燥，如撒哈拉沙漠</li></ul>' },
                    { h: '二、亚热带气候', body: '<ul><li><strong>亚热带季风气候</strong>：夏季高温多雨，冬季温和少雨（中国南方）</li><li><strong>地中海气候</strong>：夏季炎热干燥，冬季温和多雨</li></ul><div class="tip">💡 地中海气候是世界上唯一夏干冬雨的气候</div>' },
                    { h: '三、温带气候', body: '<ul><li><strong>温带季风气候</strong>：四季分明，雨热同期（中国北方）</li><li><strong>温带海洋气候</strong>：终年温和湿润（西欧）</li><li><strong>温带大陆性气候</strong>：冬冷夏热，年较差大</li></ul>' },
                    { h: '四、寒带气候', body: '<ul><li><strong>极地苔原气候</strong>：终年严寒</li><li><strong>极地冰原气候</strong>：终年冰冻（南极、格陵兰内陆）</li></ul>' }
                ]
            })
        }
    ];
}

// ========== 主入口 ==========
function seedSampleCourseware(db) {
    // 已有共享课件 → 跳过
    const existing = db.prepare(`SELECT COUNT(*) as c FROM projects WHERE is_public = 1 AND school_level != ''`).get();
    if (existing.c > 0) return;

    const courseware = buildCourseware();
    const teachers = [...new Set(courseware.map(c => c.teacher))];
    const teacherIds = {};
    const hashed = bcrypt.hashSync('teacher123', 10);

    for (const username of teachers) {
        let user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (!user) {
            const result = db.prepare(
                'INSERT INTO users (username, email, password, role, school, bio) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(
                username,
                `${username}@autoconfig.dev`,
                hashed,
                'teacher',
                '临港区示范学校',
                '示例教师账号 (口令: teacher123)'
            );
            teacherIds[username] = result.lastInsertRowid;
        } else {
            teacherIds[username] = user.id;
        }
    }

    const insertProj = db.prepare(`
        INSERT INTO projects (user_id, name, slug, description, is_public, school_level, subject, file_count, total_size, visit_count)
        VALUES (?, ?, ?, ?, 1, ?, ?, 1, ?, ?)
    `);

    for (const c of courseware) {
        const userId = teacherIds[c.teacher];
        // 写入文件
        const siteDir = path.join(SITES_DIR, c.teacher, c.slug);
        ensureDir(siteDir);
        // 注入 PROJECT_ID 占位（先写一次，后面更新）
        const initialHtml = c.html;
        fs.writeFileSync(path.join(siteDir, 'index.html'), initialHtml, 'utf-8');

        const size = Buffer.byteLength(initialHtml, 'utf-8');
        const visits = Math.floor(Math.random() * 200) + 20;
        const result = insertProj.run(userId, c.name, c.slug, c.description, c.level, c.subject, size, visits);

        // 注入 PROJECT_ID 到 index.html，让前端能上报练习记录
        const projectId = result.lastInsertRowid;
        const finalHtml = initialHtml.replace(
            '<script>',
            `<script>window.__PROJECT_ID__ = ${projectId};`
        );
        fs.writeFileSync(path.join(siteDir, 'index.html'), finalHtml, 'utf-8');
    }

    console.log(`  📚 已生成 ${courseware.length} 份示例课件 (${teachers.length} 位示例教师, 口令: teacher123)`);
}

module.exports = { seedSampleCourseware };
