// Local bulk-tagging tool.  npm run tagger  →  http://localhost:4323
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import {
  DIR, POSTS_FILE, TAGS_FILE, CATEGORIES,
  readJSON, writeJSON, readConfig, writeConfig, managedTags, slug,
} from '../lib.mjs';

const PORT = Number(process.env.TAGGER_PORT || 4323);
const STATIC = join(DIR, 'tagger');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const exported = await readJSON(POSTS_FILE, null);
if (!exported) {
  console.error('No export found. Run: npm run export');
  process.exit(1);
}

// Pre-fill photos from tags already on Tumblr: bracket alt tags if present,
// otherwise the post's existing managed tags (e.g. t-dock, challis).
function seed(post, managed) {
  const out = {};
  const fromAlt = post.photos.some((ph) => ph.altTags && ph.altTags.length);
  const postTags = post.tags.map(slug).filter((t) => managed.has(t) && !CATEGORIES.includes(t));
  for (const ph of post.photos) {
    const tags = fromAlt ? ph.altTags || [] : postTags;
    if (tags.length) out[ph.key] = [...tags];
  }
  return out;
}

async function loadState() {
  const state = await readJSON(TAGS_FILE, { version: 1, photos: {}, reviewed: {} });
  state.photos ||= {};
  state.reviewed ||= {};
  const managed = managedTags(await readConfig());
  for (const p of exported.posts) {
    if (!state.photos[p.id]) {
      const s = seed(p, managed);
      if (Object.keys(s).length) state.photos[p.id] = s;
    }
  }
  return state;
}

// Fingerprint of tags.json on disk. A tab may only save if nothing else (another
// tab, rename-people, set-cover…) has changed the file since that tab loaded it.
async function fileRev() {
  const buf = await readFile(TAGS_FILE).catch(() => Buffer.from(''));
  return createHash('sha1').update(buf).digest('hex');
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return JSON.parse(data || '{}');
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/state' && req.method === 'GET') {
      return send(res, 200, {
        posts: exported.posts,
        source: exported.source,
        exportedAt: exported.exportedAt,
        config: await readConfig(),
        state: await loadState(),
        rev: await fileRev(),
      });
    }
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      const body = await readBody(req);
      if (!body || typeof body.photos !== 'object') return send(res, 400, { error: 'bad state' });
      if (body.rev !== await fileRev()) {
        return send(res, 409, { error: 'Tags were changed somewhere else since this page was loaded. Reload the page to continue.' });
      }
      await writeJSON(TAGS_FILE, { version: 1, savedAt: new Date().toISOString(), photos: body.photos, reviewed: body.reviewed || {} });
      return send(res, 200, { ok: true, rev: await fileRev() });
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const { category, label } = await readBody(req);
      const tag = slug(label);
      if (!CATEGORIES.includes(category) || !tag) return send(res, 400, { error: 'Need a category and a name' });
      const cfg = await readConfig();
      if (managedTags(cfg).has(tag)) return send(res, 409, { error: `"${tag}" already exists` });
      cfg[category].push(category === 'people' ? { tag, label: label.trim() } : { tag, label: label.trim(), cover: '' });
      await writeConfig(cfg);
      return send(res, 200, { config: cfg, tag });
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(file)) return send(res, 404, 'Not found', 'text/plain');
    const body = await readFile(join(STATIC, file)).catch(() => null);
    if (!body) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, body, TYPES[extname(file)] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Tagger: ${url}  (${exported.posts.length} posts from ${exported.source} export ${exported.exportedAt})`);
  if (!process.env.NO_OPEN) execFile('open', [url], () => {});
});
