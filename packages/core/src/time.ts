/**
 * Instants vs wall-clock time.
 *
 * Reminders are stored as UTC instants, but they are *computed* from a local
 * date + time + IANA timezone, so "9:00 every Monday" stays 9:00 across DST
 * changes and when the user moves timezone (we recompute from the rule).
 */
import { type IsoDate, toIso } from '@lifeos/extract';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(at: Date, tz: string) {
  const p = Object.fromEntries(fmt(tz).formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), s: Number(p.second) };
}

/** Offset of tz from UTC at the given instant, in ms (IST = +19_800_000). */
export function tzOffsetMs(at: Date, tz: string): number {
  const p = parts(at, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Local wall-clock → instant. In a DST gap (a time that does not exist) the
 * result moves forward by the gap; in an overlap (a time that happens twice)
 * the earlier instant is used. Both are the conventional calendar behaviour.
 */
export function zonedToUtc(date: IsoDate, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMs(new Date(wall), tz);
  let t = wall - off1;
  const off2 = tzOffsetMs(new Date(t), tz);
  if (off2 !== off1) {
    const t2 = wall - off2;
    // Gap: neither candidate maps back to the wall time; take the later one.
    // Overlap: both map back; take the earlier one.
    const back = (x: number) => { const p = parts(new Date(x), tz); return p.h === hh && p.min === mm; };
    if (back(t) && back(t2)) t = Math.min(t, t2);
    else if (back(t2)) t = t2;
    else t = Math.max(t, t2);
  }
  return new Date(t);
}

export function localParts(at: Date, tz: string): { date: IsoDate; time: string } {
  const p = parts(at, tz);
  return { date: toIso(p.y, p.m, p.d), time: `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}` };
}

export function todayIn(tz: string, now: Date = new Date()): IsoDate {
  return localParts(now, tz).date;
}

/** True when the local time of `at` falls in [start, end), wrapping past midnight. */
export function inQuietHours(at: Date, tz: string, start: string | null, end: string | null): boolean {
  if (!start || !end || start === end) return false;
  const t = localParts(at, tz).time;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

/** Next instant at which quiet hours end, in local time. */
export function quietHoursEnd(at: Date, tz: string, end: string): Date {
  const local = localParts(at, tz);
  const sameDay = zonedToUtc(local.date, end, tz);
  if (sameDay.getTime() > at.getTime()) return sameDay;
  const [y, m, d] = local.date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return zonedToUtc(next.toISOString().slice(0, 10), end, tz);
}

export function normaliseTime(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?$/.exec(String(v));
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
}
