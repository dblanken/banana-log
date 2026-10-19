'use strict';
// Banana Log web app. Plain DOM, no dependencies. All data comes from /api/* as the signed-in user.
// Text from the database is only ever inserted with textContent (via h()), never as HTML.

const MG_PER_MEQ = 39.1;
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const NUTRIENTS = [
  ['calories', 'Calories', 'kcal', 'calorie_target'],
  ['protein_g', 'Protein', 'g', 'protein_target_g'],
  ['carbs_g', 'Carbs', 'g', 'carbs_target_g'],
  ['fat_g', 'Fat', 'g', 'fat_target_g'],
  ['fiber_g', 'Fiber', 'g', 'fiber_target_g'],
  ['sugar_g', 'Sugar', 'g', null],
  ['sodium_mg', 'Sodium', 'mg', 'sodium_limit_mg'],
];
const TARGETS = NUTRIENTS.filter((n) => n[3]);
const PLATE = {
  color: {
    title: 'By color',
    field: 'plate_color',
    labels: { green: 'Green', white: 'White / beige', red_orange: 'Red / orange', yellow: 'Yellow', brown: 'Brown', other: 'Other' },
  },
  groups: {
    title: 'By food group',
    field: 'food_groups',
    labels: { vegetables: 'Vegetables', fruit: 'Fruit', grains: 'Grains / starch', protein: 'Protein', dairy: 'Dairy', fats_sweets: 'Fats / sweets', other: 'Other' },
  },
};
const ALLERGENS = {
  mushrooms: 'Mushrooms', seafood: 'Fish and shellfish', honey: 'Honey', peanuts: 'Peanuts', tree_nuts: 'Tree nuts',
  eggs: 'Eggs', dairy: 'Dairy', gluten: 'Wheat / gluten', soy: 'Soy', sesame: 'Sesame',
};
const SOURCE_LABELS = { ai: 'ChatGPT', paste: 'Pasted', manual: 'Added by hand' };
const LAB_LOW = 3.5;
const LAB_HIGH = 5.0;

const state = {
  email: null,
  settings: null,
  date: null,
  historyDays: 30,
  plateMode: 'color',
  pasteDraft: '',
};

const view = document.getElementById('view');

// ---------- DOM helpers ----------

// Flattens nested lists and drops null/undefined/false, so optional sections can be written inline.
function kids(children) {
  return children.flat(Infinity)
    .filter((c) => c !== null && c !== undefined && c !== false)
    .map((c) => (c instanceof Node ? c : String(c)));
}

function fill(el, ...children) {
  el.replaceChildren(...kids(children));
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids(children));
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
  el.append(...kids(children));
  return el;
}

// ---------- Formatting ----------

function fmt(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

// Building an Intl formatter is the slow part, so keep one per (kind, timezone).
const formatters = new Map();
function formatter(kind, options) {
  const key = `${kind}|${state.settings.timezone}`;
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat('en-US', { timeZone: state.settings.timezone, ...options }));
  return formatters.get(key);
}

function zonedParts(date) {
  const p = {};
  const parts = formatter('parts', {
    hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  for (const { type, value } of parts) p[type] = value;
  return p;
}

function todayLocal() {
  const p = zonedParts(new Date());
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDay(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
}

function fmtTime(isoInstant) {
  return formatter('time', { hour: 'numeric', minute: '2-digit' }).format(new Date(isoInstant));
}

// "YYYY-MM-DDTHH:MM" in her timezone, for <input type="datetime-local">.
function localInputValue(date) {
  const p = zonedParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);

// ---------- API ----------

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    location.reload();
    throw new Error('Your sign-in expired.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.details = data.details || [];
    throw err;
  }
  return data;
}

// ---------- Toast ----------

let toastTimer;
function toast(message, action) {
  const el = document.getElementById('toast');
  fill(el, h('span', null, message));
  if (action) {
    el.append(h('button', {
      type: 'button',
      onclick: async () => {
        el.hidden = true;
        await action.run();
      },
    }, action.label));
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 8000 : 4000);
}

function errorList(err) {
  return h('div', { class: 'alert', role: 'alert' },
    h('p', null, err.message),
    err.details && err.details.length ? h('ul', { class: 'errors' }, err.details.map((d) => h('li', null, d))) : null);
}

// ---------- Router ----------

const VIEWS = { today: renderToday, history: renderHistory, add: renderAdd, labs: renderLabs, settings: renderSettings };

function currentView() {
  const name = location.hash.replace('#', '');
  return VIEWS[name] ? name : 'today';
}

async function render() {
  const name = currentView();
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.view === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  try {
    await VIEWS[name]();
  } catch (err) {
    fill(view, errorList(err), h('button', { class: 'btn', type: 'button', onclick: render }, 'Try again'));
  }
}

// ---------- Today ----------

async function renderToday() {
  const today = todayLocal();
  if (!state.date || state.date > today) state.date = today;
  const date = state.date;
  const { summary, entries, deleted } = await api(`/api/day?date=${date}`);
  if (currentView() !== 'today' || state.date !== date) return;
  fill(view,
    dateNav(date, today),
    potassiumCard(summary),
    summary.allergens.length ? allergenAlert(summary.allergens) : null,
    nutrientCard(summary),
    plateCard(summary),
    mealsSection(entries),
    deleted.length ? deletedSection(deleted) : null,
  );
}

function dateNav(date, today) {
  const isToday = date === today;
  const go = (d) => { state.date = d; render(); };
  return h('div', { class: 'datenav' },
    h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Previous day', onclick: () => go(addDays(date, -1)) }, '‹'),
    h('h1', null, isToday ? 'Today' : fmtDay(date),
      h('span', { class: 'sub' }, isToday ? fmtDay(date, { weekday: 'long', month: 'long', day: 'numeric' }) : h('a', { href: '#today', onclick: (e) => { e.preventDefault(); go(today); } }, 'Back to today'))),
    h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Next day', disabled: isToday, onclick: () => go(addDays(date, 1)) }, '›'),
  );
}

function potassiumCard(summary) {
  const k = summary.potassium;
  const ratio = k.target_mg ? k.food_mg / k.target_mg : 0;
  let fillClass = '';
  let status;
  if (k.mode === 'limit') {
    if (!k.met) {
      fillClass = 'over';
      status = h('p', { class: 'k-status over' }, `${fmt(-k.remaining_mg)} mg over the ${fmt(k.target_mg)} mg limit`);
    } else {
      status = h('p', { class: 'k-status' }, `${fmt(k.remaining_mg)} mg left under the ${fmt(k.target_mg)} mg limit`);
    }
  } else if (k.met) {
    fillClass = 'met';
    status = h('p', { class: 'k-status met' }, `Goal of ${fmt(k.target_mg)} mg reached`);
  } else {
    status = h('p', { class: 'k-status' }, `${fmt(k.remaining_mg)} mg to go to reach ${fmt(k.target_mg)} mg`);
  }
  const bar = h('div', { class: `fill ${fillClass}` });
  bar.style.width = `${Math.min(100, Math.round(ratio * 100))}%`;
  const supplementMg = k.supplement_meq * MG_PER_MEQ;
  return h('section', { class: 'card k-card', 'aria-label': 'Potassium' },
    h('div', { class: 'card-head' },
      h('span', { class: 'eyebrow' }, 'Potassium from food'),
      h('span', { class: 'small muted num' }, `${fmt(k.percent_of_target)}% of ${k.mode === 'limit' ? 'limit' : 'goal'}`)),
    h('div', { class: 'k-figure' },
      h('strong', null, fmt(k.food_mg)), h('span', { class: 'unit' }, 'mg'),
      h('span', { class: 'meq' }, `${fmt(k.food_meq, 1)} mEq`)),
    h('div', {
      class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': k.target_mg, 'aria-valuenow': k.food_mg,
      'aria-label': 'Potassium from food compared with target',
    }, bar),
    status,
    k.supplement_meq
      ? h('p', { class: 'small muted' }, `Plus the ${fmt(k.supplement_meq)} mEq supplement (${fmt(supplementMg)} mg), for ${fmt(k.total_meq, 1)} mEq total today.`)
      : null,
  );
}

function allergenAlert(allergens) {
  return h('div', { class: 'alert', role: 'alert' }, `Allergy check: ${allergens.join(', ')} logged today.`);
}

function nutrientCard(summary) {
  const tiles = NUTRIENTS.map(([key, label, unit, targetKey]) => {
    const value = summary.totals[key];
    const target = targetKey ? state.settings[targetKey] : null;
    const tile = h('div', { class: 'tile' },
      h('span', { class: 'label' }, label),
      h('span', { class: 'value' }, value === null ? '–' : `${fmt(value)} ${unit}`));
    if (target) {
      tile.append(h('span', { class: 'of' }, `${key === 'sodium_mg' ? 'limit' : 'of'} ${fmt(target)} ${unit}`));
      const bar = h('span');
      bar.style.width = `${Math.min(100, Math.round(((value || 0) / target) * 100))}%`;
      tile.append(h('span', { class: 'mini' }, bar));
    }
    return tile;
  });
  return h('section', { class: 'card', 'aria-label': 'Nutrition' },
    h('span', { class: 'eyebrow' }, 'Everything else'),
    h('div', { class: 'tiles' }, tiles));
}

function stackBar(map, mode) {
  const bar = h('div', { class: 'stack', role: 'img', 'aria-label': describePlate(map, mode) });
  for (const key of Object.keys(PLATE[mode].labels)) {
    if (!map[key]) continue;
    const seg = h('span', { class: `seg-${key}`, title: `${PLATE[mode].labels[key]} ${fmt(map[key])}%` });
    seg.style.width = `${map[key]}%`;
    bar.append(seg);
  }
  return bar;
}

function describePlate(map, mode) {
  return Object.keys(PLATE[mode].labels).filter((k) => map[k]).map((k) => `${PLATE[mode].labels[k]} ${fmt(map[k])}%`).join(', ');
}

function plateLegend(map, mode) {
  return h('ul', { class: 'legend' },
    Object.keys(PLATE[mode].labels).filter((k) => !map || map[k]).map((k) =>
      h('li', null, h('span', { class: `swatch seg-${k}` }), `${PLATE[mode].labels[k]}${map ? ` ${fmt(map[k])}%` : ''}`)));
}

function plateToggle(onChange) {
  return h('div', { class: 'segmented', role: 'group', 'aria-label': 'Plate view' },
    Object.entries(PLATE).map(([mode, cfg]) => h('button', {
      type: 'button',
      'aria-pressed': String(state.plateMode === mode),
      onclick: () => { state.plateMode = mode; onChange(); },
    }, cfg.title)));
}

function plateCard(summary) {
  if (!summary.plate_color && !summary.food_groups) return null;
  const card = h('section', { class: 'card', 'aria-label': 'Plate makeup' });
  const draw = () => {
    const mode = state.plateMode;
    const map = summary[PLATE[mode].field];
    fill(card, 
      h('div', { class: 'card-head' }, h('span', { class: 'eyebrow' }, 'Plate makeup'), plateToggle(draw)),
      map ? stackBar(map, mode) : h('p', { class: 'muted small' }, 'No estimate for this view yet.'),
      map ? plateLegend(map, mode) : null,
      h('p', { class: 'small muted' }, 'Estimated by ChatGPT from photos, weighted by calories.'),
    );
  };
  draw();
  return card;
}

function mealsSection(entries) {
  return h('section', { class: 'meals', 'aria-label': 'Meals' },
    h('div', { class: 'card-head' }, h('h2', null, 'Meals'), h('span', { class: 'muted small' }, entries.length ? `${entries.length} logged` : '')),
    entries.length
      ? entries.map(mealCard)
      : h('div', { class: 'empty' },
        h('p', null, 'Nothing logged for this day yet.'),
        h('p', { class: 'small' }, 'Send ChatGPT a photo of a meal, or use ', h('a', { href: '#add' }, 'Add'), '.')),
  );
}

// `preview` (a status label) shows a not-yet-saved or just-saved paste without edit controls.
function mealCard(e, { preview = null, warnings = [] } = {}) {
  const t = e.totals;
  const macro = [
    t.calories !== null ? `${fmt(t.calories)} kcal` : null,
    t.protein_g !== null ? `P ${fmt(t.protein_g)} g` : null,
    t.carbs_g !== null ? `C ${fmt(t.carbs_g)} g` : null,
    t.fat_g !== null ? `F ${fmt(t.fat_g)} g` : null,
  ].filter(Boolean);
  return h('article', { class: 'meal' },
    h('div', { class: 'meal-top' },
      preview ? h('span', { class: 'pill good' }, preview) : null,
      preview ? h('span', null, fmtDay(e.local_date)) : null,
      h('span', { class: 'num' }, fmtTime(e.eaten_at)),
      h('span', { class: 'pill meal-type' }, cap(e.meal)),
      e.source ? h('span', null, SOURCE_LABELS[e.source] || e.source) : null,
      e.confidence ? h('span', { class: `pill ${e.confidence === 'low' ? 'low' : ''}` }, `${cap(e.confidence)} confidence`) : null),
    h('p', { class: 'meal-desc' }, e.description),
    h('div', { class: 'meal-nums' },
      h('span', { class: 'k' }, `${fmt(t.potassium_mg)} mg potassium`),
      macro.map((m) => h('span', null, m))),
    e.allergens.length ? h('div', { class: 'alert inline' }, `Contains ${e.allergens.join(', ')}`) : null,
    e.items.length ? h('details', null,
      h('summary', null, `${e.items.length} food${e.items.length === 1 ? '' : 's'}`),
      h('ul', { class: 'items' }, e.items.map((it) => h('li', null,
        h('span', null, it.portion ? `${it.name} (${it.portion})` : it.name),
        h('span', null, it.potassium_mg !== undefined ? `${fmt(it.potassium_mg)} mg K` : ''))))) : null,
    e.notes ? h('p', { class: 'small muted' }, e.notes) : null,
    warnings.length ? h('ul', { class: 'warnings' }, warnings.map((w) => h('li', null, w))) : null,
    preview ? null : mealActions(e),
  );
}

// A Delete button that asks once inline (the viewer has no confirm() dialog) before calling onDelete.
function deleteControls(question, onDelete, extra = []) {
  const box = h('div', { class: 'actions' });
  const normal = () => fill(box, extra, h('button', { class: 'btn ghost danger', type: 'button', onclick: ask }, 'Delete'));
  const ask = () => fill(box,
    h('span', { class: 'confirm-text' }, question),
    h('button', {
      class: 'btn danger',
      type: 'button',
      onclick: async () => {
        try {
          await onDelete();
          render();
        } catch (err) {
          toast(err.message);
          normal();
        }
      },
    }, 'Delete'),
    h('button', { class: 'btn ghost', type: 'button', onclick: normal }, 'Keep'));
  normal();
  return box;
}

function mealActions(entry) {
  return deleteControls('Delete this meal?', async () => {
    await api(`/api/entries/${entry.id}`, { method: 'DELETE' });
    toast('Meal deleted', { label: 'Undo', run: () => restore(entry.id) });
  }, [h('button', { class: 'btn', type: 'button', onclick: () => openEditor(entry) }, 'Edit')]);
}

async function restore(id) {
  try {
    await api(`/api/entries/${id}/restore`, { method: 'POST' });
    toast('Meal restored');
    render();
  } catch (err) {
    toast(err.message);
  }
}

function deletedSection(entries) {
  return h('details', { class: 'card' },
    h('summary', { class: 'muted' }, `Deleted (${entries.length})`),
    h('div', { class: 'lab-list' }, entries.map((e) => h('div', { class: 'lab' },
      h('span', { class: 'num' }, fmtTime(e.eaten_at)),
      h('span', { class: 'grow' }, `${e.description} · ${fmt(e.totals.potassium_mg)} mg`),
      h('button', { class: 'btn', type: 'button', onclick: () => restore(e.id) }, 'Restore')))));
}

// ---------- Edit dialog ----------

function numberField(id, label, value, attrs = {}) {
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('input', { id, name: id, type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: value ?? '', ...attrs }));
}

function nutrientFields(prefix, totals = {}) {
  return h('div', { class: 'grid2' },
    numberField(`${prefix}-potassium_mg`, 'Potassium (mg)', totals.potassium_mg, { required: true }),
    NUTRIENTS.map(([key, label, unit]) => numberField(`${prefix}-${key}`, `${label} (${unit})`, totals[key])));
}

function readNutrients(form, prefix) {
  const totals = {};
  for (const key of ['potassium_mg', ...NUTRIENTS.map((n) => n[0])]) {
    const raw = form.elements[`${prefix}-${key}`].value.trim();
    totals[key] = raw === '' ? null : Number(raw);
  }
  return totals;
}

function mealSelect(id, value) {
  return h('div', { class: 'field' },
    h('label', { for: id }, 'Meal'),
    h('select', { id, name: id },
      MEALS.map((m) => h('option', { value: m, selected: m === value }, cap(m)))));
}

// Watched allergens plus any already on the entry, so a wrong tag can be unticked.
function allergenChoices(entry) {
  const keys = [...new Set([...state.settings.allergens_watch, ...entry.allergens])];
  if (!keys.length) return null;
  return h('fieldset', { class: 'field' },
    h('legend', { class: 'label' }, 'Contains'),
    h('div', { class: 'radio-row' }, keys.map((key) => h('label', null,
      h('input', { type: 'checkbox', name: 'ed-allergens', value: key, checked: entry.allergens.includes(key) }),
      ALLERGENS[key] || key))),
    h('span', { class: 'hint' }, 'Unticking only sticks if the description no longer names that food.'));
}

function openEditor(entry) {
  const dialog = document.getElementById('dialog');
  const errorBox = h('div');
  const form = h('form', { method: 'dialog' },
    h('div', { class: 'field' },
      h('label', { for: 'ed-description' }, 'Description'),
      h('textarea', { id: 'ed-description', name: 'ed-description', rows: '2', required: true, maxlength: '500' }, entry.description)),
    h('div', { class: 'grid2' },
      mealSelect('ed-meal', entry.meal),
      h('div', { class: 'field' },
        h('label', { for: 'ed-when' }, 'When'),
        h('input', { id: 'ed-when', name: 'ed-when', type: 'datetime-local', required: true, value: localInputValue(new Date(entry.eaten_at)) }))),
    nutrientFields('ed', entry.totals),
    h('div', { class: 'field' },
      h('label', { for: 'ed-notes' }, 'Notes'),
      h('textarea', { id: 'ed-notes', name: 'ed-notes', rows: '2', maxlength: '1000' }, entry.notes || '')),
    allergenChoices(entry),
    errorBox,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save changes'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => dialog.close() }, 'Cancel')),
  );
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const res = await api(`/api/entries/${entry.id}`, {
        method: 'PATCH',
        body: {
          description: form.elements['ed-description'].value,
          meal: form.elements['ed-meal'].value,
          eaten_at: form.elements['ed-when'].value,
          notes: form.elements['ed-notes'].value,
          totals: readNutrients(form, 'ed'),
          allergens: [...form.querySelectorAll('input[name="ed-allergens"]:checked')].map((el) => el.value),
        },
      });
      dialog.close();
      state.date = res.entry.local_date;
      toast(res.warnings.length ? `Saved. ${res.warnings[0]}` : 'Changes saved');
      render();
    } catch (err) {
      fill(errorBox, errorList(err));
    }
  });
  fill(dialog, h('div', { class: 'dialog-body' }, h('h2', { id: 'dialog-title' }, 'Edit meal'), form));
  dialog.showModal();
}

// ---------- History ----------

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * mag >= v) return step * mag;
  return 10 * mag;
}

function barChart(dates, values, { target, mode, met, label }) {
  const W = 640;
  const H = 230;
  const m = { l: 46, r: 8, t: 14, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = niceMax(Math.max(target || 0, ...values.filter((v) => v !== null)) * 1.08);
  const y = (v) => m.t + ih - (v / max) * ih;
  const slot = iw / dates.length;
  const bw = Math.max(2, slot * 0.72);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  for (const v of [0, max / 2, max]) {
    svg.append(s('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    svg.append(s('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, fmt(v)));
  }
  dates.forEach((d, i) => {
    const v = values[i];
    if (v === null) return;
    let cls = 'bar';
    if (mode === 'goal' && met[i]) cls += ' met';
    if (mode === 'limit' && !met[i]) cls += ' over';
    const rect = s('rect', { class: cls, x: m.l + i * slot + (slot - bw) / 2, y: y(v), width: bw, height: Math.max(1, m.t + ih - y(v)), rx: Math.min(3, bw / 3) },
      s('title', null, `${fmtDay(d)}: ${fmt(v)} mg`));
    svg.append(rect);
  });
  if (target) {
    svg.append(s('line', { class: 'target', x1: m.l, x2: W - m.r, y1: y(target), y2: y(target) }));
    svg.append(s('text', { class: 'target-label', x: W - m.r, y: y(target) - 5, 'text-anchor': 'end' }, `${mode === 'limit' ? 'Limit' : 'Goal'} ${fmt(target)}`));
  }
  const labelIdx = dates.length <= 7 ? dates.map((_, i) => i) : [0, Math.floor((dates.length - 1) / 2), dates.length - 1];
  for (const i of labelIdx) {
    svg.append(s('text', { x: m.l + i * slot + slot / 2, y: H - 6, 'text-anchor': 'middle' }, fmtDay(dates[i], { month: 'short', day: 'numeric' })));
  }
  return svg;
}

function plateColumns(days, mode) {
  const W = 640;
  const H = 150;
  const m = { l: 8, r: 8, t: 6, b: 24 };
  const field = PLATE[mode].field;
  const withData = days.filter((d) => d[field]);
  if (!withData.length) return h('p', { class: 'muted small' }, 'No plate estimates in this range yet.');
  const slot = (W - m.l - m.r) / withData.length;
  const bw = Math.max(3, Math.min(36, slot * 0.75));
  const ih = H - m.t - m.b;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Plate makeup ${PLATE[mode].title.toLowerCase()} per day` });
  withData.forEach((d, i) => {
    const map = d[field];
    const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
    let yPos = m.t + ih;
    for (const key of Object.keys(PLATE[mode].labels)) {
      if (!map[key]) continue;
      const hgt = (map[key] / total) * ih;
      yPos -= hgt;
      svg.append(s('rect', { class: `seg-${key}`, x: m.l + i * slot + (slot - bw) / 2, y: yPos, width: bw, height: hgt },
        s('title', null, `${fmtDay(d.date)}: ${PLATE[mode].labels[key]} ${fmt(map[key])}%`)));
    }
  });
  const ends = withData.length === 1 ? [0] : [0, withData.length - 1];
  for (const i of ends) {
    svg.append(s('text', { x: m.l + i * slot + slot / 2, y: H - 6, 'text-anchor': i === 0 ? 'start' : 'end' }, fmtDay(withData[i].date, { month: 'short', day: 'numeric' })));
  }
  return svg;
}

async function renderHistory() {
  const to = todayLocal();
  const from = addDays(to, -(state.historyDays - 1));
  const data = await api(`/api/days?from=${from}&to=${to}`);
  if (currentView() !== 'history') return;
  const settings = data.settings;
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const kValues = dates.map((d) => (byDate.has(d) ? byDate.get(d).totals.potassium_mg : null));
  const logged = data.days;
  const avg = (key) => {
    const vals = logged.map((d) => d.totals[key]).filter((v) => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const target = settings.potassium_target_mg;
  const metDays = logged.filter((d) => d.potassium.met).length;
  const met = dates.map((d) => byDate.get(d)?.potassium.met);

  const rangeButtons = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Range' },
    [7, 30, 90].map((n) => h('button', {
      type: 'button',
      'aria-pressed': String(state.historyDays === n),
      onclick: () => { state.historyDays = n; render(); },
    }, `${n} days`)));

  const plateCard_ = h('section', { class: 'card', 'aria-label': 'Plate makeup over time' });
  const drawPlate = () => fill(plateCard_, 
    h('div', { class: 'card-head' }, h('span', { class: 'eyebrow' }, 'Plate makeup per day'), plateToggle(drawPlate)),
    plateColumns(logged, state.plateMode),
    plateLegend(null, state.plateMode));
  drawPlate();

  fill(view,
    h('div', { class: 'card-head' }, h('h1', null, 'History'), rangeButtons),
    h('div', { class: 'stats' },
      stat(fmt(avg('potassium_mg')), 'avg mg potassium / logged day'),
      stat(`${metDays} of ${logged.length}`, settings.potassium_mode === 'limit' ? 'days under the limit' : 'days the goal was met'),
      stat(fmt(avg('calories')), 'avg calories / logged day'),
      stat(`${logged.length} of ${dates.length}`, 'days with meals logged')),
    h('section', { class: 'card', 'aria-label': 'Daily potassium' },
      h('span', { class: 'eyebrow' }, 'Potassium from food, mg per day'),
      barChart(dates, kValues, { target, mode: settings.potassium_mode, met, label: `Daily potassium for the last ${state.historyDays} days` }),
      h('p', { class: 'small muted' }, `Does not include the ${fmt(settings.supplement_meq_daily)} mEq supplement. Days with no bar have nothing logged.`)),
    plateCard_,
  );
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('div', { class: 'value' }, value), h('div', { class: 'label' }, label));
}

// ---------- Add ----------

function extractJson(text) {
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error("Couldn't find JSON in the pasted text. Copy the whole code block from ChatGPT.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The pasted text isn't valid JSON. Copy the whole code block from ChatGPT.");
  }
}

function renderAdd() {
  const pasteOut = h('div', { class: 'meals' });
  const pasteArea = h('textarea', {
    id: 'paste-json', name: 'paste-json', class: 'code', spellcheck: 'false',
    placeholder: '{\n  "description": "Banana and peanut butter toast",\n  "totals": { "potassium_mg": 520, "calories": 330 }\n}',
    oninput: (e) => { state.pasteDraft = e.target.value; },
  }, state.pasteDraft);

  async function runPaste(save) {
    fill(pasteOut);
    let meals;
    try {
      const parsed = extractJson(pasteArea.value);
      meals = Array.isArray(parsed) ? parsed : [parsed];
      if (!meals.length || meals.length > 10) throw new Error('Paste between 1 and 10 meals at a time.');
    } catch (err) {
      fill(pasteOut, errorList(err));
      return;
    }
    const results = await Promise.all(meals.map((meal) =>
      api(`/api/entries?source=paste${save ? '' : '&dry_run=1'}`, { method: 'POST', body: meal })
        .then((r) => ({ ok: true, ...r }), (err) => ({ ok: false, err }))));
    fill(pasteOut, results.map((r, i) => (r.ok
      ? mealCard(r.entry, { preview: save ? 'Saved' : 'Looks good', warnings: r.warnings })
      : h('article', { class: 'meal' }, h('p', { class: 'meal-desc' }, `Meal ${i + 1} wasn't saved`), errorList(r.err)))));
    if (save) {
      // Leave only the meals that failed in the box, so fixing them and saving again can't duplicate the rest.
      const failed = meals.filter((_, i) => !results[i].ok);
      const saved = results.filter((r) => r.ok);
      state.pasteDraft = failed.length ? JSON.stringify(failed.length === 1 ? failed[0] : failed, null, 2) : '';
      pasteArea.value = state.pasteDraft;
      if (saved.length) {
        state.date = saved[saved.length - 1].entry.local_date;
        toast(saved.length === 1 ? 'Meal saved' : `${saved.length} meals saved`);
      }
    }
  }

  const quickErrors = h('div');
  const quick = h('form', null,
    h('div', { class: 'field' },
      h('label', { for: 'qa-description' }, 'What did she eat?'),
      h('input', { id: 'qa-description', name: 'qa-description', type: 'text', required: true, maxlength: '500', placeholder: 'Medium banana' })),
    h('div', { class: 'grid2' },
      mealSelect('qa-meal', null),
      h('div', { class: 'field' },
        h('label', { for: 'qa-when' }, 'When'),
        h('input', { id: 'qa-when', name: 'qa-when', type: 'datetime-local', required: true, value: localInputValue(new Date()) }))),
    nutrientFields('qa'),
    quickErrors,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Add meal')));
  quick.elements['qa-meal'].prepend(h('option', { value: '', selected: true }, 'Guess from time'));
  quick.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    fill(quickErrors);
    try {
      const res = await api('/api/entries?source=manual', {
        method: 'POST',
        body: {
          description: quick.elements['qa-description'].value,
          meal: quick.elements['qa-meal'].value || undefined,
          eaten_at: quick.elements['qa-when'].value,
          totals: readNutrients(quick, 'qa'),
        },
      });
      state.date = res.entry.local_date;
      toast('Meal added');
      location.hash = '#today';
    } catch (err) {
      fill(quickErrors, errorList(err));
    }
  });

  fill(view,
    h('h1', null, 'Add a meal'),
    h('section', { class: 'card' },
      h('h2', null, 'Paste from ChatGPT'),
      h('p', { class: 'small muted' }, "If ChatGPT couldn't log a meal itself, it gives you a JSON code block. Copy the whole block and paste it here."),
      h('div', { class: 'field' }, h('label', { for: 'paste-json' }, 'Meal JSON'), pasteArea),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => runPaste(false) }, 'Check'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => runPaste(true) }, 'Save')),
      pasteOut),
    h('section', { class: 'card' },
      h('h2', null, 'Add by hand'),
      h('p', { class: 'small muted' }, 'For packaged food with a label, or anything ChatGPT got wrong.'),
      quick),
  );
}

// ---------- Labs ----------

function labClass(v) {
  if (v < LAB_LOW) return ['low', 'Low'];
  if (v > LAB_HIGH) return ['high', 'High'];
  return ['ok', 'In range'];
}

function labChart(labs) {
  const pts = [...labs].sort((a, b) => (a.taken_on < b.taken_on ? -1 : 1));
  const W = 640;
  const H = 200;
  const m = { l: 40, r: 12, t: 12, b: 26 };
  const lo = Math.min(2.5, ...pts.map((p) => p.potassium_mmol)) - 0.2;
  const hi = Math.max(5.5, ...pts.map((p) => p.potassium_mmol)) + 0.2;
  const t0 = Date.parse(pts[0].taken_on);
  const span = Math.max(1, Date.parse(pts[pts.length - 1].taken_on) - t0);
  const x = (d) => m.l + ((Date.parse(d) - t0) / span) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Serum potassium results over time' });
  svg.append(s('rect', { class: 'band', x: m.l, width: W - m.l - m.r, y: y(LAB_HIGH), height: y(LAB_LOW) - y(LAB_HIGH) }));
  for (const v of [3, LAB_LOW, 4, 4.5, LAB_HIGH]) {
    svg.append(s('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    svg.append(s('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, v.toFixed(1)));
  }
  svg.append(s('polyline', { class: 'line', points: pts.map((p) => `${x(p.taken_on)},${y(p.potassium_mmol)}`).join(' ') }));
  for (const p of pts) {
    svg.append(s('circle', { class: `dot ${labClass(p.potassium_mmol)[0]}`, cx: x(p.taken_on), cy: y(p.potassium_mmol), r: 5 },
      s('title', null, `${fmtDay(p.taken_on)}: ${p.potassium_mmol} mmol/L`)));
  }
  svg.append(s('text', { x: m.l, y: H - 6 }, fmtDay(pts[0].taken_on, { month: 'short', day: 'numeric', year: 'numeric' })));
  svg.append(s('text', { x: W - m.r, y: H - 6, 'text-anchor': 'end' }, fmtDay(pts[pts.length - 1].taken_on, { month: 'short', day: 'numeric', year: 'numeric' })));
  return svg;
}

async function renderLabs() {
  const { labs } = await api('/api/labs');
  if (currentView() !== 'labs') return;
  const errors = h('div');
  const form = h('form', null,
    h('div', { class: 'grid2' },
      h('div', { class: 'field' },
        h('label', { for: 'lab-date' }, 'Date of blood test'),
        h('input', { id: 'lab-date', name: 'lab-date', type: 'date', required: true, max: todayLocal(), value: todayLocal() })),
      h('div', { class: 'field' },
        h('label', { for: 'lab-value' }, 'Potassium (mmol/L)'),
        h('input', { id: 'lab-value', name: 'lab-value', type: 'number', inputmode: 'decimal', required: true, min: '1', max: '9', step: '0.1', placeholder: '3.6' }))),
    h('div', { class: 'field' },
      h('label', { for: 'lab-notes' }, 'Notes'),
      h('input', { id: 'lab-notes', name: 'lab-notes', type: 'text', maxlength: '500', placeholder: 'Dose change, how she felt, lab name' })),
    errors,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save result')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/labs', {
        method: 'POST',
        body: { taken_on: form.elements['lab-date'].value, potassium_mmol: form.elements['lab-value'].value, notes: form.elements['lab-notes'].value },
      });
      toast('Lab result saved');
      render();
    } catch (err) {
      fill(errors, errorList(err));
    }
  });

  const list = labs.length
    ? h('div', { class: 'lab-list' }, labs.map((lab) => {
      const [cls, label] = labClass(lab.potassium_mmol);
      const actions = deleteControls('Delete?', async () => {
        await api(`/api/labs/${lab.id}`, { method: 'DELETE' });
        toast('Lab result deleted');
      });
      return h('div', { class: 'lab' },
        h('span', { class: 'num' }, fmtDay(lab.taken_on, { month: 'short', day: 'numeric', year: 'numeric' })),
        h('span', { class: 'val' }, fmt(lab.potassium_mmol, 2).replace(/0$/, '')),
        h('span', { class: `pill ${cls === 'ok' ? 'good' : 'bad'}` }, label),
        h('span', { class: 'grow' }, lab.notes || ''),
        actions);
    }))
    : h('div', { class: 'empty' }, 'No lab results yet. Add her most recent potassium level above.');

  fill(view,
    h('h1', null, 'Lab results'),
    h('section', { class: 'card' }, h('h2', null, 'Add a result'), form),
    labs.length >= 2 ? h('section', { class: 'card' }, h('span', { class: 'eyebrow' }, 'Serum potassium, mmol/L'), labChart(labs)) : null,
    h('section', { class: 'card' }, h('h2', null, 'History'), list),
    h('p', { class: 'small muted' }, `The shaded band is the common reference range of ${LAB_LOW.toFixed(1)}–${LAB_HIGH.toFixed(1)} mmol/L. Use the range on her lab report or from her doctor if it differs.`),
  );
}

// ---------- Settings ----------

function renderSettings() {
  const st = state.settings;
  const errors = h('div');
  const meqHint = h('span', { class: 'hint num' });
  const updateHint = () => {
    const v = Number(form.elements['set-target'].value);
    meqHint.textContent = v ? `= ${fmt(v / MG_PER_MEQ, 1)} mEq from food per day` : '';
  };
  const form = h('form', null,
    h('fieldset', { class: 'field' },
      h('legend', { class: 'label' }, 'Potassium target is a…'),
      h('div', { class: 'radio-row' },
        h('label', null, h('input', { type: 'radio', name: 'set-mode', value: 'goal', checked: st.potassium_mode === 'goal' }), 'Goal (reach at least)'),
        h('label', null, h('input', { type: 'radio', name: 'set-mode', value: 'limit', checked: st.potassium_mode === 'limit' }), 'Limit (stay under)'))),
    h('div', { class: 'grid2' },
      h('div', { class: 'field' },
        h('label', { for: 'set-target' }, 'Potassium from food (mg/day)'),
        h('input', { id: 'set-target', name: 'set-target', type: 'number', min: '100', max: '20000', step: '10', required: true, value: st.potassium_target_mg, oninput: () => updateHint() }),
        meqHint),
      h('div', { class: 'field' },
        h('label', { for: 'set-supp' }, 'Daily supplement (mEq)'),
        h('input', { id: 'set-supp', name: 'set-supp', type: 'number', min: '0', max: '200', step: '1', required: true, value: st.supplement_meq_daily }),
        h('span', { class: 'hint' }, 'Shown alongside food; not counted toward the food target.'))),
    h('p', { class: 'small muted' }, 'Optional daily targets. Leave blank to hide them.'),
    h('div', { class: 'grid2' },
      TARGETS.map(([, label, unit, key]) =>
        numberField(`set-${key}`, `${label}${key === 'sodium_limit_mg' ? ' limit' : ''} (${unit})`, st[key]))),
    h('fieldset', { class: 'field' },
      h('legend', { class: 'label' }, 'Allergies to watch for'),
      h('span', { class: 'hint' }, 'Meals whose food names mention these get a warning, even if ChatGPT misses it.'),
      h('div', { class: 'radio-row' }, Object.entries(ALLERGENS).map(([key, label]) => h('label', null,
        h('input', { type: 'checkbox', name: 'set-allergens', value: key, checked: st.allergens_watch.includes(key) }), label)))),
    h('div', { class: 'field' },
      h('label', { for: 'set-tz' }, 'Time zone'),
      h('input', { id: 'set-tz', name: 'set-tz', type: 'text', required: true, value: st.timezone, list: 'tz-list', autocomplete: 'off' }),
      h('datalist', { id: 'tz-list' }, ['America/Indiana/Indianapolis', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'].map((z) => h('option', { value: z }))),
      h('span', { class: 'hint' }, 'Days roll over at midnight in this time zone.')),
    errors,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save settings')));
  updateHint();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    fill(errors);
    const optional = (key) => {
      const v = form.elements[`set-${key}`].value.trim();
      return v === '' ? null : Number(v);
    };
    try {
      state.settings = await api('/api/settings', {
        method: 'PUT',
        body: {
          potassium_mode: form.elements['set-mode'].value,
          potassium_target_mg: Number(form.elements['set-target'].value),
          supplement_meq_daily: Number(form.elements['set-supp'].value),
          ...Object.fromEntries(TARGETS.map(([, , , key]) => [key, optional(key)])),
          timezone: form.elements['set-tz'].value.trim(),
          allergens_watch: [...form.querySelectorAll('input[name="set-allergens"]:checked')].map((el) => el.value),
        },
      });
      toast('Settings saved');
    } catch (err) {
      fill(errors, errorList(err));
    }
  });

  const specUrl = `${location.origin}/api/ingest/openapi.json`;
  const specInput = h('input', { id: 'spec-url', type: 'text', readonly: true, value: specUrl, 'aria-label': 'Action schema URL' });
  const copyBtn = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(specUrl);
        toast('Copied');
      } catch {
        specInput.select();
      }
    },
  }, 'Copy');

  fill(view,
    h('h1', null, 'Settings'),
    h('section', { class: 'card' }, h('h2', null, 'Targets'),
      h('p', { class: 'notice' }, 'The potassium target starts at a general placeholder (2,600 mg/day, the adequate intake for adult women). Replace it with the number her doctor or dietitian gives you.'),
      form),
    h('section', { class: 'card' }, h('h2', null, 'ChatGPT connection'),
      h('p', { class: 'small muted' }, "In the custom GPT's Action, import the schema from this address. The API key lives in Cloudflare as INGEST_TOKEN."),
      h('div', { class: 'copy-row' }, specInput, copyBtn)),
    h('section', { class: 'card' }, h('h2', null, 'Your data'),
      h('p', { class: 'small muted' }, 'Download every meal from the last 400 days as a spreadsheet file.'),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: '/api/export.csv' }, 'Download CSV'))),
    h('section', { class: 'card' }, h('h2', null, 'Account'),
      h('p', null, 'Signed in as ', h('strong', null, state.email)),
      h('form', { method: 'post', action: '/auth/logout' }, h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'submit' }, 'Sign out')))),
  );
}

// ---------- Start ----------

async function start() {
  try {
    const me = await api('/api/me');
    state.email = me.email;
    state.settings = me.settings;
  } catch (err) {
    fill(view, errorList(err), h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Reload'));
    return;
  }
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentView() === 'today') render();
  });
  render();
}

start();
