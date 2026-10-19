// JSON API: /api/* for the signed-in web app, /api/ingest/* for the AI's bearer token.
import { isSameOrigin } from './auth.js';
import {
  deleteLab, getEntry, insertEntry, insertLab, listEntries, listLabs, loadSettings,
  recentAiEntryCount, saveSettings, setDeleted, updateEntry,
} from './db.js';
import { openApiSpec } from './openapi.js';
import { aggregate, daySummary } from './summary.js';
import { localDate } from './time.js';
import { addDays, csvCell, isIsoDate, json, safeEqual } from './util.js';
import {
  NUTRIENTS, ValidationError, normalizeEntry, normalizeLab, normalizeSettings,
} from './validate.js';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_RANGE_DAYS = 400;
const AI_ENTRIES_PER_MINUTE = 20;

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large');
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

function wrap(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ValidationError) return json({ error: 'Validation failed', details: err.errors }, 422);
      if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
      throw err;
    }
  };
}

function entryOptions(settings) {
  return { timeZone: settings.timezone, allergensWatch: settings.allergens_watch };
}

function today(settings) {
  return localDate(new Date(), settings.timezone);
}

function dateParam(url, name, fallback) {
  const v = url.searchParams.get(name);
  if (v === null || v === '') return fallback;
  if (!isIsoDate(v)) throw new HttpError(400, `${name} must be a date like 2026-10-19`);
  return v;
}

function rangeParams(url, settings) {
  const to = dateParam(url, 'to', today(settings));
  const from = dateParam(url, 'from', to);
  if (from > to) throw new HttpError(400, 'from must be on or before to');
  if (from < addDays(to, -MAX_RANGE_DAYS)) throw new HttpError(400, `Ranges are limited to ${MAX_RANGE_DAYS} days`);
  return { from, to };
}

async function summaryFor(env, date, settings) {
  return daySummary(date, await listEntries(env.DB, date, date), settings);
}

function idFrom(match) {
  const id = Number(match);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, 'Not found');
  return id;
}

// ---------- AI door ----------

export const handleIngest = wrap(async (request, env, url) => {
  if (url.pathname === '/api/ingest/openapi.json' && request.method === 'GET') {
    return json(openApiSpec(url.origin));
  }
  if (!env.INGEST_TOKEN) return json({ error: 'Logging from the AI is not set up yet' }, 503);
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!auth.match(/^Bearer\s+/i) || !(await safeEqual(token, env.INGEST_TOKEN))) {
    return json({ error: 'Missing or wrong API key' }, 401, { 'www-authenticate': 'Bearer' });
  }

  const settings = await loadSettings(env.DB);

  if (url.pathname === '/api/ingest/entries' && request.method === 'POST') {
    if ((await recentAiEntryCount(env.DB)) >= AI_ENTRIES_PER_MINUTE) {
      return json({ error: 'Too many entries in the last minute. Try again shortly.' }, 429);
    }
    const body = await readJson(request);
    const { entry, warnings } = normalizeEntry(body, entryOptions(settings));
    const saved = await insertEntry(env.DB, entry, { source: 'ai', createdBy: 'ai' });
    return json({ entry: saved, warnings, today: await summaryFor(env, saved.local_date, settings) }, 201);
  }

  if (url.pathname === '/api/ingest/summary' && request.method === 'GET') {
    return json(await summaryFor(env, dateParam(url, 'date', today(settings)), settings));
  }

  return json({ error: 'Not found' }, 404);
});

// ---------- Signed-in web app ----------

export const handleApi = wrap(async (request, env, url, session) => {
  const { method } = request;
  const path = url.pathname;
  if (method !== 'GET' && method !== 'HEAD' && !isSameOrigin(request, url)) {
    return json({ error: 'Cross-site request blocked' }, 403);
  }
  const settings = await loadSettings(env.DB);
  let m;

  if (path === '/api/me' && method === 'GET') {
    return json({ email: session.email, today: today(settings), settings });
  }

  if (path === '/api/settings') {
    if (method === 'GET') return json(settings);
    if (method === 'PUT') {
      const next = normalizeSettings(await readJson(request), settings);
      await saveSettings(env.DB, next);
      return json(next);
    }
  }

  if (path === '/api/summary' && method === 'GET') {
    return json(await summaryFor(env, dateParam(url, 'date', today(settings)), settings));
  }

  if (path === '/api/days' && method === 'GET') {
    const { from, to } = rangeParams(url, settings);
    const byDate = new Map();
    for (const e of await listEntries(env.DB, from, to)) {
      if (!byDate.has(e.local_date)) byDate.set(e.local_date, []);
      byDate.get(e.local_date).push(e);
    }
    const days = [...byDate].map(([date, entries]) => ({ date, ...aggregate(entries) }));
    return json({ from, to, settings, days });
  }

  if (path === '/api/entries') {
    if (method === 'GET') {
      const { from, to } = rangeParams(url, settings);
      const deleted = url.searchParams.get('deleted') === '1';
      return json({ entries: await listEntries(env.DB, from, to, { deleted }) });
    }
    if (method === 'POST') {
      const body = await readJson(request);
      const source = url.searchParams.get('source') === 'paste' ? 'paste' : 'manual';
      const { entry, warnings } = normalizeEntry(body, entryOptions(settings));
      if (url.searchParams.get('dry_run') === '1') return json({ entry, warnings });
      const saved = await insertEntry(env.DB, entry, { source, createdBy: session.email });
      return json({ entry: saved, warnings }, 201);
    }
  }

  if ((m = path.match(/^\/api\/entries\/(\d+)$/))) {
    const id = idFrom(m[1]);
    if (method === 'PATCH') {
      const existing = await getEntry(env.DB, id);
      if (!existing || existing.deleted_at) throw new HttpError(404, 'Entry not found');
      const patch = await readJson(request);
      const merged = {
        description: existing.description,
        meal: existing.meal,
        eaten_at: existing.eaten_at,
        notes: existing.notes,
        confidence: existing.confidence,
        items: existing.items,
        plate_color: existing.plate_color,
        food_groups: existing.food_groups,
        allergens: existing.allergens,
        totals: { ...existing.totals },
      };
      for (const k of ['description', 'meal', 'eaten_at', 'notes', 'confidence', 'plate_color', 'food_groups', 'items', 'allergens']) {
        if (patch[k] !== undefined) merged[k] = patch[k];
      }
      if (patch.totals && typeof patch.totals === 'object') {
        for (const k of Object.keys(NUTRIENTS)) if (patch.totals[k] !== undefined) merged.totals[k] = patch.totals[k];
      }
      const { entry, warnings } = normalizeEntry(merged, entryOptions(settings));
      const saved = await updateEntry(env.DB, id, entry);
      if (!saved) throw new HttpError(404, 'Entry not found');
      return json({ entry: saved, warnings });
    }
    if (method === 'DELETE') {
      const gone = await setDeleted(env.DB, id, true);
      if (!gone) throw new HttpError(404, 'Entry not found');
      return json({ entry: gone });
    }
  }

  if ((m = path.match(/^\/api\/entries\/(\d+)\/restore$/)) && method === 'POST') {
    const back = await setDeleted(env.DB, idFrom(m[1]), false);
    if (!back) throw new HttpError(404, 'Deleted entry not found');
    return json({ entry: back });
  }

  if (path === '/api/labs') {
    if (method === 'GET') return json({ labs: await listLabs(env.DB) });
    if (method === 'POST') {
      const lab = normalizeLab(await readJson(request), { timeZone: settings.timezone });
      return json({ lab: await insertLab(env.DB, lab, session.email) }, 201);
    }
  }

  if ((m = path.match(/^\/api\/labs\/(\d+)$/)) && method === 'DELETE') {
    if (!(await deleteLab(env.DB, idFrom(m[1])))) throw new HttpError(404, 'Lab result not found');
    return json({ ok: true });
  }

  if (path === '/api/export.csv' && method === 'GET') {
    const to = dateParam(url, 'to', today(settings));
    const from = dateParam(url, 'from', addDays(to, -MAX_RANGE_DAYS));
    if (from > to || from < addDays(to, -MAX_RANGE_DAYS)) throw new HttpError(400, `Pick a range of up to ${MAX_RANGE_DAYS} days`);
    const entries = await listEntries(env.DB, from, to);
    const nutrientKeys = Object.keys(NUTRIENTS);
    const header = ['date', 'eaten_at', 'meal', 'description', ...nutrientKeys, 'potassium_meq', 'allergens', 'confidence', 'source', 'notes'];
    const lines = [header.join(',')];
    for (const e of entries) {
      lines.push([
        e.local_date, e.eaten_at, e.meal, e.description,
        ...nutrientKeys.map((k) => e.totals[k]),
        e.totals.potassium_mg === null ? '' : Math.round((e.totals.potassium_mg / 39.1) * 10) / 10,
        e.allergens.join('; '), e.confidence, e.source, e.notes,
      ].map(csvCell).join(','));
    }
    return new Response(`${lines.join('\r\n')}\r\n`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="banana-log-${from}-to-${to}.csv"`,
      },
    });
  }

  return json({ error: 'Not found' }, 404);
});
