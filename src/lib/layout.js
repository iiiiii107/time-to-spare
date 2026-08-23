/* Laying a day out.

   The one piece of real logic in the app, and the one that decides whether a
   busy day reads or turns to mush. Pure functions: no DOM, no storage, no
   clock, so it can be tested on its own.

   The shape of the problem: events that overlap in time have to share the
   width of a day. Two meetings at ten o'clock take half each. But sharing is
   not pairwise — if A overlaps B and B overlaps C, all three have to agree on
   a width even when A and C never touch, or A and C would both claim the same
   half of the column and sit on top of each other.

   So events are grouped into *clusters* — runs connected by overlap — and the
   whole cluster splits the width. Within a cluster each event takes the first
   lane that is free at its start. */

/** '09:30' → 570. Also tolerates a full 'YYYY-MM-DDTHH:MM'. */
export function minutesOf(time) {
  const clock = time.length > 5 ? time.slice(11, 16) : time;
  const [hours, mins] = clock.split(':').map(Number);
  return hours * 60 + mins;
}

/** 570 → '09:30'. Wraps within the day rather than running past midnight. */
export function timeOf(minutes) {
  const total = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** The 'YYYY-MM-DD' half of a stored timestamp. */
export function dateOf(stamp) {
  return stamp.slice(0, 10);
}

/**
 * Do two events occupy any of the same minute?
 * Half-open, so 10:00–11:00 and 11:00–12:00 sit next to each other rather than
 * fighting over the boundary they share.
 */
export function overlaps(a, b) {
  return minutesOf(a.start) < minutesOf(b.end) && minutesOf(b.start) < minutesOf(a.end);
}

/** Round to the nearest step, for dragging. */
export function snapTo(minutes, step = 15) {
  if (!step || step < 1) return Math.round(minutes);
  return Math.round(minutes / step) * step;
}

/**
 * The hours the grid draws, as minutes from midnight.
 * A quiet week shouldn't be mostly empty grid, so the range is yours to set —
 * but anything scheduled outside it still has to be reachable, so the range
 * widens to include the events actually being shown.
 */
export function visibleRange(settings = {}, events = []) {
  let from = (settings.firstHour ?? 7) * 60;
  let to = (settings.lastHour ?? 22) * 60;

  for (const event of events) {
    if (event.allDay) continue;
    from = Math.min(from, Math.floor(minutesOf(event.start) / 60) * 60);
    to = Math.max(to, Math.ceil(minutesOf(event.end) / 60) * 60);
  }

  // Always leave at least an hour of grid, and never run past the day.
  from = Math.max(0, Math.min(from, 23 * 60));
  to = Math.min(24 * 60, Math.max(to, from + 60));
  return { from, to };
}

/** Does any part of this event fall on this date? */
export function spansDate(event, date) {
  return dateOf(event.start) <= date && dateOf(event.end) >= date;
}

/**
 * The piece of an event that belongs to one day.
 *
 * An event that runs past midnight is one thing to you and two pieces of
 * grid, so each day gets the part of it that falls there, clamped to the ends
 * of that day. `continuesBefore` and `continuesAfter` let the card show that
 * it carries on rather than pretending it stops at midnight.
 *
 * Returns null when the event doesn't touch the day at all.
 */
export function segmentOn(event, date) {
  if (!spansDate(event, date)) return null;

  const startsHere = dateOf(event.start) === date;
  const endsHere = dateOf(event.end) === date;
  if (startsHere && endsHere) {
    return { ...event, continuesBefore: false, continuesAfter: false };
  }

  return {
    ...event,
    // The stored times stay put; only this piece's own ends are clamped.
    start: startsHere ? event.start : `${date}T00:00`,
    end: endsHere ? event.end : `${date}T23:59`,
    continuesBefore: !startsHere,
    continuesAfter: !endsHere,
  };
}

/**
 * Everything on one date, as pieces — all-day first, then in clock order.
 * A multi-day event appears on every day it covers.
 */
export function eventsOn(events, date) {
  return events
    .map((event) => segmentOn(event, date))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return minutesOf(a.start) - minutesOf(b.start) || minutesOf(b.end) - minutesOf(a.end);
    });
}

/** How many days an event covers, counting both ends. 1 for a normal one. */
export function daySpan(event) {
  return Math.max(1, daysApart(dateOf(event.start), dateOf(event.end)) + 1);
}

function daysApart(from, to) {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/**
 * Group timed events into runs connected by overlap.
 * Sorted by start, so a cluster is closed as soon as an event begins after
 * everything in it has ended.
 * @returns {object[][]}
 */
export function cluster(events) {
  const timed = events
    .filter((event) => !event.allDay)
    .slice()
    .sort((a, b) => minutesOf(a.start) - minutesOf(b.start));

  const clusters = [];
  let current = [];
  let reach = -Infinity;

  for (const event of timed) {
    if (current.length && minutesOf(event.start) >= reach) {
      clusters.push(current);
      current = [];
      reach = -Infinity;
    }
    current.push(event);
    reach = Math.max(reach, minutesOf(event.end));
  }
  if (current.length) clusters.push(current);
  return clusters;
}

/**
 * Where every event on a day sits.
 *
 * `top` and `height` are in minutes from the top of the visible range, so the
 * view can scale them by whatever an hour is worth in pixels without this
 * knowing anything about pixels.
 *
 * All-day events are left out — they belong in the strip above the grid, not
 * in it.
 *
 * @param {object[]} events one day's worth
 * @param {{from?: number}} [range] from visibleRange()
 * @returns {{event: object, lane: number, lanes: number, top: number, height: number}[]}
 */
export function layoutDay(events, range = {}) {
  const from = range.from ?? 0;
  const placed = [];

  for (const group of cluster(events)) {
    /** The end time currently reached by each lane. */
    const lanes = [];

    for (const event of group) {
      const start = minutesOf(event.start);
      let lane = lanes.findIndex((busyUntil) => busyUntil <= start);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(0);
      }
      lanes[lane] = minutesOf(event.end);

      placed.push({
        event,
        lane,
        lanes: 0, // filled in below, once the cluster's width is known
        top: start - from,
        // A five-minute event still has to be clickable.
        height: Math.max(minutesOf(event.end) - start, 15),
        _group: group,
      });
    }

    const width = lanes.length;
    for (const item of placed) {
      if (item._group === group) item.lanes = width;
    }
  }

  for (const item of placed) delete item._group;
  return placed;
}
