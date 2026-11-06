// Fake Tumblr (OAuth2 + the API endpoints the admin uses) for local testing.
//   node scripts/mock-tumblr.mjs   → http://localhost:4399
// Seeds posts from migration/data/posts.json. GET /__log returns every write.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.MOCK_PORT || 4399);
const BLOG = 'fyi-photos';
const exp = JSON.parse(readFileSync(fileURLToPath(new URL('../migration/data/posts.json', import.meta.url)), 'utf8'));
const log = [];
let nextId = 900000000000000000n;

const db = new Map();
for (const p of exp.posts) {
  const content = p.npf ? [
    { type: 'text', text: 'keep me' },
    ...p.photos.map((ph) => {
      const alt = ph.altTags && ph.altTags.length ? `${ph.alt ? ph.alt + ' ' : ''}[${ph.altTags.join(', ')}]` : ph.alt;
      return { type: 'image', media: [{ url: ph.full, width: ph.w, height: ph.h }, { url: ph.thumb, width: 400, height: Math.round(400 * ph.h / (ph.w || 1)) }], ...(alt ? { alt_text: alt } : {}) };
    }),
  ] : [];
  db.set(p.id, {
    id_string: p.id, timestamp: Date.parse(p.date) / 1000, tags: p.tags, post_url: p.url, state: 'published',
    is_blocks_post_format: !!p.npf, content, layout: [{ type: 'rows', display: [{ blocks: [0] }] }],
  });
}
const ordered = () => [...db.values()].sort((a, b) => b.timestamp - a.timestamp);

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  return new Request(`http://localhost${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (p === '/__log') return json(res, 200, log);
  if (p === '/oauth2/authorize') {
    const to = new URL(url.searchParams.get('redirect_uri'));
    to.searchParams.set('code', 'mock-code');
    to.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { location: to.href });
    return res.end();
  }
  if (p === '/v2/oauth2/token') return json(res, 200, { access_token: 'mock-token', refresh_token: 'mock-refresh', expires_in: 2520 });
  if (req.headers.authorization !== 'Bearer mock-token') return json(res, 401, { meta: { status: 401, msg: 'Unauthorized' } });
  if (p === '/v2/user/info') {
    return json(res, 200, { response: { user: { name: 'way-way-out-there', blogs: [{ name: 'other', admin: true }, { name: BLOG, admin: true }] } } });
  }
  let m;
  if (p === `/v2/blog/${BLOG}/posts` && req.method === 'GET') {
    const offset = +url.searchParams.get('offset') || 0, limit = +url.searchParams.get('limit') || 20;
    const all = ordered();
    return json(res, 200, { response: { total_posts: all.length, posts: all.slice(offset, offset + limit) } });
  }
  if ((m = p.match(new RegExp(`^/v2/blog/${BLOG}/posts/(\\d+)$`)))) {
    const post = db.get(m[1]);
    if (!post) return json(res, 404, { errors: [{ detail: 'Not found' }] });
    if (req.method === 'GET') return json(res, 200, { response: post });
    if (req.method === 'PUT') {
      const body = await (await toRequest(req)).json();
      const imgsBefore = post.content.filter((b) => b.type === 'image').length;
      const imgsAfter = body.content.filter((b) => b.type === 'image').length;
      const textKept = !post.content.length || body.content[0]?.text === post.content[0]?.text;
      const dateKept = new Date(body.date).getTime() / 1000 === post.timestamp;
      log.push({ op: 'edit', id: m[1], tags: body.tags, alts: body.content.filter((b) => b.type === 'image').map((b) => b.alt_text || ''), ok: imgsBefore === imgsAfter && textKept && dateKept });
      if (!(imgsBefore === imgsAfter && textKept && dateKept)) return json(res, 400, { errors: [{ detail: 'content or date altered' }] });
      post.content = body.content;
      post.tags = body.tags ? body.tags.split(',') : [];
      return json(res, 200, { response: { id_string: m[1] } });
    }
  }
  if (p === `/v2/blog/${BLOG}/posts` && req.method === 'POST') {
    const form = await (await toRequest(req)).formData();
    const body = JSON.parse(await form.get('json').text());
    const files = body.content.filter((b) => b.type === 'image').map((b) => form.get(b.media[0].identifier));
    const sizes = files.map((f) => (f ? f.size : 0));
    const id = String(nextId++);
    log.push({ op: 'create', id, state: body.state, date: body.date || null, tags: body.tags, alts: body.content.filter((b) => b.type === 'image').map((b) => b.alt_text || ''), caption: body.content.find((b) => b.type === 'text')?.text || '', sizes, types: files.map((f) => f && f.type) });
    if (sizes.some((s) => !s)) return json(res, 400, { errors: [{ detail: 'missing media part' }] });
    if (body.state === 'published') {
      db.set(id, {
        id_string: id, timestamp: Math.floor(Date.now() / 1000), tags: body.tags.split(','), post_url: `https://fyi.photos/post/${id}`, state: 'published',
        is_blocks_post_format: true,
        content: body.content.map((b, i) => b.type === 'image' ? { type: 'image', alt_text: b.alt_text, media: [{ url: `https://64.media.tumblr.com/mock${id}/${i}-x/s1280x1920/a.jpg`, width: b.media[0].width, height: b.media[0].height }] } : b),
        layout: [],
      });
    }
    return json(res, 201, { response: { id_string: id } });
  }
  json(res, 404, { errors: [{ detail: 'mock: no route ' + req.method + ' ' + p }] });
}).listen(PORT, () => console.log(`Mock Tumblr: http://localhost:${PORT}`));
