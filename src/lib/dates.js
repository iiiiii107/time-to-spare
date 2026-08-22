/* Dates are handled as 'YYYY-MM-DD' strings throughout the app.
   Using strings rather than Date objects keeps every comparison timezone-proof:
   a task due "today" means today where the user is, not UTC. */

export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO() {
  return toISO(new Date());
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(iso) {
  return fromISO(iso).getDay();
}

export function isWeekend(iso) {
  const d = dayOfWeek(iso);
  return d === 0 || d === 6;
}

/**
 * @param {string} iso
 * @param {number} weekStartsOn 0 = Sunday … 6 = Saturday. Defaults to Monday.
 */
export function startOfWeek(iso, weekStartsOn = 1) {
  const offset = (dayOfWeek(iso) - weekStartsOn + 7) % 7;
  return addDays(iso, -offset);
}

/** Short day names rotated to begin on the configured start day. */
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** Distinct short labels, so Tuesday and Thursday can be told apart. */
export const DAY_SHORT = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];
export const DAY_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

export function orderedDayNames(weekStartsOn = 1) {
  return Array.from({ length: 7 }, (_, i) => DAY_NAMES[(weekStartsOn + i) % 7]);
}

export function startOfMonth(iso) {
  return `${iso.slice(0, 7)}-01`;
}

export function startOfYear(iso) {
  return `${iso.slice(0, 4)}-01-01`;
}

export function daysInMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1 + n, 1);
  // Clamp to the last day when the target month is shorter.
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(d, last));
  return toISO(date);
}

export function daysBetween(fromIso, toIso) {
  const ms = fromISO(toIso) - fromISO(fromIso);
  return Math.round(ms / 86400000);
}

export function monthOf(iso) {
  return Number(iso.slice(5, 7));
}

export function formatLong(iso) {
  return fromISO(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function formatShort(iso) {
  return fromISO(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}
