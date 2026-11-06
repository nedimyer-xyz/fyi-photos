// POST   /api/stage   (body: one resized JPEG, ≤ 4.4 MB) → { url }
// DELETE /api/stage   { urls: [...] } → removes staged photos that won't be posted
import { withAuth } from '../server/session.mjs';
import { stagePhoto, deleteStaged } from '../server/store.mjs';

const MAX = 4.4 * 1024 * 1024;

export const POST = withAuth(async (req) => {
  const type = req.headers.get('content-type') || '';
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return Response.json({ error: 'Photos must be JPEG, PNG or WebP' }, { status: 415 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX) return Response.json({ error: 'Photo too large' }, { status: 413 });
  return Response.json({ url: await stagePhoto(bytes, type) });
});

export const DELETE = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.urls)) return Response.json({ error: 'Bad request' }, { status: 400 });
  await deleteStaged(body.urls.slice(0, 100));
  return new Response(null, { status: 204 });
});
