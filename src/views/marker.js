import { capturePointer, el, svg } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { pathFromPoints, simplify, toolWith } from '../lib/tools.js';
import { toolSvg } from './pot.js';

/* Dragging a tool across a surface.

   Written once. In the habit tracker this logic ended up copied into two
   views that then drifted apart; here every surface that can be marked up
   calls this, and the surface only has to say where its canvas is.

   Holding the space bar lifts the nib. The tool stays in your hand and keeps
   following the pointer, but it stops leaving a line — so you can cross the
   page to reach the next thing without drawing all the way there. Letting go
   puts it back down and starts a fresh stroke.

   Two things worth keeping in mind, both learned the hard way:

   - The store is not written to until the pointer comes up. Saving mid-drag
     re-renders the view, which pulls the canvas out from under the stroke.
   - The nib is offset from the pointer, because the tool is drawn turned 150°
     into a writing grip. The offsets below match that angle; change one and
     you have to change the other. */

/* ---------- the tool in your hand ----------

   A phone has no space bar, so the same idea arrives as a mode: tap a tool
   and it is in your hand, draw with a finger as often as you like, tap it
   again to put it down. Nothing else on the page answers while a tool is
   armed — a tap on the grid draws instead of making an event, which is the
   whole point of having picked something up.

   Dragging a tool straight out of the pot still works. A press that never
   moves is a tap and arms; a press that travels is a drag. */

let armed = null;
const armedWatchers = new Set();

/** The tool currently in hand, or null. */
export function armedTool() {
  return armed;
}

export function setArmed(toolId) {
  armed = toolId;
  armedWatchers.forEach((fn) => fn(armed));
}

export function toggleArmed(toolId) {
  setArmed(armed === toolId ? null : toolId);
}

export function onArmedChange(fn) {
  armedWatchers.add(fn);
  return () => armedWatchers.delete(fn);
}

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

  /* Strokes, plural: lifting the nib ends one and the next press starts
     another, so a single drag can leave several separate marks. */
  const strokes = [];
  let points = [];
  let path = null;
  let wiped = false;
  let erasedSomething = false;
  let lifted = false;

  /* A press that never travels is a tap, and a tap picks the tool up rather
     than drawing a dot nobody asked for. */
  const from = { x: event.clientX, y: event.clientY };
  let travelled = false;

  /** End the current stroke without ending the drag. */
  function liftNib() {
    if (lifted) return;
    lifted = true;
    ghost.classList.add('lifted-nib');
    if (points.length >= 2 && path) strokes.push(path);
    points = [];
    path = null;
  }

  function lowerNib() {
    lifted = false;
    ghost.classList.remove('lifted-nib');
  }

  function onKeyDown(keyEvent) {
    if (keyEvent.code !== 'Space' && keyEvent.key !== ' ') return;
    // Stop the page scrolling under the drag.
    keyEvent.preventDefault();
    liftNib();
  }

  function onKeyUp(keyEvent) {
    if (keyEvent.code !== 'Space' && keyEvent.key !== ' ') return;
    keyEvent.preventDefault();
    lowerNib();
  }

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

    // Nib up: the tool still follows the pointer, it just isn't writing.
    if (lifted) return;

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
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', liftNib);

    ghost.classList.add('returning');
    setTimeout(() => ghost.remove(), 180);
    source.classList.remove('lifted');

    // Never went anywhere: you tapped it, so it goes in your hand.
    if (!travelled) {
      toggleArmed(toolId);
      return;
    }

    if (tool.erases) {
      if (wiped) store.clearMarks(markKey);
      if (erasedSomething) onErased?.();
      return;
    }

    if (points.length >= 2 && path) strokes.push(path);
    if (!strokes.length) return;

    store.addMarks(markKey, strokes.map((stroke) => ({
      d: stroke.getAttribute('d'),
      ink: tool.ink || 'var(--ink)',
      width: tool.width,
      opacity: tool.opacity,
      cap: tool.id === 'highlighter' ? 'butt' : 'round',
    })));
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  // Losing the window while space is held would otherwise leave the nib down.
  window.addEventListener('blur', liftNib);
}


/* ---------- drawing with the tool already in hand ---------- */

/**
 * Wire a surface up so that, while a tool is armed, pressing on it draws.
 *
 * Each press-drag-release is one stroke, saved on release — the same rule as
 * dragging from the pot, and for the same reason: a save re-renders the view
 * and would pull the surface out from under the next stroke.
 *
 * The nib is under the finger here, not offset. The offset exists because a
 * dragged tool is drawn in your hand and has to write from its tip; there is
 * no drawn tool in this mode, so writing anywhere but exactly under the touch
 * would just feel broken.
 *
 * @param {object} options
 * @param {HTMLElement} options.canvas the element holding the .ink layer
 * @param {string} options.markKey where finished marks are stored
 * @param {(nib: {x: number, y: number}) => boolean} [options.onErase]
 * @param {() => void} [options.onErased]
 */
export function armedDrawing({ canvas, markKey, onErase, onErased }) {
  if (!armed || !canvas) return;
  const layer = canvas.querySelector('.ink');
  if (!layer) return;

  const tool = toolWith(armed, store.state.settings.toolStyles?.[armed]);
  canvas.classList.add('armed');

  canvas.addEventListener('pointerdown', (event) => {
    // Still armed? The mode can be dropped between renders.
    if (!armed) return;
    event.preventDefault();
    event.stopPropagation();

    capturePointer(canvas, event.pointerId);

    const box = () => canvas.getBoundingClientRect();
    const points = [];
    let path = null;
    let wiped = false;
    let erasedSomething = false;

    const at = (e) => {
      const b = box();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };

    function draw(e) {
      if (tool.erases) {
        if (onErase?.({ x: e.clientX, y: e.clientY })) erasedSomething = true;
        if (layer.childElementCount) {
          layer.replaceChildren();
          wiped = true;
        }
        return;
      }
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
      points.push(at(e));
      path.setAttribute('d', pathFromPoints(simplify(points)));
    }

    draw(event);

    function onMove(moveEvent) {
      moveEvent.preventDefault();
      draw(moveEvent);
    }

    function onUp() {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);

      if (tool.erases) {
        if (wiped) store.clearMarks(markKey);
        if (erasedSomething) onErased?.();
        return;
      }
      if (points.length < 2 || !path) {
        path?.remove();
        return;
      }
      store.addMarks(markKey, [{
        d: path.getAttribute('d'),
        ink: tool.ink || 'var(--ink)',
        width: tool.width,
        opacity: tool.opacity,
        cap: tool.id === 'highlighter' ? 'butt' : 'round',
      }]);
    }

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
  });
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
