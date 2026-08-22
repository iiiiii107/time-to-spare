import { minutesOf, timeOf } from './layout.js';

/* What an event is.

   Times are stored as local wall time — 'YYYY-MM-DDTHH:MM', no zone suffix.
   The same choice the habit tracker makes with plain date strings, for the
   same reason: what you meant was "half nine on Tuesday", and that shouldn't
   move because you crossed a border or the clocks changed.

   Two fields exist here that nothing reads yet. `origin` says where an event
   came from, and `pushedAt` says whether it has been sent to Google. They are
   here from the start so that connecting Google later is an addition rather
   than a migration of everything you have already written. */

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** 'YYYY-MM-DD' + minutes → a stored timestamp. */
export function stamp(date, minutes) {
  return `${date}T${timeOf(minutes)}`;
}

/**
 * A new event, with everything filled in.
 * @param {object} fields
 * @param {object} settings
 */
export function makeEvent(fields, settings = {}) {
  const length = settings.defaultMinutes ?? 30;
  const date = fields.date || fields.start?.slice(0, 10);
  const startMinutes = fields.startMinutes ?? minutesOf(fields.start || '09:00');

  return {
    id: uid(),
    calendarId: fields.calendarId || 'local',
    title: (fields.title || '').trim(),
    start: fields.start && fields.start.length > 10 ? fields.start : stamp(date, startMinutes),
    end:
      fields.end && fields.end.length > 10
        ? fields.end
        : stamp(date, (fields.endMinutes ?? startMinutes + length)),
    allDay: Boolean(fields.allDay),
    color: fields.color || null,
    note: fields.note || '',
    origin: 'local',
    pushedAt: null,
    createdAt: new Date().toISOString(),
  };
}

/** Still ours alone — never sent anywhere. */
export function isDraft(event) {
  return !event.pushedAt;
}

/** The colour an event actually draws in: its own, else its calendar's. */
export function colorOf(event, calendars = []) {
  if (event.color) return event.color;
  const calendar = calendars.find((c) => c.id === event.calendarId);
  return calendar?.color || '#2F5C96';
}

/** Events on calendars you have turned off aren't drawn. */
export function visibleEvents(events, calendars) {
  const hidden = new Set(calendars.filter((c) => c.visible === false).map((c) => c.id));
  return hidden.size ? events.filter((e) => !hidden.has(e.calendarId)) : events;
}

/**
 * Move an event to a new day and start, keeping how long it lasts.
 * @returns {{start: string, end: string}}
 */
export function movedTo(event, date, startMinutes) {
  const length = minutesOf(event.end) - minutesOf(event.start);
  return {
    start: stamp(date, startMinutes),
    end: stamp(date, startMinutes + length),
  };
}

/** Resize by moving one edge, never letting an event invert or vanish. */
export function resizedTo(event, edge, minutes, { min = 15 } = {}) {
  const date = event.start.slice(0, 10);
  if (edge === 'start') {
    const capped = Math.min(minutes, minutesOf(event.end) - min);
    return { start: stamp(date, capped), end: event.end };
  }
  const capped = Math.max(minutes, minutesOf(event.start) + min);
  return { start: event.start, end: stamp(date, capped) };
}

/** '09:30' or '9:30 am', depending on what you asked for. */
export function formatTime(value, { hour12 = false } = {}) {
  const total = typeof value === 'number' ? value : minutesOf(value);
  const hours = Math.floor(total / 60) % 24;
  const mins = total % 60;

  if (!hour12) return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

  const suffix = hours < 12 ? 'am' : 'pm';
  const shown = hours % 12 === 0 ? 12 : hours % 12;
  return mins === 0 ? `${shown}${suffix}` : `${shown}:${String(mins).padStart(2, '0')}${suffix}`;
}

/** '09:30 – 10:15', for a card that has room for it. */
export function formatSpan(event, settings) {
  if (event.allDay) return 'All day';
  return `${formatTime(event.start, settings)} – ${formatTime(event.end, settings)}`;
}
