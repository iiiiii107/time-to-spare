import { el, modal, svg } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { TOOLS, TOOL_LIMITS } from '../lib/tools.js';

/* Setting up the highlighter and the crayon.

   Reached by double-clicking either tool, wherever the pot is — beside the
   task list or over the notepad. One setting per tool, shared by both, so a
   crayon you've made green is green everywhere.

   Marks already made keep what they were drawn with. Changing a tool changes
   the next stroke, not the last one. */

/** A few ready-made inks, so picking one is usually a single click. */
const INKS = [
  '#EFD87B', '#E8C05F', '#B8714C', '#C58E5C',
  '#7E9A70', '#9CB88C', '#7C93B8', '#5B7291',
  '#8C6A5A', '#302E28',
];

export function toolStyleDialog(id) {
  const tool = TOOLS[id];
  const limits = TOOL_LIMITS[id];
  if (!tool?.adjustable || !limits) return;

  const saved = { ...store.state.settings.toolStyles?.[id] };
  let ink = saved.ink || tool.ink;
  let width = Number(saved.width) || tool.width;

  // A stroke of the actual tool, so you can see the setting rather than read it.
  const preview = svg('svg', {
    class: 'tool-preview', viewBox: '0 0 220 44', 'aria-hidden': 'true',
  });
  const stroke = svg('path', {
    d: 'M 12 30 Q 60 14 108 26 T 208 18',
    fill: 'none',
    'stroke-linecap': id === 'highlighter' ? 'butt' : 'round',
  });
  preview.append(stroke);

  function draw() {
    stroke.setAttribute('stroke', ink);
    stroke.setAttribute('stroke-width', String(width));
    stroke.setAttribute('stroke-opacity', String(tool.opacity));
  }
  draw();

  const swatches = el('div', { class: 'ink-row' });
  const custom = el('input', {
    type: 'color',
    value: ink,
    'aria-label': 'Any other colour',
    onInput: (event) => {
      ink = event.target.value;
      for (const node of swatches.children) node.setAttribute('aria-pressed', 'false');
      draw();
    },
  });

  for (const value of INKS) {
    swatches.append(
      el('button', {
        type: 'button',
        class: 'ink-swatch',
        style: `--ink-swatch:${value}`,
        'aria-label': value,
        'aria-pressed': String(value.toLowerCase() === String(ink).toLowerCase()),
        onClick: (event) => {
          ink = value;
          for (const node of swatches.children) node.setAttribute('aria-pressed', 'false');
          event.currentTarget.setAttribute('aria-pressed', 'true');
          custom.value = value;
          draw();
        },
      }),
    );
  }

  const readout = el('span', { class: 'stepper-value', text: `${width}px` });
  const slider = el('input', {
    type: 'range',
    min: String(limits.min),
    max: String(limits.max),
    step: '0.5',
    value: String(width),
    'aria-label': 'Width',
    onInput: (event) => {
      width = Number(event.target.value);
      readout.textContent = `${width}px`;
      draw();
    },
  });

  const put = (styles) =>
    store.updateSettings({
      toolStyles: { ...store.state.settings.toolStyles, [id]: styles },
    });

  modal({
    title: tool.label,
    body: el('div', {}, [
      el('p', { class: 'muted', style: 'margin-bottom:14px', text: tool.hint }),
      preview,
      el('div', { class: 'field' }, [
        el('label', { text: 'Colour' }),
        el('div', { class: 'ink-picker' }, [swatches, custom]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Width' }),
        el('div', { class: 'slider-row' }, [slider, readout]),
      ]),
    ]),
    actions: [
      { label: 'Reset', onClick: () => put({ ink: tool.ink, width: tool.width }) },
      { label: 'Save', class: 'btn btn-primary', onClick: () => put({ ink, width }) },
    ],
  });
}
