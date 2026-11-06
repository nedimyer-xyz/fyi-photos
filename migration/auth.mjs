// Tumblr OAuth2 login + authenticated API helpers.
//
//   npm run auth      one-time browser login; saves migration/.secrets.json
import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SECRETS, readJSON, writeJSON, sleep } from './lib.mjs';

const API = process.env.TUMBLR_API || 'https://api.tumblr.com/v2';
const PORT = 4322;
const REDIRECT = `http://localhost:${PORT}/callback`;

async function saveSecrets(s) {
  await writeJSON(SECRETS, s);
  await chmod(SECRETS, 0o600);
}

async function tokenRequest(params) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Token request failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

function storeToken(secrets, t) {
  return {
    ...secrets,
    access_token: t.access_token,
    refresh_token: t.refresh_token || secrets.refresh_token,
    expires_at: Date.now() + (t.expires_in || 2520) * 1000,
  };
}

export async function getSecrets() {
  return readJSON(SECRETS, {});
}

export async function getAccessToken() {
  let s = await getSecrets();
  if (!s.access_token) throw new Error('Not logged in. Run: npm run auth');
  if (Date.now() > (s.expires_at || 0) - 60_000) {
    if (!s.refresh_token) throw new Error('Session expired. Run: npm run auth');
    s = storeToken(s, await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: s.refresh_token,
      client_id: s.client_id,
      client_secret: s.client_secret,
    }));
    await saveSecrets(s);
  }
  return s.access_token;
}

// Authenticated request with retry on rate limits / transient errors.
export async function api(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    const token = await getAccessToken();
    const res = await fetch(API + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json.response;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 6) {
      const wait = res.status === 429 ? 60_000 * attempt : 2_000 * attempt;
      console.warn(`  ${res.status} from Tumblr, retrying in ${Math.round(wait / 1000)}s…`);
      await sleep(wait);
      continue;
    }
    const err = new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json.errors || json.meta || json)}`);
    err.status = res.status;
    throw err;
  }
}

async function login() {
  let s = await getSecrets();
  if (!s.client_id || !s.client_secret) {
    console.log(`
1. Go to https://www.tumblr.com/oauth/apps and click "Register application".
2. Fill in any name/description/website (e.g. https://fyi.photos).
3. Set BOTH "Default callback URL" and "OAuth2 redirect URLs" to:
     ${REDIRECT}
4. Copy the "OAuth Consumer Key" and "Secret Key" below.
`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    s.client_id = (await rl.question('OAuth Consumer Key: ')).trim();
    s.client_secret = (await rl.question('Secret Key: ')).trim();
    rl.close();
    await saveSecrets(s);
  }

  const state = randomBytes(16).toString('hex');
  const url = 'https://www.tumblr.com/oauth2/authorize?' + new URLSearchParams({
    client_id: s.client_id,
    response_type: 'code',
    scope: 'basic write offline_access',
    state,
    redirect_uri: REDIRECT,
  });

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html' });
      res.end(ok ? '<p style="font:16px sans-serif">Logged in — you can close this tab.</p>'
                 : '<p style="font:16px sans-serif">Login failed. Check the terminal.</p>');
      server.close();
      ok ? resolve(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error') || 'state mismatch'));
    }).listen(PORT, () => {
      console.log('Opening Tumblr to authorize… If nothing opens, visit:\n' + url + '\n');
      execFile('open', [url], () => {});
    });
  });

  s = storeToken(s, await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: s.client_id,
    client_secret: s.client_secret,
    redirect_uri: REDIRECT,
  }));
  await saveSecrets(s);
  const me = await api('GET', '/user/info');
  console.log(`✓ Logged in as ${me.user.name}. Blogs: ${me.user.blogs.map((b) => b.name).join(', ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  login().catch((e) => { console.error('✗', e.message); process.exit(1); });
}
