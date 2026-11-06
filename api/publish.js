// POST /api/publish { photos: [{ url, width, height, tags }], caption, state, date }
// Creates a photo post on Tumblr from staged uploads, then deletes the uploads.
import { withAuth } from '../server/session.mjs';
import { readStore, readStaged, deleteStaged, cleanupOldStaged } from '../server/store.mjs';
import { createPhotoPost } from '../shared/tumblr.mjs';
import { slug } from '../shared/core.mjs';

export const maxDuration = 120;

export const POST = withAuth(async (req, { token, blog }) => {
  const body = await req.json().catch(() => null);
  const list = body && Array.isArray(body.photos) ? body.photos : [];
  if (!list.length || list.length > 30) return Response.json({ error: 'Add between 1 and 30 photos' }, { status: 400 });
  const state = ['published', 'queue', 'draft'].includes(body.state) ? body.state : 'published';
  const date = body.date && !Number.isNaN(Date.parse(body.date)) ? body.date : null;
  const caption = typeof body.caption === 'string' ? body.caption.slice(0, 2000) : '';

  const photos = await Promise.all(list.map(async (p) => ({
    data: await readStaged(String(p.url)),
    type: 'image/jpeg',
    width: Math.max(1, parseInt(p.width, 10) || 1),
    height: Math.max(1, parseInt(p.height, 10) || 1),
    tags: Array.isArray(p.tags) ? [...new Set(p.tags.map(slug).filter(Boolean))] : [],
  })));
  const { data } = await readStore();
  const post = await createPhotoPost(token, blog, { photos, caption, state, date }, data.config);
  await deleteStaged(list.map((p) => String(p.url))).catch(() => {});
  await cleanupOldStaged().catch(() => {});
  return Response.json({ post });
});
