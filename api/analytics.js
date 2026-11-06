// GET: authenticated dashboard data.
// POST: public, cookie-free pageview collector for fyi.photos.
// Analytics is stored separately from posts, tags, covers, and admin data.
import { withAuth } from '../server/session.mjs';
import { eventFromRequest, pruneAnalytics, readEvents, recordEvent, summarize } from '../server/analytics.mjs';

const ALLOWED = new Set(['https://fyi.photos', 'https://www.fyi.photos']);
const BOT = /bot|crawler|spider|headless|preview|facebookexternalhit|slurp|bingpreview/i;

function cors(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'cross-origin',
    'vary': 'origin',
  };
}

export const GET = withAuth(async (req) => {
  const days = parseInt(new URL(req.url).searchParams.get('days') || '7', 10);
  return Response.json(summarize(await readEvents(), days), {
    headers: { 'cache-control': 'private, no-store' },
  });
});

export async function OPTIONS(req) {
  const origin = req.headers.get('origin') || '';
  if (!ALLOWED.has(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors(origin) });
}

export async function POST(req) {
  const origin = req.headers.get('origin') || '';
  if (!ALLOWED.has(origin)) return new Response(null, { status: 403 });
  if (BOT.test(req.headers.get('user-agent') || '')) {
    return new Response(null, { status: 202, headers: cors(origin) });
  }
  const length = parseInt(req.headers.get('content-length') || '0', 10);
  if (length > 2048) return new Response(null, { status: 413, headers: cors(origin) });
  const text = await req.text();
  if (text.length > 2048) return new Response(null, { status: 413, headers: cors(origin) });
  let payload;
  try {
    payload = JSON.parse(text || '{}');
  } catch {
    return new Response(null, { status: 400, headers: cors(origin) });
  }
  await recordEvent(eventFromRequest(req, payload));
  if (Math.random() < 0.01) pruneAnalytics().catch(() => {});
  return new Response(null, { status: 204, headers: cors(origin) });
}
