/**
 * Natural-language quick add: "Remind me to submit the form next Friday at 5pm".
 *
 * Returns the parsed parts *and* a plain-language interpretation so the UI can
 * show what will be saved before the user presses Enter.
 */
import { type IsoDate, describeDate, partialToIso } from './calendar.ts';
import { type DateOrder, type RecurrenceRule, type Uncertainty, describeRecurrence, findDates, findRecurrence } from './dates.ts';

export interface QuickAdd {
  title: string;
  dueDate: IsoDate | null;
  dueTime: string | null;
  recurrence: RecurrenceRule | null;
  priority: 0 | 1 | 2 | 3;
  tags: string[];
  interpretation: string;
  uncertain: Uncertainty[];
  /** The text that was read as a date, for highlighting. */
  matched: string[];
}

export function parseQuickAdd(input: string, ctx: { today: IsoDate; order?: DateOrder; locale?: string }): QuickAdd {
  let text = input.trim();
  const tags = [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{1,32})/gu)].map((m) => m[1]!.toLowerCase());
  text = text.replace(/(?:^|\s)#[\p{L}\p{N}_-]{1,32}/gu, ' ');
  let priority: QuickAdd['priority'] = 0;
  const p = /(?:^|\s)(?:!{1,3}|p([1-3]))(?=\s|$)/i.exec(text);
  if (p) {
    priority = p[1] ? ((4 - Number(p[1])) as 1 | 2 | 3) : (Math.min(3, p[0].trim().length) as 1 | 2 | 3);
    text = text.replace(p[0], ' ');
  }

  const matched: string[] = [];
  const recurrence = findRecurrence(text);
  if (recurrence) {
    matched.push(recurrence.text);
    text = `${text.slice(0, recurrence.start)} ${text.slice(recurrence.end)}`;
  }
  const dates = findDates(text, ctx);
  const d = dates[0];
  let dueDate: IsoDate | null = null;
  let dueTime: string | null = null;
  const uncertain: Uncertainty[] = [];
  if (d) {
    matched.push(d.text);
    dueDate = partialToIso(d.date);
    dueTime = d.time ? `${String(d.time.h).padStart(2, '0')}:${String(d.time.m).padStart(2, '0')}` : null;
    uncertain.push(...d.uncertain.map((u) => ({ ...u, field: 'dueDate' })));
    text = `${text.slice(0, d.start)} ${text.slice(d.end)}`;
  } else {
    // A bare time ("call mom at 5pm") is not given a date silently.
    const t = /\b(?:at\s+)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i.exec(text);
    if (t) {
      let h = Number(t[1]) % 12;
      if (t[3]!.toLowerCase() === 'pm') h += 12;
      dueTime = `${String(h).padStart(2, '0')}:${t[2] ?? '00'}`;
      matched.push(t[0]);
      text = text.replace(t[0], ' ');
      uncertain.push({ field: 'dueDate', reason: 'date_missing', message: 'A time was given without a day. Choose the day.' });
    }
  }

  const title = text
    .replace(/^\s*(?:remind\s+me\s+to|remember\s+to|don'?t\s+forget\s+to|todo:?|to-do:?)\s+/i, '')
    .replace(/\s+(?:on|by|at|before|from|due)\s*$/i, '')
    .replace(/\s+(?:on|by|at|before|due)\s+(?=\s|$)/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const cleanTitle = title ? title.charAt(0).toUpperCase() + title.slice(1) : input.trim();

  const parts: string[] = [];
  if (dueDate) parts.push(describeDate(dueDate, ctx.locale));
  else if (d) parts.push(`${d.text} — year not stated`);
  if (dueTime) parts.push(`at ${dueTime}`);
  if (recurrence) parts.push(describeRecurrence(recurrence.rule).toLowerCase());
  if (priority) parts.push(`priority ${priority}`);
  if (tags.length) parts.push(tags.map((t) => `#${t}`).join(' '));
  const interpretation = parts.length ? `“${cleanTitle}” · ${parts.join(' · ')}` : `“${cleanTitle}” · no date`;

  return { title: cleanTitle, dueDate, dueTime: dueDate ? dueTime : dueTime, recurrence: recurrence?.rule ?? null, priority, tags, interpretation, uncertain, matched };
}
