/**
 * Recurrence for tasks, routines and events. A small, tested subset of RFC 5545
 * RRULE: daily/weekly/monthly/yearly with interval, weekdays, month day,
 * until and count. Dates only — the time of day is applied separately in the
 * series' own timezone, which is what keeps 09:00 at 09:00 across DST.
 */
import { type IsoDate, type RecurrenceRule, addDays, addMonths, daysInMonth, parseIso, startOfWeek, toIso, weekday } from '@lifeos/extract';
import { z } from 'zod';

export const recurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(366).default(1),
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  byMonthDay: z.number().int().min(1).max(31).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  count: z.number().int().min(1).max(10_000).optional(),
});

const MAX_ITER = 20_000;

/** All occurrence dates from `start` (the series' first date), in order, lazily. */
export function* occurrences(rule: RecurrenceRule, start: IsoDate): Generator<IsoDate> {
  let produced = 0;
  const done = (d: IsoDate) => (rule.until && d > rule.until) || (rule.count !== undefined && produced >= rule.count);
  const emit = function* (d: IsoDate) {
    if (d < start) return;
    produced++;
    yield d;
  };
  const interval = Math.max(1, rule.interval || 1);
  if (rule.freq === 'daily') {
    for (let i = 0; i < MAX_ITER; i++) {
      const d = addDays(start, i * interval);
      if (done(d)) return;
      yield* emit(d);
    }
    return;
  }
  if (rule.freq === 'weekly') {
    const days = rule.byWeekday?.length ? [...rule.byWeekday].sort() : [weekday(start)];
    const week0 = startOfWeek(start);
    for (let w = 0; w < MAX_ITER; w++) {
      const base = addDays(week0, w * 7 * interval);
      for (const wd of days) {
        const d = addDays(base, wd);
        if (d < start) continue;
        if (done(d)) return;
        yield* emit(d);
      }
    }
    return;
  }
  const s = parseIso(start);
  if (rule.freq === 'monthly') {
    const dom = rule.byMonthDay ?? s.d;
    for (let i = 0; i < MAX_ITER; i++) {
      const first = addMonths(toIso(s.y, s.m, 1), i * interval);
      const { y, m } = parseIso(first);
      // The 31st in a 30-day month falls on the 30th (last day), never skipped.
      const d = toIso(y, m, Math.min(dom, daysInMonth(y, m)));
      if (d < start) continue;
      if (done(d)) return;
      yield* emit(d);
    }
    return;
  }
  for (let i = 0; i < MAX_ITER; i++) {
    const y = s.y + i * interval;
    const d = toIso(y, s.m, Math.min(s.d, daysInMonth(y, s.m)));
    if (done(d)) return;
    yield* emit(d);
  }
}

/** First occurrence strictly after `after`, or null when the series has ended. */
export function nextOccurrence(rule: RecurrenceRule, start: IsoDate, after: IsoDate): IsoDate | null {
  for (const d of occurrences(rule, start)) if (d > after) return d;
  return null;
}

export function occurrencesBetween(rule: RecurrenceRule, start: IsoDate, from: IsoDate, to: IsoDate, limit = 500): IsoDate[] {
  const out: IsoDate[] = [];
  for (const d of occurrences(rule, start)) {
    if (d > to || out.length >= limit) break;
    if (d >= from) out.push(d);
  }
  return out;
}
