// Local dev server for the admin site: serves admin/ and runs api/*.js the same
// way Vercel does (Web Request → Response handlers).
//
//   npm run admin:dev            http://localhost:4330
//
// Needs TUMBLR_CLIENT_ID / TUMBLR_CLIENT_SECRET / SESSION_SECRET in the
// environment (or in .env.local). Without BLOB_READ_WRITE_TOKEN, data is kept in
// .admin-data/. Set TUMBLR_API / TUMBLR_WWW to point at a mock Tumblr for tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 4330);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

// Minimal .env.local loader (KEY=value lines).
const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const REWRITES = { '/config.json': '/api/public-config' };

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  return new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
}

async function send(res, response) {
  const headers = {};
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

createServer(async (req, res) => {
  try {
    let path = new URL(req.url, 'http://x').pathname;
    path = REWRITES[path] || path;
    if (path.startsWith('/api/')) {
      const file = join(ROOT, normalize(path).replace(/\/$/, '') + '.js');
      if (!file.startsWith(join(ROOT, 'api')) || !existsSync(file)) return send(res, Response.json({ error: 'Not found' }, { status: 404 }));
      const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
      const handler = mod[req.method];
      if (!handler) return send(res, new Response('Method not allowed', { status: 405 }));
      return send(res, await handler(await toRequest(req)));
    }
    const file = join(ROOT, 'admin', path === '/' ? 'index.html' : normalize(path));
    if (!file.startsWith(join(ROOT, 'admin')) || !existsSync(file)) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('Server error');
  }
}).listen(PORT, () => console.log(`Admin (dev): http://localhost:${PORT}`));
