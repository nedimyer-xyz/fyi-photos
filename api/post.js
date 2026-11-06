// PUT /api/post?id=123  { photos: { photoKey: [tags] } } → saves tags to Tumblr
import { withAuth } from '../server/session.mjs';
import { readStore } from '../server/store.mjs';
import { savePhotoTags } from '../shared/tumblr.mjs';
import { slug } from '../shared/core.mjs';

export const PUT = withAuth(async (req, { token, blog }) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^\d+$/.test(id)) return Response.json({ error: 'Bad post id' }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.photos !== 'object') return Response.json({ error: 'Bad request' }, { status: 400 });
  const photos = {};
  for (const [key, tags] of Object.entries(body.photos)) {
    if (!/^[\w-]+\/[\w-]+$/.test(key) || !Array.isArray(tags)) continue;
    photos[key] = [...new Set(tags.map(slug).filter(Boolean))].slice(0, 40);
  }
  const { data } = await readStore();
  return Response.json({ post: await savePhotoTags(token, blog, id, photos, data.config) });
});
