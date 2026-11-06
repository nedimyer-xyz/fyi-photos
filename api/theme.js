// GET  /api/theme → theme.html with the current lists filled in
// POST /api/theme { hash } → remember that this version was copied into Tumblr
import { withAuth } from '../server/session.mjs';
import { readStore, updateStore, buildTheme, hash, themeStatus } from '../server/store.mjs';

export const GET = withAuth(async () => {
  const { data } = await readStore();
  const text = await buildTheme(data.config);
  return new Response(text, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-theme-hash': hash(text), 'cache-control': 'no-store' },
  });
});

export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.hash !== 'string') return Response.json({ error: 'Bad request' }, { status: 400 });
  const { data } = await updateStore(null, (d) => ({ ...d, themeCopied: body.hash }));
  return Response.json({ rev: data.configRev, theme: await themeStatus(data) });
});
