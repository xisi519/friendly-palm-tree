// /api/gaps - 公开：学生端上报"知识库答不上"的问题
import { json, readBody } from './lib.mjs';
import { kvGetJSON, kvSetJSON, KV } from '../lib/kv.mjs';

export async function onRequest(context) {
  const { env, request } = context;
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!env.KB) return json({ error: '服务器未绑定 KV 存储，缺口记录不可用' }, 503);
  const b = await readBody(request);
  if (!b || !b.q) return json({ error: '缺少问题内容' }, 400);
  const list = (await kvGetJSON(env, KV.GAPS, [])) || [];
  const now = new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
  const entry = { q: String(b.q), level: String(b.level || 'miss'), missing: String(b.missing || ''), best: String(b.best || ''), t: now };
  const next = [entry, ...list.filter(x => x.q !== entry.q)].slice(0, 200);
  await kvSetJSON(env, KV.GAPS, next);
  return json({ ok: true, count: next.length });
}