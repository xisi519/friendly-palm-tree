// /api/ask-ai - 服务端 LLM 代理（Key 只存在服务器环境变量，绝不下发浏览器）
import { json, readBody } from './lib.mjs';
import { buildSystemPrompt, buildUserPrompt } from '../lib/core.mjs';

export async function onRequest(context) {
  const { env, request } = context;
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const key = env.API_KEY;
  if (!key) return json({ error: '服务器未配置 API Key（Pages 环境变量 API_KEY）' }, 400);
  const b = await readBody(request);
  if (!b || !b.question) return json({ error: '缺少问题' }, 400);
  const user = buildUserPrompt(b.question, b.hits || [], b.unknown || []);
  const base = String(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: user }
        ]
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return json({ error: '模型接口返回 ' + resp.status + ': ' + txt.slice(0, 200) }, 502);
    }
    const data = await resp.json();
    const answer = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    if (!answer) return json({ error: '模型返回为空' }, 502);
    return json({ answer });
  } catch (e) {
    return json({ error: '模型调用失败: ' + String(e.message || e) }, 502);
  } finally {
    clearTimeout(timer);
  }
}