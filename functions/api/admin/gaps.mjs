// /api/admin/gaps - GET 缺口列表（需管理员）
import { json } from '../lib.mjs';
import { requireAdmin } from '../../lib/admin.mjs';
import { kvGetJSON, KV } from '../../lib/kv.mjs';

export async function onRequest(context) {
  const { env, request } = context;
  if (!requireAdmin(request)) return json({ error: '未解锁' }, 401);
  const gaps = (await kvGetJSON(env, KV.GAPS, [])) || [];
  return json({ gaps });
}