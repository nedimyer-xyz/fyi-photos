// GET   /api/store → { rev, config, reviewed, theme }
// PUT   /api/store { baseRev, config } → replace lists (baseRev = configRev; rejects stale tabs)
// PATCH /api/store { reviewed: { postId: true|false } } → merge reviewed flags
import { withAuth } from '../server/session.mjs';
import { readStore, updateStore, normalizeConfig, themeStatus } from '../server/store.mjs';

async function reply({ rev, data }) {
  return Response.json({ rev: data.configRev, config: data.config, reviewed: data.reviewed || {}, theme: await themeStatus(data) });
}

export const GET = withAuth(async () => reply(await readStore()));

export const PUT = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  if (!body || !body.config || typeof body.baseRev !== 'string') return Response.json({ error: 'Bad request' }, { status: 400 });
  const config = normalizeConfig(body.config);
  return reply(await updateStore(body.baseRev, (d) => ({ ...d, config })));
});

export const PATCH = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.reviewed !== 'object') return Response.json({ error: 'Bad request' }, { status: 400 });
  return reply(await updateStore(null, (d) => {
    d.reviewed = d.reviewed || {};
    for (const [id, on] of Object.entries(body.reviewed)) {
      if (!/^\d+$/.test(id)) continue;
      if (on) d.reviewed[id] = true;
      else delete d.reviewed[id];
    }
    return d;
  }));
});
