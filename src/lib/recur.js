import { addDays, daysBetween, fromISO, toISO } from './dates.js';
import { dateOf } from './layout.js';

/* Repeating events.

   A repeating event is stored once, as a master with a rule. The dates it
   falls on are worked out when they are needed rather than written down, so a
   weekly meeting is one object however many years it runs for.

   Two things make this more than a loop over dates:

   - **Exceptions.** A single occurrence can be moved, renamed or cancelled
     without touching the rest. Those live on the master, keyed by the date the
     rule originally produced — not the date the occurrence was moved to, which
     would stop the rule from ever finding it again.

   - **Length.** An occurrence keeps the master's length, including one that
     spans days. Both ends shift together, so a Friday-to-Sunday trip repeating
     monthly stays three days long every time.

   The shape deliberately matches what Google Calendar can express, so that
   reading a real calendar later is a translation rather than a redesign. */

/** How far the expander will look before giving up on a `count` rule. */
const MAX_STEPS = 2000;

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

/** A weekday index, 0 = Sunday, matching Date#getDay. */
function weekdayOf(date) {
  return fromISO(date).getDay();
}

function dayOfMonth(date) {
  return fromISO(date).getDate();
}

/**
 * Does the rule land on this date? Answers for the rule alone — whether the
 * occurrence has since been cancelled is a separate question.
 */
export function occursOn(event, date) {
  const rule = event.recur;
  if (!rule) return dateOf(event.start) === date;

  const first = dateOf(event.start);
  if (date < first) return false;
  if (rule.until && date > rule.until) return false;

  const interval = Math.max(1, rule.interval || 1);

  if (rule.freq === 'daily') {
    return daysBetween(first, date) % interval === 0;
  }

  if (rule.freq === 'weekly') {
    // No days named means "the day it started on".
    const days = rule.byDay?.length ? rule.byDay : [weekdayOf(first)];
    if (!days.includes(weekdayOf(date))) return false;
    // Intervals count from the week the series started, not from each date.
    const weeks = Math.floor(daysBetween(startOfRuleWeek(first, rule), startOfRuleWeek(date, rule)) / 7);
    return weeks % interval === 0;
  }

  if (rule.freq === 'monthly') {
    if (dayOfMonth(date) !== dayOfMonth(first)) return false;
    const months = monthsBetween(first, date);
    return months >= 0 && months % interval === 0;
  }

  if (rule.freq === 'yearly') {
    if (date.slice(5) !== first.slice(5)) return false;
    const years = fromISO(date).getFullYear() - fromISO(first).getFullYear();
    return years >= 0 && years % interval === 0;
  }

  return false;
}

/** Monday-based week start, so a weekly interval counts whole weeks. */
function startOfRuleWeek(date, rule) {
  const weekStartsOn = rule.weekStartsOn ?? 1;
  const shift = (weekdayOf(date) - weekStartsOn + 7) % 7;
  return addDays(date, -shift);
}

function monthsBetween(from, to) {
  const a = fromISO(from);
  const b = fromISO(to);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/* ---------- exceptions ---------- */

/** What has been said about one occurrence, if anything. */
export function overrideFor(event, date) {
  return event.exceptions?.[date] || null;
}

export function isCancelled(event, date) {
  return overrideFor(event, date)?.cancelled === true;
}

/**
 * The id an occurrence answers to. A plain event keeps its own id; an
 * occurrence carries the date the rule produced, so the exception it belongs
 * to can always be found again even after it has been moved.
 */
export function occurrenceId(event, date) {
  return event.recur ? `${event.id}::${date}` : event.id;
}

/** Split an occurrence id back into its parts. */
export function parseOccurrenceId(id) {
  const at = id.indexOf('::');
  if (at === -1) return { seriesId: id, date: null };
  return { seriesId: id.slice(0, at), date: id.slice(at + 2) };
}

/* ---------- expansion ---------- */

/** One dated instance of a master, with any override already applied. */
function materialise(event, date) {
  if (!event.recur) return event;

  const first = dateOf(event.start);
  const shift = daysBetween(first, date);

  const occurrence = {
    ...event,
    id: occurrenceId(event, date),
    seriesId: event.id,
    occurrenceDate: date,
    isOccurrence: true,
    // Both ends move together, so an event that spans days keeps its length.
    start: `${date}T${event.start.slice(11)}`,
    end: `${addDays(dateOf(event.end), shift)}T${event.end.slice(11)}`,
  };

  const override = overrideFor(event, date);
  return override ? { ...occurrence, ...override, cancelled: undefined } : occurrence;
}

/**
 * Everything that actually happens between two dates, inclusive.
 * Masters with a rule become one entry per occurrence; plain events pass
 * through untouched.
 *
 * @param {object[]} events
 * @param {string} from 'YYYY-MM-DD'
 * @param {string} to 'YYYY-MM-DD'
 */
export function expandAll(events, from, to) {
  const out = [];

  for (const event of events) {
    if (!event.recur) {
      // A plain event counts if any part of it falls in the window.
      if (dateOf(event.end) >= from && dateOf(event.start) <= to) out.push(event);
      continue;
    }

    const first = dateOf(event.start);
    // An occurrence that starts before the window can still reach into it.
    const span = Math.max(0, daysBetween(dateOf(event.start), dateOf(event.end)));
    let cursor = from < first ? first : addDays(from, -span);
    if (cursor < first) cursor = first;

    let steps = 0;
    let produced = countBefore(event, cursor);

    while (cursor <= to && steps < MAX_STEPS) {
      steps += 1;
      if (occursOn(event, cursor)) {
        if (rule(event).count && produced >= rule(event).count) break;
        produced += 1;
        if (!isCancelled(event, cursor)) {
          const made = materialise(event, cursor);
          if (dateOf(made.end) >= from) out.push(made);
        }
      }
      cursor = addDays(cursor, 1);
    }
  }

  return out;
}

function rule(event) {
  return event.recur || {};
}

/** How many occurrences the rule has already produced before a date. */
function countBefore(event, date) {
  if (!rule(event).count) return 0;
  let seen = 0;
  let cursor = dateOf(event.start);
  let steps = 0;
  while (cursor < date && steps < MAX_STEPS) {
    if (occursOn(event, cursor)) seen += 1;
    cursor = addDays(cursor, 1);
    steps += 1;
  }
  return seen;
}

/** A plain-English description, for the dialog and the card's label. */
export function describeRule(rule, { weekStartsOn = 1 } = {}) {
  if (!rule) return 'Once';
  const every = rule.interval > 1 ? `every ${rule.interval} ` : 'every ';

  let base;
  if (rule.freq === 'daily') base = `${every}${rule.interval > 1 ? 'days' : 'day'}`;
  else if (rule.freq === 'weekly') {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const ordered = [...(rule.byDay || [])].sort(
      (a, b) => ((a - weekStartsOn + 7) % 7) - ((b - weekStartsOn + 7) % 7),
    );
    const days = ordered.length ? ` on ${ordered.map((d) => names[d]).join(', ')}` : '';
    base = `${every}${rule.interval > 1 ? 'weeks' : 'week'}${days}`;
  } else if (rule.freq === 'monthly') base = `${every}${rule.interval > 1 ? 'months' : 'month'}`;
  else base = `${every}${rule.interval > 1 ? 'years' : 'year'}`;

  const ends = rule.until
    ? `, until ${toISO(fromISO(rule.until))}`
    : rule.count
      ? `, ${rule.count} times`
      : '';
  return base[0].toUpperCase() + base.slice(1) + ends;
}
