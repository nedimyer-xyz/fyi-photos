import { logout } from '../../server/session.mjs';

export function POST(req) {
  if (req.headers.get('x-fyi-admin') !== '1') return Response.json({ error: 'Bad request' }, { status: 400 });
  return logout(req);
}
