import { clear, el, svg } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { colorOf, formatSpan, formatTime, isDraft, visibleEvents } from '../lib/events.js';
import { eventsOn, minutesOf } from '../lib/layout.js';
import {
  addDays, addMonths, formatLong, formatShort, fromISO, orderedDayNames,
  startOfMonth, startOfWeek, todayISO,
} from '../lib/dates.js';
import { timeGrid, weekDays, weekStartsOn } from './grid.js';
import { eventDialog } from './event-dialog.js';
import { penPot } from './pot.js';
import { toolStyleDialog } from './tool-style.js';
import { inkLayer, startToolDrag } from './marker.js';

/* The four ways of looking at the same events.

   Week and Day share the time grid. Month and Agenda are their own shapes but
   the same paper, the same accent and the same header — switching zoom should
   never feel like arriving somewhere else. That was a real complaint about the
   habit tracker's three zooms, and it is fixed here from the start. */

let mode = null;
let anchor = todayISO();
let mountRoot = null;
let potOpen = false;

/** The grid element being marked on, for the pot to draw into. */
let canvasNode = null;

export function setMode(next) {
  mode = next;
}

export function currentMode() {
  return mode || store.state.settings.home || 'week';
}

function rerender() {
  if (mountRoot) renderCalendar(mountRoot);
}

/* ---------- period maths ---------- */

function periodStart() {
  const view = currentMode();
  if (view === 'month') return startOfMonth(anchor);
  if (view === 'week') return startOfWeek(anchor, weekStartsOn());
  return anchor;
}

/** Where this period's freehand marks are kept. */
function markKey() {
  return `${currentMode()}:${periodStart()}`;
}

function step(direction) {
  const view = currentMode();
  if (view === 'month') anchor = addMonths(startOfMonth(anchor), direction);
  else if (view === 'week') anchor = addDays(anchor, direction * 7);
  else if (view === 'agenda') anchor = addDays(anchor, direction * 14);
  else anchor = addDays(anchor, direction);
  rerender();
}

function periodTitle() {
  const view = currentMode();
  if (view === 'month') {
    return fromISO(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  if (view === 'week') {
    const start = startOfWeek(anchor, weekStartsOn());
    return `${formatShort(start)} – ${formatShort(addDays(start, 6))}`;
  }
  if (view === 'agenda') return `From ${formatShort(anchor)}`;
  return formatLong(anchor);
}

/* ---------- the little pen that fetches the pot ---------- */

function potToggle() {
  return el('button', {
    class: 'pot-toggle',
    'aria-pressed': String(potOpen),
    'aria-label': potOpen ? 'Put the tools away' : 'Get the tools out',
    title: potOpen ? 'Put the tools away' : 'Get the tools out',
    onClick: () => { potOpen = !potOpen; rerender(); },
  }, [
    svg('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' }, [
      svg('path', {
        d: 'M5.6 19.2 L7.4 14.6 L16.8 5.2 L19 7.4 L9.6 16.8 Z',
        fill: 'var(--paper)', stroke: 'currentColor', 'stroke-width': '1.5',
        'stroke-linejoin': 'round',
      }),
      svg('path', {
        d: 'M16.8 5.2 L18 4 A1.6 1.6 0 0 1 20.2 6.2 L19 7.4 Z',
        fill: 'currentColor', stroke: 'currentColor', 'stroke-width': '1.5',
        'stroke-linejoin': 'round',
      }),
      svg('path', { d: 'M7.4 14.6 L9.6 16.8', stroke: 'currentColor', 'stroke-width': '1.3' }),
      svg('path', {
        d: 'M5.6 19.2 L4.8 20.8 L6.6 20.2 Z',
        fill: 'currentColor', stroke: 'currentColor', 'stroke-width': '1.2',
        'stroke-linejoin': 'round',
      }),
    ]),
  ]);
}

function pot() {
  return penPot({
    onDragStart: (toolId, event, source) => startToolDrag({
      toolId,
      event,
      source,
      canvas: () => canvasNode,
      markKey: markKey(),
    }),
    onAdjust: toolStyleDialog,
    styles: store.state.settings.toolStyles,
    compact: true,
  });
}

/* ---------- month ---------- */

function monthView(events) {
  const first = startOfMonth(anchor);
  const start = startOfWeek(first, weekStartsOn());
  const today = todayISO();
  const settings = store.state.settings;

  const grid = el('div', { class: 'month-grid' });
  for (const name of orderedDayNames(weekStartsOn())) {
    grid.append(el('div', { class: 'dow', text: name }));
  }

  for (let i = 0; i < 42; i += 1) {
    const date = addDays(start, i);
    const outside = date.slice(0, 7) !== first.slice(0, 7);
    if (i >= 35 && outside) continue;

    const cell = el('div', {
      class: [
        'month-cell',
        outside ? 'outside' : '',
        date === today ? 'today' : '',
      ].filter(Boolean).join(' '),
      dataset: { date },
    }, [
      el('span', { class: 'month-n', text: String(fromISO(date).getDate()) }),
    ]);

    const day = eventsOn(events, date);
    for (const event of day.slice(0, 4)) {
      cell.append(
        el('button', {
          class: `month-strip${isDraft(event) ? ' draft' : ''}`,
          style: `--event:${colorOf(event, store.state.calendars)}`,
          title: `${event.title || 'Untitled'} · ${formatSpan(event, settings)}`,
          onClick: (clickEvent) => { clickEvent.stopPropagation(); eventDialog(event); },
        }, [
          event.allDay ? null : el('i', { text: formatTime(event.start, settings) }),
          el('span', { text: event.title || 'Untitled' }),
        ]),
      );
    }
    if (day.length > 4) {
      cell.append(el('span', { class: 'month-more', text: `+${day.length - 4} more` }));
    }

    cell.addEventListener('click', () => {
      anchor = date;
      setMode('day');
      location.hash = '#/day';
      rerender();
    });
    grid.append(cell);
  }

  return grid;
}

/* ---------- agenda ---------- */

function agendaView(events) {
  const settings = store.state.settings;
  const list = el('div', { class: 'agenda' });
  const today = todayISO();
  let shown = 0;

  for (let i = 0; i < 60 && shown < 40; i += 1) {
    const date = addDays(anchor, i);
    const day = eventsOn(events, date);
    if (!day.length) continue;
    shown += day.length;

    list.append(
      el('div', { class: 'agenda-day' }, [
        el('div', { class: `agenda-date${date === today ? ' today' : ''}` }, [
          el('b', { text: fromISO(date).toLocaleDateString(undefined, { weekday: 'long' }) }),
          el('span', { text: formatShort(date) }),
        ]),
        el('div', { class: 'agenda-items' }, day.map((event) =>
          el('button', {
            class: `agenda-item${isDraft(event) ? ' draft' : ''}`,
            style: `--event:${colorOf(event, store.state.calendars)}`,
            onClick: () => eventDialog(event),
          }, [
            el('span', { class: 'agenda-when', text: formatSpan(event, settings) }),
            el('span', { class: 'agenda-title', text: event.title || 'Untitled' }),
          ]),
        )),
      ]),
    );
  }

  if (!shown) {
    list.append(el('div', { class: 'empty' }, ['Nothing coming up.']));
  }
  return list;
}

/* ---------- the page ---------- */

export function renderCalendar(root) {
  mountRoot = root;
  clear(root);
  canvasNode = null;

  const view = currentMode();
  document.body.dataset.view = view;
  // The stock this view is printed on — a Settings choice, not a fixed style.
  document.body.dataset.paper = store.state.settings.paper?.[view] || 'ruled';

  const events = visibleEvents(store.state.events, store.state.calendars);
  const card = el('div', { class: 'card paper' });

  const zooms = el('div', { class: 'seg seg-wide', role: 'tablist', 'aria-label': 'Zoom' },
    ['day', 'week', 'month', 'agenda'].map((id) =>
      el('button', {
        class: 'seg-item', role: 'tab', text: id,
        'aria-selected': String(view === id),
        onClick: () => {
          setMode(id);
          location.hash = `#/${id}`;
          rerender();
        },
      }),
    ),
  );

  card.append(
    el('div', { class: 'cal-head' }, [
      el('div', { class: 'row title-row' }, [
        el('button', { class: 'icon-btn', text: '‹', 'aria-label': 'Previous', onClick: () => step(-1) }),
        el('h2', { class: 'cal-title', text: periodTitle() }),
        el('button', { class: 'icon-btn', text: '›', 'aria-label': 'Next', onClick: () => step(1) }),
        potToggle(),
      ]),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn-secondary btn-sm', text: 'Today',
          onClick: () => { anchor = todayISO(); rerender(); },
        }),
        el('button', {
          class: 'btn btn-primary btn-sm', text: '+ Event',
          onClick: () => eventDialog(null, { date: view === 'month' ? todayISO() : anchor }),
        }),
      ]),
    ]),
    zooms,
  );

  if (potOpen) {
    card.append(
      el('div', { class: 'pen-bar' }, [
        pot(),
        el('span', { class: 'pen-hint', text: 'Drag a tool across the page. Hover one to see what it does.' }),
      ]),
    );
  }

  const bodyWrap = el('div', { class: 'cal-body' });
  card.append(bodyWrap);

  if (view === 'month' || view === 'agenda') {
    // Month and agenda have no grid to draw into, so the body itself is the
    // canvas — the pot has to work on all four views, not two of them.
    const surface = el('div', { class: 'mark-surface' }, [
      view === 'month' ? monthView(events) : agendaView(events),
      inkLayer(markKey()),
    ]);
    bodyWrap.append(surface);
    canvasNode = surface;
  } else {
    const days = view === 'day'
      ? [anchor]
      : weekDays(startOfWeek(anchor, weekStartsOn()));

    const grid = timeGrid({
      days,
      events,
      markKey: markKey(),
      onOpen: (event) => eventDialog(event),
      onCreate: (seed) => eventDialog(null, seed),
      onDragEnd: () => rerender(),
    });
    bodyWrap.append(grid.node);
    canvasNode = grid.columns;
    // Park the scroll near now rather than at midnight.
    requestAnimationFrame(() => grid.node.__scrollToHour?.());
  }

  root.append(card);
}

export { minutesOf };
