/* The pen pot.

   Four tools, and none of them change what is in your calendar. Pen,
   highlighter and crayon leave colour on the paper; the eraser takes it off
   again. Marking a week up is a way of saying what matters to you, not a way
   of editing what is booked — that is what the cards themselves are for.

   (In the habit tracker the pen does one extra thing: crossing a task off
   completes it. There is nothing here to complete, and the tooltip says so.)

   Marks are drawn on the grid, in the grid's own coordinate space, and stored
   against the period you drew them on. */

export const TOOLS = {
  pen: {
    id: 'pen',
    label: 'Pen',
    hint: 'Draw on the week. It marks the paper — nothing in your calendar moves.',
    /** null means "use the task's own colour". */
    ink: null,
    width: 2.2,
    opacity: 1,
    completes: false,
  },
  highlighter: {
    id: 'highlighter',
    label: 'Highlighter',
    hint: 'Colour over a stretch of the week to pick it out.',
    ink: '#EFD87B',
    width: 15,
    opacity: 0.4,
    completes: false,
    adjustable: true,
  },
  crayon: {
    id: 'crayon',
    label: 'Crayon',
    hint: 'Scribble on the week — arrows, circles, whatever helps.',
    ink: '#B8714C',
    width: 5.5,
    opacity: 0.8,
    completes: false,
    adjustable: true,
  },
  eraser: {
    id: 'eraser',
    label: 'Eraser',
    hint: 'Rub marks off. It leaves your events alone.',
    ink: null,
    width: 0,
    opacity: 1,
    completes: false,
    erases: true,
  },
};

export const TOOL_ORDER = ['pen', 'highlighter', 'crayon', 'eraser'];

/** How far the adjustable tools can be taken, per tool. */
export const TOOL_LIMITS = {
  highlighter: { min: 6, max: 30 },
  crayon: { min: 2, max: 16 },
};

/**
 * A tool as it is actually set right now. The highlighter and the crayon can
 * be given a colour and a width of your own; everything else comes from the
 * definitions above.
 * @param {string} id
 * @param {{ink?: string, width?: number}} [overrides]
 */
export function toolWith(id, overrides) {
  const base = TOOLS[id];
  if (!base?.adjustable || !overrides) return base;
  return {
    ...base,
    ink: overrides.ink || base.ink,
    width: Number(overrides.width) || base.width,
  };
}

/**
 * Turn a run of pointer positions into a smooth path.
 * Midpoints between samples become the curve's on-path points, which keeps a
 * fast scribble from looking like a chain of straight segments.
 */
export function pathFromPoints(points) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

/**
 * Thin the samples so a slow drag doesn't store hundreds of near-identical
 * points. Anything closer than `minGap` to the previous keeper is dropped.
 */
export function simplify(points, minGap = 3) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (const point of points.slice(1)) {
    const last = out[out.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= minGap) out.push(point);
  }
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Marks are stored in the row's own pixel space, so a resized window would
 * put them in the wrong place. Storing the row width they were drawn at lets
 * them be scaled back on.
 */
export function scaleMark(mark, width) {
  if (!mark.w || mark.w === width) return mark.d;
  return mark.d; // paths scale with the SVG viewBox; see .ink sizing
}
