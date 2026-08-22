import { describe, expect, it } from 'vitest';
import {
  cluster, dateOf, eventsOn, layoutDay, minutesOf, overlaps, snapTo, timeOf, visibleRange,
} from './layout.js';

const at = (start, end, extra = {}) => ({
  id: `${start}-${end}`,
  title: `${start}–${end}`,
  start: `2026-08-24T${start}`,
  end: `2026-08-24T${end}`,
  allDay: false,
  ...extra,
});

/** The lane a given event landed in, by its label. */
const laneOf = (placed, label) => placed.find((p) => p.event.title === label);

describe('minutesOf / timeOf', () => {
  it('reads a bare clock time', () => {
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('00:00')).toBe(0);
    expect(minutesOf('23:59')).toBe(1439);
  });

  it('reads the clock out of a full timestamp', () => {
    expect(minutesOf('2026-08-24T09:30')).toBe(570);
  });

  it('round-trips', () => {
    for (const time of ['00:00', '07:15', '13:45', '23:30']) {
      expect(timeOf(minutesOf(time))).toBe(time);
    }
  });

  it('clamps rather than running past midnight', () => {
    expect(timeOf(-30)).toBe('00:00');
    expect(timeOf(2000)).toBe('24:00');
  });

  it('pulls the date off a timestamp', () => {
    expect(dateOf('2026-08-24T09:30')).toBe('2026-08-24');
  });
});

describe('overlaps', () => {
  it('is true when they share any minute', () => {
    expect(overlaps(at('10:00', '11:00'), at('10:30', '11:30'))).toBe(true);
  });

  it('is false when one merely starts where the other ends', () => {
    // The boundary case that decides whether back-to-back meetings split the
    // column for no reason.
    expect(overlaps(at('10:00', '11:00'), at('11:00', '12:00'))).toBe(false);
  });

  it('is false when they are far apart', () => {
    expect(overlaps(at('09:00', '09:30'), at('14:00', '15:00'))).toBe(false);
  });

  it('is true when one contains the other', () => {
    expect(overlaps(at('09:00', '17:00'), at('12:00', '13:00'))).toBe(true);
  });

  it('does not care which way round the arguments come', () => {
    const a = at('10:00', '11:00');
    const b = at('10:30', '11:30');
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });
});

describe('snapTo', () => {
  it('rounds to the nearest step', () => {
    expect(snapTo(547, 15)).toBe(540);
    expect(snapTo(548, 15)).toBe(555);
    expect(snapTo(547, 5)).toBe(545);
    expect(snapTo(547, 30)).toBe(540);
  });

  it('leaves the value alone when there is no step', () => {
    expect(snapTo(547, 0)).toBe(547);
  });
});

describe('cluster', () => {
  it('keeps unrelated events apart', () => {
    const groups = cluster([at('09:00', '10:00'), at('14:00', '15:00')]);
    expect(groups.length).toBe(2);
  });

  it('joins a chain even where the ends never touch', () => {
    // A–B overlap, B–C overlap, A and C do not. All three must still share a
    // width, or A and C would both take the left half.
    const groups = cluster([
      at('09:00', '10:00'),
      at('09:30', '11:00'),
      at('10:30', '11:30'),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].length).toBe(3);
  });

  it('leaves all-day events out', () => {
    const groups = cluster([at('09:00', '10:00'), { ...at('00:00', '23:59'), allDay: true }]);
    expect(groups.flat().length).toBe(1);
  });

  it('does not join events that merely touch', () => {
    const groups = cluster([at('10:00', '11:00'), at('11:00', '12:00')]);
    expect(groups.length).toBe(2);
  });
});

describe('layoutDay', () => {
  it('gives a lone event the full width', () => {
    const [only] = layoutDay([at('09:00', '10:00')]);
    expect(only.lane).toBe(0);
    expect(only.lanes).toBe(1);
  });

  it('splits two overlapping events in half', () => {
    const placed = layoutDay([at('10:00', '11:00'), at('10:30', '11:30')]);
    expect(placed.every((p) => p.lanes === 2)).toBe(true);
    expect(placed.map((p) => p.lane).sort()).toEqual([0, 1]);
  });

  it('splits a three-way overlap into thirds', () => {
    const placed = layoutDay([
      at('10:00', '11:00'),
      at('10:15', '11:15'),
      at('10:30', '11:30'),
    ]);
    expect(placed.every((p) => p.lanes === 3)).toBe(true);
    expect(placed.map((p) => p.lane).sort()).toEqual([0, 1, 2]);
  });

  it('gives a whole chain the same width even where the ends miss', () => {
    const placed = layoutDay([
      at('09:00', '10:00'),
      at('09:30', '11:00'),
      at('10:30', '11:30'),
    ]);
    expect(placed.every((p) => p.lanes === 2)).toBe(true);
    // The first and last never overlap, so the third can reuse the first's lane.
    expect(laneOf(placed, '09:00–10:00').lane).toBe(0);
    expect(laneOf(placed, '10:30–11:30').lane).toBe(0);
    expect(laneOf(placed, '09:30–11:00').lane).toBe(1);
  });

  it('lets back-to-back events each keep the full width', () => {
    const placed = layoutDay([at('10:00', '11:00'), at('11:00', '12:00')]);
    expect(placed.every((p) => p.lanes === 1)).toBe(true);
  });

  it('measures top from the start of the visible range', () => {
    const [only] = layoutDay([at('09:00', '10:00')], { from: 7 * 60 });
    expect(only.top).toBe(120);
    expect(only.height).toBe(60);
  });

  it('keeps a very short event tall enough to hit', () => {
    const [only] = layoutDay([at('09:00', '09:05')]);
    expect(only.height).toBe(15);
  });

  it('leaves all-day events out of the grid entirely', () => {
    const placed = layoutDay([
      at('09:00', '10:00'),
      { ...at('00:00', '23:59'), allDay: true },
    ]);
    expect(placed.length).toBe(1);
  });

  it('reuses a lane once it is free', () => {
    // Two long events either side of a gap, plus one spanning both, means the
    // spanner takes lane 1 and the other two share lane 0.
    const placed = layoutDay([
      at('09:00', '10:00'),
      at('09:00', '12:00'),
      at('10:30', '11:30'),
    ]);
    expect(laneOf(placed, '09:00–10:00').lane).toBe(0);
    expect(laneOf(placed, '10:30–11:30').lane).toBe(0);
    expect(laneOf(placed, '09:00–12:00').lane).toBe(1);
  });

  it('carries no working state out to the caller', () => {
    const placed = layoutDay([at('09:00', '10:00'), at('09:30', '10:30')]);
    for (const item of placed) expect('_group' in item).toBe(false);
  });
});

describe('visibleRange', () => {
  it('uses the hours you set', () => {
    expect(visibleRange({ firstHour: 8, lastHour: 20 })).toEqual({ from: 480, to: 1200 });
  });

  it('widens to reach an event that starts before the window', () => {
    const range = visibleRange({ firstHour: 9, lastHour: 17 }, [at('06:30', '07:15')]);
    expect(range.from).toBe(6 * 60);
  });

  it('widens to reach an event that ends after the window', () => {
    const range = visibleRange({ firstHour: 9, lastHour: 17 }, [at('21:00', '22:30')]);
    expect(range.to).toBe(23 * 60);
  });

  it('ignores all-day events when widening', () => {
    const range = visibleRange({ firstHour: 9, lastHour: 17 }, [
      { ...at('00:00', '23:59'), allDay: true },
    ]);
    expect(range).toEqual({ from: 540, to: 1020 });
  });

  it('never gives back less than an hour of grid', () => {
    const range = visibleRange({ firstHour: 10, lastHour: 10 });
    expect(range.to - range.from).toBeGreaterThanOrEqual(60);
  });

  it('stays inside the day', () => {
    const range = visibleRange({ firstHour: 0, lastHour: 24 });
    expect(range.from).toBe(0);
    expect(range.to).toBe(1440);
  });
});

describe('eventsOn', () => {
  const events = [
    at('14:00', '15:00'),
    { ...at('09:00', '10:00'), start: '2026-08-25T09:00', end: '2026-08-25T10:00' },
    at('09:00', '10:00'),
    { ...at('00:00', '23:59'), allDay: true, title: 'holiday' },
  ];

  it('keeps only the day asked for', () => {
    expect(eventsOn(events, '2026-08-24').length).toBe(3);
  });

  it('puts all-day first, then the rest in clock order', () => {
    const day = eventsOn(events, '2026-08-24');
    expect(day[0].title).toBe('holiday');
    expect(day[1].title).toBe('09:00–10:00');
    expect(day[2].title).toBe('14:00–15:00');
  });
});
