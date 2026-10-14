// /api/admin/password - 修改管理密码（写入 KV；env.ADMIN_PASSWORD 存在时仍以环境变量为准）
import { json, readBody } from '../lib.mjs';
import { requireAdmin, sessions } from '../../lib/admin.mjs';
import { makeSalt, hashPassword } from '../../lib/core.mjs';
import { kvSetJSON, KV } from '../../lib/kv.mjs';

export async function onRequest(context) {
  const { env, request } = context;
  if (!requireAdmin(request)) return json({ error: '未解锁' }, 401);
  if (!env.KB) return json({ error: '服务器未绑定 KV 存储，无法保存新密码' }, 503);
  const b = await readBody(request);
  const p = String((b && b.password) || '');
  if (p.length < 6) return json({ error: '密码至少 6 位' }, 400);
  const salt = makeSalt();
  const hash = await hashPassword(p, salt);
  await kvSetJSON(env, KV.PWD, { salt, hash, updatedAt: Date.now() });
  sessions.clear();
  return json({ ok: true });
}