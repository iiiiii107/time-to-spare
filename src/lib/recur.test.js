import { describe, expect, it } from 'vitest';
import {
  describeRule, expandAll, isCancelled, occurrenceId, occursOn, parseOccurrenceId,
} from './recur.js';

/** 2026-08-24 is a Monday. */
const MONDAY = '2026-08-24';

const series = (recur, extra = {}) => ({
  id: 'e1',
  title: 'Standup',
  start: `${MONDAY}T09:00`,
  end: `${MONDAY}T09:15`,
  allDay: false,
  recur,
  ...extra,
});

const dates = (list) => list.map((e) => e.occurrenceDate || e.start.slice(0, 10));

describe('occursOn — daily', () => {
  const every = series({ freq: 'daily', interval: 1 });
  const otherDay = series({ freq: 'daily', interval: 2 });

  it('lands on the start date', () => {
    expect(occursOn(every, MONDAY)).toBe(true);
  });

  it('lands on every following day', () => {
    expect(occursOn(every, '2026-08-25')).toBe(true);
    expect(occursOn(every, '2026-09-01')).toBe(true);
  });

  it('never lands before it started', () => {
    expect(occursOn(every, '2026-08-23')).toBe(false);
  });

  it('honours an interval', () => {
    expect(occursOn(otherDay, '2026-08-25')).toBe(false);
    expect(occursOn(otherDay, '2026-08-26')).toBe(true);
  });

  it('stops at `until`', () => {
    const bounded = series({ freq: 'daily', interval: 1, until: '2026-08-26' });
    expect(occursOn(bounded, '2026-08-26')).toBe(true);
    expect(occursOn(bounded, '2026-08-27')).toBe(false);
  });
});

describe('occursOn — weekly', () => {
  it('defaults to the day it started on', () => {
    const weekly = series({ freq: 'weekly', interval: 1 });
    expect(occursOn(weekly, '2026-08-31')).toBe(true);  // next Monday
    expect(occursOn(weekly, '2026-08-25')).toBe(false); // Tuesday
  });

  it('lands on every named day', () => {
    const mwf = series({ freq: 'weekly', interval: 1, byDay: [1, 3, 5] });
    expect(occursOn(mwf, '2026-08-24')).toBe(true);  // Mon
    expect(occursOn(mwf, '2026-08-26')).toBe(true);  // Wed
    expect(occursOn(mwf, '2026-08-28')).toBe(true);  // Fri
    expect(occursOn(mwf, '2026-08-25')).toBe(false); // Tue
  });

  it('counts a fortnightly interval in whole weeks, not in days', () => {
    // The bug this guards: measuring the interval from each date rather than
    // from the week the series started makes every other *day* qualify.
    const fortnightly = series({ freq: 'weekly', interval: 2 });
    expect(occursOn(fortnightly, '2026-08-31')).toBe(false); // +1 week
    expect(occursOn(fortnightly, '2026-09-07')).toBe(true);  // +2 weeks
    expect(occursOn(fortnightly, '2026-09-14')).toBe(false); // +3 weeks
  });

  it('keeps every named day inside the same qualifying week', () => {
    const fortnightlyMW = series({ freq: 'weekly', interval: 2, byDay: [1, 3] });
    expect(occursOn(fortnightlyMW, '2026-08-26')).toBe(true);  // Wed, week 0
    expect(occursOn(fortnightlyMW, '2026-09-02')).toBe(false); // Wed, week 1
    expect(occursOn(fortnightlyMW, '2026-09-09')).toBe(true);  // Wed, week 2
  });
});

describe('occursOn — monthly and yearly', () => {
  it('repeats on the same day of the month', () => {
    const monthly = series({ freq: 'monthly', interval: 1 });
    expect(occursOn(monthly, '2026-09-24')).toBe(true);
    expect(occursOn(monthly, '2026-09-23')).toBe(false);
  });

  it('skips months that have no such day', () => {
    const thirtyFirst = series({ freq: 'monthly', interval: 1 }, {
      start: '2026-01-31T09:00', end: '2026-01-31T10:00',
    });
    expect(occursOn(thirtyFirst, '2026-03-31')).toBe(true);
    // February has no 31st, so nothing in February qualifies.
    expect(occursOn(thirtyFirst, '2026-02-28')).toBe(false);
  });

  it('repeats on the same date each year', () => {
    const yearly = series({ freq: 'yearly', interval: 1 });
    expect(occursOn(yearly, '2027-08-24')).toBe(true);
    expect(occursOn(yearly, '2027-08-25')).toBe(false);
  });
});

describe('occurrence ids', () => {
  it('carries the date the rule produced', () => {
    const weekly = series({ freq: 'weekly', interval: 1 });
    expect(occurrenceId(weekly, '2026-08-31')).toBe('e1::2026-08-31');
  });

  it('leaves a one-off alone', () => {
    expect(occurrenceId({ id: 'x' }, '2026-08-31')).toBe('x');
  });

  it('round-trips', () => {
    expect(parseOccurrenceId('e1::2026-08-31')).toEqual({
      seriesId: 'e1', date: '2026-08-31',
    });
    expect(parseOccurrenceId('plain')).toEqual({ seriesId: 'plain', date: null });
  });
});

describe('expandAll', () => {
  it('passes a one-off straight through', () => {
    const one = { id: 'a', start: '2026-08-25T09:00', end: '2026-08-25T10:00' };
    expect(expandAll([one], '2026-08-24', '2026-08-30')).toEqual([one]);
  });

  it('leaves out a one-off outside the window', () => {
    const one = { id: 'a', start: '2026-07-01T09:00', end: '2026-07-01T10:00' };
    expect(expandAll([one], '2026-08-24', '2026-08-30')).toEqual([]);
  });

  it('produces one entry per occurrence', () => {
    const weekly = series({ freq: 'weekly', interval: 1 });
    const out = expandAll([weekly], '2026-08-24', '2026-09-14');
    expect(dates(out)).toEqual(['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']);
  });

  it('shifts both ends, so a multi-day occurrence keeps its length', () => {
    const trip = series({ freq: 'monthly', interval: 1 }, {
      start: '2026-08-28T18:00', end: '2026-08-30T20:00', allDay: true,
    });
    const [, second] = expandAll([trip], '2026-08-01', '2026-10-01');
    expect(second.start.slice(0, 10)).toBe('2026-09-28');
    expect(second.end.slice(0, 10)).toBe('2026-09-30');
  });

  it('drops a cancelled occurrence and keeps the rest', () => {
    const weekly = series({ freq: 'weekly', interval: 1 }, {
      exceptions: { '2026-08-31': { cancelled: true } },
    });
    const out = expandAll([weekly], '2026-08-24', '2026-09-07');
    expect(dates(out)).toEqual(['2026-08-24', '2026-09-07']);
  });

  it('applies an override to just that occurrence', () => {
    const weekly = series({ freq: 'weekly', interval: 1 }, {
      exceptions: { '2026-08-31': { title: 'Moved', start: '2026-08-31T14:00', end: '2026-08-31T15:00' } },
    });
    const out = expandAll([weekly], '2026-08-24', '2026-09-07');
    expect(out.map((e) => e.title)).toEqual(['Standup', 'Moved', 'Standup']);
    expect(out[1].start).toBe('2026-08-31T14:00');
    // The exception is still filed under the date the rule produced, so the
    // rule can find it again next time.
    expect(out[1].occurrenceDate).toBe('2026-08-31');
  });

  it('stops after `count` occurrences', () => {
    const thrice = series({ freq: 'weekly', interval: 1, count: 3 });
    const out = expandAll([thrice], '2026-08-24', '2026-12-31');
    expect(dates(out)).toEqual(['2026-08-24', '2026-08-31', '2026-09-07']);
  });

  it('counts occurrences before the window towards `count`', () => {
    // Asking only about September must not restart the count.
    const thrice = series({ freq: 'weekly', interval: 1, count: 3 });
    const out = expandAll([thrice], '2026-09-01', '2026-12-31');
    expect(dates(out)).toEqual(['2026-09-07']);
  });

  it('reaches into the window with an occurrence that started before it', () => {
    const trip = series({ freq: 'monthly', interval: 1 }, {
      start: '2026-08-30T09:00', end: '2026-09-02T17:00', allDay: true,
    });
    const out = expandAll([trip], '2026-09-01', '2026-09-05');
    expect(out.length).toBe(1);
    expect(out[0].start.slice(0, 10)).toBe('2026-08-30');
  });

  it('honours `until` while expanding', () => {
    const bounded = series({ freq: 'weekly', interval: 1, until: '2026-09-01' });
    const out = expandAll([bounded], '2026-08-24', '2026-09-30');
    expect(dates(out)).toEqual(['2026-08-24', '2026-08-31']);
  });
});

describe('isCancelled', () => {
  it('is true only for a cancelled date', () => {
    const weekly = series({ freq: 'weekly' }, {
      exceptions: { '2026-08-31': { cancelled: true }, '2026-09-07': { title: 'x' } },
    });
    expect(isCancelled(weekly, '2026-08-31')).toBe(true);
    expect(isCancelled(weekly, '2026-09-07')).toBe(false);
    expect(isCancelled(weekly, '2026-09-14')).toBe(false);
  });
});

describe('describeRule', () => {
  it('says what a rule does', () => {
    expect(describeRule(null)).toBe('Once');
    expect(describeRule({ freq: 'daily', interval: 1 })).toBe('Every day');
    expect(describeRule({ freq: 'daily', interval: 3 })).toBe('Every 3 days');
    expect(describeRule({ freq: 'weekly', interval: 1, byDay: [1, 3] })).toBe('Every week on Mon, Wed');
    expect(describeRule({ freq: 'monthly', interval: 2 })).toBe('Every 2 months');
    expect(describeRule({ freq: 'weekly', interval: 1, count: 4 })).toBe('Every week, 4 times');
  });

  it('orders the named days from your week start', () => {
    expect(describeRule({ freq: 'weekly', interval: 1, byDay: [0, 1] }, { weekStartsOn: 1 }))
      .toBe('Every week on Mon, Sun');
  });
});
