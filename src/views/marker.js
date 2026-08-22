import { el, svg } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { pathFromPoints, simplify, toolWith } from '../lib/tools.js';
import { toolSvg } from './pot.js';

/* Dragging a tool across a surface.

   Written once. In the habit tracker this logic ended up copied into two
   views that then drifted apart; here every surface that can be marked up
   calls this, and the surface only has to say where its canvas is.

   Two things worth keeping in mind, both learned the hard way:

   - The store is not written to until the pointer comes up. Saving mid-drag
     re-renders the view, which pulls the canvas out from under the stroke.
   - The nib is offset from the pointer, because the tool is drawn turned 150°
     into a writing grip. The offsets below match that angle; change one and
     you have to change the other. */

/** Where the nib sits relative to the pointer, given the 150° grip. */
export const NIB_OFFSET_X = 14;
export const NIB_OFFSET_Y = 26;

/** Where the tool is held, so the ghost sits under the cursor properly. */
const GRAB_X = 11;
const GRAB_Y = 20;

/**
 * @param {object} options
 * @param {string} options.toolId
 * @param {PointerEvent} options.event the pointerdown that started it
 * @param {HTMLElement} options.source the tool in the pot
 * @param {() => HTMLElement|null} options.canvas the element being drawn on
 * @param {string} options.markKey where finished marks are stored
 * @param {(nib: {x: number, y: number}) => void} [options.onErase] extra
 *   erasing beyond the marks themselves — stickers, cards, whatever the
 *   surface has. Called for every move while the eraser is down.
 * @param {() => void} [options.onErased] called on release if onErase did
 *   anything, so the surface can commit its own removals in one save.
 */
export function startToolDrag({
  toolId, event, source, canvas, markKey, onErase, onErased,
}) {
  const tool = toolWith(toolId, store.state.settings.toolStyles?.[toolId]);
  const surface = canvas();
  const layer = surface?.querySelector('.ink');
  if (!surface || !layer) return;

  source.classList.add('lifted');

  const ghost = el('div', { class: 'hand-tool', dataset: { tool: toolId } }, [
    toolSvg(toolId, tool.ink),
  ]);
  document.body.append(ghost);

  const place = (x, y) => {
    ghost.style.left = `${x - GRAB_X}px`;
    ghost.style.top = `${y - GRAB_Y}px`;
  };
  place(event.clientX, event.clientY);

  const points = [];
  let path = null;
  let wiped = false;
  let erasedSomething = false;

  function onMove(moveEvent) {
    place(moveEvent.clientX, moveEvent.clientY);

    const nibX = moveEvent.clientX + NIB_OFFSET_X;
    const nibY = moveEvent.clientY + NIB_OFFSET_Y;
    const box = surface.getBoundingClientRect();
    const inside =
      nibX >= box.left && nibX <= box.right && nibY >= box.top && nibY <= box.bottom;

    if (tool.erases) {
      if (onErase?.({ x: nibX, y: nibY })) erasedSomething = true;
      if (inside && layer.childElementCount) {
        layer.replaceChildren();
        wiped = true;
      }
      return;
    }

    if (!inside) return;

    if (!path) {
      path = svg('path', {
        fill: 'none',
        stroke: tool.ink || 'var(--ink)',
        'stroke-width': String(tool.width),
        'stroke-opacity': String(tool.opacity),
        'stroke-linecap': tool.id === 'highlighter' ? 'butt' : 'round',
        'stroke-linejoin': 'round',
      });
      layer.append(path);
    }
    points.push({ x: nibX - box.left, y: nibY - box.top });
    path.setAttribute('d', pathFromPoints(simplify(points)));
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);

    ghost.classList.add('returning');
    setTimeout(() => ghost.remove(), 180);
    source.classList.remove('lifted');

    if (tool.erases) {
      if (wiped) store.clearMarks(markKey);
      if (erasedSomething) onErased?.();
      return;
    }

    if (points.length < 2 || !path) return;
    store.addMarks(markKey, [{
      d: path.getAttribute('d'),
      ink: tool.ink || 'var(--ink)',
      width: tool.width,
      opacity: tool.opacity,
      cap: tool.id === 'highlighter' ? 'butt' : 'round',
    }]);
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/** The layer marks are drawn into, with everything already saved redrawn. */
export function inkLayer(markKey) {
  const layer = svg('svg', { class: 'ink', 'aria-hidden': 'true' });
  for (const mark of store.marksFor(markKey)) {
    layer.append(svg('path', {
      d: mark.d,
      fill: 'none',
      stroke: mark.ink,
      'stroke-width': String(mark.width),
      'stroke-opacity': String(mark.opacity),
      'stroke-linecap': mark.cap || 'round',
      'stroke-linejoin': 'round',
    }));
  }
  return layer;
}
