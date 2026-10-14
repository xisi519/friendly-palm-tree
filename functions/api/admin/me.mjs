// /api/admin/me
import { json } from '../lib.mjs';
import { requireAdmin } from '../../lib/admin.mjs';

export async function onRequest(context) {
  const { request } = context;
  if (!requireAdmin(request)) return json({ error: '未解锁：请先开启开发者模式并输入管理密码' }, 401);
  return json({ ok: true });
}