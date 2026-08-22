/* Storage adapter.

   Everything goes through `storage`, never through localStorage directly.
   Today the browser is the only backend. Google Calendar becomes the shared
   copy later, so the same four methods are all a view ever sees and a second
   backend can be slid underneath without touching one. */

const KEY = 'tts:data:v1';

/** The one calendar that exists before Google is connected. */
export const LOCAL_CALENDAR = {
  id: 'local',
  name: 'Mine',
  color: '#2F5C96',
  visible: true,
  order: 0,
};

export const DEFAULT_STATE = {
  settings: {
    // Which view you land on. Yours to change.
    home: 'week',
    weekStartsOn: 1,
    hour12: false,

    // Density: the hours drawn, and what an hour is worth in pixels.
    firstHour: 7,
    lastHour: 22,
    hourHeight: 52,

    // 'full' | 'narrow' | 'hidden'
    weekends: 'full',

    // New events
    defaultMinutes: 30,
    snapMinutes: 15,

    // Type
    displayFont: 'fraunces',
    bodyFont: 'montserrat',
    textScale: 1,

    // Paper stock per view, and the pattern printed on the page behind it.
    paper: {
      week: 'ruled',
      day: 'ruled',
      month: 'grid',
      agenda: 'dots',
    },

    theme: 'system',

    // The two tools you can re-colour. Same shape as the habit tracker's, so
    // a crayon set green there feels like the same crayon here.
    toolStyles: {
      highlighter: { ink: '#EFD87B', width: 15 },
      crayon: { ink: '#B8714C', width: 5.5 },
    },
  },

  calendars: [LOCAL_CALENDAR],
  events: [],

  /** Freehand marks, keyed 'week:2026-08-24' / 'day:2026-08-24'. */
  marks: {},
};

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Fills in anything a stored payload predates, so old saves keep working. */
export function withDefaults(data) {
  const settings = { ...DEFAULT_STATE.settings, ...(data.settings || {}) };
  settings.paper = { ...DEFAULT_STATE.settings.paper, ...(settings.paper || {}) };
  settings.toolStyles = {
    ...DEFAULT_STATE.settings.toolStyles,
    ...(settings.toolStyles || {}),
  };

  // There must always be somewhere for an event to live.
  const calendars = data.calendars?.length ? data.calendars : [LOCAL_CALENDAR];

  return { ...DEFAULT_STATE, ...data, calendars, settings };
}

export function createLocalStorage() {
  const listeners = new Set();

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? withDefaults(JSON.parse(raw)) : clone(DEFAULT_STATE);
    } catch {
      return clone(DEFAULT_STATE);
    }
  }

  function write(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save — storage may be full or blocked.', err);
    }
    listeners.forEach((fn) => fn(state));
  }

  // Another tab saving counts as a remote change; mirror it into this one.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) listeners.forEach((fn) => fn(read()));
  });

  return {
    kind: 'local',
    load: async () => read(),
    save: async (state) => write(state),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async exportAll() {
      return JSON.stringify(read(), null, 2);
    },
    async importAll(json) {
      write(withDefaults(JSON.parse(json)));
    },
  };
}

const local = createLocalStorage();
let backend = local;
const listeners = new Set();
let detach = backend.subscribe((state) => listeners.forEach((fn) => fn(state)));

export const storage = {
  get kind() {
    return backend.kind;
  },
  load: (...args) => backend.load(...args),
  save: (...args) => backend.save(...args),
  exportAll: () => backend.exportAll(),
  importAll: (json) => backend.importAll(json),
  local,

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Put a different backend underneath and hand everyone its state. */
  async use(next) {
    const chosen = next || local;
    if (chosen === backend) return backend.load();

    detach?.();
    backend = chosen;
    detach = backend.subscribe((state) => listeners.forEach((fn) => fn(state)));

    const state = await backend.load();
    listeners.forEach((fn) => fn(state));
    return state;
  },
};
