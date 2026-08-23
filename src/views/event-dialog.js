import { el, modal } from '../lib/dom.js';
import { store, CALENDAR_COLORS } from '../lib/store.js';
import { formatTime, isDraft, stamp } from '../lib/events.js';
import { minutesOf } from '../lib/layout.js';
import { describeRule } from '../lib/recur.js';
import { addDays, DAY_SHORT, formatLong, fromISO } from '../lib/dates.js';

/* Making and editing an event.

   Kept to what you actually need to say — a name, when, whether it repeats,
   where it lives, and a colour if you want one. Google's own dialog asks for a
   dozen things you almost never fill in.

   Editing one of a series asks the question that matters: this one, or all of
   them? Changing just this one writes an exception against the date the rule
   produced, so the rest of the series carries on untouched. */

function lowerFirst(text) {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

function field(label, control) {
  return el('div', { class: 'field' }, [el('label', { text: label }), control]);
}

/** The repeat controls, which fold away entirely when it doesn't repeat. */
function repeatSection(initial, startDate, weekStartsOn) {
  let rule = initial ? { ...initial } : null;

  const summary = el('span', { class: 'repeat-summary' });
  const detail = el('div', { class: 'repeat-detail' });

  const freqPick = el('select', { class: 'input' }, [
    el('option', { value: 'none', text: 'Does not repeat' }),
    el('option', { value: 'daily', text: 'Daily' }),
    el('option', { value: 'weekly', text: 'Weekly' }),
    el('option', { value: 'monthly', text: 'Monthly' }),
    el('option', { value: 'yearly', text: 'Yearly' }),
  ]);
  freqPick.value = rule?.freq || 'none';

  const interval = el('input', {
    class: 'input interval', type: 'number', min: '1', max: '99',
    value: String(rule?.interval || 1),
    'aria-label': 'How often',
  });

  // Which weekdays, for a weekly rule. Ordered from your own week start.
  const dayOrder = [0, 1, 2, 3, 4, 5, 6].sort(
    (a, b) => ((a - weekStartsOn + 7) % 7) - ((b - weekStartsOn + 7) % 7),
  );
  const byDay = new Set(rule?.byDay || [fromISO(startDate).getDay()]);
  const dayRow = el('div', { class: 'day-toggles' }, dayOrder.map((index) =>
    el('button', {
      type: 'button', class: 'day-toggle', text: DAY_SHORT[index],
      'aria-label': DAY_SHORT[index],
      'aria-pressed': String(byDay.has(index)),
      onClick: (event) => {
        if (byDay.has(index)) byDay.delete(index);
        else byDay.add(index);
        // A weekly rule with no days named has nothing to land on.
        if (!byDay.size) byDay.add(index);
        for (const node of dayRow.children) {
          node.setAttribute('aria-pressed', String(byDay.has(dayOrder[[...dayRow.children].indexOf(node)])));
        }
        sync();
      },
    }),
  ));

  const endPick = el('select', { class: 'input' }, [
    el('option', { value: 'never', text: 'Goes on forever' }),
    el('option', { value: 'until', text: 'Until a date' }),
    el('option', { value: 'count', text: 'A number of times' }),
  ]);
  endPick.value = rule?.until ? 'until' : rule?.count ? 'count' : 'never';

  const untilInput = el('input', {
    class: 'input', type: 'date',
    value: rule?.until || addDays(startDate, 90),
    'aria-label': 'Repeat until',
  });
  const countInput = el('input', {
    class: 'input interval', type: 'number', min: '1', max: '999',
    value: String(rule?.count || 10),
    'aria-label': 'How many times',
  });

  function read() {
    if (freqPick.value === 'none') return null;
    const next = {
      freq: freqPick.value,
      interval: Math.max(1, Number(interval.value) || 1),
      weekStartsOn,
    };
    if (freqPick.value === 'weekly') next.byDay = [...byDay].sort();
    if (endPick.value === 'until') next.until = untilInput.value;
    if (endPick.value === 'count') next.count = Math.max(1, Number(countInput.value) || 1);
    return next;
  }

  function sync() {
    rule = read();
    const repeating = Boolean(rule);
    detail.style.display = repeating ? '' : 'none';
    dayRow.style.display = rule?.freq === 'weekly' ? '' : 'none';
    untilInput.style.display = endPick.value === 'until' ? '' : 'none';
    countInput.style.display = endPick.value === 'count' ? '' : 'none';
    summary.textContent = repeating ? describeRule(rule, { weekStartsOn }) : '';
  }

  for (const control of [freqPick, interval, endPick, untilInput, countInput]) {
    control.addEventListener('change', sync);
    control.addEventListener('input', sync);
  }

  detail.append(
    el('div', { class: 'repeat-line' }, [el('span', { text: 'every' }), interval, dayRow]),
    el('div', { class: 'repeat-line' }, [endPick, untilInput, countInput]),
  );
  sync();

  return {
    node: el('div', { class: 'repeat' }, [freqPick, detail, summary]),
    read,
  };
}

/**
 * @param {object|null} existing the event or occurrence being edited
 * @param {object} [seed] date and startMinutes for a new one
 */
export function eventDialog(existing, seed = {}) {
  const settings = store.state.settings;
  const weekStartsOn = settings.weekStartsOn ?? 1;

  // An occurrence is a copy; the thing that gets written to is its master.
  const master = existing ? store.eventById(existing.id) : null;
  const isOccurrence = Boolean(existing?.isOccurrence);

  const date = existing?.start.slice(0, 10) || seed.date;
  const startMinutes = existing ? minutesOf(existing.start) : seed.startMinutes ?? 9 * 60;
  const endMinutes = existing
    ? minutesOf(existing.end)
    : startMinutes + (settings.defaultMinutes ?? 30);

  const title = el('input', {
    class: 'input', maxlength: '80', placeholder: 'What is it?',
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
  const endDateInput = el('input', {
    class: 'input', type: 'date',
    value: existing?.end.slice(0, 10) || date,
    'aria-label': 'Last day',
  });

  const allDay = el('input', { type: 'checkbox', checked: Boolean(existing?.allDay) });
  const times = el('div', { class: 'time-pair' }, [startInput, el('span', { text: '–' }), endInput]);
  const endDayRow = el('div', { class: 'field' }, [
    el('label', { text: 'Last day' }), endDateInput,
  ]);
  const syncTimes = () => {
    times.style.display = allDay.checked ? 'none' : '';
    endDayRow.style.display = allDay.checked ? '' : 'none';
  };
  allDay.addEventListener('change', syncTimes);
  syncTimes();

  const calendarPick = el('select', { class: 'input' });
  for (const calendar of store.state.calendars) {
    calendarPick.append(el('option', {
      value: calendar.id, text: calendar.name,
      selected: calendar.id === (existing?.calendarId || 'local'),
    }));
  }

  let color = existing?.color || null;
  const swatches = el('div', { class: 'ink-row' });
  const setColor = (value, node) => {
    color = value;
    for (const child of swatches.children) child.setAttribute('aria-pressed', 'false');
    node?.setAttribute('aria-pressed', 'true');
  };
  swatches.append(el('button', {
    type: 'button', class: 'ink-swatch inherit', 'aria-label': "The calendar's own colour",
    'aria-pressed': String(!color),
    onClick: (e) => setColor(null, e.currentTarget),
  }));
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

  /* The repeat rule belongs to the series, so editing one occurrence doesn't
     offer it — changing the rhythm is a change to all of them by definition. */
  const repeat = isOccurrence
    ? null
    : repeatSection(master?.recur || null, date, weekStartsOn);

  const body = el('div', {}, [
    isOccurrence
      ? el('p', { class: 'muted series-note' }, [
          // Lower-case the first word only — the weekday names keep their caps.
          'One of ', el('b', { text: lowerFirst(describeRule(master?.recur, { weekStartsOn })) }),
          '. Saving changes this one; the rest carry on.',
        ])
      : null,
    field('Name', title),
    field('Day', dateInput),
    el('div', { class: 'row-between setting-row' }, [
      el('label', { class: 'checkline' }, [allDay, el('span', { text: 'All day' })]),
    ]),
    endDayRow,
    field('Time', times),
    repeat ? field('Repeats', repeat.node) : null,
    field('Calendar', calendarPick),
    field('Colour', el('div', { class: 'ink-picker' }, [swatches, custom])),
    field('Note', note),
    existing && isDraft(existing)
      ? el('p', { class: 'muted draft-note' }, ['Yours only — this has not been sent to Google.'])
      : null,
  ]);

  /** What the form says, as event fields. */
  function fields() {
    const day = dateInput.value || date;
    const on = allDay.checked;
    const from = on ? 0 : minutesOf(startInput.value || '09:00');
    let to = on ? 24 * 60 - 1 : minutesOf(endInput.value || '10:00');
    // A same-day event that ends before it starts is a typo, not a rule.
    if (!on && to <= from) to = from + (settings.defaultMinutes ?? 30);

    const lastDay = on ? (endDateInput.value || day) : day;

    return {
      title: title.value.trim(),
      start: stamp(day, from),
      end: `${lastDay >= day ? lastDay : day}T${stamp(day, to).slice(11)}`,
      allDay: on,
      calendarId: calendarPick.value,
      color,
      note: note.value.trim(),
    };
  }

  function save() {
    const patch = fields();

    if (isOccurrence) {
      // Only this one. Filed under the date the rule produced, so the series
      // can still find it after it has been moved.
      store.overrideOccurrence(existing.seriesId, existing.occurrenceDate, patch);
      return;
    }
    if (master) {
      store.updateSeries(master.id, { ...patch, recur: repeat?.read() ?? null });
      return;
    }
    store.addEvent({ ...patch, date: dateInput.value || date, recur: repeat?.read() ?? null });
  }

  const actions = [{ label: 'Cancel' }];

  if (isOccurrence) {
    actions.push({
      label: 'Delete this one',
      onClick: () => store.cancelOccurrence(existing.seriesId, existing.occurrenceDate),
    });
    actions.push({
      label: 'Delete all',
      onClick: () => {
        if (confirm('Delete every occurrence of this event?')) {
          store.deleteEvent(existing.seriesId);
        }
      },
    });
  } else if (existing) {
    actions.push({ label: 'Delete', onClick: () => store.deleteEvent(existing.id) });
  }

  actions.push({ label: existing ? 'Save' : 'Add', class: 'btn btn-primary', onClick: save });

  modal({
    title: existing ? (isOccurrence ? 'Edit this one' : 'Edit') : `New — ${formatLong(date)}`,
    body,
    actions,
  });
}
