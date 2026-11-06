import { handleCallback } from '../../server/session.mjs';

export async function GET(req) {
  try {
    return await handleCallback(req);
  } catch (e) {
    console.error(e);
    return new Response('Login failed. <a href="/api/auth/login">Try again</a>', {
      status: 500, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
}
