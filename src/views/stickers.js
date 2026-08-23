import { el, modal, toast } from '../lib/dom.js';
import { store, CALENDAR_COLORS } from '../lib/store.js';
import { formatTime } from '../lib/events.js';
import { snapTo, timeOf } from '../lib/layout.js';

/* The sticker tray.

   A sticker is the shape of an event rather than an event: a name, a colour
   and a length, sitting in a tray until you drop it on a day. That is the
   whole point — the things you schedule again and again shouldn't have to be
   typed out again and again.

   Fifteen minutes is the default length because most of what you drop in is
   small, and because the bottom edge is right there to pull if it isn't. A
   sticker you use for something longer can be given its own length, so
   dropping it in lands finished rather than needing a drag every time.

   Single-use stickers leave the tray as they go. Those are the ones that were
   a specific thing you meant to place, not a habit. */

const DEFAULT_MINUTES = 15;

/** '45 min' / '1 hr 30'. Short enough to sit on a sticker. */
export function lengthLabel(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest}` : `${hours} hr`;
}

/* ---------- making and editing one ---------- */

export function stickerDialog(existing) {
  const label = el('input', {
    class: 'input', maxlength: '40', placeholder: 'Gym, emails, a walk…',
    value: existing?.label || '',
  });

  let color = existing?.color || CALENDAR_COLORS[0];
  const swatches = el('div', { class: 'ink-row' });
  for (const value of CALENDAR_COLORS) {
    swatches.append(el('button', {
      type: 'button', class: 'ink-swatch', style: `--ink-swatch:${value}`,
      'aria-label': value, 'aria-pressed': String(color === value),
      onClick: (event) => {
        color = value;
        for (const node of swatches.children) node.setAttribute('aria-pressed', 'false');
        event.currentTarget.setAttribute('aria-pressed', 'true');
        custom.value = value;
      },
    }));
  }
  const custom = el('input', {
    type: 'color', value: color, 'aria-label': 'Any other colour',
    onInput: (event) => {
      color = event.target.value;
      for (const node of swatches.children) node.setAttribute('aria-pressed', 'false');
    },
  });

  let minutes = existing?.minutes || DEFAULT_MINUTES;
  const readout = el('span', { class: 'stepper-value', text: lengthLabel(minutes) });
  const slider = el('input', {
    type: 'range', min: '5', max: '240', step: '5', value: String(minutes),
    'aria-label': 'How long',
    onInput: (event) => {
      minutes = Number(event.target.value);
      readout.textContent = lengthLabel(minutes);
    },
  });

  const singleUse = el('input', {
    type: 'checkbox', checked: Boolean(existing?.singleUse),
  });

  const body = el('div', {}, [
    el('div', { class: 'field' }, [el('label', { text: 'Name' }), label]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Colour' }),
      el('div', { class: 'ink-picker' }, [swatches, custom]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'How long' }),
      el('div', { class: 'slider-row' }, [slider, readout]),
      el('p', { class: 'muted', style: 'margin-top:6px; font-size:12px' }, [
        'What it lands as. You can always pull the bottom edge afterwards.',
      ]),
    ]),
    el('label', { class: 'checkline' }, [
      singleUse,
      el('span', { text: 'Use once, then take it out of the tray' }),
    ]),
  ]);

  const actions = [{ label: 'Cancel' }];
  if (existing) {
    actions.push({ label: 'Delete', onClick: () => store.deleteSticker(existing.id) });
  }
  actions.push({
    label: existing ? 'Save' : 'Add',
    class: 'btn btn-primary',
    onClick: () => {
      const name = label.value.trim();
      if (!name) return;
      const fields = { label: name, color, minutes, singleUse: singleUse.checked };
      if (existing) store.updateSticker(existing.id, fields);
      else store.addSticker(fields);
    },
  });

  modal({ title: existing ? 'Edit sticker' : 'New sticker', body, actions });
}

/* ---------- dragging one onto a day ---------- */

/**
 * Pick a sticker up and carry it to a time.
 *
 * The grid already knows how to turn a pointer into a minute — the same sum
 * the event cards use — so this reads it back off the grid rather than
 * keeping its own copy that could drift out of step.
 */
function startStickerDrag(sticker, event, source, onPlaced) {
  const settings = store.state.settings;
  const grid = document.querySelector('#view .grid-body');
  if (!grid?.__range) {
    toast('Open a day or a week to drop it on');
    return;
  }

  const range = grid.__range;
  const pxPerMinute = (settings.hourHeight ?? 52) / 60;
  const step = settings.snapMinutes ?? 15;

  source.classList.add('carrying');

  const ghost = el('div', {
    class: 'sticker-ghost',
    style: `--event:${sticker.color}`,
  }, [
    el('b', { text: sticker.label }),
    el('span', { class: 'sticker-when' }),
  ]);
  document.body.append(ghost);

  const when = ghost.querySelector('.sticker-when');
  let landing = null;

  function place(x, y) {
    ghost.style.left = `${x + 12}px`;
    ghost.style.top = `${y - 14}px`;
  }
  place(event.clientX, event.clientY);

  function onMove(moveEvent) {
    place(moveEvent.clientX, moveEvent.clientY);

    const column = document
      .elementsFromPoint(moveEvent.clientX, moveEvent.clientY)
      .find((node) => node.classList?.contains('day-col'));

    for (const node of document.querySelectorAll('.day-col.taking')) {
      node.classList.remove('taking');
    }

    if (!column) {
      landing = null;
      when.textContent = '';
      ghost.classList.remove('landing');
      return;
    }

    column.classList.add('taking');
    const minutes = snapTo(
      range.from + (moveEvent.clientY - column.getBoundingClientRect().top) / pxPerMinute,
      step,
    );
    landing = { date: column.dataset.date, startMinutes: Math.max(0, Math.min(minutes, 24 * 60 - 5)) };
    when.textContent = `${formatTime(landing.startMinutes, settings)} · ${lengthLabel(sticker.minutes || DEFAULT_MINUTES)}`;
    ghost.classList.add('landing');
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    for (const node of document.querySelectorAll('.day-col.taking')) {
      node.classList.remove('taking');
    }
    ghost.remove();
    source.classList.remove('carrying');

    if (!landing) return;
    store.placeSticker(sticker, landing.date, landing.startMinutes);
    toast(`${sticker.label} — ${timeOf(landing.startMinutes)}`);
    onPlaced?.();
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/* ---------- the tray ---------- */

/**
 * @param {object} options
 * @param {boolean} options.droppable whether there is a grid to drop onto
 * @param {() => void} [options.onPlaced]
 */
export function stickerTray({ droppable, onPlaced } = {}) {
  const stickers = store.state.stickers || [];

  const tray = el('div', { class: 'sticker-tray' }, [
    el('span', { class: 'tray-label', text: 'stickers' }),
  ]);

  for (const sticker of stickers) {
    const minutes = sticker.minutes || DEFAULT_MINUTES;
    const node = el('div', {
      class: `sticker${sticker.singleUse ? ' once' : ''}`,
      style: `--event:${sticker.color}`,
      role: 'button',
      tabindex: '0',
      title: droppable
        ? `${sticker.label} · ${lengthLabel(minutes)} — drag onto a day. Double-click to change it.`
        : `${sticker.label} · ${lengthLabel(minutes)} — open a day or week to drop it on.`,
    }, [
      el('b', { text: sticker.label }),
      el('span', { class: 'sticker-len', text: lengthLabel(minutes) }),
    ]);

    node.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!droppable) return;
      startStickerDrag(sticker, event, node, onPlaced);
    });
    node.addEventListener('dblclick', () => stickerDialog(sticker));
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        stickerDialog(sticker);
      }
    });

    tray.append(node);
  }

  tray.append(
    el('button', {
      class: 'sticker-new',
      text: stickers.length ? '+' : '+ Sticker',
      'aria-label': 'New sticker',
      title: 'New sticker',
      onClick: () => stickerDialog(null),
    }),
  );

  if (stickers.length && droppable) {
    tray.append(el('span', { class: 'tray-hint', text: 'drag one onto a day' }));
  }

  return tray;
}
