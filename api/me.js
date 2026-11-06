import { withAuth } from '../server/session.mjs';

export const GET = withAuth(async (req, { user, blog }) => Response.json({ user, blog }));
