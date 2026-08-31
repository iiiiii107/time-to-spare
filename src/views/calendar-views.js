import { clear, el, svg } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { colorOf, formatSpan, formatTime, isDraft, visibleEvents } from '../lib/events.js';
import { eventsOn, minutesOf } from '../lib/layout.js';
import { expandAll } from '../lib/recur.js';
import {
  addDays, addMonths, formatLong, formatShort, fromISO, orderedDayNames,
  startOfMonth, startOfWeek, todayISO,
} from '../lib/dates.js';
import { timeGrid, weekDays, weekStartsOn } from './grid.js';
import { eventDialog } from './event-dialog.js';
import { penPot } from './pot.js';
import { toolStyleDialog } from './tool-style.js';
import { armedDrawing, armedTool, inkLayer, onArmedChange, setArmed, startToolDrag } from './marker.js';
import { freshPage, isTornNow, makeTearZone, refreshTorn, tearable, tornBy } from './tear.js';
import { stickerTray } from './stickers.js';

/* The four ways of looking at the same events.

   Week and Day share the time grid. Month and Agenda are their own shapes but
   the same paper, the same accent and the same header — switching zoom should
   never feel like arriving somewhere else. That was a real complaint about the
   habit tracker's three zooms, and it is fixed here from the start. */

let mode = null;
let anchor = todayISO();
let mountRoot = null;
let potOpen = false;

/** The day the month view is showing underneath itself. */
let picked = todayISO();

/** The grid element being marked on, for the pot to draw into. */
let canvasNode = null;

/** The grid awaiting measurement, once the card it lives on is in the page. */
let pending = null;

export function setMode(next) {
  // Arriving at Today means today, whatever day you had wandered off to.
  if (next === 'today' && mode !== 'today') anchor = todayISO();
  mode = next;
}

export function currentMode() {
  return mode || store.state.settings.home || 'week';
}

/* 'today' is the day grid with the anchor held on today. Everything below
   works in terms of the shape being drawn, so this says which that is. */
function shapeOf(view) {
  if (view === 'today') return 'day';
  return view;
}

function rerender() {
  if (mountRoot) renderCalendar(mountRoot);
}

/* ---------- period maths ---------- */

function periodStart() {
  const shape = shapeOf(currentMode());
  if (shape === 'year') return `${anchor.slice(0, 4)}-01-01`;
  if (shape === 'month') return startOfMonth(anchor);
  if (shape === 'week') return startOfWeek(anchor, weekStartsOn());
  return anchor;
}

/** Where this period's freehand marks are kept. */
function markKey() {
  return `${currentMode()}:${periodStart()}`;
}

function step(direction) {
  const shape = shapeOf(currentMode());
  const view = shape;
  if (view === 'year') anchor = addMonths(`${anchor.slice(0, 4)}-01-01`, direction * 12);
  else if (view === 'month') {
    anchor = addMonths(startOfMonth(anchor), direction);
    // Land on the first of the month you moved to rather than a day you can
    // no longer see.
    picked = anchor;
  }
  else if (view === 'week') anchor = addDays(anchor, direction * weekStride());
  else if (view === 'agenda') anchor = addDays(anchor, direction * 14);
  else anchor = addDays(anchor, direction);
  rerender();
}

/** A week moves by a week — unless a phone is only showing part of one. */
function weekStride() {
  if (!isNarrow()) return 7;
  const how = store.state.settings.narrow || 'threeDays';
  if (how === 'threeDays') return 3;
  if (how === 'day') return 1;
  return 7;
}

function periodTitle() {
  const view = shapeOf(currentMode());
  if (view === 'year') return anchor.slice(0, 4);
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
    armed: armedTool(),
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
  const month = Number(first.slice(5, 7));

  const grid = el('div', {
    class: 'month-grid',
    style: `--month:${settings.monthColors?.[month] || 'var(--ink-blue)'}`,
  });

  for (const name of orderedDayNames(weekStartsOn())) {
    grid.append(el('div', { class: 'dow', text: name }));
  }

  for (let i = 0; i < 42; i += 1) {
    const date = addDays(start, i);
    const outside = date.slice(0, 7) !== first.slice(0, 7);
    if (i >= 35 && outside) continue;

    const day = eventsOn(events, date);

    const cell = el('div', {
      class: [
        'month-cell',
        outside ? 'outside' : '',
        date === today ? 'today' : '',
        date === picked ? 'picked' : '',
        day.length ? 'has-events' : '',
      ].filter(Boolean).join(' '),
      dataset: { date },
    }, [
      el('span', { class: 'month-n', text: String(fromISO(date).getDate()) }),
    ]);

    /* Two ways of showing the same day, and the stylesheet picks. Seven
       columns on a phone leave about forty pixels each, which truncates every
       title to a single letter — so there the day is dots and the panel below
       carries the words. */
    for (const event of day.slice(0, 4)) {
      cell.append(
        el('button', {
          class: `month-strip${isDraft(event) ? ' draft' : ''}${event.isOccurrence ? ' repeats' : ''}`,
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

    if (day.length) {
      cell.append(
        el('div', { class: 'month-dots', 'aria-hidden': 'true' },
          day.slice(0, 4).map((event) =>
            el('i', { style: `--event:${colorOf(event, store.state.calendars)}` }),
          ).concat(day.length > 4 ? [el('b', { text: `+${day.length - 4}` })] : []),
        ),
      );
    }

    // Picking a day shows it underneath rather than leaving the month.
    cell.addEventListener('click', () => { picked = date; rerender(); });
    grid.append(cell);
  }

  return grid;
}

/**
 * What is on the day you picked, in words.
 *
 * The grid can only ever be a shape — on a phone it is dots, and even on a
 * wide screen a cell is too narrow for a title and a time. This is where the
 * month actually tells you what is going on.
 */
function monthDayPanel(events) {
  const settings = store.state.settings;
  const day = eventsOn(events, picked);
  const when = fromISO(picked);

  const panel = el('div', { class: 'day-panel' }, [
    el('div', { class: 'day-panel-head' }, [
      el('div', {}, [
        el('b', { text: when.toLocaleDateString(undefined, { weekday: 'long' }) }),
        el('span', { text: ` ${formatShort(picked)}` }),
        picked === todayISO() ? el('em', { text: ' · today' }) : null,
      ]),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn btn-secondary btn-sm',
          text: 'Open',
          onClick: () => {
            anchor = picked;
            setMode('today');
            location.hash = '#/today';
          },
        }),
        el('button', {
          class: 'btn btn-primary btn-sm',
          text: '+ Event',
          onClick: () => eventDialog(null, { date: picked }),
        }),
      ]),
    ]),
  ]);

  if (!day.length) {
    panel.append(el('div', { class: 'day-panel-empty', text: 'Nothing on.' }));
    return panel;
  }

  panel.append(
    el('div', { class: 'day-panel-list' }, day.map((event) =>
      el('button', {
        class: `day-panel-item${isDraft(event) ? ' draft' : ''}${event.isOccurrence ? ' repeats' : ''}`,
        style: `--event:${colorOf(event, store.state.calendars)}`,
        onClick: () => eventDialog(event),
      }, [
        el('span', { class: 'day-panel-when', text: formatSpan(event, settings) }),
        el('span', { class: 'day-panel-title', text: event.title || 'Untitled' }),
      ]),
    )),
  );

  return panel;
}

/* ---------- year ----------

   Twelve small months, each tinted with its own colour from Settings, so the
   shape of a year is visible at a glance. Clicking a day goes to it. */

function yearView(events) {
  const yearNum = Number(anchor.slice(0, 4));
  const today = todayISO();
  const busy = new Set(events.map((e) => e.start.slice(0, 10)));
  const colours = store.state.settings.monthColors || {};

  const wrap = el('div', { class: 'year-grid' });

  for (let month = 1; month <= 12; month += 1) {
    const first = `${yearNum}-${String(month).padStart(2, '0')}-01`;
    const start = startOfWeek(first, weekStartsOn());

    const mini = el('div', {
      class: 'mini-month',
      style: `--month:${colours[month] || 'var(--ink-blue)'}`,
    }, [
      el('button', {
        class: 'mini-title',
        text: fromISO(first).toLocaleDateString(undefined, { month: 'long' }),
        onClick: () => { anchor = first; setMode('month'); location.hash = '#/month'; },
      }),
    ]);

    const grid = el('div', { class: 'mini-grid' });
    for (const name of orderedDayNames(weekStartsOn())) {
      grid.append(el('div', { class: 'mini-dow', text: name[0] }));
    }

    for (let i = 0; i < 42; i += 1) {
      const date = addDays(start, i);
      const outside = date.slice(0, 7) !== first.slice(0, 7);
      if (i >= 35 && outside) continue;

      grid.append(el('button', {
        class: [
          'mini-day',
          outside ? 'outside' : '',
          date === today ? 'today' : '',
          busy.has(date) ? 'busy' : '',
        ].filter(Boolean).join(' '),
        text: outside ? '' : String(fromISO(date).getDate()),
        'aria-label': date,
        disabled: outside,
        onClick: () => { anchor = date; setMode('today'); location.hash = '#/today'; },
      }));
    }

    mini.append(grid);
    wrap.append(mini);
  }

  return wrap;
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
            class: `agenda-item${isDraft(event) ? ' draft' : ''}${event.isOccurrence ? ' repeats' : ''}`,
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


/** The span of dates a view needs, with a little slack either side. */
function windowFor(view) {
  if (view === 'year') {
    const y = anchor.slice(0, 4);
    return [`${y}-01-01`, `${y}-12-31`];
  }
  if (view === 'month') {
    const first = startOfMonth(anchor);
    return [addDays(startOfWeek(first, weekStartsOn()), -7), addDays(first, 49)];
  }
  if (view === 'week') {
    const start = startOfWeek(anchor, weekStartsOn());
    return [addDays(start, -7), addDays(start, 13)];
  }
  if (view === 'agenda') return [addDays(anchor, -7), addDays(anchor, 60)];
  return [addDays(anchor, -2), addDays(anchor, 2)];
}


/** True when the screen is too narrow for seven usable columns. */
function isNarrow() {
  return window.matchMedia('(max-width: 720px)').matches;
}

/**
 * What a week does on a phone. Seven columns at 375px leaves about 45px each,
 * which is a coloured sliver and not a calendar — so unless you have asked for
 * exactly that, the week shows fewer days and moves along.
 */
function narrowedWeek(days) {
  if (!isNarrow()) return days;
  const how = store.state.settings.narrow || 'threeDays';
  if (how === 'squeeze') return days;
  if (how === 'day') return [anchor];

  // Three days, starting from the one you are looking at, kept inside the week.
  const at = Math.max(0, days.indexOf(anchor));
  const from = Math.min(at, Math.max(0, days.length - 3));
  return days.slice(from, from + 3);
}


/* The paper this view is printed on, offered beside the calendar rather than
   buried in Settings — it is a look-at-it-and-decide choice, not a
   configure-once one. The month's own colour sits next to it. */
function paperStrip(view) {
  const settings = store.state.settings;
  const current = settings.paper?.[view] || 'ruled';
  const month = Number(startOfMonth(anchor).slice(5, 7));

  const swatches = el('div', { class: 'paper-swatches' },
    ['ruled', 'grid', 'dots', 'plain'].map((kind) =>
      el('button', {
        class: 'paper-swatch',
        dataset: { paper: kind },
        title: kind,
        'aria-label': `${kind} paper`,
        'aria-pressed': String(kind === current),
        onClick: () => store.updateSettings({
          paper: { ...store.state.settings.paper, [view]: kind },
        }),
      }),
    ),
  );

  const colour = el('label', { class: 'month-colour' }, [
    el('span', { text: 'this month' }),
    el('input', {
      type: 'color',
      value: settings.monthColors?.[month] || '#7C93B8',
      'aria-label': "This month's colour",
      onChange: (event) => store.updateSettings({
        monthColors: { ...store.state.settings.monthColors, [month]: event.target.value },
      }),
    }),
  ]);

  return el('div', { class: 'paper-strip' }, [
    el('span', { class: 'paper-label', text: 'paper' }),
    swatches,
    view === 'month' ? colour : null,
  ]);
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

  /* Repeating events are stored once and worked out for the window being
     looked at, so a weekly meeting is one object however long it runs. The
     window is padded a little either side: something that began before the
     period can still reach into it. */
  const [from, to] = windowFor(shapeOf(view));
  // A page with something on it again comes back before anything is drawn.
  const events = expandAll(
    visibleEvents(store.state.events, store.state.calendars),
    from,
    to,
  );
  refreshTorn(events);

  const card = el('div', { class: 'card paper' });

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
  );

  /* One bar for the things you pick up and put on the page: the tools, when
     you have asked for them, and the stickers, always. The stickers were
     below on their own and easy to miss entirely when the tray was empty.

     Only the time grids can take a sticker — dropping one on a month cell
     would have to invent a time — so elsewhere the tray still shows and says
     so rather than disappearing. */
  const droppable = shapeOf(view) === 'day' || shapeOf(view) === 'week';

  card.append(
    el('div', { class: `tool-bar${potOpen ? ' with-pot' : ''}` }, [
      potOpen ? pot() : null,
      potOpen
        ? el('span', {
            class: `pen-hint${armedTool() ? ' holding' : ''}`,
            text: armedTool()
              ? 'Draw anywhere. Tap the tool again to put it down.'
              : 'Tap a tool to pick it up, or drag it out. Hold space to lift it.',
          })
        : null,
      stickerTray({ droppable, onPlaced: () => rerender() }),
    ]),
  );

  const bodyWrap = el('div', { class: 'cal-body' });
  card.append(bodyWrap);

  const shape = shapeOf(view);

  if (shape === 'month' || shape === 'agenda' || shape === 'year') {
    // These have no time grid to draw into, so the body itself is the canvas
    // — the pot has to work on every view, not just the ones with columns.
    const drawn = shape === 'month' ? monthView(events)
      : shape === 'year' ? yearView(events)
        : agendaView(events);
    const surface = el('div', { class: 'mark-surface' }, [drawn, inkLayer(markKey())]);
    // The month gets its paper and its colour offered right beside it.
    if (shape === 'month') {
      bodyWrap.append(
        el('div', { class: 'month-layout' }, [
          el('div', {}, [surface, monthDayPanel(events)]),
          paperStrip('month'),
        ]),
      );
    } else {
      bodyWrap.append(surface);
    }
    canvasNode = surface;
  } else if (isTornNow(shape, anchor)) {
    // Torn off. A clean sheet until something turns up on it again.
    const undo = tornBy(shape, anchor);
    bodyWrap.append(freshPage(
      shape === 'week' ? 'this week is behind you' : 'that day is done',
      undo ? { ...undo, onDone: () => rerender() } : null,
    ));
  } else {
    const days = shape === 'day'
      ? [anchor]
      : narrowedWeek(weekDays(startOfWeek(anchor, weekStartsOn())));

    const grid = timeGrid({
      days,
      events,
      markKey: markKey(),
      onOpen: (event) => eventDialog(event),
      onCreate: (seed) => eventDialog(null, seed),
      onDragEnd: () => rerender(),
    });

    const target = tearable(shape, anchor, events);
    bodyWrap.append(target ? makeTearZone(grid.node, target, () => rerender()) : grid.node);
    canvasNode = grid.columns;
    // Park the scroll near now rather than at midnight.
    // Measured after the card is in the document, below — offsetHeight is 0
    // until then, and the all-day strip pins against that height.
    pending = grid.node;
  }

  // With a tool in hand, pressing the page draws on it.
  if (armedTool() && canvasNode) {
    armedDrawing({ canvas: canvasNode, markKey: markKey() });
  }

  root.append(card);

  if (pending) {
    pending.__measure?.();
    pending.__scrollToHour?.();
    pending = null;
  }
}

export { minutesOf };
