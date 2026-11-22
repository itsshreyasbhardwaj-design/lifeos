/**
 * Date-only arithmetic on ISO `YYYY-MM-DD` strings.
 *
 * Everything here works on calendar dates, not instants, so it is immune to
 * timezone and DST effects by construction. Instants live in @lifeos/core/time.
 */

export type IsoDate = string; // YYYY-MM-DD

/** A date as written: any part the source did not state is null. */
export interface PartialDate {
  y: number | null;
  m: number | null;
  d: number | null;
}

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toIso(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseIso(iso: IsoDate): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Not an ISO date: ${iso}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isValidYmd(y, m, d)) throw new Error(`Invalid date: ${iso}`);
  return { y, m, d };
}

export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  return isValidYmd(y, m, d);
}

function toUtcMs(iso: IsoDate): number {
  const { y, m, d } = parseIso(iso);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): IsoDate {
  const dt = new Date(ms);
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  return fromUtcMs(toUtcMs(iso) + n * 86_400_000);
}

/** Adds months, clamping to the last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: IsoDate, n: number): IsoDate {
  const { y, m, d } = parseIso(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toIso(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addYears(iso: IsoDate, n: number): IsoDate {
  return addMonths(iso, n * 12);
}

/** 0 = Monday … 6 = Sunday (ISO weekday minus one). */
export function weekday(iso: IsoDate): number {
  return (new Date(toUtcMs(iso)).getUTCDay() + 6) % 7;
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(a) - toUtcMs(b)) / 86_400_000);
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function startOfWeek(iso: IsoDate): IsoDate {
  return addDays(iso, -weekday(iso));
}

export function endOfMonth(iso: IsoDate): IsoDate {
  const { y, m } = parseIso(iso);
  return toIso(y, m, daysInMonth(y, m));
}

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export const WEEKDAY_SHORT = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;

export function monthFromName(name: string): number | null {
  const n = name.toLowerCase().replace(/\.$/, '');
  if (n === 'sept') return 9;
  const idx = MONTHS.findIndex((m) => m === n || m.slice(0, 3) === n);
  return idx === -1 ? null : idx + 1;
}

export function weekdayFromName(name: string): number | null {
  const n = name.toLowerCase().replace(/\.$/, '');
  const idx = WEEKDAYS.findIndex((w) => w === n || w.slice(0, 3) === n || (n.length >= 3 && w.startsWith(n)));
  return idx === -1 ? null : idx;
}

/** Human-friendly rendering used in review screens; never used for storage. */
export function describeDate(iso: IsoDate, locale = 'en-IN'): string {
  const { y, m, d } = parseIso(iso);
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function describePartial(p: PartialDate): string {
  const month = p.m ? MONTHS[p.m - 1]!.slice(0, 3) : '???';
  const cap = month.charAt(0).toUpperCase() + month.slice(1);
  return `${p.d ?? '??'} ${cap} ${p.y ?? '(year not stated)'}`;
}

export function partialToIso(p: PartialDate): IsoDate | null {
  if (p.y === null || p.m === null || p.d === null) return null;
  return isValidYmd(p.y, p.m, p.d) ? toIso(p.y, p.m, p.d) : null;
}
