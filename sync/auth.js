'use strict';
// One-time Tumblr login. Opens your browser, you click Allow, and the
// tokens are saved to sync/.tumblr-tokens.json (never committed).
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const tumblr = require('./tumblr');

const env = tumblr.requireEnv('TUMBLR_CLIENT_ID', 'TUMBLR_CLIENT_SECRET', 'TUMBLR_BLOG');
const state = crypto.randomBytes(16).toString('hex');
const authUrl = `${tumblr.AUTHORIZE_URL}?${new URLSearchParams({
  client_id: env.TUMBLR_CLIENT_ID,
  response_type: 'code',
  scope: 'basic write offline_access',
  state,
  redirect_uri: tumblr.REDIRECT_URI,
})}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, tumblr.REDIRECT_URI);
  if (url.pathname !== '/callback') return res.writeHead(404).end();

  const reply = (status, text) => res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
  const finish = (code) => {
    process.exitCode = code;
    server.close();
    server.closeAllConnections();
  };

  if (url.searchParams.get('state') !== state) return reply(400, 'Login link expired. Run node sync/auth.js again.');
  if (url.searchParams.get('error')) {
    reply(400, `Tumblr declined the login: ${url.searchParams.get('error')}`);
    console.error(`Tumblr declined the login: ${url.searchParams.get('error')}`);
    return finish(1);
  }

  try {
    await tumblr.tokenRequest({
      grant_type: 'authorization_code',
      code: url.searchParams.get('code'),
      client_id: env.TUMBLR_CLIENT_ID,
      client_secret: env.TUMBLR_CLIENT_SECRET,
      redirect_uri: tumblr.REDIRECT_URI,
    });
    const info = await tumblr.api('GET', '/user/info');
    const blogs = info.user.blogs.map((b) => b.name);
    const target = env.TUMBLR_BLOG.replace(/\.tumblr\.com$/, '');
    reply(200, 'Connected to Tumblr. You can close this tab.');
    console.log(`Connected as ${info.user.name}. Your blogs: ${blogs.join(', ')}`);
    if (!target.includes('.') && !blogs.includes(target)) {
      console.warn(`Warning: TUMBLR_BLOG is "${env.TUMBLR_BLOG}", which isn't one of your blogs. Fix it in sync/.env.`);
    }
    finish(0);
  } catch (err) {
    reply(500, err.message);
    console.error(err.message);
    finish(1);
  }
});

server.listen(3000, () => {
  console.log('Opening Tumblr in your browser. If it does not open, visit:\n');
  console.log(authUrl + '\n');
  const opener = { darwin: 'open', linux: 'xdg-open' }[process.platform];
  if (opener) execFile(opener, [authUrl], () => {});
});
