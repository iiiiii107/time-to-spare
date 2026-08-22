import { storage } from './storage.js';
import { makeEvent, uid } from './events.js';

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

  eventById(id) {
    return this.state.events.find((e) => e.id === id);
  }

  /**
   * Move or resize without a save per pointer move. Dragging writes straight
   * to state and repaints; the save happens once, on release.
   */
  stageEvent(id, patch) {
    const event = this.state.events.find((e) => e.id === id);
    if (event) Object.assign(event, patch);
    return event;
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

  // ---- settings ----------------------------------------------------------

  updateSettings(patch) {
    Object.assign(this.state.settings, patch);
    return this.persist();
  }
}

export const store = new Store();
