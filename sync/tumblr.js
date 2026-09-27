'use strict';
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '.env');
const TOKEN_FILE = path.join(__dirname, '.tumblr-tokens.json');
const API = process.env.TUMBLR_API_BASE || 'https://api.tumblr.com';
const AUTHORIZE_URL = 'https://www.tumblr.com/oauth2/authorize';
const REDIRECT_URI = 'http://localhost:3000/callback';

function loadEnv() {
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || m[1] in process.env) continue;
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return process.env;
}

function requireEnv(...names) {
  const env = loadEnv();
  const missing = names.filter((n) => !env[n]);
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')} in sync/.env (copy sync/.env.example to get started).`);
    process.exit(1);
  }
  return env;
}

function blogId(name) {
  return name.includes('.') ? name : `${name}.tumblr.com`;
}

async function tokenRequest(params) {
  const res = await fetch(`${API}/v2/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Tumblr login failed (${res.status}): ${JSON.stringify(body)}`);
  const tokens = {
    access_token: body.access_token,
    refresh_token: body.refresh_token || params.refresh_token,
    expires_at: Date.now() + (body.expires_in || 0) * 1000,
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  return tokens;
}

async function accessToken() {
  const env = requireEnv('TUMBLR_CLIENT_ID', 'TUMBLR_CLIENT_SECRET');
  if (!fs.existsSync(TOKEN_FILE)) throw new Error('Not connected to Tumblr yet. Run: node sync/auth.js');
  let tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  if (Date.now() > tokens.expires_at - 60_000) {
    if (!tokens.refresh_token) throw new Error('Tumblr login expired. Run: node sync/auth.js');
    tokens = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: env.TUMBLR_CLIENT_ID,
      client_secret: env.TUMBLR_CLIENT_SECRET,
    });
  }
  return tokens.access_token;
}

class ApiError extends Error {
  constructor(status, body) {
    super(`Tumblr API error ${status}: ${JSON.stringify(body.errors || body.meta || body)}`);
    this.status = status;
    this.body = body;
  }
}

async function api(method, pathname, { json, form } = {}) {
  const headers = { Authorization: `Bearer ${await accessToken()}` };
  let body = form;
  if (json) {
    body = JSON.stringify(json);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API}/v2${pathname}`, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data.response;
}

function isRateLimit(err) {
  return err instanceof ApiError && (err.status === 429 || /limit/i.test(JSON.stringify(err.body)));
}

module.exports = { loadEnv, requireEnv, blogId, tokenRequest, api, isRateLimit, AUTHORIZE_URL, REDIRECT_URI };
