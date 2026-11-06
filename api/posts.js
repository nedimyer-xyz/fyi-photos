// GET /api/posts?offset=0 → { total, posts } (20 at a time, newest first)
import { withAuth } from '../server/session.mjs';
import { readStore } from '../server/store.mjs';
import { listPosts } from '../shared/tumblr.mjs';

export const GET = withAuth(async (req, { token, blog }) => {
  const offset = Math.max(0, parseInt(new URL(req.url).searchParams.get('offset') || '0', 10) || 0);
  const { data } = await readStore();
  return Response.json(await listPosts(token, blog, offset, data.config));
});
