/**
 * iCalendar (RFC 5545) import and export — the subset LifeOS can represent
 * faithfully. Anything it cannot represent (EXDATE, RECURRENCE-ID overrides,
 * BYDAY with ordinals) is reported back as a warning, never silently dropped.
 */
import type { RecurrenceRule } from '@lifeos/extract';
import { zonedToUtc } from './time.ts';

export interface IcsEvent {
  uid: string;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  startDate?: string; // all-day
  endDate?: string; // all-day, inclusive
  startsAt?: Date;
  endsAt?: Date;
  timezone: string | null;
  recurrence: RecurrenceRule | null;
  warnings: string[];
}

export function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n').filter((l) => l.length > 0);
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function escape(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): Prop | null {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rawParams] = head.split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name!.toUpperCase(), params, value };
}

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function parseRrule(v: string, warnings: string[]): RecurrenceRule | null {
  const parts = Object.fromEntries(v.split(';').map((kv) => kv.split('=') as [string, string]));
  const freqMap: Record<string, RecurrenceRule['freq']> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
  const freq = freqMap[parts.FREQ ?? ''];
  if (!freq) {
    warnings.push(`Repeat rule "${v}" is not supported; only the first occurrence was imported.`);
    return null;
  }
  const rule: RecurrenceRule = { freq, interval: Math.max(1, Number(parts.INTERVAL ?? 1)) };
  if (parts.BYDAY) {
    const days = parts.BYDAY.split(',');
    if (days.some((d) => !DAY_CODES.includes(d))) {
      warnings.push(`Repeat rule "${v}" uses positions like "2nd Tuesday", which are not supported; only the first occurrence was imported.`);
      return null;
    }
    rule.byWeekday = days.map((d) => DAY_CODES.indexOf(d)).sort();
  }
  if (parts.BYMONTHDAY) rule.byMonthDay = Number(parts.BYMONTHDAY.split(',')[0]);
  if (parts.COUNT) rule.count = Number(parts.COUNT);
  if (parts.UNTIL) rule.until = `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`;
  return rule;
}

function parseDateValue(p: Prop, fallbackTz: string): { allDay: true; date: string } | { allDay: false; at: Date; tz: string | null } {
  const v = p.value.trim();
  if (p.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) return { allDay: true, date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` };
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) throw new Error(`Unreadable date "${v}"`);
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const time = `${m[4]}:${m[5]}`;
  if (m[7]) return { allDay: false, at: new Date(`${date}T${time}:${m[6] ?? '00'}Z`), tz: null };
  const tz = p.params.TZID ?? fallbackTz;
  try {
    return { allDay: false, at: zonedToUtc(date, time, tz), tz };
  } catch {
    // Windows-style TZIDs ("India Standard Time") are not IANA names.
    return { allDay: false, at: zonedToUtc(date, time, fallbackTz), tz: fallbackTz };
  }
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function parseIcs(text: string, fallbackTz: string): { events: IcsEvent[]; warnings: string[] } {
  const lines = unfold(text);
  if (!lines.some((l) => l.toUpperCase().startsWith('BEGIN:VCALENDAR'))) return { events: [], warnings: ['This file is not an iCalendar (.ics) file.'] };
  const events: IcsEvent[] = [];
  const warnings: string[] = [];
  let cur: Prop[] | null = null;
  let depth = 0;
  for (const line of lines) {
    const up = line.toUpperCase();
    if (up === 'BEGIN:VEVENT') {
      cur = [];
      depth = 0;
      continue;
    }
    if (cur && up.startsWith('BEGIN:')) depth++;
    if (cur && up.startsWith('END:') && up !== 'END:VEVENT') {
      depth--;
      continue;
    }
    if (up === 'END:VEVENT' && cur) {
      const ev = toEvent(cur, fallbackTz);
      if (ev) events.push(ev);
      else warnings.push('An event without a start date was skipped.');
      cur = null;
      continue;
    }
    if (cur && depth === 0) {
      const p = parseLine(line);
      if (p) cur.push(p);
    }
  }
  return { events, warnings };
}

function toEvent(props: Prop[], fallbackTz: string): IcsEvent | null {
  const get = (n: string) => props.find((p) => p.name === n);
  const start = get('DTSTART');
  if (!start) return null;
  const w: string[] = [];
  const s = parseDateValue(start, fallbackTz);
  const endP = get('DTEND');
  const title = unescape(get('SUMMARY')?.value ?? '(no title)').slice(0, 300);
  if (props.some((p) => p.name === 'EXDATE')) w.push(`"${title}": excluded dates (EXDATE) are not supported and were ignored.`);
  if (props.some((p) => p.name === 'RECURRENCE-ID')) w.push(`"${title}": a changed single occurrence was imported as its own event.`);
  const rr = get('RRULE');
  const recurrence = rr ? parseRrule(rr.value, w) : null;
  const base = {
    uid: (get('UID')?.value ?? `${title}-${start.value}`).slice(0, 300) + (get('RECURRENCE-ID') ? `#${get('RECURRENCE-ID')!.value}` : ''),
    title, description: get('DESCRIPTION') ? unescape(get('DESCRIPTION')!.value).slice(0, 10_000) : null,
    location: get('LOCATION') ? unescape(get('LOCATION')!.value).slice(0, 500) : null, recurrence, warnings: w,
  };
  if (s.allDay) {
    // DTEND for all-day events is exclusive in iCalendar.
    const e = endP ? parseDateValue(endP, fallbackTz) : null;
    const endDate = e && e.allDay ? dayBefore(e.date) : s.date;
    return { ...base, allDay: true, startDate: s.date, endDate: endDate < s.date ? s.date : endDate, timezone: null };
  }
  const e = endP ? parseDateValue(endP, fallbackTz) : null;
  const endsAt = e && !e.allDay ? e.at : new Date(s.at.getTime() + 60 * 60_000);
  return { ...base, allDay: false, startsAt: s.at, endsAt: endsAt < s.at ? s.at : endsAt, timezone: s.tz };
}

// ------------------------------------------------------------------ export

function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 75) {
      out.push(cur);
      cur = ` ${ch}`;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const compactDate = (iso: string) => iso.replace(/-/g, '');

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface ExportEvent {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  allDay: boolean;
  startDate?: string | null;
  endDate?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  recurrence?: RecurrenceRule | null;
  updatedAt?: Date;
}

function rruleOf(r: RecurrenceRule): string {
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byWeekday?.length) parts.push(`BYDAY=${r.byWeekday.map((d) => DAY_CODES[d]).join(',')}`);
  if (r.byMonthDay) parts.push(`BYMONTHDAY=${r.byMonthDay}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${compactDate(r.until)}`);
  return parts.join(';');
}

export function toIcs(events: ExportEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LifeOS//LifeOS 0.1//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@lifeos`, `DTSTAMP:${utc(e.updatedAt ?? now)}`);
    if (e.allDay && e.startDate) {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.startDate)}`, `DTEND;VALUE=DATE:${compactDate(dayAfter(e.endDate ?? e.startDate))}`);
    } else if (e.startsAt) {
      lines.push(`DTSTART:${utc(e.startsAt)}`, `DTEND:${utc(e.endsAt ?? e.startsAt)}`);
    }
    lines.push(`SUMMARY:${escape(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escape(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escape(e.location)}`);
    if (e.recurrence) lines.push(`RRULE:${rruleOf(e.recurrence)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
