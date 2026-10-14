// /api/admin/cards - 云端老师考点卡（KV）：GET 列表 / POST 新增
import { json, readBody } from '../lib.mjs';
import { requireAdmin } from '../../lib/admin.mjs';
import { isValidCard, nextTeacherId, KV } from '../../lib/core.mjs';
import { kvGetJSON, kvSetJSON } from '../../lib/kv.mjs';

export async function onRequest(context) {
  const { env, request } = context;
  if (!requireAdmin(request)) return json({ error: '未解锁' }, 401);
  if (!env.KB) return json({ error: '服务器未绑定 KV 存储，云端知识卡不可用' }, 503);

  if (request.method === 'GET') {
    const cloud = (await kvGetJSON(env, KV.CARDS, [])) || [];
    const items = cloud.map(c => ({ id: c.id, title: c.title, keywords: c.keywords, exam: c.exam, chapter: c.chapter, priority: c.priority, body: c.body, deletable: true }));
    return json({ cards: items });
  }

  if (request.method === 'POST') {
    const b = await readBody(request);
    const v = isValidCard(b || {});
    if (!v.ok) return json({ error: v.error }, 400);
    const cloud = (await kvGetJSON(env, KV.CARDS, [])) || [];
    const id = nextTeacherId(cloud.map(c => c.id));
    const card = {
      id, title: v.title, keywords: v.keywords, exam: v.exam, chapter: v.chapter,
      body: v.body, priority: 'teacher', source: '管理员云端录入（公网版）',
      createdAt: new Date().toISOString()
    };
    cloud.unshift(card);
    await kvSetJSON(env, KV.CARDS, cloud);
    return json({ id, card });
  }

  return json({ error: 'method not allowed' }, 405);
}