import { capturePointer, el } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { colorOf, formatSpan, formatTime, isDraft, movedTo, resizedTo } from '../lib/events.js';
import { eventsOn, layoutDay, minutesOf, snapTo, timeOf, visibleRange } from '../lib/layout.js';
import { addDays, todayISO } from '../lib/dates.js';
import { inkLayer } from './marker.js';

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
    class: `event${isDraft(event) ? ' draft' : ''}${event.origin === 'tracker' ? ' task' : ''}`,
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
  const range = visibleRange(settings, events);
  const pxPerMinute = (settings.hourHeight ?? 52) / 60;
  const height = (range.to - range.from) * pxPerMinute;
  const today = todayISO();

  // ---- the all-day strip ----
  const allDayRow = el('div', { class: 'allday-row' }, [
    el('div', { class: 'allday-label', text: 'all day' }),
  ]);
  let anyAllDay = false;
  const allDayCells = el('div', { class: 'allday-cells' });
  for (const date of days) {
    const cell = el('div', { class: 'allday-cell', dataset: { date } });
    for (const event of eventsOn(events, date).filter((e) => e.allDay)) {
      anyAllDay = true;
      cell.append(
        el('button', {
          class: 'allday-chip',
          style: `--event:${colorOf(event, store.state.calendars)}`,
          text: event.title || 'Untitled',
          title: event.title || 'Untitled',
          onClick: () => onOpen(event),
        }),
      );
    }
    allDayCells.append(cell);
  }
  allDayRow.append(allDayCells);

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

    for (const placed of layoutDay(eventsOn(events, date), range)) {
      column.append(eventCard(placed, { pxPerMinute, onOpen, onDragEnd }));
    }

    // Clicking empty grid starts an event there.
    column.addEventListener('pointerdown', (pointerEvent) => {
      if (pointerEvent.target.closest('.event')) return;
      if (pointerEvent.target.closest('.pot-tool')) return;
      const box = column.getBoundingClientRect();
      const minutes = snapTo(
        range.from + (pointerEvent.clientY - box.top) / pxPerMinute,
        settings.snapMinutes ?? 15,
      );
      onCreate({ date, startMinutes: Math.max(0, minutes) });
    });

    columns.append(column);
  }

  const body = el('div', { class: 'grid-body' }, [
    hourRail(range, pxPerMinute, settings),
    columns,
  ]);
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
  }, [
    head,
    anyAllDay ? allDayRow : null,
    body,
  ]);

  wrap.__scrollToHour = () => {
    const target = Math.max(0, (nowOrStart(range) - range.from) * pxPerMinute - 80);
    body.scrollTop = target;
  };

  return { node: wrap, body, columns, range, pxPerMinute };
}

/** Where to park the scroll: now if today is on screen, else the day's start. */
function nowOrStart(range) {
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  return now > range.from && now < range.to ? now : range.from;
}

export { timeOf };
