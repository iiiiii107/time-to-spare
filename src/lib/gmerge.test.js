import { describe, expect, it } from 'vitest';
import {
  fromGoogle, fromGoogleList, isTrackerEvent, localStamp, mergeEvents, toGoogle,
} from './gmerge.js';

/* The conversions between Google's shape and ours. Everything here is the
   kind of mistake you cannot see afterwards — a birthday quietly two days
   long, a meeting an hour out — so it is pinned down rather than eyeballed. */

const timed = (start, end, extra = {}) => ({
  id: 'abc123',
  status: 'confirmed',
  summary: 'Standup',
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});

const allDay = (from, to, extra = {}) => ({
  id: 'day1',
  status: 'confirmed',
  summary: 'Birthday',
  start: { date: from },
  end: { date: to },
  ...extra,
});

describe('all-day events', () => {
  it('takes a day off the end, because Google says the morning after', () => {
    // Google: 24th → 25th means "the 24th". Ours stores the last day covered.
    // Without this every one-day event silently becomes two.
    const event = fromGoogle(allDay('2026-08-24', '2026-08-25'));
    expect(event.start.slice(0, 10)).toBe('2026-08-24');
    expect(event.end.slice(0, 10)).toBe('2026-08-24');
    expect(event.allDay).toBe(true);
  });

  it('keeps a real multi-day span', () => {
    const event = fromGoogle(allDay('2026-08-24', '2026-08-28'));
    expect(event.start.slice(0, 10)).toBe('2026-08-24');
    expect(event.end.slice(0, 10)).toBe('2026-08-27');
  });

  it('never ends before it starts, whatever Google sends', () => {
    const event = fromGoogle(allDay('2026-08-24', '2026-08-24'));
    expect(event.end.slice(0, 10)).toBe('2026-08-24');
  });

  it('survives a missing end', () => {
    const event = fromGoogle({ ...allDay('2026-08-24', '2026-08-25'), end: undefined });
    expect(event.end.slice(0, 10)).toBe('2026-08-24');
  });

  it('puts the day back on the way out', () => {
    const ours = { title: 'Trip', allDay: true, start: '2026-08-24T00:00', end: '2026-08-27T23:59' };
    const body = toGoogle(ours);
    expect(body.start.date).toBe('2026-08-24');
    expect(body.end.date).toBe('2026-08-28');
  });

  it('round-trips a one-day event back to itself', () => {
    const there = fromGoogle(allDay('2026-08-24', '2026-08-25'));
    const back = toGoogle(there);
    expect(back.start.date).toBe('2026-08-24');
    expect(back.end.date).toBe('2026-08-25');
  });
});

describe('timed events', () => {
  it('reads an offset into local wall time', () => {
    // Whatever zone the test machine is in, the instant is the same, so the
    // wall time has to match what a real Date says locally.
    const raw = timed('2026-08-24T09:00:00+02:00', '2026-08-24T10:00:00+02:00');
    const event = fromGoogle(raw);
    expect(event.start).toBe(localStamp(new Date('2026-08-24T09:00:00+02:00')));
    expect(event.end).toBe(localStamp(new Date('2026-08-24T10:00:00+02:00')));
    expect(event.allDay).toBe(false);
  });

  it('handles a Z time', () => {
    const event = fromGoogle(timed('2026-08-24T09:00:00Z', '2026-08-24T10:00:00Z'));
    expect(event.start).toBe(localStamp(new Date('2026-08-24T09:00:00Z')));
  });

  it('gives back a stamp our own parser can read', () => {
    const event = fromGoogle(timed('2026-08-24T09:30:00+02:00', '2026-08-24T10:00:00+02:00'));
    expect(event.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('does not fall over on an unparseable time', () => {
    expect(fromGoogle(timed('not a date', 'nor this'))).toBe(null);
  });

  it('attaches a zone on the way out', () => {
    const body = toGoogle(
      { title: 'X', allDay: false, start: '2026-08-24T09:00', end: '2026-08-24T10:00' },
      { timeZone: 'Europe/Berlin' },
    );
    expect(body.start).toEqual({ dateTime: '2026-08-24T09:00:00', timeZone: 'Europe/Berlin' });
    expect(body.end).toEqual({ dateTime: '2026-08-24T10:00:00', timeZone: 'Europe/Berlin' });
  });
});

describe('what gets dropped', () => {
  it('drops a cancelled occurrence', () => {
    // Google keeps sending these so you know they are gone.
    expect(fromGoogle(timed('2026-08-24T09:00:00Z', '2026-08-24T10:00:00Z', { status: 'cancelled' })))
      .toBe(null);
  });

  it('drops anything with no start at all', () => {
    expect(fromGoogle({ id: 'x', status: 'confirmed' })).toBe(null);
    expect(fromGoogle(null)).toBe(null);
  });

  it('filters a whole page in one go', () => {
    const list = fromGoogleList([
      timed('2026-08-24T09:00:00Z', '2026-08-24T10:00:00Z'),
      timed('2026-08-24T11:00:00Z', '2026-08-24T12:00:00Z', { status: 'cancelled' }),
      null,
    ]);
    expect(list.length).toBe(1);
  });
});

describe('events the habit tracker wrote', () => {
  it('recognises them by the source it stamps', () => {
    expect(isTrackerEvent({ id: 'zzz', source: { title: '10 Minutes to Spare' } })).toBe(true);
  });

  it('recognises them by the id it derives', () => {
    expect(isTrackerEvent({ id: 'tms1a2b3c' })).toBe(true);
  });

  it('recognises an occurrence of one', () => {
    expect(isTrackerEvent({ id: 'tms1a2b_20260824', recurringEventId: 'tms1a2b' })).toBe(true);
  });

  it('leaves an ordinary meeting alone', () => {
    expect(isTrackerEvent({ id: 'abc123', summary: 'Standup' })).toBe(false);
    expect(isTrackerEvent({})).toBe(false);
  });

  it('marks them so they can be drawn as tasks rather than meetings', () => {
    const task = fromGoogle(timed('2026-08-24T09:00:00Z', '2026-08-24T09:10:00Z', { id: 'tms99' }));
    const meeting = fromGoogle(timed('2026-08-24T09:00:00Z', '2026-08-24T10:00:00Z'));
    expect(task.origin).toBe('tracker');
    expect(meeting.origin).toBe('google');
  });
});

describe('identity and permission', () => {
  it('namespaces the id by calendar, so two calendars cannot collide', () => {
    const a = fromGoogle(timed('2026-08-24T09:00:00Z', '2026-08-24T10:00:00Z'), { id: 'work' });
    const b = fromGoogle(timed('2026-08-24T09:00:00Z', '2026-08-24T10:00:00Z'), { id: 'home' });
    expect(a.id).not.toBe(b.id);
    expect(a.googleId).toBe(b.googleId);
  });

  it('marks an event on a calendar you can only read', () => {
    const mine = fromGoogle(timed('2026-08-24T09:00:00Z', '2026-08-24T10:00:00Z'), { id: 'c', accessRole: 'owner' });
    const theirs = fromGoogle(timed('2026-08-24T09:00:00Z', '2026-08-24T10:00:00Z'), { id: 'c', accessRole: 'reader' });
    expect(mine.readOnly).toBe(false);
    expect(theirs.readOnly).toBe(true);
  });

  it('is never a draft — it is already on Google', () => {
    const event = fromGoogle(timed('2026-08-24T09:00:00Z', '2026-08-24T10:00:00Z'));
    expect(event.pushedAt).toBeTruthy();
  });
});

describe('mergeEvents', () => {
  const draft = { id: 'l1', title: 'Draft', googleId: null, pushedAt: null };
  const pushedLocally = { id: 'l2', title: 'Sent', googleId: 'abc123', pushedAt: 'yesterday' };
  const fromGoogleSide = { id: 'g:primary:abc123', googleId: 'abc123', title: 'Sent' };

  it('keeps drafts, which exist nowhere else', () => {
    expect(mergeEvents([draft], []).map((e) => e.id)).toEqual(['l1']);
  });

  it('does not show a pushed event twice', () => {
    // The local copy and Google's copy are the same booking. Google's is the
    // one that is real, so the local one steps aside.
    const merged = mergeEvents([draft, pushedLocally], [fromGoogleSide]);
    expect(merged.map((e) => e.id)).toEqual(['l1', 'g:primary:abc123']);
  });

  it("passes Google's events straight through", () => {
    expect(mergeEvents([], [fromGoogleSide]).length).toBe(1);
  });

  it('copes with neither side having anything', () => {
    expect(mergeEvents()).toEqual([]);
  });
});
