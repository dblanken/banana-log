import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry, normalizeSettings, normalizeLab, ValidationError, detectAllergens, DEFAULT_SETTINGS } from '../src/validate.js';

const tz = 'America/Indiana/Indianapolis';
const now = new Date('2026-10-19T20:00:00Z'); // 4pm EDT

test('accepts the documented example and keeps given totals', () => {
  const { entry, warnings } = normalizeEntry({
    eaten_at: '2026-10-19T12:30:00-04:00',
    meal: 'lunch',
    description: 'Grilled chicken, white rice, steamed broccoli',
    items: [
      { name: 'grilled chicken breast', portion: '4 oz', grams: 113, potassium_mg: 290, calories: 187 },
      { name: 'white rice, cooked', potassium_mg: 55, calories: 205 },
      { name: 'broccoli, steamed', potassium_mg: 457, calories: 55 },
    ],
    totals: { potassium_mg: 802, calories: 447 },
    plate_color: { green: 35, white: 40, brown: 25 },
    food_groups: { vegetables: 35, grains: 40, protein: 25 },
    confidence: 'Medium',
  }, { timeZone: tz, now });
  assert.equal(entry.eaten_at, '2026-10-19T16:30:00.000Z');
  assert.equal(entry.local_date, '2026-10-19');
  assert.equal(entry.totals.potassium_mg, 802);
  assert.equal(entry.totals.calories, 447);
  assert.equal(entry.confidence, 'medium');
  assert.deepEqual(entry.plate_color, { green: 35, white: 40, brown: 25 });
  assert.deepEqual(warnings, []);
});

test('sums items when totals are missing', () => {
  const { entry } = normalizeEntry({ items: [{ name: 'banana', potassium_mg: 422 }, { name: 'yogurt', potassium_mg: 240.04 }] }, { timeZone: tz, now });
  assert.equal(entry.totals.potassium_mg, 662);
  assert.equal(entry.description, 'banana, yogurt');
  assert.equal(entry.totals.calories, null);
});

test('accepts top-level potassium for simple posts', () => {
  const { entry } = normalizeEntry({ description: 'Banana', potassium_mg: '422' }, { timeZone: tz, now });
  assert.equal(entry.totals.potassium_mg, 422);
});

test('requires potassium', () => {
  assert.throws(() => normalizeEntry({ description: 'Toast', totals: { calories: 100 } }, { timeZone: tz, now }),
    (err) => err instanceof ValidationError && err.errors.some((e) => e.includes('potassium_mg is required')));
});

test('rejects bad numbers and non-objects', () => {
  assert.throws(() => normalizeEntry({ description: 'x', totals: { potassium_mg: -5 } }, { timeZone: tz, now }), ValidationError);
  assert.throws(() => normalizeEntry({ description: 'x', totals: { potassium_mg: 'lots' } }, { timeZone: tz, now }), ValidationError);
  assert.throws(() => normalizeEntry([], { timeZone: tz, now }), ValidationError);
  assert.throws(() => normalizeEntry({ description: 'x', potassium_mg: 1, meal: 'brunch' }, { timeZone: tz, now }), ValidationError);
});

test('warns when totals disagree with items', () => {
  const { warnings } = normalizeEntry({ items: [{ name: 'a', potassium_mg: 100 }], totals: { potassium_mg: 500 } }, { timeZone: tz, now });
  assert.ok(warnings.some((w) => w.includes('differs')));
});

test('reads a bare local time in her timezone and infers the meal', () => {
  const { entry } = normalizeEntry({ description: 'Eggs', potassium_mg: 130, eaten_at: '2026-10-19T08:15' }, { timeZone: tz, now });
  assert.equal(entry.eaten_at, '2026-10-19T12:15:00.000Z');
  assert.equal(entry.meal, 'breakfast');
});

test('late-evening UTC instants still land on her local date', () => {
  const { entry } = normalizeEntry({ description: 'Snack', potassium_mg: 50, eaten_at: '2026-10-20T02:30:00Z' }, { timeZone: tz, now: new Date('2026-10-20T03:00:00Z') });
  assert.equal(entry.local_date, '2026-10-19');
});

test('handles the DST change in winter', () => {
  const { entry } = normalizeEntry({ description: 'Soup', potassium_mg: 300, eaten_at: '2026-12-01T18:00' }, { timeZone: tz, now: new Date('2026-12-02T00:00:00Z') });
  assert.equal(entry.eaten_at, '2026-12-01T23:00:00.000Z');
});

test('accepts offsets without a colon and rejects future times', () => {
  const { entry } = normalizeEntry({ description: 'x', potassium_mg: 1, eaten_at: '2026-10-19T12:30:00-0400' }, { timeZone: tz, now });
  assert.equal(entry.eaten_at, '2026-10-19T16:30:00.000Z');
  assert.throws(() => normalizeEntry({ description: 'x', potassium_mg: 1, eaten_at: '2026-10-25T12:00:00Z' }, { timeZone: tz, now }), ValidationError);
  assert.throws(() => normalizeEntry({ description: 'x', potassium_mg: 1, eaten_at: 'yesterday' }, { timeZone: tz, now }), ValidationError);
});

test('maps plate aliases and warns on odd sums', () => {
  const { entry, warnings } = normalizeEntry({ description: 'x', potassium_mg: 1, plate_color: { Green: 30, 'white/beige': 30, orange: 10, blue: 5 } }, { timeZone: tz, now });
  assert.deepEqual(entry.plate_color, { green: 30, white: 30, red_orange: 10 });
  assert.ok(warnings.some((w) => w.includes('blue')));
  assert.ok(warnings.some((w) => w.includes('adds up to 70%')));
});

test('flags watched allergens even when the AI does not', () => {
  const watch = ['mushrooms', 'seafood', 'honey'];
  assert.deepEqual(detectAllergens(['Shrimp fried rice'], watch), ['seafood']);
  assert.deepEqual(detectAllergens(['Honey-glazed carrots', 'mushroom risotto'], watch).sort(), ['honey', 'mushrooms']);
  assert.deepEqual(detectAllergens(['Honeydew melon', 'Goldfish crackers', 'Monroe salad'], watch), []);
  assert.deepEqual(detectAllergens(['Peanut butter toast'], watch), []);
  assert.deepEqual(detectAllergens(['Peanut butter toast'], ['peanuts']), ['peanuts']);
  const { entry } = normalizeEntry({ description: 'Salad', potassium_mg: 300, items: [{ name: 'grilled salmon', potassium_mg: 200 }], allergens: ['Fish'] }, { timeZone: tz, allergensWatch: watch, now });
  assert.deepEqual(entry.allergens, ['seafood']);
  assert.deepEqual(normalizeEntry({ description: 'Shrimp', potassium_mg: 1 }, { timeZone: tz, now }).entry.allergens, []);
});

test('allergen watch list setting', () => {
  assert.deepEqual(normalizeSettings({ allergens_watch: ['honey', 'honey', 'seafood'] }).allergens_watch, ['honey', 'seafood']);
  assert.throws(() => normalizeSettings({ allergens_watch: ['kryptonite'] }), ValidationError);
});

test('settings validation', () => {
  const s = normalizeSettings({ potassium_target_mg: '3000', potassium_mode: 'goal', calorie_target: '' }, DEFAULT_SETTINGS);
  assert.equal(s.potassium_target_mg, 3000);
  assert.equal(s.calorie_target, null);
  assert.throws(() => normalizeSettings({ potassium_target_mg: '' }), ValidationError);
  assert.throws(() => normalizeSettings({ timezone: 'Mars/Base' }), ValidationError);
  assert.throws(() => normalizeSettings({ potassium_mode: 'max' }), ValidationError);
});

test('lab validation', () => {
  assert.deepEqual(normalizeLab({ taken_on: '2026-10-01', potassium_mmol: '3.04' }, { timeZone: tz, now }), { taken_on: '2026-10-01', potassium_mmol: 3.04, notes: null });
  assert.throws(() => normalizeLab({ taken_on: '2026-10-01', potassium_mmol: 30 }, { timeZone: tz, now }), ValidationError);
  assert.throws(() => normalizeLab({ taken_on: '2026-11-01', potassium_mmol: 3.5 }, { timeZone: tz, now }), ValidationError);
});

test('rejects impossible calendar dates instead of rolling them over', async () => {
  const { isIsoDate } = await import('../src/util.js');
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2026-02-31'), false);
  assert.throws(() => normalizeEntry({ description: 'x', potassium_mg: 1, eaten_at: '2026-02-31T12:00' }, { timeZone: tz, now }), ValidationError);
  assert.throws(() => normalizeLab({ taken_on: '2026-02-30', potassium_mmol: 3.5 }, { timeZone: tz, now }), ValidationError);
});

test('inherited object names are not valid keys', () => {
  assert.throws(() => normalizeSettings({ allergens_watch: ['toString'] }), ValidationError);
  assert.throws(() => normalizeSettings({ allergens_watch: ['constructor'] }), ValidationError);
  const { entry } = normalizeEntry({ description: 'x', potassium_mg: 1, allergens: ['constructor'], plate_color: { constructor: 50, green: 50 } }, { timeZone: tz, now });
  assert.deepEqual(entry.allergens, ['constructor']);
  assert.deepEqual(entry.plate_color, { green: 50 });
});

test('plant milks and chocolate truffles are not flagged', () => {
  assert.deepEqual(detectAllergens(['almond milk latte', 'coconut milk curry', 'chocolate truffle'], ['dairy', 'mushrooms']), []);
  assert.deepEqual(detectAllergens(['whole milk'], ['dairy']), ['dairy']);
  assert.deepEqual(detectAllergens(['truffle fries'], ['mushrooms']), ['mushrooms']);
});

test('checkItems: false skips the totals-vs-items warning', () => {
  const input = { items: [{ name: 'a', potassium_mg: 100 }], totals: { potassium_mg: 500 } };
  assert.deepEqual(normalizeEntry(input, { timeZone: tz, now, checkItems: false }).warnings, []);
});
