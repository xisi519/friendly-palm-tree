// /api/admin/login
import { json, readBody, clientIp } from '../lib.mjs';
import { newToken, verifyPassword, hashPassword, makeSalt } from '../../lib/core.mjs';
import { kvGetJSON, kvSetJSON, KV } from '../../lib/kv.mjs';
import { sessions, loginGuard, SESSION_HOURS } from '../../lib/admin.mjs';

export async function onRequest(context) {
  const { env, request } = context;
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const ip = clientIp(request);
  if (!loginGuard.allowed(ip)) return json({ error: '失败次数过多，请 60 秒后再试' }, 429);
  const b = await readBody(request);
  const pwd = String((b && b.password) || '');
  let ok = false;
  if (env.ADMIN_PASSWORD) {
    ok = pwd === env.ADMIN_PASSWORD; // 环境变量本身是秘密，直接比对
  } else {
    const stored = await kvGetJSON(env, KV.PWD, null);
    if (stored && stored.salt && stored.hash) {
      ok = pwd.length > 0 && (await verifyPassword(pwd, stored.salt, stored.hash));
    }
  }
  if (!ok) {
    loginGuard.fail(ip);
    return json({ error: '密码错误' }, 401);
  }
  loginGuard.clear(ip);
  const token = newToken();
  sessions.set(token, SESSION_HOURS);
  return json({ token, expiresHours: SESSION_HOURS });
}