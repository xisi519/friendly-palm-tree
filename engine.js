/* engine.js - 检索/缺口/渲染引擎（无 DOM 依赖，供 ui.js 与测试页复用） */
"use strict";
/* =========================================================
 * 机电传动智能助教 v0.1 —— 核心引擎
 * 分层知识：A 老师考点(user/teacher) > B 教材 > C 通用知识(LLM)
 * 检索：中文二元切分 + 别名扩展 + BM25 + 优先级/考点加权
 * ========================================================= */

/* ---------- 全局状态与配置 ---------- */
const STATE = { cards: [], dict: null };
const PW = { teacher: 1.75, textbook: 1.0, inbox: 0.85 };
// 网站端固定配置：检索 TopK=5；teacher_first = 老师考点额外加权（与服务器端 kb-lib 行为一致）
function loadCfg(){ return { topk: 5, scope: 'teacher_first' }; }

/* ---------- 知识卡装载 ---------- */
// 知识卡唯一来源：服务端编译的 knowledge.js（由 knowledge/**/*.md 生成）
function loadCards(){
  return (window.KB || []).map(c => Object.assign({ origin: c.origin || 'file' }, c));
}
function refreshCards(){ STATE.cards = loadCards(); STATE.dict = null; }

/* ---------- 同义词/别名扩展 ---------- */
const ALIAS = [
  ['异步电机','异步电动机','感应电机','感应电动机'],
  ['可控硅','晶闸管','scr'],
  ['plc','可编程控制器','可编程序控制器'],
  ['变频器','变频调速','vvvf','变压变频'],
  ['星三角','y-δ','y-△','星形三角形','星形-三角形'],
  ['步进电机','步进电动机'],
  ['伺服电机','伺服电动机'],
  ['直流电机','直流电动机'],
  ['热继电器','热继','过载继电器'],
  ['换向器','整流子'],
  ['笼型','鼠笼','鼠笼式'],
  ['机械特性','特性曲线'],
  ['接触器','交流接触器'],
  ['熔断器','保险丝'],
  ['测速发电机','测速电机'],
  ['运动方程式','动力学方程'],
  ['飞轮转矩','飞轮矩','gd2'],
  ['双闭环','转速电流双闭环','asr','acr'],
  ['反接制动','倒拉反接'],
  ['反馈制动','再生制动','回馈制动']
];

/* ---------- 分词 ---------- */
function expandQuery(text){
  const t = String(text||'').toLowerCase();
  const extra = [];
  ALIAS.forEach(g => {
    if (g.some(m => t.indexOf(m) >= 0)) g.forEach(m => { if (t.indexOf(m) < 0) extra.push(m); });
  });
  return extra.length ? text + ' ' + extra.join(' ') : text;
}
function tokenize(text){
  const out = [], t = String(text||'').toLowerCase();
  let m, re1 = /[a-z][a-z0-9.\-_]*|[0-9]+[0-9.]*/g;
  while ((m = re1.exec(t))) out.push(m[0]);
  let re2 = /[\u4e00-\u9fff]+/g;
  while ((m = re2.exec(t))) {
    const s = m[0];
    if (s.length === 1) out.push(s);
    else for (let i = 0; i < s.length - 1; i++) out.push(s.substr(i, 2));
  }
  return out;
}

/* ---------- 索引与 BM25 ---------- */
function buildIndex(pool){
  pool.forEach(c => {
    if (c._tf) return;
    const doc = (c.title+' ').repeat(3) + ((c.keywords||'')+' ').repeat(2) + (c.chapter||'') + ' ' + (c.body||'');
    const toks = tokenize(doc), tf = new Map();
    toks.forEach(x => tf.set(x, (tf.get(x)||0)+1));
    c._tf = tf; c._len = toks.length;
  });
  const df = new Map();
  pool.forEach(c => { for (const k of c._tf.keys()) df.set(k, (df.get(k)||0)+1); });
  const avgdl = pool.reduce((s,c)=>s+c._len,0) / (pool.length||1);
  return { df, avgdl, N: pool.length };
}

/* ---------- 课程术语词典 & 知识缺口检测 ----------
 * 从知识卡标题/关键词构建课程术语表，对问题做贪心最长匹配；
 * 匹配不上的实词 = 知识库确实没有的概念 -> 触发"缺口"提示，而不是假装回答。 */
const STOPCHARS = '的了是在有和与或及其等这那哪什么怎如何为吗呢吧啊并且但因为所以如果虽然于对把被给让向从到就都很更最又再只各某之上下中大小多少';
const GENERIC = new Set(['应用','使用','情况','问题','方面','内容','部分','相关','一般','通常','进行','存在','具有','以及','其他','作用','原因','方法','过程','特点','区别','要求','目的','意义','方式','几种','哪种','哪些','多少','是否','能否','还有','例如','比如','其中','这个','那个','一个','什么','怎么','怎样','如何','为何','为什么','属于','包括','需要','可以','什么时候','哪些是']);
function buildDict(cards){
  // 词典覆盖"标题+关键词+正文"：判断一个概念是否真的不在知识库中出现过。
  const dict = new Set();
  const addRuns = (src, maxN) => {
    (src.match(/[\u4e00-\u9fff]{2,}/g) || []).forEach(run => {
      const lim = Math.min(maxN, run.length);
      for (let n = 2; n <= lim; n++)
        for (let i = 0; i + n <= run.length; i++) dict.add(run.substr(i, n));
    });
    (src.toLowerCase().match(/[a-z][a-z0-9.\-_]+/g) || []).forEach(w => dict.add(w));
  };
  cards.forEach(c => {
    addRuns((c.title||'') + ' ' + (c.keywords||'') + ' ' + (c.chapter||''), 6);
    addRuns(String(c.body||'').slice(0, 1500), 4);
  });
  return dict;
}function getDict(){ if (!STATE.dict) STATE.dict = buildDict(STATE.cards); return STATE.dict; }
function matchLen(run, i, dict){
  for (let k = Math.min(6, run.length - i); k >= 2; k--) if (dict.has(run.substr(i, k))) return k;
  return 0;
}
function unknownTerms(query){
  const dict = getDict(), out = [];
  (String(query).match(/[\u4e00-\u9fff]{2,}/g) || []).forEach(run => {
    let i = 0;
    while (i < run.length){
      const n = matchLen(run, i, dict);
      if (n){ i += n; continue; }
      let j = i + 1;
      while (j < run.length && !matchLen(run, j, dict)) j++;
      const seg = run.substr(i, j - i);
      seg.split(new RegExp('[' + STOPCHARS + ']+')).forEach(p => { if (p.length >= 2 && !GENERIC.has(p)) out.push(p); });
      i = j;
    }
  });
  (String(query).toLowerCase().match(/[a-z][a-z0-9.\-_]+/g) || []).forEach(w => { if (!dict.has(w) && !GENERIC.has(w)) out.push(w); });
  return Array.from(new Set(out));
}
function isTeacher(c){ return c.origin === 'user' || c.priority === 'teacher'; }

const DL_FLOOR = 120;   // 文档长度下限，防止短卡片被长度归一化过度放大
const MIN_SCORE = 1.2;  // 绝对相关度门槛，低于此分的卡片不作为证据呈现

function search(query, opt){
  opt = opt || {};
  const cfg = loadCfg();
  const topK = opt.topK || cfg.topk || 5;
  const mode = opt.mode || cfg.scope || 'all';
  let pool = STATE.cards.slice();
  if (opt.chapter) pool = pool.filter(c => c.chapter === opt.chapter);
  if (mode === 'teacher_only') pool = pool.filter(isTeacher);
  if (!pool.length) return [];
  const idx = buildIndex(pool);
  const qOrig = Array.from(new Set(tokenize(query)));                 // 用于覆盖率
  const qFull = Array.from(new Set(tokenize(expandQuery(query))));     // 用于打分
  if (!qFull.length) return [];
  const k1 = 1.6, b = 0.72, res = [];
  for (const c of pool){
    let score = 0;
    const dl = Math.max(c._len, DL_FLOOR);
    for (const t of qFull){
      const f = c._tf.get(t); if (!f) continue;
      const n = idx.df.get(t) || 1;
      const idf = Math.log((idx.N - n + 0.5)/(n + 0.5) + 1);
      score += idf * (f*(k1+1)) / (f + k1*(1 - b + b*dl/idx.avgdl));
    }
    if (score <= 0) continue;
    let matched = 0;
    for (const t of qOrig) if (c._tf.has(t)) matched++;
    let w = isTeacher(c) ? 1.9 : (PW[c.priority] || 1);
    if (mode === 'teacher_first' && isTeacher(c)) w *= 1.5;
    let bonus = 0;
    const ql = query.toLowerCase();
    if (c.title && ql.indexOf(c.title.toLowerCase()) >= 0) bonus += 3;
    String(c.keywords||'').split(/[,，;；/、\s]+/).forEach(k => { if (k.length >= 2 && ql.indexOf(k.toLowerCase()) >= 0) bonus += 1.2; });
    const ex = String(c.exam||'');
    if (ex.indexOf('必考') >= 0) bonus += 0.6; else if (ex.indexOf('高频') >= 0) bonus += 0.35;
    res.push({ card:c, score:+(score*w + bonus).toFixed(3), coverage:qOrig.length ? +(matched/qOrig.length).toFixed(3) : 0, matched, qn:qOrig.length });
  }
  res.sort((x,y) => y.score - x.score);
  return diversify(res.filter(x => x.score >= MIN_SCORE), topK);
}

// 分层配额：A 层(老师考点)最多占 40% 名额，B 层(教材)至少 2 张；
// 且 A 层卡片必须同时通过"绝对门槛 MIN_SCORE"与"相对门槛 35%×最高分"，避免弱相关的考点卡挤占上下文。
function diversify(res, topK){
  if (!res.length) return res;
  const floor = Math.max(MIN_SCORE, res[0].score * 0.35);
  const cand = res.filter(x => !isTeacher(x.card) || x.score >= floor);
  if (cand.length <= topK) return cand;
  const A = cand.filter(x => isTeacher(x.card));
  const B = cand.filter(x => !isTeacher(x.card));
  const maxA = Math.max(1, Math.min(Math.ceil(topK*0.4), A.length));
  const needB = Math.max(2, Math.floor(topK/2));
  const seen = new Set(), out = [];
  A.slice(0, maxA).forEach(x => { if (!seen.has(x.card.id)){ seen.add(x.card.id); out.push(x); } });
  B.slice(0, needB).forEach(x => { if (!seen.has(x.card.id)){ seen.add(x.card.id); out.push(x); } });
  for (const x of cand){ if (out.length >= topK) break; if (!seen.has(x.card.id)){ seen.add(x.card.id); out.push(x); } }
  return out.sort((x,y) => y.score - x.score).slice(0, topK);
}
// 置信度分级：miss = 知识库未覆盖；low = 命中弱；mid / high = 可用
// 置信度分级：miss 完全未覆盖 / gap 部分覆盖(存在库外概念) / low / mid / high
function confidence(top, query){
  if (!top) return 'miss';
  if (top.score < 3.5 || top.coverage < 0.28) return 'miss';
  const base = (top.score >= 10 && top.coverage >= 0.5) ? 'high' : (top.score >= 5 ? 'mid' : 'low');
  if (query && unknownTerms(query).length && (base === 'high' || base === 'mid')) return 'gap';
  return base;
}
/* ---------- Markdown 渲染（极简安全版） ---------- */
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function inline(s){
  return s.replace(/`([^`]+)`/g, (m,p) => '<code>'+p+'</code>')
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}
function md(src){
  const lines = String(src||'').replace(/\r/g,'').split('\n');
  let out = '', inCode = false, code = [], list = null, tbl = [];
  const endList = () => { if (list){ out += '</'+list+'>'; list = null; } };
  const endTbl = () => {
    if (!tbl.length) return;
    const rows = tbl.filter(r => !/^[\s|:\-]+$/.test(r));
    let h = '<table>';
    rows.forEach((r,i) => {
      const cells = r.replace(/^\|/,'').replace(/\|$/,'').split('|').map(x => x.trim());
      const tag = i === 0 ? 'th' : 'td';
      h += '<tr>' + cells.map(c => '<'+tag+'>'+inline(esc(c))+'</'+tag+'>').join('') + '</tr>';
    });
    out += h + '</table>'; tbl = [];
  };
  for (const line of lines){
    if (/^```/.test(line.trim())){
      if (inCode){ out += '<pre><code>'+esc(code.join('\n'))+'</code></pre>'; code = []; inCode = false; }
      else { endList(); endTbl(); inCode = true; }
      continue;
    }
    if (inCode){ code.push(line); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)){ endList(); tbl.push(line); continue; }
    endTbl();
    if (!line.trim()){ endList(); continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))){ endList(); const lv = Math.min(m[1].length+2, 6); out += '<h'+lv+'>'+inline(esc(m[2]))+'</h'+lv+'>'; continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))){ if (list !== 'ul'){ endList(); out += '<ul>'; list = 'ul'; } out += '<li>'+inline(esc(m[1]))+'</li>'; continue; }
    if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))){ if (list !== 'ol'){ endList(); out += '<ol>'; list = 'ol'; } out += '<li>'+inline(esc(m[2]))+'</li>'; continue; }
    if (/^\s*>\s?/.test(line)){ endList(); out += '<blockquote>'+inline(esc(line.replace(/^\s*>\s?/,'')))+'</blockquote>'; continue; }
    if (/^\s{4,}\S/.test(line)){ endList(); out += '<pre><code>'+esc(line.replace(/^\s{4}/,''))+'</code></pre>'; continue; }
    endList();
    out += '<p>'+inline(esc(line))+'</p>';
  }
  if (inCode) out += '<pre><code>'+esc(code.join('\n'))+'</code></pre>';
  endList(); endTbl();
  return out;
}

/* ---------- 检索模式答案（无需 API） ---------- */
/* ---------- 检索模式答案（无需 API，零幻觉：只呈现卡片原文） ---------- */
function cardBox(x, full){
  const c = x.card;
  const pcls = c.priority === 'teacher' ? 'p-teacher' : ('p-' + (c.priority || 'textbook'));
  const pname = c.priority === 'teacher' ? '★老师考点' : (c.priority === 'inbox' ? '◇待整理' : '教材');
  let h = '<div class="cardbox' + (isTeacher(c) ? ' a' : '') + '">';
  h += '<div class="ch"><span class="pill ' + pcls + '">' + pname + '</span>'
    + '<b>' + esc(c.id) + ' ' + esc(c.title) + '</b>'
    + (c.exam ? ' · 考点:' + esc(c.exam) : '') + ' · 相关度 ' + x.score + '</div>';
  const body = String(c.body || '');
  if (full) h += '<div class="cb">' + md(body) + '</div>';
  else {
    const prev = body.split('\n').filter(s => s.trim()).slice(0, 3).join('\n');
    h += '<div class="prev">' + inline(esc(prev)) + '\n…</div>';
  }
  return h + '</div>';
}

function retrieveAnswer(query, hits){
  const top = hits[0], lv = confidence(top, query);
  const un = unknownTerms(query);
  if (lv === 'miss'){
    let h = '<h3>知识库未覆盖</h3><p>本地知识卡中没有与该问题足够相关的内容（置信度：低）。</p>';
    if (un.length) h += '<p>识别出的库外概念：<b>' + un.map(esc).join('、') + '</b></p>';
    h += '<ul><li>换更贴近教材的关键词重试；</li>'
      + '<li>在「设置」填入 API Key 升级为 AI 模式，用通用知识作答并标注不确定性；</li>'
      + '<li>查证后用「+ 添加老师考点」把它沉淀进知识库，形成闭环。</li></ul>';
    if (hits.length) h += '<p style="color:var(--muted);font-size:12px">相邻但未必相关的卡片：'
      + hits.slice(0,2).map(x => esc(x.card.id) + ' ' + esc(x.card.title)).join('；') + '</p>';
    return { html:h, miss:true, level:'miss', unknown:un };
  }
  const label = { high:'高', mid:'中', low:'偏低', gap:'部分覆盖' }[lv];
  const A = hits.filter(x => isTeacher(x.card));
  const B = hits.filter(x => !isTeacher(x.card));
  const shownA = A.slice(0,2), shownB = B.slice(0,2);
  let h = '';
  if (lv === 'gap') h += '<div class="lowconf">知识库未覆盖这些概念：<b>' + un.map(esc).join('、')
    + '</b>。下方内容来自相关卡片，未覆盖部分建议联网查证或问老师，确认后补录为考点。</div>';
  h += '<h3>结论</h3><p>依据 <b>' + hits.length + '</b> 张知识卡作答，置信度：<b>' + label + '</b>'
    + ' <span style="color:var(--muted);font-size:12px">(最高分 ' + top.score + '，查询词覆盖率 ' + top.coverage + ')</span></p>';
  if (shownA.length){ h += '<h3 style="color:var(--teacher)">★ 老师考点（优先采信）</h3>'; shownA.forEach(x => h += cardBox(x, true)); }
  if (shownB.length){ h += '<h3>教材解析</h3>'; shownB.forEach(x => h += cardBox(x, true)); }
  const shownIds = shownA.concat(shownB).map(x => x.card.id);
  const rest = hits.filter(x => shownIds.indexOf(x.card.id) < 0);
  if (rest.length){ h += '<h3>其他相关</h3>'; rest.forEach(x => h += cardBox(x, false)); }
  h += '<p style="color:var(--muted);font-size:12px;margin-top:8px">检索模式（未配置 API Key）：直接呈现权威卡片原文，保证零幻觉。配置后可让模型基于这些卡片组织讲解、例题与易错点。</p>';
  return { html:h, miss:false, level:lv, unknown:un };
}
