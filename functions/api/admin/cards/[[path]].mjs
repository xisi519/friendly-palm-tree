// /api/admin/cards/{id} - DELETE 云端老师考点卡（仅允许删除云端卡）
import { json } from '../../lib.mjs';
import { requireAdmin } from '../../../lib/admin.mjs';
import { KV } from '../../../lib/core.mjs';
import { kvGetJSON, kvSetJSON } from '../../../lib/kv.mjs';

export async function onRequest(context) {
  const { env, request } = context;
  if (request.method !== 'DELETE') return json({ error: 'method not allowed' }, 405);
  if (!requireAdmin(request)) return json({ error: '未解锁' }, 401);
  if (!env.KB) return json({ error: '服务器未绑定 KV 存储' }, 503);
  const seg = (request.url.split('/').filter(Boolean).pop() || '');
  const id = decodeURIComponent(seg);
  const cloud = (await kvGetJSON(env, KV.CARDS, [])) || [];
  const idx = cloud.findIndex(c => c.id === id);
  if (idx < 0) return json({ error: '未找到可删除的卡片 ' + id + '（教材卡受保护，只能删除云端录入的卡）' }, 404);
  cloud.splice(idx, 1);
  await kvSetJSON(env, KV.CARDS, cloud);
  return json({ ok: true, id });
}