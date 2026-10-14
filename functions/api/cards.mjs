// /api/cards - 公开：返回管理员云端录入的老师考点卡（前端合并进检索）
import { json } from './lib.mjs';
import { kvGetJSON, KV } from '../lib/kv.mjs';

export async function onRequest(context) {
  const { env } = context;
  const cloud = await kvGetJSON(env, KV.CARDS, []);
  return json({ cards: cloud || [] });
}