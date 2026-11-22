/**
 * Date, time, range and recurrence recognition.
 *
 * Rules this module keeps:
 *   - A year that is not written is not filled in. The mention carries y: null
 *     and an `uncertain` entry so the reviewer has to choose.
 *   - A time that is not written is not filled in. Date-only stays date-only.
 *   - All-numeric dates with both parts ≤ 12 are ambiguous. The user's
 *     date-order preference picks the primary reading; the other is offered.
 *   - Relative expressions are resolved against an explicit anchor date (the
 *     date the source was written, or the capture date) and say so.
 */
import {
  type IsoDate,
  type PartialDate,
  addDays,
  addMonths,
  isValidYmd,
  monthFromName,
  partialToIso,
  toIso,
  weekday,
  weekdayFromName,
  parseIso,
} from './calendar.ts';

export type DateOrder = 'DMY' | 'MDY' | 'YMD';

export interface Uncertainty {
  field: string;
  reason:
    | 'year_missing'
    | 'day_missing'
    | 'day_month_order'
    | 'relative_reading'
    | 'vague_period'
    | 'window_start'
    | 'derived_from_term'
    | 'amount_choice'
    | 'direction'
    | 'guessed_name'
    | 'date_missing'
    | 'cycle_missing'
    | 'date_choice';
  message: string;
  alternatives?: unknown[];
}

export interface TimeOfDay {
  h: number;
  m: number;
}

export interface DateMention {
  start: number;
  end: number;
  text: string;
  kind: 'absolute' | 'relative' | 'range';
  date: PartialDate;
  endDate?: PartialDate;
  time?: TimeOfDay;
  endTime?: TimeOfDay;
  /** The date a relative expression was resolved against. */
  anchor?: IsoDate;
  uncertain: Uncertainty[];
}

export interface DateContext {
  /** Anchor for relative expressions: source date if known, else capture date (user's local date). */
  today: IsoDate;
  order?: DateOrder;
}

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const WEEKDAY_RE = '(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?![a-z])';
const ORD = '(?:st|nd|rd|th)?';

/** Converts Devanagari and Bengali digits to ASCII so Indian-script dates parse. */
export function normaliseDigits(text: string): string {
  return text.replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966)).replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 0x09e6));
}

// ------------------------------------------------------------------ times

const TIME_12 = /\b(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/gi;
const TIME_24 = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:hrs?|hours|h\b)?(?!\s*(?:a\.?m|p\.?m|%|\d))/gi;
const TIME_WORDS = /\b(noon|midday|midnight)\b/gi;

export interface TimeMention {
  start: number;
  end: number;
  time: TimeOfDay;
}

export function findTimes(text: string): TimeMention[] {
  const out: TimeMention[] = [];
  for (const m of text.matchAll(TIME_12)) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const pm = m[3]!.toLowerCase().startsWith('p');
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    out.push({ start: m.index!, end: m.index! + m[0].length, time: { h, m: min } });
  }
  for (const m of text.matchAll(TIME_24)) {
    const start = m.index!;
    if (out.some((t) => start >= t.start && start < t.end)) continue;
    // "12.50" next to a currency marker is money, not a time.
    const before = text.slice(Math.max(0, start - 4), start);
    if (/(₹|rs\.?|inr|\$|€|£)\s*$/i.test(before)) continue;
    if (m[0].includes('.') && !/hrs?|hours/i.test(m[0])) continue;
    out.push({ start, end: start + m[0].length, time: { h: Number(m[1]), m: Number(m[2]) } });
  }
  for (const m of text.matchAll(TIME_WORDS)) {
    const word = m[1]!.toLowerCase();
    out.push({ start: m.index!, end: m.index! + m[0].length, time: word === 'midnight' ? { h: 0, m: 0 } : { h: 12, m: 0 } });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------------ dates

function numericReading(a: number, b: number, y: number, order: DateOrder): { primary: PartialDate; alt?: PartialDate } | null {
  const dmy = isValidYmd(y, b, a) ? { y, m: b, d: a } : null;
  const mdy = isValidYmd(y, a, b) ? { y, m: a, d: b } : null;
  if (dmy && mdy && a !== b) {
    return order === 'MDY' ? { primary: mdy, alt: dmy } : { primary: dmy, alt: mdy };
  }
  const only = dmy ?? mdy;
  return only ? { primary: only } : null;
}

function expandYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

function yearUncertain(field: string): Uncertainty {
  return { field, reason: 'year_missing', message: 'The year is not written in the source. Choose it before saving.' };
}

export function findDates(input: string, ctx: DateContext): DateMention[] {
  const text = normaliseDigits(input);
  const order = ctx.order ?? 'DMY';
  const found: DateMention[] = [];
  const push = (m: DateMention) => found.push(m);

  // --- ranges first so their parts are not also reported as single dates
  // "3-5 Dec 2026", "3 to 5 December", "Dec 3-5, 2026"
  const rangeDayFirst = new RegExp(`\\b(\\d{1,2})${ORD}\\s*(?:-|–|—|to|till|until)\\s*(\\d{1,2})${ORD}\\s+${MONTH_RE}(?:,?\\s*(\\d{4}))?`, 'gi');
  for (const m of text.matchAll(rangeDayFirst)) {
    const month = monthFromName(m[3]!)!;
    const y = m[4] ? Number(m[4]) : null;
    const d1 = Number(m[1]);
    const d2 = Number(m[2]);
    if (d2 < d1) continue;
    const yr = y ?? 2000;
    if (!isValidYmd(yr, month, d1) || !isValidYmd(yr, month, d2)) continue;
    push({
      start: m.index!, end: m.index! + m[0].length, text: m[0], kind: 'range',
      date: { y, m: month, d: d1 }, endDate: { y, m: month, d: d2 },
      uncertain: y === null ? [yearUncertain('date')] : [],
    });
  }
  const rangeMonthFirst = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})${ORD}\\s*(?:-|–|—|to)\\s*(\\d{1,2})${ORD}(?:,?\\s*(\\d{4}))?`, 'gi');
  for (const m of text.matchAll(rangeMonthFirst)) {
    const month = monthFromName(m[1]!)!;
    const y = m[4] ? Number(m[4]) : null;
    const d1 = Number(m[2]);
    const d2 = Number(m[3]);
    if (d2 < d1 || !isValidYmd(y ?? 2000, month, d2)) continue;
    push({
      start: m.index!, end: m.index! + m[0].length, text: m[0], kind: 'range',
      date: { y, m: month, d: d1 }, endDate: { y, m: month, d: d2 },
      uncertain: y === null ? [yearUncertain('date')] : [],
    });
  }

  // --- ISO 2026-11-22 (optionally with T10:30)
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?\b/g)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!isValidYmd(y, mo, d)) continue;
    push({
      start: m.index!, end: m.index! + m[0].length, text: m[0], kind: 'absolute',
      date: { y, m: mo, d }, ...(m[4] ? { time: { h: Number(m[4]), m: Number(m[5]) } } : {}), uncertain: [],
    });
  }

  // --- numeric 22/11/2026, 22-11-26, 22.11.2026
  for (const m of text.matchAll(/\b(\d{1,2})([/.\-])(\d{1,2})\2(\d{4}|\d{2})\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const y = expandYear(m[4]!);
    const reading = numericReading(a, b, y, order === 'YMD' ? 'DMY' : order);
    if (!reading) continue;
    const uncertain: Uncertainty[] = [];
    if (reading.alt) {
      uncertain.push({
        field: 'date',
        reason: 'day_month_order',
        message: `"${m[0]}" could be ${partialToIso(reading.primary)} or ${partialToIso(reading.alt)}. Read as ${order === 'MDY' ? 'month first' : 'day first'} per your settings.`,
        alternatives: [partialToIso(reading.primary), partialToIso(reading.alt)],
      });
    }
    push({ start: m.index!, end: m.index! + m[0].length, text: m[0], kind: 'absolute', date: reading.primary, uncertain });
  }

  // --- written: "Friday, 28th November 2026", "28 Nov", "28th of November, 2026"
  const dayFirst = new RegExp(`\\b(?:${WEEKDAY_RE},?\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s*('?\\d{4}|'\\d{2}))?(?![a-z])`, 'gi');
  for (const m of text.matchAll(dayFirst)) {
    const d = Number(m[2]);
    const month = monthFromName(m[3]!)!;
    const y = m[4] ? expandYear(m[4].replace("'", '')) : null;
    if (!isValidYmd(y ?? 2000, month, d)) continue;
    push({
      start: m.index!, end: m.index! + m[0].length, text: m[0], kind: 'absolute',
      date: { y, m: month, d }, uncertain: y === null ? [yearUncertain('date')] : [],
    });
  }
  // "November 28, 2026", "Nov 28th", "Friday, November 28"
  const monthFirst = new RegExp(`\\b(?:${WEEKDAY_RE},?\\s+)?${MONTH_RE}\\s+(\\d{1,2})${ORD}(?![\\d:])(?:,?\\s*(\\d{4}))?`, 'gi');
  for (const m of text.matchAll(monthFirst)) {
    const month = monthFromName(m[2]!)!;
    const d = Number(m[3]);
    const y = m[4] ? Number(m[4]) : null;
    if (!isValidYmd(y ?? 2000, month, d)) continue;
    push({
      start: m.index!, end: m.index! + m[0].length, text: m[0], kind: 'absolute',
      date: { y, m: month, d }, uncertain: y === null ? [yearUncertain('date')] : [],
    });
  }
  // "March 2027" / "03/2027" — month and year with no day
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE},?\\s+(\\d{4})\\b`, 'gi'))) {
    push({
      start: m.index!, end: m.index! + m[0].length, text: m[0], kind: 'absolute',
      date: { y: Number(m[2]), m: monthFromName(m[1]!)!, d: null },
      uncertain: [{ field: 'date', reason: 'day_missing', message: 'Only the month and year are written. Choose the day before saving.' }],
    });
  }

  // --- relative
  const anchor = ctx.today;
  const rel = (m: RegExpMatchArray, iso: IsoDate, extra: Uncertainty[] = []) => {
    const { y, m: mo, d } = parseIso(iso);
    push({ start: m.index!, end: m.index! + m[0].length, text: m[0], kind: 'relative', date: { y, m: mo, d }, anchor, uncertain: extra });
  };
  for (const m of text.matchAll(/\b(day after tomorrow|tomorrow|tmrw|today|tonight|yesterday)\b/gi)) {
    const w = m[1]!.toLowerCase();
    const n = w === 'day after tomorrow' ? 2 : w === 'tomorrow' || w === 'tmrw' ? 1 : w === 'yesterday' ? -1 : 0;
    rel(m, addDays(anchor, n));
  }
  for (const m of text.matchAll(/\b(?:in|within)\s+(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})\s+(business\s+|working\s+)?(day|week)s?\b/gi)) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (hi < lo) continue;
    const business = Boolean(m[3]);
    const unit = m[4]!.toLowerCase();
    const iso = unit === 'week' ? addDays(anchor, 7 * hi) : business ? addBusinessDays(anchor, hi) : addDays(anchor, hi);
    rel(m, iso, [
      { field: 'date', reason: 'relative_reading', message: `"${m[0]}" is a range counted from ${anchor}; the later end (${iso}) is used.` },
    ]);
  }
  for (const m of text.matchAll(/\b(?:in|after|within)\s+(\d{1,3}|a|an|one|two|three|four|five|six|seven|ten|fifteen|thirty)\s+(business\s+|working\s+)?(day|week|month|year)s?\b/gi)) {
    const n = wordNumber(m[1]!);
    if (n === null) continue;
    const unit = m[3]!.toLowerCase();
    const business = Boolean(m[2]);
    const iso = unit === 'day' ? (business ? addBusinessDays(anchor, n) : addDays(anchor, n)) : unit === 'week' ? addDays(anchor, 7 * n) : unit === 'month' ? addMonths(anchor, n) : addMonths(anchor, 12 * n);
    const extra: Uncertainty[] = [
      { field: 'date', reason: 'relative_reading', message: `"${m[0]}" was counted from ${anchor}. If it should count from another date (delivery, issue date), change it.` },
    ];
    rel(m, iso, extra);
  }
  for (const m of text.matchAll(new RegExp(`\\b(this|next|coming|on|by|before|until)?\\s*${WEEKDAY_RE}\\b(?!,?\\s*(?:\\d|${MONTH_RE}))`, 'gi'))) {
    const qualifier = (m[1] ?? '').toLowerCase();
    const wd = weekdayFromName(m[2]!);
    if (wd === null) continue;
    // A bare weekday with no qualifier inside a longer sentence is only taken
    // when it reads like a day reference ("on Friday", "Friday at 5").
    if (!qualifier) {
      const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 12);
      if (!/^\s*(at|by|morning|evening|night|afternoon)\b/i.test(after)) continue;
    }
    const today = weekday(anchor);
    let delta = (wd - today + 7) % 7;
    const uncertain: Uncertainty[] = [];
    if (qualifier === 'next') {
      if (delta === 0) delta = 7;
      // "next Friday" said on Monday can mean this coming Friday or the one after.
      const alt = addDays(anchor, delta + 7);
      const primary = addDays(anchor, delta);
      uncertain.push({
        field: 'date', reason: 'relative_reading',
        message: `"${m[0].trim()}" can mean ${primary} or ${alt}. Pick the one you meant.`,
        alternatives: [primary, alt],
      });
    } else if (delta === 0 && qualifier !== 'this') {
      delta = 7;
    }
    const start = m.index! + (m[0].length - m[0].trimStart().length);
    const iso = addDays(anchor, delta);
    const { y, m: mo, d } = parseIso(iso);
    push({ start, end: m.index! + m[0].length, text: m[0].trim(), kind: 'relative', date: { y, m: mo, d }, anchor, uncertain });
  }
  for (const m of text.matchAll(/\b(next week|next month|this weekend|end of (?:the )?month|end of (?:the )?week)\b/gi)) {
    const w = m[1]!.toLowerCase();
    let iso: IsoDate;
    if (w === 'next week') iso = addDays(anchor, 7 - weekday(anchor));
    else if (w === 'next month') iso = addMonths(anchor, 1).slice(0, 8) + '01';
    else if (w === 'this weekend') iso = addDays(anchor, (5 - weekday(anchor) + 7) % 7);
    else if (w.startsWith('end of') && w.endsWith('week')) iso = addDays(anchor, 6 - weekday(anchor));
    else {
      const { y, m: mo } = parseIso(anchor);
      iso = toIso(y, mo, new Date(Date.UTC(y, mo, 0)).getUTCDate());
    }
    rel(m, iso, [{ field: 'date', reason: 'vague_period', message: `"${m[0]}" is a period, not a day. Shown as ${iso}; adjust if you meant another day.` }]);
  }

  const resolved = resolveOverlaps(found);
  attachTimes(text, resolved);
  return resolved;
}

function wordNumber(w: string): number | null {
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fifteen: 15, thirty: 30 };
  if (/^\d+$/.test(w)) return Number(w);
  return words[w.toLowerCase()] ?? null;
}

function addBusinessDays(iso: IsoDate, n: number): IsoDate {
  let cur = iso;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (weekday(cur) < 5) left--;
  }
  return cur;
}

const KIND_RANK = { range: 3, absolute: 2, relative: 1 } as const;

function resolveOverlaps(items: DateMention[]): DateMention[] {
  const sorted = [...items].sort((a, b) => b.end - b.start - (a.end - a.start) || KIND_RANK[b.kind] - KIND_RANK[a.kind]);
  const kept: DateMention[] = [];
  for (const it of sorted) {
    if (kept.some((k) => it.start < k.end && k.start < it.end)) continue;
    kept.push(it);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Attaches a time written next to a date ("28 Nov at 5pm", "10:30 on 3 Dec"). */
function attachTimes(text: string, mentions: DateMention[]): void {
  const times = findTimes(text).filter((t) => !mentions.some((m) => t.start < m.end && m.start < t.end));
  for (const m of mentions) {
    if (m.time) continue;
    const near = times.filter((t) => {
      const gap = t.start >= m.end ? text.slice(m.end, t.start) : text.slice(t.end, m.start);
      return gap.length <= 24 && !/[\n.;]/.test(gap) && /^[\s,]*(?:at|@|from|by|,|-|–|on)?[\s,]*$/i.test(gap.replace(/\b(?:at|from|on|by)\b/gi, ' '));
    });
    if (near.length === 0) continue;
    m.time = near[0]!.time;
    m.end = Math.max(m.end, near[0]!.end);
    m.start = Math.min(m.start, near[0]!.start);
    m.text = text.slice(m.start, m.end);
    // A time range: "10:00 - 11:30", "5pm to 6pm"
    const second = near[1] ?? times.find((t) => t.start > near[0]!.end && /^\s*(?:-|–|to|till|until)\s*$/i.test(text.slice(near[0]!.end, t.start)));
    if (second && second.time && /^\s*(?:-|–|to|till|until)\s*$/i.test(text.slice(near[0]!.end, second.start))) {
      m.endTime = second.time;
      m.end = Math.max(m.end, second.end);
      m.text = text.slice(m.start, m.end);
    }
  }
}

// ------------------------------------------------------------------ recurrence

export interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  /** 0 = Monday … 6 = Sunday */
  byWeekday?: number[];
  byMonthDay?: number;
  until?: IsoDate;
  count?: number;
}

export interface RecurrenceMention {
  start: number;
  end: number;
  text: string;
  rule: RecurrenceRule;
}

export function findRecurrence(input: string): RecurrenceMention | null {
  const text = normaliseDigits(input);
  const patterns: [RegExp, (m: RegExpMatchArray) => RecurrenceRule | null][] = [
    [/\bevery\s+weekday\b/i, () => ({ freq: 'weekly', interval: 1, byWeekday: [0, 1, 2, 3, 4] })],
    [
      new RegExp(`\\bevery\\s+((?:${WEEKDAY_RE}(?:\\s*(?:,|and|&)\\s*)?)+)`, 'i'),
      (m) => {
        const days = [...m[1]!.matchAll(new RegExp(WEEKDAY_RE, 'gi'))].map((d) => weekdayFromName(d[0])).filter((d): d is number => d !== null);
        return days.length ? { freq: 'weekly', interval: 1, byWeekday: [...new Set(days)].sort() } : null;
      },
    ],
    [/\b(?:on\s+the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?every\s+month\b/i, (m) => monthDay(Number(m[1]))],
    [/\bevery\s+month\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, (m) => monthDay(Number(m[1]))],
    [/\bmonthly\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, (m) => monthDay(Number(m[1]))],
    [/\bevery\s+other\s+(day|week|month|year)\b/i, (m) => ({ freq: unitFreq(m[1]!), interval: 2 })],
    [/\bevery\s+(\d{1,3})\s+(day|week|month|year)s?\b/i, (m) => ({ freq: unitFreq(m[2]!), interval: Math.max(1, Number(m[1])) })],
    [/\b(?:every\s+day|daily|each\s+day)\b/i, () => ({ freq: 'daily', interval: 1 })],
    [/\b(?:every\s+week|weekly|each\s+week)\b/i, () => ({ freq: 'weekly', interval: 1 })],
    [/\b(?:every\s+month|monthly|each\s+month)\b/i, () => ({ freq: 'monthly', interval: 1 })],
    [/\b(?:every\s+quarter|quarterly)\b/i, () => ({ freq: 'monthly', interval: 3 })],
    [/\b(?:every\s+year|yearly|annually|each\s+year)\b/i, () => ({ freq: 'yearly', interval: 1 })],
  ];
  for (const [re, build] of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const rule = build(m);
    if (!rule) continue;
    let end = m.index! + m[0].length;
    const tail = text.slice(end);
    const until = /^\s*(?:until|till)\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4})/i.exec(tail);
    if (until) {
      const d = findDates(until[1]!, { today: '2000-01-01' })[0];
      const iso = d ? partialToIso(d.date) : null;
      if (iso) {
        rule.until = iso;
        end += until[0].length;
      }
    }
    const count = /^\s*for\s+(\d{1,3})\s+(?:times|occurrences|weeks|months|days)/i.exec(tail);
    if (count) {
      rule.count = Number(count[1]);
      end += count[0].length;
    }
    return { start: m.index!, end, text: text.slice(m.index!, end), rule };
  }
  return null;
}

function monthDay(d: number): RecurrenceRule | null {
  return d >= 1 && d <= 31 ? { freq: 'monthly', interval: 1, byMonthDay: d } : null;
}

function unitFreq(u: string): RecurrenceRule['freq'] {
  const s = u.toLowerCase();
  return s.startsWith('day') ? 'daily' : s.startsWith('week') ? 'weekly' : s.startsWith('month') ? 'monthly' : 'yearly';
}

export function describeRecurrence(rule: RecurrenceRule): string {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq];
  let s = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  if (rule.byWeekday?.length) s += ` on ${rule.byWeekday.map((d) => names[d]).join(', ')}`;
  if (rule.byMonthDay) s += ` on day ${rule.byMonthDay}`;
  if (rule.until) s += ` until ${rule.until}`;
  if (rule.count) s += `, ${rule.count} times`;
  return s;
}
