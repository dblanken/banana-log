import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, potassiumStatus } from '../src/summary.js';
import { DEFAULT_SETTINGS } from '../src/validate.js';
import { csvCell, safeEqual } from '../src/util.js';

const e = (k, cal, plate) => ({ totals: { potassium_mg: k, calories: cal, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, sodium_mg: null }, plate_color: plate, food_groups: null, allergens: [] });

test('aggregate sums and weights plate makeup by calories', () => {
  const agg = aggregate([e(800, 300, { green: 100 }), e(400, 100, { white: 100 })]);
  assert.equal(agg.totals.potassium_mg, 1200);
  assert.equal(agg.totals.protein_g, null);
  assert.deepEqual(agg.plate_color, { green: 75, white: 25 });
});

test('potassium status in goal and limit modes', () => {
  const goal = potassiumStatus(1955, DEFAULT_SETTINGS);
  assert.equal(goal.food_meq, 50);
  assert.equal(goal.total_meq, 70);
  assert.equal(goal.remaining_mg, 645);
  assert.equal(goal.met, false);
  const limit = potassiumStatus(3000, { ...DEFAULT_SETTINGS, potassium_mode: 'limit' });
  assert.equal(limit.remaining_mg, -400);
  assert.equal(limit.met, false);
});

test('csv cells are escaped and formula-safe', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell(-12.5), '-12.5');
  assert.equal(csvCell(null), '');
});

test('safeEqual', async () => {
  assert.equal(await safeEqual('abc', 'abc'), true);
  assert.equal(await safeEqual('abc', 'abd'), false);
  assert.equal(await safeEqual('abc', undefined), false);
});
