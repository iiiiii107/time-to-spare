import { capturePointer, el } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { colorOf, formatSpan, formatTime, isDraft, movedTo, resizedTo } from '../lib/events.js';
import {
  dateOf, daySpan, eventsOn, layoutDay, minutesOf, snapTo, timeOf, visibleRange,
} from '../lib/layout.js';
import { addDays, todayISO } from '../lib/dates.js';
import { armedTool, inkLayer } from './marker.js';

/* The time grid, shared by the week and the day.

   One column per day, hours down the side, and events placed by the minute.
   layoutDay() has already worked out which lane each event takes and how many
   lanes its cluster needs; everything here is turning minutes into pixels.

   An event is a little paper card: a tinted sheet with a coloured edge, the
   same paper language as the rest of the app. A draft — something not yet
   sent to Google — is drawn with a dashed edge, so you can see at a glance
   what is only yours so far. */

/** How near an edge you have to grab to resize rather than move. */
const EDGE_GRAB = 7;

export function weekStartsOn() {
  return store.state.settings.weekStartsOn ?? 1;
}

/** The days a week shows, honouring the weekend setting. */
export function weekDays(start) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  if (store.state.settings.weekends !== 'hidden') return days;
  return days.filter((date) => {
    const day = new Date(`${date}T00:00:00`).getDay();
    return day !== 0 && day !== 6;
  });
}

function isWeekendDate(date) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

/* ---------- the hour rail ---------- */

function hourRail(range, pxPerMinute, settings) {
  const rail = el('div', { class: 'rail', 'aria-hidden': 'true' });
  for (let minutes = range.from; minutes <= range.to; minutes += 60) {
    rail.append(
      el('div', {
        class: 'rail-hour',
        style: `top:${(minutes - range.from) * pxPerMinute}px`,
        text: minutes >= 24 * 60 ? '' : formatTime(minutes, settings),
      }),
    );
  }
  return rail;
}

/** The faint lines behind the cards. */
function hourLines(range, pxPerMinute) {
  const lines = el('div', { class: 'hour-lines', 'aria-hidden': 'true' });
  for (let minutes = range.from; minutes <= range.to; minutes += 60) {
    lines.append(
      el('div', {
        class: 'hour-line',
        style: `top:${(minutes - range.from) * pxPerMinute}px`,
      }),
    );
  }
  return lines;
}

/* ---------- one card ---------- */

function eventCard(placed, { pxPerMinute, onOpen, onDragEnd }) {
  const { event, lane, lanes, top, height } = placed;
  const width = 100 / lanes;
  const color = colorOf(event, store.state.calendars);
  const settings = store.state.settings;

  const heightPx = height * pxPerMinute;

  /* Only the lane numbers go inline; the stylesheet works out left and width
     from them. That way hovering can widen a crowded card back to the full
     column with an ordinary rule — an inline `width` would beat any rule
     trying to override it, and so would an inline custom property. */
  const card = el('div', {
    class: [
      'event',
      isDraft(event) ? 'draft' : '',
      event.origin === 'tracker' ? 'task' : '',
      event.isOccurrence ? 'repeats' : '',
    ].filter(Boolean).join(' '),
    style: [
      `--event:${color}`,
      `--lane:${lane}`,
      `--lanes:${lanes}`,
      `top:${top * pxPerMinute}px`,
      `height:${heightPx}px`,
    ].join('; '),
    dataset: {
      event: event.id,
      lanes: String(lanes),
      size: heightPx < 30 ? 'tiny' : heightPx < 54 ? 'short' : 'normal',
    },
    tabindex: '0',
    role: 'button',
    'aria-label': `${event.title || 'Untitled'}, ${formatSpan(event, settings)}`,
  }, [
    el('span', { class: 'event-time', text: formatTime(event.start, settings) }),
    el('span', { class: 'event-title', text: event.title || 'Untitled' }),
    el('span', { class: 'event-grip top', 'aria-hidden': 'true' }),
    el('span', { class: 'event-grip bottom', 'aria-hidden': 'true' }),
  ]);

  card.addEventListener('dblclick', () => onOpen(event));
  card.addEventListener('keydown', (keyEvent) => {
    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
      keyEvent.preventDefault();
      onOpen(event);
    }
  });

  card.addEventListener('pointerdown', (pointerEvent) => {
    // A tool being dragged out of the pot must not be intercepted by a card.
    if (pointerEvent.target.closest('.pot-tool')) return;
    // Nor should a card move when you meant to draw over it.
    if (armedTool()) return;
    pointerEvent.stopPropagation();

    const box = card.getBoundingClientRect();
    const fromTop = pointerEvent.clientY - box.top;
    const edge =
      fromTop <= EDGE_GRAB ? 'start' : fromTop >= box.height - EDGE_GRAB ? 'end' : null;

    const grid = card.closest('.grid-body');
    if (!grid) return;

    capturePointer(card, pointerEvent.pointerId);
    card.classList.add('dragging');

    const step = settings.snapMinutes ?? 15;
    const range = grid.__range;
    const startedAt = pointerEvent.clientY;
    const originalStart = minutesOf(event.start);
    const originalEnd = minutesOf(event.end);
    let moved = false;

    /* Pointer y → minutes from midnight.

       Measured against a day column, not the scroll box. The column is the
       element cards are positioned inside, so its box already accounts for
       both the scroll offset and the padding the hour labels need — measuring
       from the scroll box instead put every drag out by that padding. */
    function minutesAt(clientY) {
      const column = card.closest('.day-col') || grid.querySelector('.day-col');
      return range.from + (clientY - column.getBoundingClientRect().top) / pxPerMinute;
    }

    /* The card is moved directly rather than by re-rendering. A re-render per
       pointer move would rebuild the node under the pointer and drop the
       capture; the full repaint happens once, on release, when lanes may have
       changed and have to be worked out again. */
    function paint(startMinutes, endMinutes) {
      card.style.top = `${(startMinutes - range.from) * pxPerMinute}px`;
      card.style.height = `${Math.max(endMinutes - startMinutes, 15) * pxPerMinute}px`;
      const label = card.querySelector('.event-time');
      if (label) label.textContent = formatTime(startMinutes, settings);
    }

    function onMove(moveEvent) {
      if (!moved && Math.abs(moveEvent.clientY - startedAt) < 3) return;
      moved = true;

      if (edge) {
        const patch = resizedTo(event, edge, snapTo(minutesAt(moveEvent.clientY), step));
        store.stageEvent(event.id, patch);
        paint(minutesOf(patch.start), minutesOf(patch.end));
        return;
      }

      // Whichever column the pointer is over is the day it lands on.
      const under = document
        .elementsFromPoint(moveEvent.clientX, moveEvent.clientY)
        .find((node) => node.classList?.contains('day-col'));
      const date = under?.dataset.date || event.start.slice(0, 10);

      const delta = snapTo(minutesAt(moveEvent.clientY) - minutesAt(startedAt), step);
      const startMinutes = Math.max(0, originalStart + delta);
      const patch = movedTo(event, date, startMinutes);
      store.stageEvent(event.id, patch);

      // Crossing into another day moves the node itself, which keeps the
      // pointer capture — rebuilding it would not.
      if (under && under !== card.parentElement) under.append(card);
      paint(startMinutes, startMinutes + (originalEnd - originalStart));
    }

    function onUp() {
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerup', onUp);
      card.removeEventListener('pointercancel', onUp);
      card.classList.remove('dragging');
      // One save for the whole drag, not one per pointer move. The repaint
      // afterwards re-runs the lane algorithm, which the move may have changed.
      if (moved) {
        store.commit();
        onDragEnd();
      }
    }

    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerup', onUp);
    card.addEventListener('pointercancel', onUp);
  });

  return card;
}


/**
 * All-day events as bars over a run of days, packed into rows.
 *
 * Each bar knows which column it starts in and how many it spans, so a
 * four-day trip is one element rather than four chips that happen to sit next
 * to each other. Two bars that share a day go on separate rows.
 *
 * @returns {{event: object, column: number, span: number,
 *            continuesBefore: boolean, continuesAfter: boolean}[][]}
 */
function allDayBars(days, events) {
  const first = days[0];
  const last = days[days.length - 1];

  const found = events
    .filter((event) => event.allDay && dateOf(event.end) >= first && dateOf(event.start) <= last)
    .sort((a, b) => a.start.localeCompare(b.start) || daySpan(b) - daySpan(a));

  const rows = [];

  for (const event of found) {
    // Clamp to the days actually on screen; the flags say it carries on.
    const from = Math.max(0, days.indexOf(clampDate(dateOf(event.start), first, last)));
    const to = Math.max(from, days.indexOf(clampDate(dateOf(event.end), first, last)));

    const bar = {
      event,
      column: from + 1, // CSS grid columns are 1-based
      span: to - from + 1,
      continuesBefore: dateOf(event.start) < first,
      continuesAfter: dateOf(event.end) > last,
    };

    // The first row with nothing already occupying those columns.
    let row = rows.find((existing) => existing.every((other) =>
      bar.column + bar.span <= other.column || other.column + other.span <= bar.column));
    if (!row) {
      row = [];
      rows.push(row);
    }
    row.push(bar);
  }

  return rows;
}

function clampDate(date, first, last) {
  if (date < first) return first;
  if (date > last) return last;
  return date;
}

/* ---------- the whole grid ---------- */

/**
 * @param {object} options
 * @param {string[]} options.days the dates to draw, left to right
 * @param {object[]} options.events everything visible
 * @param {string} options.markKey where freehand marks for this period live
 * @param {(event: object) => void} options.onOpen
 * @param {(fields: object) => void} options.onCreate
 * @param {(opts?: object) => void} options.onDragEnd repaint after a drag
 */
export function timeGrid({ days, events, markKey, onOpen, onCreate, onDragEnd }) {
  const settings = store.state.settings;
  /* Segments first, then the range from the segments.

     An event running 22:00 → 06:00 next day has a stored end of 06:00, which
     is *earlier* than its start, so asking the raw event how far the grid must
     reach says "not far". Its second piece then began at midnight, four hours
     above a grid starting at seven, and was drawn off the top. Cutting the
     pieces first means the range is worked out from what is actually going to
     be drawn. */
  const perDay = new Map(days.map((date) => [date, eventsOn(events, date)]));
  const range = visibleRange(settings, [...perDay.values()].flat());
  const pxPerMinute = (settings.hourHeight ?? 52) / 60;
  const height = (range.to - range.from) * pxPerMinute;
  const today = todayISO();

  // ---- the all-day strip ----
  /* A trip is one thing, so it is drawn as one bar across the days it covers
     rather than repeated once per day. Bars are packed into rows so two that
     overlap don't land on top of each other; each row is its own grid, laid
     over the same columns as the days below. */
  const bars = allDayBars(days, events);
  const anyAllDay = bars.length > 0;

  const allDayRow = el('div', { class: 'allday-row' }, [
    el('div', { class: 'allday-label', text: 'all day' }),
    el('div', { class: 'allday-stack' }, bars.map((row) =>
      el('div', { class: 'allday-cells' }, row.map((bar) =>
        el('button', {
          class: [
            'allday-chip',
            bar.continuesBefore ? 'from-before' : '',
            bar.continuesAfter ? 'into-after' : '',
            isDraft(bar.event) ? 'draft' : '',
          ].filter(Boolean).join(' '),
          style: [
            `--event:${colorOf(bar.event, store.state.calendars)}`,
            `grid-column:${bar.column} / span ${bar.span}`,
          ].join('; '),
          text: bar.event.title || 'Untitled',
          title: bar.event.title || 'Untitled',
          onClick: () => onOpen(bar.event),
        }),
      )),
    )),
  ]);

  // ---- the headers ----
  const head = el('div', { class: 'grid-head' }, [
    el('div', { class: 'rail-spacer', 'aria-hidden': 'true' }),
    el('div', { class: 'head-cells' }, days.map((date) => {
      const when = new Date(`${date}T00:00:00`);
      return el('div', {
        class: [
          'head-cell',
          date === today ? 'today' : '',
          isWeekendDate(date) ? 'weekend' : '',
        ].filter(Boolean).join(' '),
      }, [
        el('span', { class: 'head-day', text: when.toLocaleDateString(undefined, { weekday: 'short' }) }),
        el('span', { class: 'head-date', text: String(when.getDate()) }),
      ]);
    })),
  ]);

  // ---- the grid itself ----
  const columns = el('div', { class: 'day-cols' });
  for (const date of days) {
    const column = el('div', {
      class: `day-col${isWeekendDate(date) ? ' weekend' : ''}${date === today ? ' today' : ''}`,
      dataset: { date },
      style: `height:${height}px`,
    });

    column.append(hourLines(range, pxPerMinute));

    for (const placed of layoutDay(perDay.get(date) || [], range)) {
      column.append(eventCard(placed, { pxPerMinute, onOpen, onDragEnd }));
    }

    /* Tapping empty grid starts an event there.

       On a finger this has to wait for the release. A scroll begins with a
       press on the grid like everything else, so opening the dialog on
       pointerdown meant every attempt to scroll the day threw up a new event —
       which is exactly what it did on a phone. A press only counts as a tap if
       the finger stayed put and did not linger. */
    column.addEventListener('pointerdown', (pointerEvent) => {
      if (pointerEvent.target.closest('.event')) return;
      if (pointerEvent.target.closest('.pot-tool')) return;
      // With something in your hand, a press on the grid is a stroke, not a
      // new event — that is the whole point of having picked it up.
      if (armedTool()) return;

      const from = { x: pointerEvent.clientX, y: pointerEvent.clientY, at: Date.now() };
      // Where the finger first landed is the time it means, not where it let go.
      const box = column.getBoundingClientRect();
      const minutes = snapTo(
        range.from + (pointerEvent.clientY - box.top) / pxPerMinute,
        settings.snapMinutes ?? 15,
      );

      const done = () => {
        column.removeEventListener('pointerup', onUp);
        column.removeEventListener('pointercancel', done);
        window.removeEventListener('pointercancel', done);
      };

      function onUp(upEvent) {
        done();
        // Travelled: that was a scroll, or a drag that meant something else.
        if (Math.hypot(upEvent.clientX - from.x, upEvent.clientY - from.y) > 8) return;
        // Lingered: a long press is not a tap either.
        if (Date.now() - from.at > 700) return;
        onCreate({ date, startMinutes: Math.max(0, minutes) });
      }

      column.addEventListener('pointerup', onUp);
      // A scroll taking over cancels the pointer, which is the clearest signal
      // of all that this was never a tap.
      column.addEventListener('pointercancel', done);
      window.addEventListener('pointercancel', done);
    });

    columns.append(column);
  }

  /* Everything goes inside one scroll box.

     The headings used to sit outside it. The moment the grid was tall enough
     to scroll, its 15px scrollbar made the columns narrower than the headings
     above them — a couple of pixels per column, so by Sunday the name was
     thirteen pixels off its own day. Putting them in the same box makes them
     the same width by construction rather than by arithmetic, and the heading
     row is pinned so it stays put while the day scrolls under it. */
  const inner = el('div', { class: 'grid-inner' }, [
    head,
    anyAllDay ? allDayRow : null,
    hourRail(range, pxPerMinute, settings),
    columns,
  ]);
  const body = el('div', { class: 'grid-body' }, [inner]);
  body.__range = range;

  // Now, as a line across the days it belongs to.
  if (days.includes(today)) {
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    if (nowMinutes >= range.from && nowMinutes <= range.to) {
      columns.append(
        el('div', {
          class: 'now-line',
          'aria-hidden': 'true',
          style: `top:${(nowMinutes - range.from) * pxPerMinute}px`,
        }),
      );
    }
  }

  // The ink sits over the whole grid — a mark can run across days.
  const ink = inkLayer(markKey);
  columns.append(ink);

  /* The header row and the body are separate grids that have to stay lined
     up, so both take their column template from the same two variables. */
  const narrow = settings.weekends === 'narrow' && days.length > 1;
  const template = narrow
    ? days.map((date) => (isWeekendDate(date) ? '0.55fr' : '1fr')).join(' ')
    : null;

  const wrap = el('div', {
    class: 'grid',
    dataset: { weekends: narrow ? 'narrow' : 'full' },
    style: [
      `--cols:${days.length}`,
      template ? `--week-cols:${template}` : '',
    ].filter(Boolean).join('; '),
  }, [body]);

  /* The all-day strip pins directly under the heading row, so it has to be
     told how tall that row actually is rather than guessing. */
  wrap.__measure = () => {
    wrap.style.setProperty('--head-h', `${head.offsetHeight}px`);
  };

  /* The page scrolls now, not the grid, so bringing the current hour into
     view means moving the window — and only when it is actually out of sight.
     Yanking the whole page down on every render would be worse than landing
     at the top of the day. */
  wrap.__scrollToHour = () => {
    const into = (nowOrStart(range) - range.from) * pxPerMinute;
    const target = columns.getBoundingClientRect().top + window.scrollY + into - 120;
    if (target <= window.scrollY) return;
    if (columns.getBoundingClientRect().top + into < window.innerHeight - 80) return;
    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  };

  return { node: wrap, body, columns, range, pxPerMinute };
}

/** Where to park the scroll: now if today is on screen, else the day's start. */
function nowOrStart(range) {
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  return now > range.from && now < range.to ? now : range.from;
}

export { timeOf };
