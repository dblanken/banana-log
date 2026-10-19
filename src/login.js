// The only page anyone sees before signing in. No data, no script.
import { authConfigured } from './auth.js';

const MESSAGES = {
  not_allowed: "That Google account isn't on the list for Banana Log.",
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in link expired. Please try again.',
  google_error: "Google didn't complete the sign-in. Please try again.",
  bad_token: "Google's response couldn't be verified. Please try again.",
  not_configured: "Sign-in isn't set up yet. The app's secrets still need to be added in Cloudflare.",
};

const escape = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function loginPage(url, env) {
  const configured = authConfigured(env);
  const code = configured ? url.searchParams.get('error') : 'not_configured';
  const message = MESSAGES[code] || (url.searchParams.get('signed_out') ? 'You are signed out.' : '');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#4f6b12">
<title>Banana Log</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/app.css">
</head>
<body class="login">
<main class="login-card">
  <img src="/icon.svg" alt="" width="64" height="64">
  <h1>Banana Log</h1>
  <p class="muted">Potassium and meal tracker</p>
  ${message ? `<p class="login-msg" role="status">${escape(message)}</p>` : ''}
  ${configured ? '<a class="btn primary big" href="/auth/login">Sign in with Google</a>' : ''}
</main>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
