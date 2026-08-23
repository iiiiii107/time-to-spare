import { storage } from './storage.js';
import { makeEvent, uid } from './events.js';
import { parseOccurrenceId } from './recur.js';

/* Single source of truth. Views read `store.state`, call an action, and
   re-render on the change event — no view mutates state directly. */

export const CALENDAR_COLORS = [
  '#2F5C96', '#7E9A70', '#B8714C', '#D9B54A', '#8A6A93', '#20395C',
];

class Store extends EventTarget {
  constructor() {
    super();
    this.state = null;
    this.ready = false;
  }

  async init() {
    this.state = await storage.load();
    this.ready = true;
    storage.subscribe((incoming) => {
      this.state = incoming;
      this.emit();
    });
    this.emit();
  }

  emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }

  async persist() {
    await storage.save(this.state);
    this.emit();
  }

  // ---- events ------------------------------------------------------------

  addEvent(fields) {
    const event = makeEvent(fields, this.state.settings);
    this.state.events.push(event);
    this.persist();
    return event;
  }

  updateEvent(id, patch) {
    const event = this.state.events.find((e) => e.id === id);
    if (event) Object.assign(event, patch);
    return this.persist();
  }

  deleteEvent(id) {
    this.state.events = this.state.events.filter((e) => e.id !== id);
    return this.persist();
  }

  /**
   * The stored event behind an id. An occurrence's id carries the date the
   * rule produced it on, so it resolves back to its master.
   */
  eventById(id) {
    const direct = this.state.events.find((e) => e.id === id);
    if (direct) return direct;
    const { seriesId } = parseOccurrenceId(id);
    return this.state.events.find((e) => e.id === seriesId);
  }

  // ---- repeating events --------------------------------------------------

  /**
   * Change one occurrence without touching the rest of the series.
   * The exception is filed under the date the rule produced, never the date
   * the occurrence has been moved to — otherwise the rule could not find it
   * again and the change would come back as a duplicate.
   */
  overrideOccurrence(seriesId, occurrenceDate, patch) {
    const master = this.state.events.find((e) => e.id === seriesId);
    if (!master) return this.persist();
    if (!master.exceptions) master.exceptions = {};
    master.exceptions[occurrenceDate] = {
      ...(master.exceptions[occurrenceDate] || {}),
      ...patch,
    };
    return this.persist();
  }

  /** Take one occurrence out of the series, leaving the rest alone. */
  cancelOccurrence(seriesId, occurrenceDate) {
    return this.overrideOccurrence(seriesId, occurrenceDate, { cancelled: true });
  }

  /**
   * Editing the whole series drops the per-occurrence exceptions, because
   * they were answers to a shape the series no longer has.
   */
  updateSeries(seriesId, patch) {
    const master = this.state.events.find((e) => e.id === seriesId);
    if (!master) return this.persist();
    Object.assign(master, patch);
    if (patch.recur !== undefined) delete master.exceptions;
    return this.persist();
  }

  /**
   * Move or resize without a save per pointer move. Dragging writes straight
   * to state and repaints; the save happens once, on release.
   */
  stageEvent(id, patch) {
    const event = this.state.events.find((e) => e.id === id);
    if (event) {
      Object.assign(event, patch);
      return event;
    }

    // Dragging one occurrence of a series moves only that occurrence.
    const { seriesId, date } = parseOccurrenceId(id);
    const master = this.state.events.find((e) => e.id === seriesId);
    if (!master || !date) return null;
    if (!master.exceptions) master.exceptions = {};
    master.exceptions[date] = { ...(master.exceptions[date] || {}), ...patch };
    return master;
  }

  commit() {
    return this.persist();
  }

  // ---- calendars ---------------------------------------------------------

  addCalendar({ name, color = CALENDAR_COLORS[0] }) {
    this.state.calendars.push({
      id: uid(),
      name: name.trim(),
      color,
      visible: true,
      order: this.state.calendars.length,
    });
    return this.persist();
  }

  updateCalendar(id, patch) {
    const calendar = this.state.calendars.find((c) => c.id === id);
    if (calendar) Object.assign(calendar, patch);
    return this.persist();
  }

  /** Removing a calendar takes its events with it. */
  deleteCalendar(id) {
    if (this.state.calendars.length <= 1) return this.persist();
    this.state.calendars = this.state.calendars.filter((c) => c.id !== id);
    this.state.events = this.state.events.filter((e) => e.calendarId !== id);
    return this.persist();
  }

  moveCalendar(id, direction) {
    const list = this.state.calendars;
    const at = list.findIndex((c) => c.id === id);
    const to = at + direction;
    if (at < 0 || to < 0 || to >= list.length) return this.persist();
    [list[at], list[to]] = [list[to], list[at]];
    list.forEach((calendar, index) => { calendar.order = index; });
    return this.persist();
  }

  visibleCalendars() {
    return this.state.calendars.filter((c) => c.visible !== false);
  }

  // ---- marks -------------------------------------------------------------

  /** Freehand marks for one period, e.g. 'week:2026-08-24'. */
  marksFor(key) {
    return this.state.marks?.[key] || [];
  }

  addMarks(key, marks) {
    if (!marks.length) return this.persist();
    if (!this.state.marks) this.state.marks = {};
    if (!this.state.marks[key]) this.state.marks[key] = [];
    this.state.marks[key].push(...marks);
    return this.persist();
  }

  clearMarks(key) {
    if (this.state.marks) delete this.state.marks[key];
    return this.persist();
  }

  // ---- torn pages --------------------------------------------------------

  /** Days and weeks already torn off, so they aren't offered twice. */
  isTorn(kind, key) {
    return Boolean(this.state.torn?.[`${kind}:${key}`]);
  }

  tearOff(kind, key) {
    if (!this.state.torn) this.state.torn = {};
    this.state.torn[`${kind}:${key}`] = new Date().toISOString();
    return this.persist();
  }

  /** A page comes back when there's something on it again. */
  untear(kind, key) {
    if (this.state.torn) delete this.state.torn[`${kind}:${key}`];
    return this.persist();
  }

  // ---- settings ----------------------------------------------------------

  updateSettings(patch) {
    Object.assign(this.state.settings, patch);
    return this.persist();
  }
}

export const store = new Store();
