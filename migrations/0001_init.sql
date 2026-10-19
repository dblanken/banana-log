-- Banana Log schema. Applied by `wrangler d1 migrations apply` in the deploy workflow.

CREATE TABLE entries (
  id               INTEGER PRIMARY KEY,
  eaten_at         TEXT NOT NULL,             -- UTC ISO 8601
  local_date       TEXT NOT NULL,             -- YYYY-MM-DD in the configured timezone, for daily totals
  meal             TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
  description      TEXT NOT NULL,
  items_json       TEXT NOT NULL DEFAULT '[]',
  potassium_mg     REAL NOT NULL,
  calories         REAL,
  protein_g        REAL,
  carbs_g          REAL,
  fat_g            REAL,
  fiber_g          REAL,
  sugar_g          REAL,
  sodium_mg        REAL,
  plate_color_json TEXT,                      -- {"green": 40, "white": 60}
  food_groups_json TEXT,                      -- {"vegetables": 40, "grains": 60}
  allergens_json   TEXT NOT NULL DEFAULT '[]',
  confidence       TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  notes            TEXT,
  source           TEXT NOT NULL CHECK (source IN ('ai', 'paste', 'manual')),
  created_by       TEXT NOT NULL,             -- 'ai' or the signed-in email
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT,
  deleted_at       TEXT                       -- soft delete, so mistakes can be undone
);
CREATE INDEX entries_by_date ON entries (local_date, eaten_at);
CREATE INDEX entries_by_created ON entries (created_at);

CREATE TABLE labs (
  id             INTEGER PRIMARY KEY,
  taken_on       TEXT NOT NULL,               -- YYYY-MM-DD
  potassium_mmol REAL NOT NULL,               -- serum potassium, mmol/L (same as mEq/L)
  notes          TEXT,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at     TEXT
);
CREATE INDEX labs_by_date ON labs (taken_on);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                   -- JSON
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
