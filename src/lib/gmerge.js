import { addDays } from './dates.js';

/* Turning a Google event into one of ours.

   Three things here are easy to get wrong and impossible to see afterwards:

   **All-day ends are exclusive.** Google says a one-day event on the 24th ends
   on the 25th. We store the last day it actually covers, so every all-day end
   loses a day on the way in and gains one on the way out. Miss it and every
   birthday becomes two days long.

   **Timed events carry an offset**, not a wall time. `09:00:00+02:00` is nine
   o'clock in Berlin and eight in London, and we store what the clock on your
   own wall would say — so it goes through a real Date rather than being
   sliced out of the string.

   **Recurrence is Google's problem, not ours.** Asking for singleEvents means
   each occurrence arrives as its own event, already worked out, so none of our
   own rule engine is involved. Cancelled occurrences still come back, marked,
   and have to be dropped.

   Everything here is pure, so it can be tested without a network. */

/** Google's own marker for an event this family of apps wrote. */
const TRACKER_SOURCE = '10 Minutes to Spare';
const TRACKER_ID_PREFIX = 'tms';

function two(n) {
  return String(n).padStart(2, '0');
}

/** A Date → 'YYYY-MM-DDTHH:MM' in the viewer's own local time. */
export function localStamp(date) {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
    + `T${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * Was this written by 10 Minutes to Spare?
 *
 * Two independent marks, because either can go missing: the source it stamps
 * on what it writes, and the id prefix it derives. A ten-minute task is not a
 * meeting and shouldn't be drawn like one.
 */
export function isTrackerEvent(raw) {
  if (raw?.source?.title === TRACKER_SOURCE) return true;
  const id = raw?.id || '';
  const base = raw?.recurringEventId || id;
  return typeof base === 'string' && base.startsWith(TRACKER_ID_PREFIX);
}

/**
 * One Google event in our shape, or null if it shouldn't be drawn at all.
 *
 * @param {object} raw the API's event resource
 * @param {object} [calendar] the calendar it came from
 */
export function fromGoogle(raw, calendar = {}) {
  if (!raw || raw.status === 'cancelled') return null;
  if (!raw.start) return null;

  const allDay = Boolean(raw.start.date);

  let start;
  let end;

  if (allDay) {
    start = `${raw.start.date}T00:00`;
    // Google's all-day end is the morning after. Ours is the last day it
    // covers, so a one-day event doesn't become two.
    const lastDay = raw.end?.date ? addDays(raw.end.date, -1) : raw.start.date;
    end = `${lastDay < raw.start.date ? raw.start.date : lastDay}T23:59`;
  } else {
    const from = new Date(raw.start.dateTime);
    const to = new Date(raw.end?.dateTime || raw.start.dateTime);
    if (Number.isNaN(from.getTime())) return null;
    start = localStamp(from);
    end = localStamp(Number.isNaN(to.getTime()) ? from : to);
  }

  const tracker = isTrackerEvent(raw);

  return {
    id: `g:${calendar.id || 'primary'}:${raw.id}`,
    googleId: raw.id,
    calendarId: calendar.id || 'primary',
    title: raw.summary || '(no title)',
    start,
    end,
    allDay,
    color: null,
    note: raw.description || '',
    origin: tracker ? 'tracker' : 'google',
    // Already on Google by definition — nothing here is a draft.
    pushedAt: raw.updated || new Date().toISOString(),
    // Whether we may write it back. Google says so per calendar.
    readOnly: calendar.accessRole ? !['owner', 'writer'].includes(calendar.accessRole) : false,
    recurring: Boolean(raw.recurringEventId),
  };
}

/** A page of Google events, cleaned up. */
export function fromGoogleList(items = [], calendar = {}) {
  return items.map((raw) => fromGoogle(raw, calendar)).filter(Boolean);
}

/**
 * Everything to draw, from both sides.
 *
 * A local event that has been pushed carries the googleId it was given, and
 * Google will hand the same event back on the next read — so the pushed copy
 * wins and the local one steps aside, rather than the day showing it twice.
 */
export function mergeEvents(local = [], google = []) {
  // A local event that has been pushed has a googleId, and Google hands the
  // same event back on the next read. Google's copy is the one that is
  // actually booked, so the local one steps aside rather than the day showing
  // both. Drafts have no googleId and are entirely ours to draw.
  return [...local.filter((event) => !event.googleId), ...google];
}

/**
 * Our event, in the shape Google's API wants.
 * The inverse of the two conversions above, so an all-day end gains back the
 * day it lost and a wall time gets the viewer's own zone attached.
 */
export function toGoogle(event, { timeZone } = {}) {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const body = {
    summary: event.title || 'Untitled',
    description: event.note || '',
    // Guarded: this module is pure and gets exercised without a DOM.
    source: {
      title: 'Time to Spare',
      url: typeof window === 'undefined' ? '' : window.location?.origin || '',
    },
  };

  if (event.allDay) {
    const first = event.start.slice(0, 10);
    // Back to an exclusive end: the morning after the last day it covers.
    body.start = { date: first };
    body.end = { date: addDays(event.end.slice(0, 10), 1) };
  } else {
    body.start = { dateTime: `${event.start}:00`, timeZone: zone };
    body.end = { dateTime: `${event.end}:00`, timeZone: zone };
  }

  return body;
}
