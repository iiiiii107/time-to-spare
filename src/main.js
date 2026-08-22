import './styles/app.css';
import { clear, el, svg } from './lib/dom.js';
import { store } from './lib/store.js';
import { formatLong, todayISO } from './lib/dates.js';
import { registerServiceWorker } from './lib/pwa.js';
import { currentMode, renderCalendar, setMode } from './views/calendar-views.js';
import { applyTheme, applyType, renderSettings } from './views/settings.js';

/* Hash routing keeps GitHub Pages happy: every URL is really index.html, so
   there are no 404s on refresh and no rewrite rules to configure.

   Three tabs, because three is what fits along the bottom of a phone. Week and
   Month get one each because they are the two you actually live in; Day,
   Agenda and Settings sit behind Other. */

const CALENDAR_VIEWS = ['week', 'day', 'month', 'agenda'];

const SECTIONS = [
  { id: 'week', label: 'Week', href: '#/week', icon: '🗓️' },
  { id: 'month', label: 'Month', href: '#/month', icon: '📅' },
  { id: 'other', label: 'Other', href: '#/agenda', icon: '⋯' },
];

const OTHER = [
  { id: 'day', label: 'Day', icon: '📄' },
  { id: 'agenda', label: 'Agenda', icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

const MARQUEE = [
  'Time you can see',
  'A week you shaped yourself',
  'Room to think',
];

function sectionFor(viewId) {
  if (viewId === 'week' || viewId === 'month') return viewId;
  return 'other';
}

function currentViewId() {
  const id = location.hash.replace(/^#\/?/, '');
  if (id === 'settings' || CALENDAR_VIEWS.includes(id)) return id;
  return store.state?.settings?.home || 'week';
}

/* The clock. Tapping it swaps the wordmark for the date and time, and tapping
   again puts them back — the time is one tap away without permanently taking
   the masthead's best real estate. */

let showTime = false;

function clockIcon() {
  return svg('svg', { viewBox: '0 0 64 64', fill: 'none', 'aria-hidden': 'true' }, [
    svg('path', {
      d: 'M26 13c0-3 2.7-4.6 6-4.6S38 10 38 13Z',
      fill: 'var(--rust)', stroke: 'var(--ink)', 'stroke-width': '2.6', 'stroke-linejoin': 'round',
    }),
    svg('path', { d: 'M29 9v4M32 8.6v4.4M35 9v4', stroke: 'var(--ink)', 'stroke-width': '1.6' }),
    svg('rect', {
      x: '8', y: '14', width: '48', height: '42', rx: '13',
      fill: 'var(--sage)', stroke: 'var(--ink)', 'stroke-width': '2.8',
    }),
    svg('rect', {
      x: '15', y: '20', width: '32', height: '30', rx: '8',
      fill: 'var(--paper)', stroke: 'var(--ink)', 'stroke-width': '2.4',
    }),
    svg('path', {
      d: 'M31 24v2.4M31 43.6V46M21.5 35h2.4M38.1 35h2.4',
      stroke: 'var(--ink)', 'stroke-width': '1.8', 'stroke-linecap': 'round',
    }),
    svg('path', {
      d: 'M31 35V27M31 35l6 3',
      stroke: 'var(--ink)', 'stroke-width': '2.6', 'stroke-linecap': 'round',
    }),
    svg('circle', { cx: '31', cy: '35', r: '3', fill: 'var(--rust)', stroke: 'var(--ink)', 'stroke-width': '1.8' }),
  ]);
}

function tickClock() {
  const now = new Date();
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const date = formatLong(todayISO());
  for (const node of document.querySelectorAll('[data-clock-time]')) node.textContent = time;
  for (const node of document.querySelectorAll('[data-clock-date]')) node.textContent = date;
}

function buildMasthead(onToggleTime) {
  const clockButton = el('button', {
    class: 'clock-btn',
    'aria-pressed': String(showTime),
    'aria-label': showTime ? 'Show the title' : 'Show the date and time',
    title: showTime ? 'Show the title' : 'Show the date and time',
    onClick: onToggleTime,
  }, [clockIcon()]);

  const heading = showTime
    ? el('div', { class: 'clock-face' }, [
        el('div', { class: 'clock-time', dataset: { clockTime: '' } }),
        el('div', { class: 'clock-date', dataset: { clockDate: '' } }),
      ])
    : el('div', {}, [
        el('h1', { class: 'wordmark' }, ['Time ', el('em', { text: 'to spare' })]),
        el('p', { class: 'wordmark-sub', text: 'a week you shaped yourself' }),
      ]);

  return el('header', { class: 'masthead' }, [
    el('div', { class: 'masthead-panel' }, [
      el('div', { class: 'stripes', 'aria-hidden': 'true' }),
      clockButton,
      el('div', { class: 'masthead-inner' }, [heading]),
    ]),
  ]);
}

function buildChrome() {
  const app = document.getElementById('app');
  clear(app);

  const marquee = el('div', { class: 'marquee', 'aria-hidden': 'true' }, [
    el('div', { class: 'marquee-track' },
      Array.from({ length: 12 }, (_, i) =>
        el('span', {}, [MARQUEE[i % MARQUEE.length], el('i', { text: ' ✦' })]),
      ),
    ),
  ]);

  const nav = el('nav', { class: 'nav', 'aria-label': 'Sections' });
  for (const section of SECTIONS) {
    nav.append(
      el('a', { class: 'nav-tab', href: section.href, dataset: { section: section.id } }, [
        el('span', { class: 'nav-icon', text: section.icon, 'aria-hidden': 'true' }),
        el('span', { class: 'nav-label', text: section.label }),
      ]),
    );
  }

  const outlet = el('div', { id: 'view' });
  const mastheadSlot = el('div');

  app.append(mastheadSlot, marquee, nav, el('main', { class: 'app' }, [outlet]));
  return { nav, outlet, mastheadSlot };
}

/** The row of extra screens, shown above whichever of them you are on. */
function otherSwitcher(current) {
  const tabs = el('div', { class: 'section-tabs' });
  for (const item of OTHER) {
    tabs.append(
      el('a', {
        class: 'section-tab',
        href: `#/${item.id}`,
        'aria-current': item.id === current ? 'page' : null,
      }, [
        el('span', { class: 'section-icon', text: item.icon, 'aria-hidden': 'true' }),
        el('span', { text: item.label }),
      ]),
    );
  }
  return tabs;
}

function route(chrome) {
  const { nav, outlet, mastheadSlot } = chrome;
  const id = currentViewId();
  const section = sectionFor(id);

  clear(mastheadSlot);
  mastheadSlot.append(buildMasthead(() => {
    showTime = !showTime;
    route(chrome);
  }));
  tickClock();

  for (const tab of nav.children) {
    if (tab.dataset.section === section) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }

  clear(outlet);

  const inOther = OTHER.some((item) => item.id === id);
  const body = el('div');
  if (inOther) outlet.append(otherSwitcher(id));
  outlet.append(body);

  if (id === 'settings') {
    renderSettings(body);
    document.title = 'Settings · Time to Spare';
    return;
  }

  setMode(id);
  renderCalendar(body);
  document.title = `${id[0].toUpperCase()}${id.slice(1)} · Time to Spare`;
}

async function boot() {
  await store.init();
  applyTheme(store.state.settings.theme || 'system');
  applyType(store.state.settings);

  const chrome = buildChrome();
  const go = () => route(chrome);

  window.addEventListener('hashchange', go);
  store.addEventListener('change', () => go());

  // No hash means the view you chose in Settings.
  if (!location.hash) setMode(store.state.settings.home || 'week');
  go();

  tickClock();
  setInterval(tickClock, 1000);

  registerServiceWorker(import.meta.env.BASE_URL);

  // The now-line goes stale while the app sits open.
  setInterval(() => {
    if (!document.hidden && currentMode() !== 'settings') go();
  }, 60_000);
}

boot();
