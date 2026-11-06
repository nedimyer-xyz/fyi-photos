// One command for local work, with no access to the real Tumblr or Vercel Blob:
//   npm run local
// Starts the mock Tumblr (4399), the admin (4330, local .admin-data/ storage)
// and the theme preview (4321). Ctrl+C stops all three.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const adminEnv = {
  // Empty values win over .env.local, so the real Blob store is never used.
  BLOB_READ_WRITE_TOKEN: '',
  VERCEL_OIDC_TOKEN: '',
  OAUTH_CALLBACK_ORIGIN: '',
  TUMBLR_API: 'http://localhost:4399/v2',
  TUMBLR_WWW: 'http://localhost:4399',
  TUMBLR_CLIENT_ID: 'mock',
  TUMBLR_CLIENT_SECRET: 'mock',
  TUMBLR_BLOG: 'fyi-photos',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  PORT: '4330',
};

const procs = [
  ['mock  ', 'scripts/mock-tumblr.mjs', {}],
  ['admin ', 'scripts/admin-dev.mjs', adminEnv],
  ['theme ', 'preview/server.mjs', { PORT: '4321' }],
].map(([name, file, env]) => {
  const p = spawn(process.execPath, [file], { cwd: ROOT, env: { ...process.env, ...env } });
  const out = (d) => process.stdout.write(String(d).replace(/^(?=.)/gm, `[${name}] `));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => console.log(`[${name}] exited (${code})`));
  return p;
});

setTimeout(() => console.log('\nAdmin:  http://localhost:4330  (click "Login to fyi.photos")\nTheme:  http://localhost:4321\n'), 1000);

const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
