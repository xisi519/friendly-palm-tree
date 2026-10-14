// /api/health
import { json } from './lib.mjs';
import { kvGetJSON, KV } from '../lib/kv.mjs';
import { buildSystemPrompt } from '../lib/core.mjs';

export async function onRequest(context) {
  const { env } = context;
  const cloud = await kvGetJSON(env, KV.CARDS, []);
  const hasPwd = !!env.ADMIN_PASSWORD || !!(await kvGetJSON(env, KV.PWD, null));
  // 静态知识卡数量：改 knowledge 后与 tools/build-knowledge.ps1 输出同步（仅用于展示）
  const staticTotal = parseInt(env.STATIC_CARDS || '58', 10) || 58;
  return json({
    ai: !!env.API_KEY,
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
    version: '0.3-cf',
    cards: staticTotal + (cloud ? cloud.length : 0),
    admin: !!hasPwd,
    storage: !!env.KB,
    promptOk: buildSystemPrompt().length > 50
  });
}