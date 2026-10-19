// Turns untrusted input (from the AI, a paste, or a form) into clean records.
import { zonedToUtc, localDate, localHour, isValidTimeZone } from './time.js';
import { isIsoDate, round1 } from './util.js';

export const NUTRIENTS = {
  potassium_mg: 20000,
  calories: 10000,
  protein_g: 1000,
  carbs_g: 2000,
  fat_g: 1000,
  fiber_g: 500,
  sugar_g: 1000,
  sodium_mg: 30000,
};
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const CONFIDENCE = ['low', 'medium', 'high'];
export const COLOR_KEYS = ['green', 'white', 'red_orange', 'yellow', 'brown', 'other'];
export const GROUP_KEYS = ['vegetables', 'fruit', 'grains', 'protein', 'dairy', 'fats_sweets', 'other'];

const COLOR_ALIASES = {
  white_beige: 'white', beige: 'white', cream: 'white', tan: 'brown',
  red: 'red_orange', orange: 'red_orange', purple: 'other', black: 'other',
};
const GROUP_ALIASES = {
  vegetable: 'vegetables', veggies: 'vegetables', veg: 'vegetables', fruits: 'fruit',
  grain: 'grains', starch: 'grains', starches: 'grains', grains_starch: 'grains', grains_starches: 'grains',
  meat: 'protein', proteins: 'protein', fats: 'fats_sweets', sweets: 'fats_sweets', fat: 'fats_sweets',
};

// Common allergens the server can spot in food names itself, rather than trusting the AI to flag them.
// Which ones to watch for is a setting (allergens_watch), stored in the database, not in code.
export const ALLERGEN_PATTERNS = {
  mushrooms: /mushroom|shiitake|portobell|cremini|crimini|chanterelle|morel|enoki|truffle/i,
  seafood: /seafood|shellfish|shrimp|prawn|crab|lobster|clam|oyster|mussel|scallop|squid|calamari|octopus|(?<!gold)fish|salmon|tuna|\bcod\b|tilapia|anchov|sardine|halibut|trout|mahi|sushi|sashimi|crawfish|crayfish|surimi|caviar|\broe\b/i,
  honey: /\bhoney\b/i,
  peanuts: /peanut/i,
  tree_nuts: /almond|cashew|walnut|pecan|pistachio|hazelnut|macadamia|brazil nut|pine nut/i,
  eggs: /\beggs?\b|omelet|frittata|quiche|mayonnaise|\bmayo\b|meringue/i,
  dairy: /milk(?!shake)|cheese|yogurt|yoghurt|(?<!(?:peanut|almond|cashew|apple|cocoa|sunflower|nut) )butter(?!nut|milk)|cream|whey|kefir|milkshake/i,
  gluten: /wheat|bread|pasta|noodle|flour|barley|\brye\b|couscous|cracker|bagel|tortilla/i,
  soy: /\bsoy|tofu|edamame|tempeh|miso/i,
  sesame: /sesame|tahini/i,
};
const ALLERGEN_ALIASES = { mushroom: 'mushrooms', fish: 'seafood', shellfish: 'seafood', peanut: 'peanuts', egg: 'eggs', milk: 'dairy', nuts: 'tree_nuts', tree_nut: 'tree_nuts', wheat: 'gluten' };

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join('; '));
    this.errors = errors;
  }
}

function num(value, field, max, errors) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    errors.push(`${field} must be a number`);
    return null;
  }
  if (n < 0 || n > max) {
    errors.push(`${field} must be between 0 and ${max}`);
    return null;
  }
  return round1(n);
}

function text(value, field, max, errors) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    errors.push(`${field} must be text`);
    return null;
  }
  const s = value.trim();
  if (s.length > max) {
    errors.push(`${field} must be at most ${max} characters`);
    return null;
  }
  return s || null;
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

// Accepts "2026-10-19T12:30:00-04:00", "...Z", or a bare local time ("2026-10-19T12:30"),
// which is read in the configured timezone.
function parseEatenAt(value, timeZone, now, errors) {
  if (value === undefined || value === null || value === '') return now;
  const m = typeof value === 'string' ? ISO_RE.exec(value.trim()) : null;
  if (!m) {
    errors.push('eaten_at must look like 2026-10-19T12:30:00-04:00');
    return now;
  }
  const [, y, mo, d, h, mi, s = '00', off] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +s > 59) {
    errors.push('eaten_at is not a real date and time');
    return now;
  }
  let date;
  if (off) {
    const offset = off.toUpperCase() === 'Z' ? 'Z' : off.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  } else {
    date = zonedToUtc({ year: +y, month: +mo, day: +d, hour: +h, minute: +mi, second: +s }, timeZone);
  }
  if (Number.isNaN(date.getTime())) {
    errors.push('eaten_at is not a real date and time');
    return now;
  }
  if (date.getTime() > now.getTime() + 12 * 3600 * 1000) {
    errors.push('eaten_at is in the future');
    return now;
  }
  if (date.getUTCFullYear() < 2020) {
    errors.push('eaten_at is too far in the past');
    return now;
  }
  return date;
}

function inferMeal(hour) {
  if (hour >= 4 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 22) return 'dinner';
  return 'snack';
}

function percentMap(value, field, keys, aliases, errors, warnings) {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) {
    errors.push(`${field} must be an object of percentages, like {"green": 40, "white": 60}`);
    return null;
  }
  const out = {};
  let sum = 0;
  for (const [rawKey, raw] of Object.entries(value)) {
    let key = rawKey.toLowerCase().trim().replace(/[\s/&-]+/g, '_');
    key = aliases[key] || key;
    if (!keys.includes(key)) {
      warnings.push(`${field}.${rawKey} is not a known category and was ignored`);
      continue;
    }
    const n = num(raw, `${field}.${rawKey}`, 100, errors);
    if (n === null || n === 0) continue;
    out[key] = round1((out[key] || 0) + n);
    sum += n;
  }
  if (!Object.keys(out).length) return null;
  if (sum < 90 || sum > 110) warnings.push(`${field} adds up to ${round1(sum)}%, expected about 100%`);
  return out;
}

function normalizeItem(raw, i, errors) {
  const f = `items[${i}]`;
  if (!isObject(raw)) {
    errors.push(`${f} must be an object`);
    return null;
  }
  const item = { name: text(raw.name, `${f}.name`, 200, errors) };
  if (!item.name) errors.push(`${f}.name is required`);
  const portion = text(raw.portion, `${f}.portion`, 100, errors);
  if (portion) item.portion = portion;
  const grams = num(raw.grams, `${f}.grams`, 5000, errors);
  if (grams !== null) item.grams = grams;
  for (const [k, max] of Object.entries(NUTRIENTS)) {
    const v = num(raw[k], `${f}.${k}`, max, errors);
    if (v !== null) item[k] = v;
  }
  return item;
}

export function detectAllergens(texts, watch) {
  const joined = texts.filter(Boolean).join(' \n ');
  return watch.filter((name) => ALLERGEN_PATTERNS[name] && ALLERGEN_PATTERNS[name].test(joined));
}

function normalizeAllergens(value, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push('allergens must be a list');
    return [];
  }
  const out = [];
  for (const a of value.slice(0, 10)) {
    if (typeof a !== 'string' || !a.trim()) continue;
    const key = a.trim().toLowerCase().slice(0, 40);
    out.push(ALLERGEN_ALIASES[key] || key);
  }
  return out;
}

/**
 * Validate a meal entry. Returns { entry, warnings } or throws ValidationError.
 * Totals may be given directly, at the top level, or summed from items.
 */
export function normalizeEntry(input, { timeZone, allergensWatch = [], now = new Date() }) {
  if (!isObject(input)) throw new ValidationError(['The body must be a JSON object describing one meal']);
  const errors = [];
  const warnings = [];

  let items = [];
  if (input.items !== undefined && input.items !== null) {
    if (!Array.isArray(input.items)) errors.push('items must be a list');
    else if (input.items.length > 50) errors.push('items can have at most 50 foods');
    else items = input.items.map((it, i) => normalizeItem(it, i, errors)).filter(Boolean);
  }

  const givenTotals = isObject(input.totals) ? input.totals : {};
  if (input.totals !== undefined && input.totals !== null && !isObject(input.totals)) {
    errors.push('totals must be an object');
  }
  const totals = {};
  for (const [k, max] of Object.entries(NUTRIENTS)) {
    const given = num(givenTotals[k] ?? input[k], `totals.${k}`, max, errors);
    const values = items.map((it) => it[k]).filter((v) => v !== undefined);
    const summed = values.length ? round1(values.reduce((a, b) => a + b, 0)) : null;
    if (given !== null) {
      totals[k] = given;
      // Only compare when every item has the value; partial item data is expected.
      const big = Math.max(given, summed ?? 0);
      const comparable = summed !== null && values.length === items.length && (k === 'potassium_mg' || k === 'calories');
      if (comparable && big > 0 && Math.abs(given - summed) / big > 0.15) {
        warnings.push(`totals.${k} (${given}) differs from the sum of the items (${summed})`);
      }
    } else {
      totals[k] = summed;
    }
  }
  if (totals.potassium_mg === null && !errors.some((e) => e.startsWith('totals.potassium_mg'))) {
    errors.push('potassium_mg is required, either in totals or on each item');
  }
  const missingK = items.filter((it) => it.potassium_mg === undefined).length;
  if (items.length && missingK && givenTotals.potassium_mg === undefined && input.potassium_mg === undefined) {
    warnings.push(`${missingK} item(s) have no potassium_mg, so the total may be low`);
  }

  let description = text(input.description, 'description', 500, errors);
  if (!description && items.length) description = items.map((it) => it.name).filter(Boolean).join(', ').slice(0, 500);
  if (!description) errors.push('description is required');

  const eatenAt = parseEatenAt(input.eaten_at, timeZone, now, errors);

  let meal = typeof input.meal === 'string' ? input.meal.trim().toLowerCase() : null;
  if (meal && !MEALS.includes(meal)) {
    errors.push(`meal must be one of: ${MEALS.join(', ')}`);
    meal = null;
  }
  if (!meal) meal = inferMeal(localHour(eatenAt, timeZone));

  let confidence = typeof input.confidence === 'string' ? input.confidence.trim().toLowerCase() : null;
  if (confidence && !CONFIDENCE.includes(confidence)) {
    warnings.push(`confidence "${input.confidence}" was ignored; use low, medium, or high`);
    confidence = null;
  }

  const plateColor = percentMap(input.plate_color, 'plate_color', COLOR_KEYS, COLOR_ALIASES, errors, warnings);
  const foodGroups = percentMap(input.food_groups, 'food_groups', GROUP_KEYS, GROUP_ALIASES, errors, warnings);
  const notes = text(input.notes, 'notes', 1000, errors);

  const allergens = new Set(normalizeAllergens(input.allergens, errors));
  for (const a of detectAllergens([description, ...items.map((it) => it.name)], allergensWatch)) allergens.add(a);

  if (errors.length) throw new ValidationError(errors);

  return {
    entry: {
      eaten_at: eatenAt.toISOString(),
      local_date: localDate(eatenAt, timeZone),
      meal,
      description,
      items,
      totals,
      plate_color: plateColor,
      food_groups: foodGroups,
      allergens: [...allergens],
      confidence,
      notes,
    },
    warnings,
  };
}

export const DEFAULT_SETTINGS = {
  timezone: 'America/Indiana/Indianapolis',
  potassium_mode: 'goal',
  potassium_target_mg: 2600,
  supplement_meq_daily: 20,
  calorie_target: null,
  protein_target_g: null,
  carbs_target_g: null,
  fat_target_g: null,
  fiber_target_g: null,
  sodium_limit_mg: null,
  allergens_watch: [],
};

const SETTING_RANGES = {
  potassium_target_mg: [100, 20000, true],
  supplement_meq_daily: [0, 200, true],
  calorie_target: [0, 10000, false],
  protein_target_g: [0, 1000, false],
  carbs_target_g: [0, 2000, false],
  fat_target_g: [0, 1000, false],
  fiber_target_g: [0, 500, false],
  sodium_limit_mg: [0, 30000, false],
};

export function normalizeSettings(input, current = DEFAULT_SETTINGS) {
  if (!isObject(input)) throw new ValidationError(['Settings must be a JSON object']);
  const errors = [];
  const out = { ...current };
  if (input.timezone !== undefined) {
    if (isValidTimeZone(input.timezone)) out.timezone = input.timezone;
    else errors.push('timezone must be an IANA name like America/Indiana/Indianapolis');
  }
  if (input.potassium_mode !== undefined) {
    if (['goal', 'limit'].includes(input.potassium_mode)) out.potassium_mode = input.potassium_mode;
    else errors.push('potassium_mode must be "goal" or "limit"');
  }
  for (const [k, [min, max, required]] of Object.entries(SETTING_RANGES)) {
    if (input[k] === undefined) continue;
    if ((input[k] === null || input[k] === '') && !required) {
      out[k] = null;
      continue;
    }
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < min || n > max) errors.push(`${k} must be between ${min} and ${max}`);
    else out[k] = round1(n);
  }
  if (input.allergens_watch !== undefined) {
    if (Array.isArray(input.allergens_watch) && input.allergens_watch.every((a) => a in ALLERGEN_PATTERNS)) {
      out.allergens_watch = [...new Set(input.allergens_watch)];
    } else {
      errors.push(`allergens_watch must be a list drawn from: ${Object.keys(ALLERGEN_PATTERNS).join(', ')}`);
    }
  }
  if (errors.length) throw new ValidationError(errors);
  return out;
}

export function normalizeLab(input, { timeZone, now = new Date() }) {
  if (!isObject(input)) throw new ValidationError(['Lab result must be a JSON object']);
  const errors = [];
  const takenOn = typeof input.taken_on === 'string' ? input.taken_on.trim() : '';
  if (!isIsoDate(takenOn)) {
    errors.push('taken_on must be a date like 2026-10-19');
  } else if (takenOn > localDate(now, timeZone)) {
    errors.push('taken_on is in the future');
  }
  const value = Number(input.potassium_mmol);
  if (!Number.isFinite(value) || value < 1 || value > 9) errors.push('potassium_mmol must be between 1.0 and 9.0');
  const notes = text(input.notes, 'notes', 500, errors);
  if (errors.length) throw new ValidationError(errors);
  return { taken_on: takenOn, potassium_mmol: Math.round(value * 100) / 100, notes };
}
