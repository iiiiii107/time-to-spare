import { el, modal } from '../lib/dom.js';
import { store, CALENDAR_COLORS } from '../lib/store.js';
import { formatTime, isDraft, stamp } from '../lib/events.js';
import { minutesOf } from '../lib/layout.js';
import { formatLong } from '../lib/dates.js';

/* Making and editing an event.

   Kept to what you actually need to say — a name, when, where it lives, and a
   colour if you want one. Google's own dialog asks for a dozen things you
   almost never fill in; the rest can wait until there is a reason for it. */

function field(label, control) {
  return el('div', { class: 'field' }, [el('label', { text: label }), control]);
}

/**
 * @param {object|null} existing the event to edit, or null for a new one
 * @param {object} [seed] date and startMinutes for a new event
 */
export function eventDialog(existing, seed = {}) {
  const settings = store.state.settings;
  const date = existing?.start.slice(0, 10) || seed.date;
  const startMinutes = existing ? minutesOf(existing.start) : seed.startMinutes ?? 9 * 60;
  const endMinutes = existing
    ? minutesOf(existing.end)
    : startMinutes + (settings.defaultMinutes ?? 30);

  const title = el('input', {
    class: 'input',
    maxlength: '80',
    placeholder: 'What is it?',
    value: existing?.title || '',
  });

  const startInput = el('input', {
    class: 'input', type: 'time', step: '300',
    value: formatTime(startMinutes, { hour12: false }),
  });
  const endInput = el('input', {
    class: 'input', type: 'time', step: '300',
    value: formatTime(endMinutes, { hour12: false }),
  });
  const dateInput = el('input', { class: 'input', type: 'date', value: date });

  const allDay = el('input', { type: 'checkbox', checked: Boolean(existing?.allDay) });
  const times = el('div', { class: 'time-pair' }, [startInput, el('span', { text: '–' }), endInput]);
  const syncTimes = () => { times.style.display = allDay.checked ? 'none' : ''; };
  allDay.addEventListener('change', syncTimes);
  syncTimes();

  const calendarPick = el('select', { class: 'input' });
  for (const calendar of store.state.calendars) {
    calendarPick.append(
      el('option', {
        value: calendar.id,
        text: calendar.name,
        selected: calendar.id === (existing?.calendarId || 'local'),
      }),
    );
  }

  let color = existing?.color || null;
  const swatches = el('div', { class: 'ink-row' });
  const setColor = (value, node) => {
    color = value;
    for (const child of swatches.children) child.setAttribute('aria-pressed', 'false');
    node?.setAttribute('aria-pressed', 'true');
  };
  // "Same as the calendar" is the first option, and the default.
  const inherit = el('button', {
    type: 'button', class: 'ink-swatch inherit', 'aria-label': "The calendar's own colour",
    'aria-pressed': String(!color),
    onClick: (e) => setColor(null, e.currentTarget),
  });
  swatches.append(inherit);
  for (const value of CALENDAR_COLORS) {
    swatches.append(el('button', {
      type: 'button', class: 'ink-swatch', style: `--ink-swatch:${value}`,
      'aria-label': value, 'aria-pressed': String(color === value),
      onClick: (e) => setColor(value, e.currentTarget),
    }));
  }
  const custom = el('input', {
    type: 'color', value: color || '#2F5C96', 'aria-label': 'Any other colour',
    onInput: (e) => setColor(e.target.value, null),
  });

  const note = el('textarea', {
    class: 'textarea', rows: '2', maxlength: '400',
    placeholder: 'Anything worth remembering',
  });
  note.value = existing?.note || '';

  const body = el('div', {}, [
    field('Name', title),
    field('Day', dateInput),
    el('div', { class: 'row-between setting-row' }, [
      el('label', { class: 'checkline' }, [allDay, el('span', { text: 'All day' })]),
    ]),
    field('Time', times),
    field('Calendar', calendarPick),
    field('Colour', el('div', { class: 'ink-picker' }, [swatches, custom])),
    field('Note', note),
    existing && isDraft(existing)
      ? el('p', { class: 'muted draft-note' }, [
          'Yours only — this has not been sent to Google.',
        ])
      : null,
  ]);

  function save() {
    const day = dateInput.value || date;
    const isAllDay = allDay.checked;
    const from = isAllDay ? 0 : minutesOf(startInput.value || '09:00');
    let to = isAllDay ? 24 * 60 : minutesOf(endInput.value || '10:00');
    if (!isAllDay && to <= from) to = from + (settings.defaultMinutes ?? 30);

    const patch = {
      title: title.value.trim(),
      start: stamp(day, from),
      end: stamp(day, to),
      allDay: isAllDay,
      calendarId: calendarPick.value,
      color,
      note: note.value.trim(),
    };

    if (existing) store.updateEvent(existing.id, patch);
    else store.addEvent({ ...patch, date: day });
  }

  const actions = [{ label: 'Cancel' }];
  if (existing) {
    actions.push({
      label: 'Delete',
      onClick: () => store.deleteEvent(existing.id),
    });
  }
  actions.push({ label: existing ? 'Save' : 'Add', class: 'btn btn-primary', onClick: save });

  modal({
    title: existing ? 'Edit' : `New — ${formatLong(date)}`,
    body,
    actions,
  });
}
