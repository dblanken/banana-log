import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession, checkIdTokenClaims, isSameOrigin } from '../src/auth.js';

const env = { SESSION_SECRET: 's3cret', GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com', ALLOWED_EMAILS: 'Angie@Example.com, dave@example.com' };

test('session round trip', async () => {
  const token = await signSession('angie@example.com', env.SESSION_SECRET);
  assert.equal(await verifySession(token, env), 'angie@example.com');
});

test('session rejects tampering, expiry, other secrets, and removed emails', async () => {
  const token = await signSession('angie@example.com', env.SESSION_SECRET);
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'dave@example.com', x: 9999999999 })).toString('base64url');
  assert.equal(await verifySession(`${forged}.${sig}`, env), null);
  assert.equal(await verifySession(`${payload}.${sig}x`, env), null);
  assert.equal(await verifySession(token, { ...env, SESSION_SECRET: 'other' }), null);
  assert.equal(await verifySession(token, env, Date.now() + 31 * 86400 * 1000), null);
  assert.equal(await verifySession(token, { ...env, ALLOWED_EMAILS: 'dave@example.com' }), null);
  assert.equal(await verifySession('garbage', env), null);
});

test('id token claims', () => {
  const good = { iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, exp: Date.now() / 1000 + 60, email: 'ANGIE@example.com', email_verified: true };
  assert.deepEqual(checkIdTokenClaims(good, env), { ok: true, email: 'angie@example.com' });
  assert.equal(checkIdTokenClaims({ ...good, aud: 'someone-else' }, env).ok, false);
  assert.equal(checkIdTokenClaims({ ...good, exp: 1 }, env).ok, false);
  assert.equal(checkIdTokenClaims({ ...good, email_verified: false }, env).reason, 'not_allowed');
  assert.equal(checkIdTokenClaims({ ...good, email: 'stranger@example.com' }, env).reason, 'not_allowed');
});

test('same-origin check', () => {
  const url = new URL('https://banana-log.example.workers.dev/api/entries');
  const req = (headers) => new Request(url, { method: 'POST', headers });
  assert.equal(isSameOrigin(req({ 'sec-fetch-site': 'same-origin' }), url), true);
  assert.equal(isSameOrigin(req({ 'sec-fetch-site': 'cross-site', origin: url.origin }), url), false);
  assert.equal(isSameOrigin(req({ origin: url.origin }), url), true);
  assert.equal(isSameOrigin(req({ origin: 'https://evil.example' }), url), false);
  assert.equal(isSameOrigin(req({}), url), false);
});
