"use strict";
/* ui.js - 网站前端：极简对话主界面 + 开发者模式管理抽屉 */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const TOKEN_KEY = 'jdcd_admin_token';
let HEALTH = { ai:false, cards:0 };
let unlocked = false;

const QUICK = [
  '他励直流电动机的机械特性方程怎么推导？',
  'Y-Δ 降压起动的电流和转矩是直接起动的多少倍？',
  '双闭环调速系统起动过程分哪三个阶段？',
  'PLC 循环扫描分几个阶段？和继电器控制有何区别？',
  '步进电动机步距角怎么计算？',
  '热继电器为什么不能作短路保护？'
];

/* ---------- 网络 ---------- */
function token(){ return sessionStorage.getItem(TOKEN_KEY) || ''; }
async function api(path, opt){
  opt = opt || {};
  const headers = Object.assign({ 'Content-Type':'application/json' }, opt.headers || {});
  if (token()) headers['X-Admin-Token'] = token();
  const res = await fetch(path, Object.assign({}, opt, { headers, body: opt.body ? JSON.stringify(opt.body) : undefined }));
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch(e){ data = { raw:text }; }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || ('HTTP ' + res.status)), { status: res.status, data });
  return data;
}

/* ---------- 对话 ---------- */
function addMsg(role, html){
  const el = document.createElement('div');
  el.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  el.innerHTML = '<div class="role">' + (role === 'user' ? '我' : '小电') + '</div>' + html;
  $('#msgs').appendChild(el);
  $('#msgs').scrollTop = $('#msgs').scrollHeight;
  return el;
}
function srcBlock(hits){
  if (!hits || !hits.length) return '';
  let h = '<div class="srcs"><div class="h">依据的知识卡</div>';
  hits.forEach(x => {
    const c = x.card;
    const pcls = c.priority === 'teacher' ? 'p-teacher' : ('p-' + (c.priority || 'textbook'));
    const pname = c.priority === 'teacher' ? '★老师考点' : (c.priority === 'inbox' ? '◇待整理' : '教材');
    h += '<div class="src"><span class="pill ' + pcls + '">' + pname + '</span><span class="id">' + esc(c.id) + '</span>'
      + '<span>' + esc(c.title) + '</span><span class="sc">' + x.score + '</span></div>';
  });
  return h + '</div>';
}
function reportGap(q, lv, missing, best){
  api('/api/gaps', { method:'POST', body:{ q, level:lv, missing, best } }).catch(() => {});
}
async function ask(){
  const q = $('#q').value.trim();
  if (!q) return;
  $('#q').value = ''; autoGrow();
  addMsg('user', esc(q));
  const hits = search(q, {});
  const lv = confidence(hits[0], q);
  const un = unknownTerms(q);
  if (lv === 'miss' || lv === 'gap') reportGap(q, lv, un.join('、'), hits[0] ? hits[0].card.id + ' ' + hits[0].card.title : '');

  if (HEALTH.ai){
    const el = addMsg('bot', '<span class="loading"></span>正在结合 ' + hits.length + ' 张知识卡组织答案…');
    try{
      const r = await api('/api/ask-ai', { method:'POST', body:{
        question: q,
        hits: hits.map(x => ({ id:x.card.id, title:x.card.title, source:x.card.source, exam:x.card.exam,
                               priority:x.card.priority, body:x.card.body, score:x.score }))
      }});
      el.innerHTML = '<div class="role">助教</div>' + md(r.answer) + srcBlock(hits)
        + ((lv === 'gap' || lv === 'miss') ? '<div class="warnbox">知识库未覆盖：' + un.map(esc).join('、') + '。以上含模型通用知识，建议向老师核实。</div>' : '');
    }catch(err){
      el.innerHTML = '<div class="role">助教</div><div class="warnbox">AI 接口调用失败：' + esc(String(err.message || err)) + '，已回退到检索模式。</div>' + retrieveAnswer(q, hits).html + srcBlock(hits);
    }
  } else {
    addMsg('bot', retrieveAnswer(q, hits).html + srcBlock(hits));
  }
  $('#msgs').scrollTop = $('#msgs').scrollHeight;
}

/* ---------- 管理抽屉 ---------- */
function openDrawer(){ $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden','false'); $('#scrim').classList.remove('hidden'); }
function closeDrawer(){ $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden','true'); $('#scrim').classList.add('hidden'); }
function showAdmin(on){
  unlocked = on;
  $('#loginBox').classList.toggle('hidden', on);
  $('#adminBox').classList.toggle('hidden', !on);
  $('#devSwitch').checked = on;
  $('#devHint').textContent = on ? '已解锁：可以添加 / 删除知识卡' : '关闭时知识库只读，任何人无法篡改';
  if (on){ loadCardsAdmin(); loadGaps(); loadSrvInfo(); }
}
function lock(){ sessionStorage.removeItem(TOKEN_KEY); showAdmin(false); $('#pwd').value = ''; $('#loginErr').textContent = ''; }

async function unlock(){
  const p = $('#pwd').value;
  $('#loginErr').textContent = '';
  try{
    const r = await api('/api/admin/login', { method:'POST', body:{ password:p } });
    sessionStorage.setItem(TOKEN_KEY, r.token);
    $('#pwd').value = '';
    showAdmin(true);
  }catch(err){
    $('#loginErr').textContent = (err.data && err.data.error) || String(err.message || err);
  }
}
async function loadCardsAdmin(){
  try{
    const r = await api('/api/admin/cards');
    const kw = ($('#cardSearch').value || '').trim().toLowerCase();
    const list = r.cards.filter(c => !kw || (c.id + c.title + (c.keywords||'') + (c.body||'')).toLowerCase().indexOf(kw) >= 0);
    $('#cardList').innerHTML = list.slice(0, 120).map(c => {
      const pcls = c.priority === 'teacher' ? 'p-teacher' : ('p-' + (c.priority || 'textbook'));
      const pname = c.priority === 'teacher' ? '★老师考点' : '教材';
      return '<div class="citem"><span class="pill ' + pcls + '">' + pname + '</span>'
        + '<span style="font-family:Consolas,monospace;font-size:11px;color:var(--muted)">' + esc(c.id) + '</span>'
        + '<div class="t">' + esc(c.title) + '</div><div class="m">' + esc((c.chapter||'') + ' · ' + (c.exam||'')) + '</div>'
        + (c.deletable ? '<div class="acts"><button data-del="' + esc(c.id) + '">删除</button></div>' : '')
        + '</div>';
    }).join('') || '<p class="hint">没有匹配的卡片</p>';
    $$('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('删除知识卡 ' + b.dataset.del + ' ？该操作会写入知识库文件。')) return;
      try{ await api('/api/admin/cards/' + encodeURIComponent(b.dataset.del), { method:'DELETE' }); loadCardsAdmin(); refreshCards(); }
      catch(err){ alert((err.data && err.data.error) || err.message); }
    });
  }catch(err){ $('#cardList').innerHTML = '<p class="err">' + esc(String(err.message||err)) + '</p>'; }
}
async function loadGaps(){
  try{
    const r = await api('/api/admin/gaps');
    $('#gapList').innerHTML = r.gaps.length ? r.gaps.map(g =>
      '<div class="citem"><div class="t">' + esc(g.q) + '</div><div class="m">' + esc(g.t || '')
      + (g.missing ? ' · 缺：' + esc(g.missing) : '') + (g.best ? ' · 最接近：' + esc(g.best) : '') + '</div></div>').join('')
      : '<p class="hint">暂无缺口记录。</p>';
  }catch(err){ $('#gapList').innerHTML = '<p class="err">' + esc(String(err.message||err)) + '</p>'; }
}
async function loadSrvInfo(){
  try{
    const r = await api('/api/admin/info');
    $('#srvInfo').innerHTML = '知识卡 <b>' + r.cards + '</b> 张（老师考点 <b>' + r.teacher + '</b>）<br>服务启动于 ' + esc(r.startedAt) + '<br>AI 模式：' + (r.ai ? '已启用（' + esc(r.model) + '）' : '未启用（检索模式）');
  }catch(e){}
}
async function saveCard(){
  const body = { title: $('#fTitle').value.trim(), keywords: $('#fKw').value.trim(), exam: $('#fExam').value,
                 chapter: $('#fCh').value.trim(), body: $('#fBody').value.trim() };
  $('#saveMsg').textContent = '';
  if (!body.title || !body.body){ $('#saveMsg').className = 'err'; $('#saveMsg').textContent = '标题与正文必填'; return; }
  try{
    const r = await api('/api/admin/cards', { method:'POST', body });
    $('#saveMsg').className = 'ok';
    $('#saveMsg').textContent = '已保存为 ' + r.id + '（老师考点，最高优先级）';
    $('#fTitle').value = ''; $('#fKw').value = ''; $('#fBody').value = ''; $('#fCh').value = '';
    if (r.card){ STATE.cards.push(Object.assign({ origin:'file' }, r.card)); STATE.dict = null; }
    loadCardsAdmin();
  }catch(err){ $('#saveMsg').className = 'err'; $('#saveMsg').textContent = (err.data && err.data.error) || String(err.message||err); }
}
async function changePwd(){
  const a = $('#np1').value, b = $('#np2').value;
  $('#pwdMsg').className = 'ok'; $('#pwdMsg').textContent = '';
  if (a.length < 6){ $('#pwdMsg').className = 'err'; $('#pwdMsg').textContent = '密码至少 6 位'; return; }
  if (a !== b){ $('#pwdMsg').className = 'err'; $('#pwdMsg').textContent = '两次输入不一致'; return; }
  try{
    await api('/api/admin/password', { method:'POST', body:{ password:a } });
    $('#pwdMsg').textContent = '密码已修改'; $('#np1').value = ''; $('#np2').value = '';
  }catch(err){ $('#pwdMsg').className = 'err'; $('#pwdMsg').textContent = (err.data && err.data.error) || String(err.message||err); }
}

/* ---------- 初始化 ---------- */
function autoGrow(){ const t = $('#q'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 150) + 'px'; }
function welcome(){
  addMsg('bot', '<p>你好，我是<b>小电</b>，机电传动课程助教，服务武汉理工大学《机电传动控制》课程（教材：吴超群、雷艇 主编，机械工业出版社）。本地知识库共 <b>' + STATE.cards.length
    + '</b> 张知识卡：老师考点优先，教材知识点次之。</p>'
    + '<p class="hint" style="margin-top:6px">当前为<b>' + (HEALTH.ai ? 'AI 讲解模式' : '检索模式（零幻觉，直接呈现知识卡原文）') + '</b>。试试下面的快捷问题。</p>');
}
async function init(){
  refreshCards();
  try{ HEALTH = await api('/api/health'); }catch(e){ HEALTH = { ai:false, cards:STATE.cards.length, admin:false }; }
  // 公网版（0.3-cf）：拉取管理员云端录入的老师考点卡并合并进检索
  if (String(HEALTH.version || '').indexOf('0.3-cf') === 0){
    try{
      const cloud = await api('/api/cards');
      if (cloud && Array.isArray(cloud.cards) && cloud.cards.length){
        STATE.cards = STATE.cards.concat(cloud.cards.map(c => Object.assign({ origin:'file' }, c)));
        STATE.dict = null;
      }
    }catch(e){}
  }
  if (!HEALTH.admin) $('#devHint').textContent = '当前部署为只读版：管理员未配置密码/存储，知识库不可修改';
  const mb = $('#modeBadge');
  mb.textContent = HEALTH.ai ? 'AI 讲解模式' : '检索模式';
  mb.className = 'badge' + (HEALTH.ai ? ' ai' : '');
  $('#quick').innerHTML = QUICK.map(q => '<button type="button" data-q="' + esc(q) + '">' + esc(q) + '</button>').join('');
  $$('#quick button').forEach(b => b.onclick = () => { $('#q').value = b.dataset.q; ask(); });

  $('#inputbar').addEventListener('submit', e => { e.preventDefault(); ask(); });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); ask(); } });
  $('#q').addEventListener('input', autoGrow);
  $('#btnAdmin').onclick = openDrawer;
  $('#btnCloseDrawer').onclick = closeDrawer;
  $('#scrim').onclick = closeDrawer;
  $('#devSwitch').onchange = e => {
    if (e.target.checked){ if (unlocked) showAdmin(true); else { openDrawer(); $('#loginBox').classList.remove('hidden'); setTimeout(() => $('#pwd').focus(), 120); e.target.checked = false; } }
    else lock();
  };
  $('#btnUnlock').onclick = unlock;
  $('#pwd').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
  $('#btnLock').onclick = lock;
  $('#btnSaveCard').onclick = saveCard;
  $('#btnChPwd').onclick = changePwd;
  $('#cardSearch').oninput = loadCardsAdmin;
  $$('.dtab').forEach(t => t.onclick = () => {
    $$('.dtab').forEach(x => x.classList.remove('active')); t.classList.add('active');
    $$('.dpane').forEach(p => p.classList.remove('active')); $('#dt-' + t.dataset.dt).classList.add('active');
  });

  // 会话内已解锁则恢复
  if (token()){
    try{ await api('/api/admin/me'); showAdmin(true); }catch(e){ sessionStorage.removeItem(TOKEN_KEY); }
  }
  welcome();

  // 深链接：?q=问题 打开即自动提问；#admin 打开管理抽屉（仍需密码解锁）
  const _qp = new URLSearchParams(location.search).get('q');
  if (_qp){ $('#q').value = _qp; ask(); }
  if (location.hash === '#admin') openDrawer();
}
document.addEventListener('DOMContentLoaded', init);