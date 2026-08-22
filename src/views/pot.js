import { el, svg } from '../lib/dom.js';
import { TOOLS, TOOL_ORDER, toolWith } from '../lib/tools.js';

/* The pen pot: a line-art cup with the tools standing in it, drawn in the
   same simple outlined style as the reference. Picking one lifts it out of
   the cup; the cup is drawn over the tools so they read as sitting inside.

   The outlines are deliberately fine — heavy strokes at this size read as a
   cartoon rather than as the pen-and-ink drawing the rest of the app is
   after. */

/** Outline weights, kept together so the whole drawing stays in proportion. */
const STROKE = { cup: 2.1, body: 1.5, detail: 1.3, fine: 1.2 };

/** One implement, drawn side-on. `ink` colours the tools you can re-colour. */
function toolArt(id, ink) {
  const line = 'var(--ink)';

  if (id === 'pen') {
    return svg('g', {}, [
      svg('path', {
        d: 'M11 14 L19 14 L19 62 L11 62 Z',
        fill: 'var(--paper)', stroke: line, 'stroke-width': String(STROKE.body),
        'stroke-linejoin': 'round',
      }),
      svg('path', { d: 'M11 24 H19', stroke: line, 'stroke-width': String(STROKE.detail) }),
      svg('path', {
        d: 'M11 14 L15 5 L19 14 Z',
        fill: 'var(--ink-blue)', stroke: line, 'stroke-width': String(STROKE.body),
        'stroke-linejoin': 'round',
      }),
    ]);
  }

  if (id === 'highlighter') {
    return svg('g', {}, [
      svg('rect', {
        x: '9', y: '18', width: '13', height: '44', rx: '2',
        fill: ink, stroke: line, 'stroke-width': String(STROKE.body),
      }),
      svg('path', {
        d: 'M10 18 L12 7 H19 L21 18 Z',
        fill: 'var(--paper)', stroke: line, 'stroke-width': String(STROKE.body),
        'stroke-linejoin': 'round',
      }),
      svg('path', { d: 'M9 28 H22', stroke: line, 'stroke-width': String(STROKE.detail) }),
    ]);
  }

  if (id === 'crayon') {
    return svg('g', {}, [
      svg('path', {
        d: 'M10 18 L21 18 L21 62 L10 62 Z',
        fill: ink, stroke: line, 'stroke-width': String(STROKE.body),
        'stroke-linejoin': 'round',
      }),
      svg('path', {
        d: 'M10 18 L15.5 7 L21 18 Z',
        fill: 'var(--paper)', stroke: line, 'stroke-width': String(STROKE.body),
        'stroke-linejoin': 'round',
      }),
      svg('path', { d: 'M10 30 H21 M10 38 H21', stroke: line, 'stroke-width': String(STROKE.fine) }),
    ]);
  }

  // eraser — a stubby block, standing like the ruler in the reference
  return svg('g', {}, [
    svg('rect', {
      x: '8', y: '20', width: '16', height: '42', rx: '2.5',
      fill: 'var(--paper)', stroke: line, 'stroke-width': String(STROKE.body),
    }),
    svg('path', { d: 'M8 33 H24', stroke: line, 'stroke-width': String(STROKE.detail) }),
    svg('path', {
      d: 'M9.2 21 H22.8 A1.4 1.4 0 0 1 24 22.4 V33 H8 V22.4 A1.4 1.4 0 0 1 9.2 21 Z',
      fill: 'var(--rust)', stroke: line, 'stroke-width': String(STROKE.body),
      'stroke-linejoin': 'round',
    }),
  ]);
}

/**
 * A tool standing in the cup. You pull it out and drag it across a task —
 * there's no separate "held" tool that appears elsewhere; the thing you drag
 * is the thing in the pot.
 *
 * Hovering says what the tool does, because "highlighter" doesn't tell you
 * that it deliberately leaves the task undone.
 */
function toolButton(id, { onDragStart, onAdjust, styles, index }) {
  const tool = toolWith(id, styles?.[id]);

  const node = el('div', {
    class: `pot-tool${tool.adjustable ? ' pot-tool-adjustable' : ''}`,
    role: 'button',
    tabindex: '0',
    'aria-label': `${tool.label}. ${tool.hint}`,
    dataset: { tool: id, slot: String(index) },
  }, [
    svg('svg', { viewBox: '0 0 32 64', fill: 'none', 'aria-hidden': 'true' }, [
      toolArt(id, tool.ink),
    ]),
    el('span', { class: 'pot-tip', role: 'tooltip' }, [
      el('b', { text: tool.label }),
      el('span', { text: tool.hint }),
      tool.adjustable
        ? el('i', { text: 'Double-click to change its colour and width' })
        : null,
    ]),
  ]);

  node.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    onDragStart(id, event, node);
  });

  if (tool.adjustable && onAdjust) {
    node.addEventListener('dblclick', (event) => {
      event.preventDefault();
      onAdjust(id);
    });
    // Keyboard users get there too — drag isn't available to them anyway.
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onAdjust(id);
      }
    });
  }

  return node;
}

/**
 * Only the front wall of the cup. Drawing the far rim as well made it read as
 * a closed, empty pot with the tools stuck behind it; with just the near rim
 * the tools rise out of it the way they actually would.
 */
function cupArt() {
  return svg('svg', {
    class: 'pot-cup', viewBox: '0 0 120 60', fill: 'none', 'aria-hidden': 'true',
  }, [
    svg('path', {
      d: [
        'M9 8',
        'C9 17 32 22 60 22',      // near rim, dipping through the middle
        'C88 22 111 17 111 8',
        'L111 42',
        'C111 51 88 56 60 56',    // rounded base
        'C32 56 9 51 9 42',
        'Z',
      ].join(' '),
      fill: 'var(--paper)', stroke: 'var(--ink)', 'stroke-width': String(STROKE.cup),
      'stroke-linejoin': 'round',
    }),
  ]);
}

/** The tool currently in hand, drawn large for dragging across a task. */
export function toolSvg(id, ink) {
  return svg('svg', { viewBox: '0 0 32 64', fill: 'none', 'aria-hidden': 'true' }, [
    toolArt(id, ink || TOOLS[id].ink),
  ]);
}

/**
 * @param {object} options
 * @param {(id: string, event: PointerEvent, node: HTMLElement) => void} options.onDragStart
 * @param {(id: string) => void} [options.onAdjust] double-click on an adjustable tool
 * @param {object} [options.styles] per-tool colour and width overrides
 * @param {boolean} [options.compact] phone layout — a flat row instead of a cup
 */
export function penPot({ onDragStart, onAdjust, styles, compact = false }) {
  const buttons = TOOL_ORDER.map((id, index) =>
    toolButton(id, { onDragStart, onAdjust, styles, index }),
  );

  if (compact) {
    return el('div', { class: 'pot pot-compact', 'aria-label': 'Tools' }, buttons);
  }

  return el('div', { class: 'pot-shell' }, [
    el('div', { class: 'pot-stage' }, [
      el('div', { class: 'pot', 'aria-label': 'Tools' }, buttons),
      cupArt(),
    ]),
  ]);
}
