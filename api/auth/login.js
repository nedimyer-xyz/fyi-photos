import { loginRedirect } from '../../server/session.mjs';

export function GET(req) {
  return loginRedirect(req);
}
