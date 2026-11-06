// GET /config.json → the people / travel / series lists (already public in the theme).
import { readStore } from '../server/store.mjs';

export async function GET() {
  const { data } = await readStore();
  return Response.json(data.config, {
    headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' },
  });
}
