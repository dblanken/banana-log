// D1 queries. Every value goes through bind(); no SQL is built from input.
import { DEFAULT_SETTINGS } from './validate.js';
import { rowToEntry } from './summary.js';
import { localDate } from './time.js';

export async function loadSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const { key, value } of results) {
    if (key in DEFAULT_SETTINGS) {
      try { out[key] = JSON.parse(value); } catch { /* keep default */ }
    }
  }
  return out;
}

export async function saveSettings(db, settings) {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  await db.batch(Object.entries(settings).map(([k, v]) => stmt.bind(k, JSON.stringify(v))));
}

const ENTRY_COLUMNS = [
  'eaten_at', 'local_date', 'meal', 'description', 'items_json',
  'potassium_mg', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg',
  'plate_color_json', 'food_groups_json', 'allergens_json', 'confidence', 'notes',
];
const placeholders = (n) => Array.from({ length: n }, (_, i) => `?${i + 1}`).join(', ');

function entryValues(e) {
  const t = e.totals;
  return [
    e.eaten_at, e.local_date, e.meal, e.description, JSON.stringify(e.items),
    t.potassium_mg, t.calories, t.protein_g, t.carbs_g, t.fat_g, t.fiber_g, t.sugar_g, t.sodium_mg,
    e.plate_color ? JSON.stringify(e.plate_color) : null,
    e.food_groups ? JSON.stringify(e.food_groups) : null,
    JSON.stringify(e.allergens), e.confidence, e.notes,
  ];
}

// With maxPerMinute, the insert only happens while fewer rows from this source were created in the
// last minute. It's one statement, so simultaneous requests can't all slip past the check.
// Returns null when the limit was hit.
export async function insertEntry(db, entry, { source, createdBy, maxPerMinute = null }) {
  const columns = [...ENTRY_COLUMNS, 'source', 'created_by'];
  const n = columns.length;
  const limit = maxPerMinute === null ? '' : `WHERE (SELECT COUNT(*) FROM entries WHERE source = ?${n - 1}
      AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute')) < ?${n + 1}`;
  const row = await db
    .prepare(`INSERT INTO entries (${columns.join(', ')}) SELECT ${placeholders(n)} ${limit} RETURNING *`)
    .bind(...entryValues(entry), source, createdBy, ...(maxPerMinute === null ? [] : [maxPerMinute]))
    .first();
  return row ? rowToEntry(row) : null;
}

// local_date is stored for fast daily queries, so it must be rebuilt when the timezone changes.
export async function rebucketDates(db, timeZone) {
  const { results } = await db.prepare('SELECT id, eaten_at, local_date FROM entries').all();
  const stmt = db.prepare('UPDATE entries SET local_date = ?1 WHERE id = ?2');
  const updates = results
    .map((r) => ({ id: r.id, date: localDate(new Date(r.eaten_at), timeZone), old: r.local_date }))
    .filter((r) => r.date !== r.old)
    .map((r) => stmt.bind(r.date, r.id));
  for (let i = 0; i < updates.length; i += 100) await db.batch(updates.slice(i, i + 100));
}

export async function updateEntry(db, id, entry) {
  const sets = ENTRY_COLUMNS.map((c, i) => `${c} = ?${i + 1}`).join(', ');
  const row = await db
    .prepare(`UPDATE entries SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id = ?${ENTRY_COLUMNS.length + 1} AND deleted_at IS NULL RETURNING *`)
    .bind(...entryValues(entry), id)
    .first();
  return row ? rowToEntry(row) : null;
}

export async function getEntry(db, id) {
  const row = await db.prepare('SELECT * FROM entries WHERE id = ?1').bind(id).first();
  return row ? rowToEntry(row) : null;
}

// Live entries only, unless includeDeleted (callers split on entry.deleted_at).
export async function listEntries(db, from, to, { includeDeleted = false } = {}) {
  const { results } = await db
    .prepare(`SELECT * FROM entries WHERE local_date BETWEEN ?1 AND ?2
              ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY eaten_at`)
    .bind(from, to)
    .all();
  return results.map(rowToEntry);
}

export async function setDeleted(db, id, deleted) {
  const row = await db
    .prepare(`UPDATE entries SET deleted_at = ${deleted ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'}
              WHERE id = ?1 AND deleted_at IS ${deleted ? 'NULL' : 'NOT NULL'} RETURNING *`)
    .bind(id)
    .first();
  return row ? rowToEntry(row) : null;
}

export async function listLabs(db) {
  const { results } = await db
    .prepare('SELECT id, taken_on, potassium_mmol, notes, created_at FROM labs WHERE deleted_at IS NULL ORDER BY taken_on DESC, id DESC')
    .all();
  return results;
}

export async function insertLab(db, lab, createdBy) {
  return db
    .prepare(`INSERT INTO labs (taken_on, potassium_mmol, notes, created_by) VALUES (?1, ?2, ?3, ?4)
              RETURNING id, taken_on, potassium_mmol, notes, created_at`)
    .bind(lab.taken_on, lab.potassium_mmol, lab.notes, createdBy)
    .first();
}

export async function deleteLab(db, id) {
  const row = await db
    .prepare(`UPDATE labs SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?1 AND deleted_at IS NULL RETURNING id`)
    .bind(id)
    .first();
  return Boolean(row);
}
