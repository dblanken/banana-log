# Banana Log

A private potassium and meal tracker. A custom GPT estimates nutrition from a food photo and logs
it through an API; the web app shows daily totals, history, plate makeup, and lab results.

- **Hosting:** one Cloudflare Worker (API and web app) with a D1 (SQLite) database. Free tier, no card.
- **Sign-in:** Google, limited to the addresses in `ALLOWED_EMAILS`.
- **AI access:** `POST /api/ingest/entries` and `GET /api/ingest/summary` with a bearer token. That
  door can add meals and read a day's totals, nothing else.
- **Backups:** nightly SQL dump committed to the private `dblanken/banana-log-data` repo, plus D1
  Time Travel (7 days of point-in-time restore on the free plan).
- **Dependencies:** none at runtime. `wrangler` runs only inside GitHub Actions, pinned.

## Layout

```
src/            Worker: routing, Google sign-in, API, validation
public/         Web app (vanilla JS, no build step), served only after sign-in
migrations/     D1 schema, applied on every deploy
test/           node --test unit tests
docs/           ChatGPT setup and instructions
.github/        Deploy on push to main; nightly backup
```

## Secrets

Set in Cloudflare: **Workers & Pages → banana-log → Settings → Variables and Secrets** (type: Secret).
Until all four exist, the app shows the sign-in page with a "not set up yet" message and rejects
every API call.

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_SECRET` | From the Google OAuth client |
| `SESSION_SECRET` | `openssl rand -base64 32`. Rotating it signs everyone out. |
| `ALLOWED_EMAILS` | Comma-separated Google addresses allowed to sign in |
| `INGEST_TOKEN` | `openssl rand -base64 32`. Also goes into the GPT's Action. |

GitHub repository secrets (**Settings → Secrets and variables → Actions**): `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `BACKUP_REPO_TOKEN`.

## API for the AI

`GET /api/ingest/openapi.json` describes it; the GPT imports that URL. Minimal call:

```sh
curl -X POST https://banana-log.dtblankenship.workers.dev/api/ingest/entries \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"Medium banana","totals":{"potassium_mg":422,"calories":105}}'
```

The server validates everything, re-checks totals against items, reads times without an offset in
the configured timezone, infers the meal from the time if missing, and flags the allergens chosen in
Settings from food names even if the AI doesn't. Personal details (allowed emails, allergies,
targets) live in Cloudflare secrets and the database, never in this repo.

## Local development

```sh
cp .dev.vars.example .dev.vars        # fill in test values
npx wrangler@4.143.0 d1 migrations apply banana-log --local
npx wrangler@4.143.0 dev
node --test
```

Google sign-in won't complete on localhost unless you add `http://localhost:8787/auth/callback`
as a redirect URI. For local testing it's simpler to mint a session cookie with `signSession()`
from `src/auth.js`.

## Restoring data

- **Recent mistake (within 7 days):** `npx wrangler@4.143.0 d1 time-travel restore banana-log --timestamp=<unix seconds>`
- **Older:** take `banana-log.sql` from the backup repo's history and run
  `npx wrangler@4.143.0 d1 execute banana-log --remote --file=banana-log.sql` against an empty database.
- **Single deleted meal:** the Today page lists deleted meals with a Restore button.
