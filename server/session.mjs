// Encrypted cookie sessions + Tumblr OAuth2 token handling for the admin site.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { API, WWW, tumblr } from '../shared/tumblr.mjs';

const COOKIE = 'fyi_admin';
const STATE_COOKIE = 'fyi_oauth_state';
const MAX_AGE = 60 * 60 * 24 * 365; // stay logged in for a year (renewed on use)

export const BLOG = () => process.env.TUMBLR_BLOG || 'fyi-photos';

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set (32+ chars)');
  return createHash('sha256').update(secret).digest();
}

export function seal(obj) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64url');
}

export function unseal(str) {
  try {
    const buf = Buffer.from(str, 'base64url');
    const d = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isLocal(req) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(new URL(req.url).host);
}

export function cookie(req, name, value, maxAge) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isLocal(req) ? '' : 'Secure',
    `Max-Age=${maxAge}`,
  ].filter(Boolean).join('; ');
}

export function origin(req) {
  return new URL(req.url).origin;
}

// The return address registered with the Tumblr app (OAUTH_CALLBACK_ORIGIN).
// Requests to the vercel.app address are forwarded to admin.fyi.photos (see
// vercel.json), so the login cookie is always set on admin.fyi.photos.
export function redirectUri(req) {
  return `${process.env.OAUTH_CALLBACK_ORIGIN || origin(req)}/api/auth/callback`;
}

/* ── OAuth ──────────────────────────────────────────────── */

// The OAuth "state" is a short signed timestamp (hex only, so Tumblr passes it
// back untouched). The callback verifies it without needing a cookie.
const STATE_TTL = 15 * 60 * 1000;

function stateSig(t) {
  return createHmac('sha256', key()).update('oauth-state:' + t).digest('hex').slice(0, 32);
}
function makeState() {
  const t = Date.now().toString(16);
  return t + stateSig(t);
}
function checkState(state) {
  if (!/^[0-9a-f]{40,48}$/.test(state || '')) return false;
  const t = state.slice(0, -32), sig = state.slice(-32);
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(stateSig(t)))) return false;
  return Date.now() - parseInt(t, 16) < STATE_TTL;
}

export function loginRedirect(req) {
  const state = makeState();
  const url = `${WWW()}/oauth2/authorize?` + new URLSearchParams({
    client_id: process.env.TUMBLR_CLIENT_ID,
    response_type: 'code',
    scope: 'basic write offline_access',
    state,
    redirect_uri: redirectUri(req),
  });
  return new Response(null, { status: 302, headers: { location: url } });
}

async function tokenRequest(params) {
  const res = await fetch(`${API()}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.TUMBLR_CLIENT_ID,
      client_secret: process.env.TUMBLR_CLIENT_SECRET,
      ...params,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`Token request failed (${res.status})`);
  return json;
}

function sessionFrom(t, user, prev = {}) {
  return {
    user: user || prev.user,
    access: t.access_token,
    refresh: t.refresh_token || prev.refresh,
    exp: Date.now() + (t.expires_in || 2520) * 1000,
  };
}

export async function handleCallback(req) {
  const url = new URL(req.url);
  const fail = (msg) => new Response(page(msg), { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } });
  // Tumblr sometimes returns without the state parameter. A *wrong* state is
  // rejected; a missing one is allowed, since only the fyi-photos blog owner can
  // log in anyway (checked below), so a forged login can't sign you in as someone else.
  const state = url.searchParams.get('state');
  if (state && !checkState(state)) {
    console.warn('OAuth state rejected');
    return fail('Login took too long. Please try again.');
  }
  const code = url.searchParams.get('code');
  if (!code) {
    console.warn('OAuth callback without code; params:', [...url.searchParams.keys()].join(',') || '(none)', url.searchParams.get('error') || '', url.searchParams.get('error_description') || '');
    return fail('Tumblr did not approve the login.');
  }

  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(req) });
  const info = await tumblr(t.access_token, 'GET', '/user/info');
  const blog = (info.user.blogs || []).find((b) => b.name === BLOG());
  if (!blog || blog.admin === false) return fail(`This admin is only for the ${BLOG()} blog owner.`);

  const headers = new Headers({ location: '/' });
  headers.append('set-cookie', cookie(req, COOKIE, seal(sessionFrom(t, info.user.name)), MAX_AGE));
  headers.append('set-cookie', cookie(req, STATE_COOKIE, '', 0));
  return new Response(null, { status: 302, headers });
}

export function logout(req) {
  return new Response(null, { status: 204, headers: { 'set-cookie': cookie(req, COOKIE, '', 0) } });
}

function page(msg) {
  return `<!doctype html><meta name="viewport" content="width=device-width"><body style="font:15px -apple-system,sans-serif;padding:40px;color:#333">${msg}<p><a href="/api/auth/login">Log in with Tumblr</a></p>`;
}

/* ── Guard for API routes ───────────────────────────────── */

// Wraps a handler (req, ctx) => Response. ctx = { token, user, blog }.
// Rejects unauthenticated requests and cross-site writes; refreshes tokens.
export function withAuth(handler) {
  return async (req) => {
    try {
      if (req.method !== 'GET' && req.headers.get('x-fyi-admin') !== '1') {
        return Response.json({ error: 'Bad request' }, { status: 400 });
      }
      let s = unseal(cookies(req)[COOKIE] || '');
      if (!s || !s.access) return Response.json({ error: 'Not logged in' }, { status: 401 });
      let setCookie = null;
      // Renew the cookie at most once a day so regular use never logs you out.
      if (!s.renewed || Date.now() - s.renewed > 86_400_000) {
        s.renewed = Date.now();
        setCookie = cookie(req, COOKIE, seal(s), MAX_AGE);
      }
      if (Date.now() > s.exp - 60_000) {
        if (!s.refresh) return Response.json({ error: 'Not logged in' }, { status: 401 });
        try {
          s = sessionFrom(await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refresh }), null, s);
        } catch {
          return Response.json({ error: 'Not logged in' }, { status: 401 });
        }
        setCookie = cookie(req, COOKIE, seal(s), MAX_AGE);
      }
      const res = await handler(req, { token: s.access, user: s.user, blog: BLOG() });
      if (setCookie) res.headers.append('set-cookie', setCookie);
      return res;
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (status === 500) console.error(e);
      // A Tumblr 401 means Tumblr rejected us, not that the admin session is gone.
      return Response.json({ error: e.message || 'Server error' }, { status: status === 401 ? 502 : status });
    }
  };
}
