// core.mjs - 小电公网版核心逻辑（纯函数，零运行时依赖，浏览器可测试）
// 用途: Cloudflare Pages Functions 与 tests/test-cloudflare.html 共用

const TE = new TextEncoder();

export function utf8Bytes(s) { return TE.encode(String(s)); }

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', utf8Bytes(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function makeSalt() {
  const rb = new Uint8Array(16);
  crypto.getRandomValues(rb);
  return Array.from(rb).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hashPassword(password, saltHex) {
  return sha256Hex(saltHex + ':' + password);
}

export async function verifyPassword(password, saltHex, hashHex) {
  if (!saltHex || !hashHex) return false;
  const h = await hashPassword(password, saltHex);
  return h === hashHex;
}

export function newToken() {
  const rb = new Uint8Array(32);
  crypto.getRandomValues(rb);
  return Array.from(rb).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 云端老师考点卡的下一个 ID（T-01, T-02, ...）
export function nextTeacherId(existingIds, base = 3) {
  let max = base;
  for (const id of existingIds || []) {
    const m = String(id).match(/^[TU]-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'T-' + String(max + 1).padStart(2, '0');
}

export function isValidCard(input) {
  const title = String(input.title || '').trim();
  const body = String(input.body || '').trim();
  if (!title || !body) return { ok: false, error: '标题与正文必填' };
  if (title.length > 120 || body.length > 20000) return { ok: false, error: '内容过长' };
  return { ok: true, title, body, keywords: String(input.keywords || '').trim(), exam: String(input.exam || '老师强调').trim(), chapter: String(input.chapter || '').trim() };
}

// ---- 会话（单个 isolate 内存态；重启即失效，学生规模可接受）----
export function makeSessionStore() {
  const map = new Map(); // token -> expiryMs
  return {
    set(token, hours) { map.set(token, Date.now() + hours * 3600 * 1000); },
    check(token) {
      if (!token || !map.has(token)) return false;
      const exp = map.get(token);
      if (Date.now() > exp) { map.delete(token); return false; }
      return true;
    },
    clear() { map.clear(); },
    count() { return map.size; }
  };
}

// ---- 登录限流（内存态：5 次失败 / 60 秒 / IP）----
export function makeLoginGuard() {
  const fails = new Map(); // ip -> [timestamps]
  return {
    allowed(ip) {
      const now = Date.now();
      const list = (fails.get(ip) || []).filter(t => now - t < 60000);
      if (list.length) fails.set(ip, list); else fails.delete(ip);
      return list.length < 5;
    },
    fail(ip) {
      const list = fails.get(ip) || [];
      list.push(Date.now());
      fails.set(ip, list);
    },
    clear(ip) { fails.delete(ip); }
  };
}

// ---- Prompt（与服务端 PowerShell 版本一致）----
export function buildSystemPrompt() {
  return [
    '你是「小电」，「机电传动控制」课程的专属 AI 助教，服务对象是武汉理工大学正在学习与备考的本科生。',
    '',
    '【知识优先级（必须严格遵守）】',
    'A. 老师考点  >  B. 教材知识库  >  C. 你自己的通用知识。',
    '- 若 A 与 B/C 冲突，以 A 为准，并写明"按老师课堂要求：…；教材一般表述为：…"。',
    '- 严禁编造"老师说过"的内容；没有 A 层依据时，不得声称某结论是老师考点。',
    '- 只有当 A、B 均未覆盖时才可使用 C，且必须显式标注"（以下为通用知识，本地知识库未覆盖，建议向老师确认）"。',
    '',
    '【回答结构（按序输出，用 Markdown）】',
    '1. **一句话结论**',
    '2. **原理 / 公式**：写出公式、每个符号的含义与单位；公式用纯文本或代码块，不要用 LaTeX 图片。',
    '3. **推导 / 解题步骤**：涉及计算时必须给出可套用的步骤模板。',
    '4. **典型例题思路**（若适用）',
    '5. **易错点**：列出 2~4 条常见误区。',
    '6. **考试提示**：可能的题型与答题要点。',
    '7. **依据**：逐条标注来源，格式 [卡片ID]；无本地依据的内容标注 [通用知识]。',
    '8. **延伸追问**：给出 2~3 个相关问题。',
    '',
    '【风格】中文、准确、简洁、结构化，多用列表与表格；不确定时明确说明；与课程无关的问题礼貌拒绝并引导回机电传动主题。'
  ].join('\n');
}

export function buildUserPrompt(question, hits, unknown) {
  let A = '', B = '';
  for (const h of hits || []) {
    const c = h.card || {};
    const layer = c.priority === 'teacher' ? 'A-老师考点' : 'B-教材';
    const blk = '[' + (c.id || '?') + '] ' + (c.title || '') + '\n  层级: ' + layer
      + '\n  来源: ' + (c.source || '') + '\n  考点标记: ' + (c.exam || '') + '  相关度: ' + (h.score || 0)
      + '\n  正文:\n' + (c.body || '') + '\n\n';
    if (c.priority === 'teacher') A += blk; else B += blk;
  }
  const stateLine = (unknown && unknown.length)
    ? '以下概念不在本地知识库中：' + unknown.join('、') + '。请按规则使用通用知识并明确标注。'
    : '请优先基于以上材料作答，并标注 [卡片ID]。';
  return '问题：' + String(question || '') + '\n\n【A 层 · 老师考点】\n' + (A || '（无）')
    + '\n【B 层 · 教材知识库】\n' + (B || '（无）') + '\n\n' + stateLine;
}

// ---- KV 键（固定命名）----
export const KV = {
  CARDS: 'kb:cloud_cards',
  GAPS: 'kb:gaps',
  PWD: 'kb:admin_password'
};