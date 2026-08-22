/* Tiny DOM helpers. Views build elements with `el()` rather than innerHTML so
   user-entered category and task names can never be parsed as markup. */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }

  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Namespaced element creation, for the inline SVG bits. */
export function svg(tag, props = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

/**
 * Pointer capture, guarded. Browsers throw if the id isn't an active pointer,
 * and losing capture is never worth breaking the whole interaction over.
 */
export function capturePointer(node, pointerId) {
  try {
    node.setPointerCapture(pointerId);
  } catch {
    /* keep going without capture */
  }
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

export function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = el('div', { class: 'toast', role: 'status', text: message });
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

/** A modal with its own focus trap; resolves when closed. */
export function modal({ title, body, actions = [] }) {
  const previouslyFocused = document.activeElement;
  const backdrop = el('div', { class: 'modal-backdrop' });
  const panel = el('div', {
    class: 'modal paper',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  });

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    previouslyFocused?.focus?.();
  }
  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  panel.append(el('h3', { text: title }), body);
  if (actions.length) {
    panel.append(
      el(
        'div',
        { class: 'modal-actions' },
        actions.map((action) =>
          el('button', {
            class: action.class || 'btn btn-secondary',
            text: action.label,
            onClick: () => {
              if (action.onClick?.({ close }) !== false) close();
            },
          }),
        ),
      ),
    );
  }

  backdrop.append(panel);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  panel.querySelector('input, textarea, select, button')?.focus();

  return { close, panel };
}

export function confetti(colors) {
  const layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < 34; i += 1) {
    layer.append(
      el('i', {
        style: `left:${Math.random() * 100}%;
                top:${Math.random() * 18}%;
                background:${colors[i % colors.length]};
                animation-delay:${Math.random() * 0.35}s`,
      }),
    );
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2200);
}

/** The hand-drawn strike-through, with a per-row wobble so no two match. */
export function strikeSvg(seed = 0) {
  const paths = [
    'M2 6C40 3 80 8 120 5C160 2 200 7 238 4',
    'M2 5C40 8 80 3 120 6C160 9 200 4 238 6',
    'M2 6C40 4 80 8 120 4C160 3 200 8 238 5',
    'M2 5C40 7 80 3 120 6C160 8 200 3 238 5',
  ];
  return svg(
    'svg',
    { class: 'strike', viewBox: '0 0 240 10', preserveAspectRatio: 'none' },
    [svg('path', { d: paths[seed % paths.length] })],
  );
}

export function checkSvg() {
  return svg('svg', { viewBox: '0 0 16 16' }, [
    svg('path', { d: 'M2.5 8.5l3.5 3.5 7.5-8' }),
  ]);
}

/** The pen, drawn to match the reference line art. */
export function penSvg() {
  const parts = [
    'M15.4 13.5C15.4 7.5 16.2 4.2 18.6 4.2C21 4.2 21.8 7.5 21.8 13.5Z',
    'M14.4 15.4C11 16.6 10 21.6 10 29.8C10 37.8 10.4 43.6 11.6 46.8C12.7 44.6 13 37.8 13 29.8C13 21.8 13.2 17.4 14.4 15.4Z',
    'M14.2 14.6C13.2 30 13 45 13.6 62.4L23.8 62.4C24.4 45 24.2 30 23.2 14.6Z',
    'M13.6 62.4C14 74 15 82.4 16.2 88.4L21.2 88.4C22.4 82.4 23.4 74 23.8 62.4Z',
    'M16.2 88.4C16.8 92 17.6 94.8 18.7 97.2C19.8 94.8 20.6 92 21.2 88.4Z',
  ];
  return svg(
    'svg',
    {
      class: 'pen',
      viewBox: '0 0 36 100',
      fill: 'none',
      stroke: 'var(--ink)',
      'stroke-width': '2.2',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'aria-hidden': 'true',
    },
    parts.map((d) => svg('path', { d, fill: 'var(--paper)' })),
  );
}
