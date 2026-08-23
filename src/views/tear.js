import { capturePointer, el, svg } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { dateOf, eventsOn, minutesOf } from '../lib/layout.js';
import { addDays, formatShort, startOfWeek, todayISO } from '../lib/dates.js';

/* Tearing a day off.

   The heading stays put and everything below it rips away downward, the way
   you'd tear the written part off a pad. One ragged line is generated per
   tear and used twice — as the underside of the piece that stays and the top
   of the piece that falls — so both halves share the same rip. Underneath is
   the next page, clean.

   A day is offered after nine in the evening, once nothing on it is still to
   come. A week is offered on its last day, on the same terms, for every day
   in it. Months are not: a month is too long a thing to be finished with in
   one gesture.

   Tearing isn't final. Put something new on a day you have torn and the page
   comes back, and can be torn again once that is done too. */

/** The hour after which a day can be called finished. */
const DONE_AFTER = 21;

/** Depth of the ragged strip, in px. */
const TEETH = 12;

/** How far you have to pull before it lets go. */
const TEAR_THRESHOLD = 80;

/* ---------- the ragged line ---------- */

function ripPoints() {
  const points = [];
  const steps = 26;
  for (let i = 0; i <= steps; i += 1) {
    points.push([(i / steps) * 100, 2 + Math.random() * (TEETH - 4)]);
  }
  return points;
}

/** The falling piece is clipped so its top edge is the rip. */
function clipBelow(points) {
  const top = points.map(([x, y]) => `${x.toFixed(1)}% ${y.toFixed(1)}px`).join(', ');
  return `polygon(${top}, 100% 100%, 0% 100%)`;
}

/** The staying piece gets a paper strip shaped to the same rip. */
function stubEdge(points) {
  const width = 100;
  const line = points
    .map(([x, y], i) => `${i ? 'L' : 'M'} ${((x / 100) * width).toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
  return svg('svg', {
    class: 'tear-stub-edge',
    viewBox: `0 0 ${width} ${TEETH}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  }, [svg('path', { d: `M 0 0 L ${width} 0 ${line.slice(1)} Z`, fill: 'var(--paper)' })]);
}

/* ---------- what counts as finished ---------- */

/**
 * Has this event already happened?
 *
 * All-day events never block a tear. They aren't appointments — a birthday or
 * a trip sits across the day rather than being something still to come — and
 * treating them as unfinished until midnight would mean a day with one on it
 * could never be torn.
 */
function hasEnded(event, date, now) {
  if (event.allDay) return true;
  if (dateOf(event.end) < date) return true;
  if (dateOf(event.end) > date) return false;
  return minutesOf(event.end) <= now;
}

/**
 * A day is finished when the evening has come and nothing on it is still to
 * come. An empty day counts — there was never anything left on it.
 */
export function dayFinished(date, events, at = new Date()) {
  const today = todayISO();
  if (date > today) return false;

  const nowMinutes = at.getHours() * 60 + at.getMinutes();
  if (date === today && at.getHours() < DONE_AFTER) return false;

  // A day in the past is finished whatever the clock says now.
  const cutoff = date === today ? nowMinutes : 24 * 60;
  return eventsOn(events, date).every((event) => hasEnded(event, date, cutoff));
}

/** Every day of the week finished, and the week actually over. */
export function weekFinished(weekStart, events, at = new Date()) {
  const lastDay = addDays(weekStart, 6);
  const today = todayISO();

  // Only on the last day — a week isn't done until it has run out of days.
  if (today < lastDay) return false;
  if (today === lastDay && at.getHours() < DONE_AFTER) return false;

  for (let date = weekStart; date <= lastDay; date = addDays(date, 1)) {
    if (!dayFinished(date, events, at)) return false;
  }
  return true;
}

/* ---------- what can be torn ---------- */

/**
 * The biggest thing available to tear, or null. A week beats a day, so
 * finishing a week offers the week rather than one more day.
 */
export function tearable(shape, anchor, events, at = new Date()) {
  const weekStartsOn = store.state.settings.weekStartsOn ?? 1;

  if (shape === 'week') {
    const start = startOfWeek(anchor, weekStartsOn);
    if (!store.isTorn('week', start) && weekFinished(start, events, at)) {
      return {
        kind: 'week',
        key: start,
        label: `the week of ${formatShort(start)}`,
      };
    }
    return null;
  }

  if (shape === 'day') {
    // A day inside a week already torn off has gone with it.
    const start = startOfWeek(anchor, weekStartsOn);
    if (store.isTorn('week', start)) return null;
    if (!store.isTorn('day', anchor) && dayFinished(anchor, events, at)) {
      return { kind: 'day', key: anchor, label: formatShort(anchor) };
    }
  }

  return null;
}

/** True when what you are looking at has been torn off already. */
export function isTornNow(shape, anchor) {
  const weekStartsOn = store.state.settings.weekStartsOn ?? 1;
  const start = startOfWeek(anchor, weekStartsOn);
  if (shape === 'week') return store.isTorn('week', start);
  if (shape === 'day') return store.isTorn('day', anchor) || store.isTorn('week', start);
  return false;
}

/**
 * A page that was torn but has something on it again comes back. Called
 * before rendering, so adding an event to a finished day puts its page back.
 * @returns {boolean} whether anything changed
 */
export function refreshTorn(events, at = new Date()) {
  let changed = false;

  for (const key of Object.keys(store.state.torn || {})) {
    const [kind, when] = key.split(':');
    const stillDone = kind === 'week'
      ? weekFinished(when, events, at)
      : dayFinished(when, events, at);
    if (!stillDone) {
      store.untear(kind, when);
      changed = true;
    }
  }
  return changed;
}

/* ---------- the tear ---------- */

/**
 * @param {HTMLElement} page the part that rips away
 * @param {object} target from tearable()
 * @param {() => void} onTorn
 * @returns {HTMLElement} the zone to put where the page was
 */
export function makeTearZone(page, target, onTorn) {
  const points = ripPoints();

  const fresh = el('div', { class: 'tear-fresh', 'aria-hidden': 'true' });
  const sheet = el('div', { class: 'tear-page' }, [page]);
  const grip = el('div', {
    class: 'tear-grip',
    role: 'button',
    tabindex: '0',
    'aria-label': `Tear off ${target.label}`,
  }, [
    el('span', { class: 'tear-grip-line', 'aria-hidden': 'true' }),
    el('span', { class: 'tear-grip-text', text: `Tear off ${target.label}` }),
  ]);

  /* The grip sits at the tear line — above the page, under the heading —
     rather than below it. A day's grid is seven hundred pixels tall, so a
     grip at the bottom would mean scrolling the whole day to find the thing
     that gets rid of it. It is also where the perforation would be. */
  const zone = el('div', { class: 'tear-zone' }, [grip, fresh, sheet]);

  let pulling = false;
  let startY = 0;
  let offset = 0;
  let ripping = false;

  function beginRip() {
    if (ripping) return;
    ripping = true;
    sheet.style.clipPath = clipBelow(points);
    zone.prepend(stubEdge(points));
    zone.classList.add('ripping');
  }

  function setOffset(value) {
    offset = Math.max(0, value);
    sheet.style.transform = `translateY(${offset}px) rotate(${offset * 0.01}deg)`;
    grip.style.opacity = String(Math.max(0, 1 - offset / 50));
  }

  function finish() {
    sheet.classList.add('torn');
    grip.remove();
    setTimeout(() => {
      store.tearOff(target.kind, target.key);
      onTorn?.();
    }, 640);
  }

  function release() {
    if (!pulling) return;
    pulling = false;
    if (offset >= TEAR_THRESHOLD) {
      finish();
      return;
    }
    sheet.style.transition = 'transform .3s ease';
    setOffset(0);
    setTimeout(() => {
      sheet.style.transition = '';
      sheet.style.clipPath = '';
      zone.querySelector('.tear-stub-edge')?.remove();
      zone.classList.remove('ripping');
      ripping = false;
      grip.style.opacity = '';
    }, 320);
  }

  grip.addEventListener('pointerdown', (event) => {
    pulling = true;
    startY = event.clientY;
    capturePointer(grip, event.pointerId);
    beginRip();
    event.preventDefault();
  });

  grip.addEventListener('pointermove', (event) => {
    if (!pulling) return;
    setOffset(event.clientY - startY);
  });

  grip.addEventListener('pointerup', release);
  grip.addEventListener('pointercancel', release);

  // Clicking or pressing Enter does the same without the drag.
  grip.addEventListener('click', () => {
    if (offset > 0) return;
    beginRip();
    sheet.style.transition = 'transform .28s ease';
    setOffset(TEAR_THRESHOLD + 10);
    setTimeout(finish, 280);
  });
  grip.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      grip.click();
    }
  });

  return zone;
}

/**
 * A clean sheet, shown once the page above it has come away.
 *
 * With a way back. A page only un-tears on its own while something on it is
 * still to come, which a day already past never is — so without this, tearing
 * the wrong day would hide it for good.
 */
export function freshPage(label, undo) {
  return el('div', { class: 'fresh-page' }, [
    el('span', { class: 'fresh-page-note', text: label || 'a clean page' }),
    undo
      ? el('button', {
          class: 'fresh-page-undo',
          text: 'put it back',
          onClick: () => { store.untear(undo.kind, undo.key); undo.onDone?.(); },
        })
      : null,
  ]);
}

/** What was torn to hide what you're looking at, so it can be put back. */
export function tornBy(shape, anchor) {
  const weekStartsOn = store.state.settings.weekStartsOn ?? 1;
  const start = startOfWeek(anchor, weekStartsOn);
  if (store.isTorn('week', start)) return { kind: 'week', key: start };
  if (shape === 'day' && store.isTorn('day', anchor)) return { kind: 'day', key: anchor };
  return null;
}
