// kv.mjs - Cloudflare KV 封装（仅在 Functions 运行时可用的模块，浏览器测试不 import 它）
import { KV } from './core.mjs';

export async function kvGetJSON(env, key, fallback) {
  if (!env || !env.KB) return fallback;
  try {
    const v = await env.KB.get(key, 'json');
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

export async function kvSetJSON(env, key, value) {
  if (!env || !env.KB) throw new Error('KV 未绑定（配置 KB 命名空间后重试）');
  await env.KB.put(key, JSON.stringify(value));
}

export async function kvDelete(env, key) {
  if (!env || !env.KB) throw new Error('KV 未绑定');
  await env.KB.delete(key);
}

export { KV };