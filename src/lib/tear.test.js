import { describe, expect, it, vi, afterEach } from 'vitest';

/* The tear conditions are about the clock and the calendar at once, which is
   where quiet bugs live: a day that can never be torn because an all-day event
   technically runs to midnight, or a week that offers itself on a Tuesday.

   dayFinished and weekFinished read today's date from the system clock, so
   these fake it rather than writing tests that pass only in August. */

const TODAY = '2026-08-24';           // a Monday
const SUNDAY = '2026-08-30';          // the end of that week

let stub;

async function load(now, torn = {}) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${now}T00:00:00`));
  stub = {
    state: { settings: { weekStartsOn: 1 }, torn },
    isTorn: (kind, key) => Boolean(torn[`${kind}:${key}`]),
    untear: (kind, key) => { delete torn[`${kind}:${key}`]; },
    tearOff: (kind, key) => { torn[`${kind}:${key}`] = 'now'; },
  };
  vi.doMock('./store.js', () => ({ store: stub }));
  return import('../views/tear.js');
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('./store.js');
});

const at = (hour, minute = 0) => new Date(2026, 7, 24, hour, minute);

const timed = (date, start, end) => ({
  id: `${date}-${start}`, title: 'Thing', allDay: false,
  start: `${date}T${start}`, end: `${date}T${end}`,
});

describe('dayFinished', () => {
  it('is false before nine in the evening, however empty the day', async () => {
    const { dayFinished } = await load(TODAY);
    expect(dayFinished(TODAY, [], at(20, 59))).toBe(false);
  });

  it('is true after nine when nothing is on the day', async () => {
    const { dayFinished } = await load(TODAY);
    expect(dayFinished(TODAY, [], at(21, 0))).toBe(true);
  });

  it('is true after nine when everything has ended', async () => {
    const { dayFinished } = await load(TODAY);
    const events = [timed(TODAY, '09:00', '10:00'), timed(TODAY, '14:00', '15:30')];
    expect(dayFinished(TODAY, events, at(21, 30))).toBe(true);
  });

  it('is false while something is still to come', async () => {
    const { dayFinished } = await load(TODAY);
    const events = [timed(TODAY, '22:00', '23:00')];
    expect(dayFinished(TODAY, events, at(21, 30))).toBe(false);
  });

  it('turns true once that last thing has ended', async () => {
    const { dayFinished } = await load(TODAY);
    const events = [timed(TODAY, '22:00', '23:00')];
    expect(dayFinished(TODAY, events, at(23, 0))).toBe(true);
  });

  it('is not blocked by an all-day event', async () => {
    // An all-day event runs to midnight, so treating it as unfinished would
    // mean a day with a birthday on it could never be torn off.
    const { dayFinished } = await load(TODAY);
    const events = [{
      id: 'b', title: 'Birthday', allDay: true,
      start: `${TODAY}T00:00`, end: `${TODAY}T23:59`,
    }];
    expect(dayFinished(TODAY, events, at(21, 30))).toBe(true);
  });

  it('is never true for a day still to come', async () => {
    const { dayFinished } = await load(TODAY);
    expect(dayFinished('2026-08-25', [], at(23, 59))).toBe(false);
  });

  it('is true for a past day whatever the clock says now', async () => {
    const { dayFinished } = await load(TODAY);
    const events = [timed('2026-08-23', '22:00', '23:00')];
    expect(dayFinished('2026-08-23', events, at(9, 0))).toBe(true);
  });
});

describe('weekFinished', () => {
  it('is false in the middle of the week, however quiet', async () => {
    const { weekFinished } = await load(TODAY);
    expect(weekFinished(TODAY, [], at(23, 0))).toBe(false);
  });

  it('is false on the last day before nine', async () => {
    const { weekFinished } = await load(SUNDAY);
    expect(weekFinished(TODAY, [], at(20, 0))).toBe(false);
  });

  it('is true on the last day after nine, with the week clear', async () => {
    const { weekFinished } = await load(SUNDAY);
    expect(weekFinished(TODAY, [], at(21, 0))).toBe(true);
  });

  it('is false when one day of the week still has something to come', async () => {
    const { weekFinished } = await load(SUNDAY);
    const events = [timed(SUNDAY, '22:00', '23:00')];
    expect(weekFinished(TODAY, events, at(21, 0))).toBe(false);
  });

  it('does not mind days earlier in the week having had events', async () => {
    const { weekFinished } = await load(SUNDAY);
    const events = [
      timed(TODAY, '09:00', '10:00'),
      timed('2026-08-26', '14:00', '15:00'),
    ];
    expect(weekFinished(TODAY, events, at(21, 0))).toBe(true);
  });
});

describe('refreshTorn', () => {
  it('leaves a torn day torn while it is still finished', async () => {
    const torn = { 'day:2026-08-23': 'x' };
    const { refreshTorn } = await load(TODAY, torn);
    refreshTorn([], at(10, 0));
    expect(Object.keys(torn)).toEqual(['day:2026-08-23']);
  });

  it('puts a torn day back when something on it is still to come', async () => {
    // Tear today at nine, then put a ten o'clock meeting on it: the day is no
    // longer finished, so the page it was torn from comes back.
    const torn = { [`day:${TODAY}`]: 'x' };
    const { refreshTorn } = await load(TODAY, torn);
    refreshTorn([timed(TODAY, '22:00', '23:00')], at(21, 30));
    expect(Object.keys(torn)).toEqual([]);
  });

  it('leaves a past day torn even once something is added to it', async () => {
    // Nothing on a day already gone can still be to come, so recording
    // something that already happened does not un-finish it.
    const torn = { 'day:2026-08-20': 'x' };
    const { refreshTorn } = await load(TODAY, torn);
    refreshTorn([timed('2026-08-20', '11:00', '12:00')], at(10, 0));
    expect(Object.keys(torn)).toEqual(['day:2026-08-20']);
  });
});
