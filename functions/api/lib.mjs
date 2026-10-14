// lib.mjs - 响应封装（Functions 内共享）
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function readBody(request) {
  try { return await request.json(); } catch (e) { return null; }
}

export function clientIp(request) {
  return (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
}