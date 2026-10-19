// Timezone helpers built on Intl, so daily totals roll over at local midnight, not UTC.

const formatters = new Map();

function zonedParts(date, timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  return p;
}

// Minutes the zone is ahead of UTC at the given instant (EDT is -240).
function offsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// Interpret a wall-clock time in `timeZone` and return the UTC instant.
export function zonedToUtc({ year, month, day, hour, minute, second = 0 }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = offsetMinutes(new Date(guess), timeZone);
  let t = guess - first * 60000;
  const second_ = offsetMinutes(new Date(t), timeZone);
  if (second_ !== first) t = guess - second_ * 60000;
  return new Date(t);
}

export function localDate(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localHour(date, timeZone) {
  return +zonedParts(date, timeZone).hour;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
