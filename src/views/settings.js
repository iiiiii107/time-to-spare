import { clear, el, toast } from '../lib/dom.js';
import { store, CALENDAR_COLORS } from '../lib/store.js';
import { storage } from '../lib/storage.js';
import { DAY_FULL, DAY_SHORT } from '../lib/dates.js';
import { formatTime } from '../lib/events.js';

/* Settings.

   The complaint this app answers is that Google's calendar is somebody else's
   idea of a calendar. So most of what it looks like is here: the hours it
   draws, how tall an hour is, what the weekend gets, the type, the paper.
   None of it changes your events — only how they are put in front of you. */

function card(title, sub, children) {
  return el('div', { class: 'card paper' }, [
    el('div', { class: 'section-head' }, [
      el('h2', { text: title }),
      sub ? el('span', { class: 'sub', text: sub }) : null,
    ]),
    ...[].concat(children),
  ]);
}

function segmented(options, value, onPick, { wide = false } = {}) {
  const wrap = el('div', { class: `seg${wide ? ' seg-wide' : ''}` });
  for (const option of options) {
    wrap.append(
      el('button', {
        type: 'button',
        class: 'seg-item',
        text: option.label,
        'aria-label': option.aria || option.label,
        'aria-selected': String(option.value === value),
        onClick: () => {
          for (const node of wrap.children) node.setAttribute('aria-selected', 'false');
          wrap.children[options.indexOf(option)].setAttribute('aria-selected', 'true');
          onPick(option.value);
        },
      }),
    );
  }
  return wrap;
}

function slider(value, { min, max, step = 1, format, onChange }) {
  const readout = el('span', { class: 'stepper-value', text: format(value) });
  const input = el('input', {
    type: 'range',
    min: String(min), max: String(max), step: String(step),
    value: String(value),
    onInput: (event) => {
      readout.textContent = format(Number(event.target.value));
    },
    onChange: (event) => onChange(Number(event.target.value)),
  });
  return el('div', { class: 'slider-row' }, [input, readout]);
}

function settingRow(label, description, control) {
  return el('div', { class: 'row-between setting-row' }, [
    el('div', {}, [
      el('div', { style: 'font-weight:700; font-size:14px', text: label }),
      description ? el('div', { class: 'muted', text: description }) : null,
    ]),
    control,
  ]);
}

function exportData() {
  storage.exportAll().then((json) => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', {
      href: url,
      download: `time-to-spare-${new Date().toISOString().slice(0, 10)}.json`,
    });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

function importData() {
  const picker = el('input', {
    type: 'file',
    accept: 'application/json',
    style: 'display:none',
    onChange: async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!confirm('This replaces everything currently saved. Continue?')) return;
      try {
        await storage.importAll(await file.text());
        toast('Restored');
        location.reload();
      } catch {
        toast("That file couldn't be read");
      }
    },
  });
  document.body.append(picker);
  picker.click();
  picker.remove();
}

/* ---------- calendars ---------- */

function calendarList(rerender) {
  const wrap = el('div', { class: 'stack' });

  store.state.calendars.forEach((calendar, index) => {
    wrap.append(
      el('div', { class: 'cal-row', style: `--event:${calendar.color}` }, [
        el('input', {
          type: 'checkbox',
          checked: calendar.visible !== false,
          'aria-label': `Show ${calendar.name}`,
          onChange: (event) => store.updateCalendar(calendar.id, { visible: event.target.checked }),
        }),
        el('input', {
          class: 'input cal-name',
          value: calendar.name,
          'aria-label': 'Name',
          onChange: (event) => store.updateCalendar(calendar.id, { name: event.target.value.trim() || 'Untitled' }),
        }),
        el('input', {
          type: 'color',
          value: calendar.color,
          'aria-label': `${calendar.name} colour`,
          onChange: (event) => store.updateCalendar(calendar.id, { color: event.target.value }),
        }),
        el('button', {
          class: 'icon-btn', text: '↑', 'aria-label': 'Move up',
          disabled: index === 0,
          onClick: () => store.moveCalendar(calendar.id, -1),
        }),
        el('button', {
          class: 'icon-btn', text: '↓', 'aria-label': 'Move down',
          disabled: index === store.state.calendars.length - 1,
          onClick: () => store.moveCalendar(calendar.id, 1),
        }),
        el('button', {
          class: 'icon-btn danger', text: '×', 'aria-label': `Delete ${calendar.name}`,
          disabled: store.state.calendars.length <= 1,
          onClick: () => {
            if (confirm(`Delete "${calendar.name}" and everything on it?`)) {
              store.deleteCalendar(calendar.id);
            }
          },
        }),
      ]),
    );
  });

  wrap.append(
    el('button', {
      class: 'btn btn-secondary btn-sm',
      style: 'margin-top:10px',
      text: '+ Calendar',
      onClick: () => {
        const name = prompt('Name it');
        if (name?.trim()) {
          store.addCalendar({
            name,
            color: CALENDAR_COLORS[store.state.calendars.length % CALENDAR_COLORS.length],
          });
        }
      },
    }),
  );

  return wrap;
}

/* ---------- the page ---------- */

export function renderSettings(root) {
  clear(root);
  document.body.dataset.view = 'settings';
  const s = store.state.settings;
  const rerender = () => renderSettings(root);

  const view = card('The view', 'where you land, and how the week is shaped', [
    settingRow('Opens on', 'The view you get when you open the app.',
      segmented(
        [
          { value: 'week', label: 'Week' },
          { value: 'day', label: 'Day' },
          { value: 'month', label: 'Month' },
          { value: 'agenda', label: 'Agenda' },
        ],
        s.home,
        (value) => store.updateSettings({ home: value }),
      )),

    el('div', { class: 'field' }, [
      el('label', { text: 'Week starts on' }),
      segmented(
        [1, 2, 3, 4, 5, 6, 0].map((index) => ({
          value: index, label: DAY_SHORT[index], aria: DAY_FULL[index],
        })),
        s.weekStartsOn ?? 1,
        (value) => store.updateSettings({ weekStartsOn: value }),
        { wide: true },
      ),
    ]),

    settingRow('Weekends', 'Give the working week the room, or keep all seven.',
      segmented(
        [
          { value: 'full', label: 'Full' },
          { value: 'narrow', label: 'Narrow' },
          { value: 'hidden', label: 'Hidden' },
        ],
        s.weekends,
        (value) => { store.updateSettings({ weekends: value }); },
      )),

    settingRow('On a narrow screen', 'Seven columns on a phone leaves about 45px each.',
      segmented(
        [
          { value: 'threeDays', label: '3 days' },
          { value: 'day', label: 'One day' },
          { value: 'squeeze', label: 'All 7' },
        ],
        s.narrow || 'threeDays',
        (value) => store.updateSettings({ narrow: value }),
      )),

    settingRow('Time', null,
      segmented(
        [{ value: false, label: '24h' }, { value: true, label: '12h' }],
        Boolean(s.hour12),
        (value) => store.updateSettings({ hour12: value }),
      )),
  ]);

  const density = card('Density', "how much of the day is drawn, and how big", [
    el('div', { class: 'field' }, [
      el('label', { text: 'Day starts at' }),
      slider(s.firstHour, {
        min: 0, max: 12,
        format: (v) => formatTime(v * 60, s),
        onChange: (value) => store.updateSettings({ firstHour: Math.min(value, s.lastHour - 1) }),
      }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Day ends at' }),
      slider(s.lastHour, {
        min: 13, max: 24,
        format: (v) => (v >= 24 ? 'midnight' : formatTime(v * 60, s)),
        onChange: (value) => store.updateSettings({ lastHour: Math.max(value, s.firstHour + 1) }),
      }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'An hour is' }),
      slider(s.hourHeight, {
        min: 30, max: 110,
        format: (v) => `${v}px tall`,
        onChange: (value) => store.updateSettings({ hourHeight: value }),
      }),
    ]),
    el('p', { class: 'muted' }, [
      'Anything scheduled outside these hours still shows — the grid stretches to reach it.',
    ]),
  ]);

  const making = card('New events', 'what happens when you click empty grid', [
    el('div', { class: 'field' }, [
      el('label', { text: 'Default length' }),
      slider(s.defaultMinutes, {
        min: 15, max: 180, step: 15,
        format: (v) => (v >= 60 ? `${v / 60} hr${v === 60 ? '' : 's'}` : `${v} min`),
        onChange: (value) => store.updateSettings({ defaultMinutes: value }),
      }),
    ]),
    settingRow('Snap to', 'How finely dragging lands.',
      segmented(
        [5, 15, 30].map((v) => ({ value: v, label: `${v}m` })),
        s.snapMinutes,
        (value) => store.updateSettings({ snapMinutes: value }),
      )),
  ]);

  const type = card('Type', 'the faces, and how big they sit', [
    el('div', { class: 'field' }, [
      el('label', { text: 'Headings' }),
      segmented(
        [
          { value: 'fraunces', label: 'Fraunces' },
          { value: 'montserrat', label: 'Montserrat' },
          { value: 'system', label: 'System' },
        ],
        s.displayFont,
        (value) => { store.updateSettings({ displayFont: value }); applyType(store.state.settings); },
        { wide: true },
      ),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Body' }),
      segmented(
        [
          { value: 'montserrat', label: 'Montserrat' },
          { value: 'fraunces', label: 'Fraunces' },
          { value: 'system', label: 'System' },
        ],
        s.bodyFont,
        (value) => { store.updateSettings({ bodyFont: value }); applyType(store.state.settings); },
        { wide: true },
      ),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Text size' }),
      slider(Math.round(s.textScale * 100), {
        min: 85, max: 125, step: 5,
        format: (v) => `${v}%`,
        onChange: (value) => {
          store.updateSettings({ textScale: value / 100 });
          applyType(store.state.settings);
        },
      }),
    ]),
  ]);

  const paper = card('Paper', 'the stock each view is printed on', [
    ...['week', 'day', 'month', 'agenda'].map((viewId) =>
      el('div', { class: 'field' }, [
        el('label', { text: viewId }),
        segmented(
          [
            { value: 'ruled', label: 'Ruled' },
            { value: 'grid', label: 'Grid' },
            { value: 'dots', label: 'Dots' },
            { value: 'plain', label: 'Plain' },
          ],
          s.paper?.[viewId] || 'ruled',
          (value) => store.updateSettings({ paper: { ...store.state.settings.paper, [viewId]: value } }),
          { wide: true },
        ),
      ]),
    ),
  ]);

  const calendars = card('Calendars', 'colour, order, and what shows', [calendarList(rerender)]);

  const appearance = card('Appearance', 'light, dark, or follow your device', [
    segmented(
      [
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      s.theme || 'system',
      (value) => { store.updateSettings({ theme: value }); applyTheme(value); },
      { wide: true },
    ),
  ]);

  const data = card('Your data', 'saved on this device', [
    el('p', { class: 'muted', style: 'margin-bottom:14px' }, [
      'Everything lives in this browser. Nothing has been sent to Google — that comes later, ',
      'and when it does, an event will only leave when you say so.',
    ]),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn btn-secondary btn-sm', text: 'Export backup', onClick: exportData }),
      el('button', { class: 'btn btn-secondary btn-sm', text: 'Import backup', onClick: importData }),
    ]),
  ]);

  root.append(view, density, making, type, paper, calendars, appearance, data);
}

/** Stamps the theme choice on <html>; 'system' clears it so the OS decides. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}

const FACES = {
  fraunces: "'Fraunces', 'Iowan Old Style', Georgia, serif",
  montserrat: "'Montserrat', 'Helvetica Neue', Arial, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

/** Type is a token swap, so nothing else has to know it changed. */
export function applyType(settings) {
  const root = document.documentElement;
  root.style.setProperty('--font-display', FACES[settings.displayFont] || FACES.fraunces);
  root.style.setProperty('--font-body', FACES[settings.bodyFont] || FACES.montserrat);
  root.style.setProperty('--text-scale', String(settings.textScale ?? 1));
}
