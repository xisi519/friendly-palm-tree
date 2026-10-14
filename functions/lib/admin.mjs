// admin.mjs - 管理会话（共享内存态）与鉴权
import { makeSessionStore, makeLoginGuard } from './core.mjs';

export const sessions = makeSessionStore();
export const loginGuard = makeLoginGuard();

export const SESSION_HOURS = 8;

// 校验 X-Admin-Token；通过返回 token，否则 null
export function requireAdmin(request) {
  const t = request.headers.get('x-admin-token');
  if (!t || !sessions.check(t)) return null;
  return t;
}