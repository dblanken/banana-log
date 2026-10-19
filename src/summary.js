// Daily rollups shared by the dashboard API and the AI's summary call.
import { round1 } from './util.js';
import { NUTRIENTS } from './validate.js';

export const MG_PER_MEQ_POTASSIUM = 39.1;

export function rowToEntry(row) {
  const parse = (s, fallback) => {
    if (!s) return fallback;
    try { return JSON.parse(s); } catch { return fallback; }
  };
  const totals = {};
  for (const k of Object.keys(NUTRIENTS)) totals[k] = row[k] ?? null;
  return {
    id: row.id,
    eaten_at: row.eaten_at,
    local_date: row.local_date,
    meal: row.meal,
    description: row.description,
    items: parse(row.items_json, []),
    totals,
    plate_color: parse(row.plate_color_json, null),
    food_groups: parse(row.food_groups_json, null),
    allergens: parse(row.allergens_json, []),
    confidence: row.confidence,
    notes: row.notes,
    source: row.source,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

// Weighted by calories so a big plate counts more than a garnish; entries without calories weigh 1.
function blend(entries, field) {
  const acc = {};
  let weight = 0;
  for (const e of entries) {
    if (!e[field]) continue;
    const w = e.totals.calories > 0 ? e.totals.calories : 1;
    weight += w;
    for (const [k, v] of Object.entries(e[field])) acc[k] = (acc[k] || 0) + v * w;
  }
  if (!weight) return null;
  for (const k of Object.keys(acc)) acc[k] = round1(acc[k] / weight);
  return acc;
}

export function aggregate(entries) {
  const totals = {};
  for (const k of Object.keys(NUTRIENTS)) {
    const vals = entries.map((e) => e.totals[k]).filter((v) => v !== null && v !== undefined);
    totals[k] = vals.length ? round1(vals.reduce((a, b) => a + b, 0)) : null;
  }
  return {
    count: entries.length,
    totals,
    plate_color: blend(entries, 'plate_color'),
    food_groups: blend(entries, 'food_groups'),
    allergens: [...new Set(entries.flatMap((e) => e.allergens))],
  };
}

export function potassiumStatus(foodMg, settings) {
  const food = foodMg || 0;
  const target = settings.potassium_target_mg;
  const supplementMeq = settings.supplement_meq_daily || 0;
  const status = {
    mode: settings.potassium_mode,
    food_mg: round1(food),
    food_meq: round1(food / MG_PER_MEQ_POTASSIUM),
    supplement_meq: supplementMeq,
    total_meq: round1(food / MG_PER_MEQ_POTASSIUM + supplementMeq),
    target_mg: target,
    target_meq: round1(target / MG_PER_MEQ_POTASSIUM),
    percent_of_target: target ? Math.round((food / target) * 100) : null,
  };
  if (settings.potassium_mode === 'limit') {
    status.remaining_mg = round1(target - food);
    status.met = food <= target;
  } else {
    status.remaining_mg = round1(Math.max(0, target - food));
    status.met = food >= target;
  }
  return status;
}

export function daySummary(date, entries, settings) {
  const agg = aggregate(entries);
  return {
    date,
    entries: agg.count,
    potassium: potassiumStatus(agg.totals.potassium_mg, settings),
    totals: agg.totals,
    targets: {
      calories: settings.calorie_target,
      protein_g: settings.protein_target_g,
      carbs_g: settings.carbs_target_g,
      fat_g: settings.fat_target_g,
      fiber_g: settings.fiber_target_g,
      sodium_mg_limit: settings.sodium_limit_mg,
    },
    plate_color: agg.plate_color,
    food_groups: agg.food_groups,
    allergens: agg.allergens,
  };
}
