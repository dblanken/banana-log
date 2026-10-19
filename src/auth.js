// Sign in with Google (OAuth 2.0 authorization code flow + PKCE) and signed session cookies.
import {
  b64urlEncode, b64urlDecodeToString, cookie, hmacSha256, parseCookies, randomToken,
  redirect, safeEqual, sha256,
} from './util.js';

export const SESSION_COOKIE = '__Host-bl_session';
const STATE_COOKIE = '__Host-bl_oauth';
const SESSION_SECONDS = 30 * 24 * 3600;
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

export function authConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET && allowedEmails(env).length);
}

export function allowedEmails(env) {
  return (env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export async function signSession(email, secret, nowMs = Date.now()) {
  const payload = b64urlEncode(JSON.stringify({ e: email, x: Math.floor(nowMs / 1000) + SESSION_SECONDS }));
  const sig = b64urlEncode(await hmacSha256(secret, payload));
  return `${payload}.${sig}`;
}

// Returns the email for a valid, unexpired session that is still on the allow-list, else null.
// Removing an address from ALLOWED_EMAILS (or rotating SESSION_SECRET) signs that person out.
export async function verifySession(token, env, nowMs = Date.now()) {
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64urlEncode(await hmacSha256(env.SESSION_SECRET, payload));
  if (!(await safeEqual(sig, expected))) return null;
  let data;
  try { data = JSON.parse(b64urlDecodeToString(payload)); } catch { return null; }
  if (typeof data.e !== 'string' || typeof data.x !== 'number' || data.x * 1000 < nowMs) return null;
  return allowedEmails(env).includes(data.e) ? data.e : null;
}

export async function getSession(request, env) {
  if (!authConfigured(env)) return null;
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  const email = await verifySession(token, env);
  return email ? { email } : null;
}

// Checks the ID token Google returned from the token endpoint. The token came straight from
// Google over TLS, so its claims can be trusted without verifying the JWT signature.
export function checkIdTokenClaims(claims, env, nowMs = Date.now()) {
  if (!claims || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) return { ok: false, reason: 'bad_token' };
  if (claims.aud !== env.GOOGLE_CLIENT_ID) return { ok: false, reason: 'bad_token' };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < nowMs) return { ok: false, reason: 'bad_token' };
  if (claims.email_verified !== true || typeof claims.email !== 'string') return { ok: false, reason: 'not_allowed' };
  const email = claims.email.toLowerCase();
  if (!allowedEmails(env).includes(email)) return { ok: false, reason: 'not_allowed' };
  return { ok: true, email };
}

function callbackUrl(url) {
  return `${url.origin}/auth/callback`;
}

const clearState = cookie(STATE_COOKIE, '', { maxAge: 0 });

export async function handleAuth(request, env, url) {
  if (!authConfigured(env)) return redirect('/?error=not_configured');

  if (url.pathname === '/auth/login' && request.method === 'GET') {
    const state = randomToken(16);
    const verifier = randomToken(32);
    const challenge = b64urlEncode(await sha256(verifier));
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: callbackUrl(url),
      response_type: 'code',
      scope: 'openid email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return redirect(`${GOOGLE_AUTH}?${params}`, 302, {
      'set-cookie': cookie(STATE_COOKIE, `${state}.${verifier}`, { maxAge: 600 }),
    });
  }

  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    const fail = (reason) => redirect(`/?error=${reason}`, 302, { 'set-cookie': clearState });
    if (url.searchParams.get('error')) return fail('cancelled');
    const [state, verifier] = (parseCookies(request.headers.get('cookie'))[STATE_COOKIE] || '').split('.');
    const code = url.searchParams.get('code');
    if (!state || !verifier || !code || !(await safeEqual(state, url.searchParams.get('state') || ''))) {
      return fail('expired');
    }
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUrl(url),
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    if (!res.ok) {
      console.error('Google token exchange failed', res.status, await res.text());
      return fail('google_error');
    }
    const { id_token: idToken } = await res.json();
    let claims = null;
    try { claims = JSON.parse(b64urlDecodeToString(idToken.split('.')[1])); } catch { /* handled below */ }
    const check = checkIdTokenClaims(claims, env);
    if (!check.ok) return fail(check.reason);
    const headers = new Headers({ location: '/' });
    headers.append('set-cookie', clearState);
    headers.append('set-cookie', cookie(SESSION_COOKIE, await signSession(check.email, env.SESSION_SECRET), { maxAge: SESSION_SECONDS }));
    return new Response(null, { status: 302, headers });
  }

  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    if (!isSameOrigin(request, url)) return new Response('Cross-site request blocked', { status: 403 });
    return redirect('/?signed_out=1', 303, { 'set-cookie': cookie(SESSION_COOKIE, '', { maxAge: 0 }) });
  }

  return new Response('Not found', { status: 404 });
}

// CSRF guard for anything that changes data: the request must come from our own pages.
export function isSameOrigin(request, url) {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  return request.headers.get('origin') === url.origin;
}
