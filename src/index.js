// Banana Log Worker: one door for the browser (Google sign-in), one for the AI (bearer token).
import { handleApi, handleIngest } from './api.js';
import { getSession, handleAuth } from './auth.js';
import { loginPage } from './login.js';
import { json, withSecurityHeaders } from './util.js';

// Files the browser needs before sign-in (login page styling, home-screen icon). They hold no data.
const PUBLIC_ASSETS = new Set(['/app.css', '/icon.svg', '/icon-180.png', '/icon-512.png', '/manifest.webmanifest']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let res;
    try {
      res = await route(request, env, url);
    } catch (err) {
      console.error(err);
      res = json({ error: 'Something went wrong on the server' }, 500);
    }
    const isAsset = PUBLIC_ASSETS.has(url.pathname);
    return withSecurityHeaders(res, { noStore: !isAsset });
  },
};

async function route(request, env, url) {
  const path = url.pathname;
  if (path.startsWith('/auth/')) return handleAuth(request, env, url);
  if (path.startsWith('/api/ingest/')) return handleIngest(request, env, url);
  if (PUBLIC_ASSETS.has(path)) return env.ASSETS.fetch(request);

  const session = await getSession(request, env);
  if (path.startsWith('/api/')) {
    return session ? handleApi(request, env, url, session) : json({ error: 'Not signed in' }, 401);
  }
  if (!session) return loginPage(url, env);
  return env.ASSETS.fetch(request);
}
