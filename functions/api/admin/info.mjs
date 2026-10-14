// /api/admin/info
import { json } from '../lib.mjs';
import { requireAdmin, sessions } from '../../lib/admin.mjs';
import { kvGetJSON, KV } from '../../lib/kv.mjs';

export async function onRequest(context) {
  const { env, request } = context;
  if (!requireAdmin(request)) return json({ error: '未解锁' }, 401);
  const cloud = await kvGetJSON(env, KV.CARDS, []) || [];
  const staticTotal = parseInt(env.STATIC_CARDS || '58', 10) || 58;
  return json({
    cards: staticTotal + cloud.length,
    teacher: 3 + cloud.length,
    startedAt: '公网部署（Cloudflare Pages）',
    ai: !!env.API_KEY,
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
    sessions: sessions.count(),
    storage: !!env.KB
  });
}