/* recast-sync — one tiny key/value room per sync code.

   The page hashes the sync code in the browser and only ever sends the hash,
   so the Worker never sees the code itself. Whoever knows the code owns the
   room; there is no account. Rooms hold one JSON document (the source post,
   whether it is locked, which platforms are posted) and a revision counter,
   so two devices can't silently clobber each other: a PUT must carry the
   revision it last saw, and gets a 409 with the current document otherwise. */

const MAX_BYTES = 64 * 1024;
const TTL = 60 * 60 * 24 * 30; // a room nobody touched for 30 days expires

const ALLOWED = [
  'https://recast.yourcardjourney.store',
  'http://localhost:9777',
  'http://127.0.0.1:9777',
];

function cors(origin) {
  const ok = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': ok,
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}

const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const h = cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const m = new URL(request.url).pathname.match(/^\/s\/([a-f0-9]{64})$/);
    if (!m) return json({ error: 'not found' }, 404, h);
    const key = 'room:' + m[1];

    if (request.method === 'GET') {
      const cur = await env.RC.get(key, 'json');
      return cur ? json(cur, 200, h) : json({ rev: 0 }, 404, h);
    }

    if (request.method === 'DELETE') {
      await env.RC.delete(key);
      return json({ ok: true, rev: 0 }, 200, h);
    }

    if (request.method === 'PUT') {
      const raw = await request.text();
      if (raw.length > MAX_BYTES) return json({ error: 'too large' }, 413, h);
      let body;
      try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad json' }, 400, h); }
      const cur = (await env.RC.get(key, 'json')) || { rev: 0 };
      const base = Number(body.baseRev || 0);
      if (base !== cur.rev) return json({ conflict: true, ...cur }, 409, h);
      const next = {
        rev: cur.rev + 1,
        at: Date.now(),
        src: String(body.src || '').slice(0, MAX_BYTES / 2),
        locked: !!body.locked,
        converted: !!body.converted,
        done: Array.isArray(body.done) ? body.done.filter((d) => ['wa', 'ig', 'li', 'rd'].includes(d)) : [],
        device: String(body.device || '').slice(0, 40),
      };
      await env.RC.put(key, JSON.stringify(next), { expirationTtl: TTL });
      return json(next, 200, h);
    }

    return json({ error: 'method' }, 405, h);
  },
};
