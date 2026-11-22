/**
 * Money recognition. Amounts are returned in integer minor units (paise,
 * cents) with an ISO 4217 code. A number with no currency marker is not
 * treated as money.
 */
import { normaliseDigits } from './dates.ts';

export interface MoneyMention {
  start: number;
  end: number;
  text: string;
  amountMinor: number;
  currency: string;
  /** What the line calls this amount, if anything ("total", "amount due"). */
  label: MoneyLabel | null;
  /** Billing period written next to the amount ("/month", "per year"). */
  period: 'week' | 'month' | 'quarter' | 'year' | null;
  line: number;
}

export type MoneyLabel = 'total' | 'paid' | 'due' | 'subtotal' | 'tax' | 'discount' | 'shipping' | 'price' | 'refund' | 'mrp';

const SYMBOLS: [RegExp, string][] = [
  [/₹/, 'INR'],
  [/^rs\.?$/i, 'INR'],
  [/^inr$/i, 'INR'],
  [/\$/, 'USD'],
  [/^usd$/i, 'USD'],
  [/€/, 'EUR'],
  [/^eur$/i, 'EUR'],
  [/£/, 'GBP'],
  [/^gbp$/i, 'GBP'],
  [/^aed$/i, 'AED'],
  [/^sgd$/i, 'SGD'],
];

// Indian grouping (1,49,999), western grouping (149,999) or plain digits; optional decimals.
const NUMBER = '(\\d{1,3}(?:,\\d{2})+,\\d{3}|\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?';
const PREFIX = new RegExp(`(₹|rs\\.?|inr|usd|us\\$|\\$|€|eur|£|gbp|aed|sgd)\\s?${NUMBER}(?:\\s*/-)?`, 'gi');
const SUFFIX = new RegExp(`\\b${NUMBER}\\s?(inr|rupees|usd|eur|gbp|aed|sgd)\\b`, 'gi');

const LABELS: [RegExp, MoneyLabel][] = [
  [/\b(grand\s+total|total\s+amount|order\s+total|invoice\s+total|net\s+(?:amount|payable)|amount\s+payable|total\s+payable|total)\b/i, 'total'],
  [/\b(amount\s+paid|paid|you\s+paid|payment\s+of|charged)\b/i, 'paid'],
  [/\b(amount\s+due|total\s+due|due\s+amount|balance\s+due|bill\s+amount|outstanding|pay(?:able)?\s+by)\b/i, 'due'],
  [/\b(sub\s*-?\s*total)\b/i, 'subtotal'],
  [/\b(gst|cgst|sgst|igst|vat|tax)\b/i, 'tax'],
  [/\b(discount|savings|you\s+save|coupon)\b/i, 'discount'],
  [/\b(shipping|delivery\s+(?:fee|charges?)|convenience\s+fee)\b/i, 'shipping'],
  [/\b(refund(?:ed)?)\b/i, 'refund'],
  [/\b(m\.?r\.?p\.?)\b/i, 'mrp'],
  [/\b(price|amount|cost|fee|plan)\b/i, 'price'],
];

function currencyOf(token: string): string {
  const t = token.trim();
  for (const [re, code] of SYMBOLS) if (re.test(t)) return code;
  if (/rupees/i.test(t)) return 'INR';
  if (/us\$/i.test(t)) return 'USD';
  return 'INR';
}

function toMinor(intPart: string, frac: string | undefined): number {
  const whole = Number(intPart.replace(/,/g, ''));
  const cents = frac ? Number(frac.padEnd(2, '0')) : 0;
  return whole * 100 + cents;
}

function periodNear(after: string): MoneyMention['period'] {
  const s = after.slice(0, 24).toLowerCase();
  if (/^\s*(?:\/|per\s+|a\s+|every\s+)\s*(?:mo\b|month|mon\b)|^\s*(?:monthly|p\/m|pm\b)/.test(s)) return 'month';
  if (/^\s*(?:\/|per\s+|a\s+|every\s+)\s*(?:yr\b|year|annum)|^\s*(?:yearly|annually|p\.a\.|pa\b)/.test(s)) return 'year';
  if (/^\s*(?:\/|per\s+|every\s+)\s*(?:quarter)|^\s*quarterly/.test(s)) return 'quarter';
  if (/^\s*(?:\/|per\s+|a\s+|every\s+)\s*(?:wk\b|week)|^\s*weekly/.test(s)) return 'week';
  return null;
}

export function findMoney(input: string): MoneyMention[] {
  const text = normaliseDigits(input);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0;
    for (let i = 0; i < lineStarts.length; i++) if (lineStarts[i]! <= pos) lo = i;
    return lo;
  };
  const out: MoneyMention[] = [];
  const add = (m: RegExpMatchArray, cur: string, intPart: string, frac: string | undefined) => {
    const start = m.index!;
    const end = start + m[0].length;
    if (out.some((o) => start < o.end && o.start < end)) return;
    const line = lineOf(start);
    const lineText = text.slice(lineStarts[line]!, lineStarts[line + 1] ?? text.length);
    const before = text.slice(lineStarts[line]!, start);
    let label: MoneyLabel | null = null;
    for (const [re, l] of LABELS) {
      if (re.test(before) || (l !== 'price' && re.test(lineText.slice(0, 60)) && !before.trim())) {
        label = l;
        break;
      }
    }
    out.push({ start, end, text: m[0], amountMinor: toMinor(intPart, frac), currency: currencyOf(cur), label, period: periodNear(text.slice(end)), line });
  };
  for (const m of text.matchAll(PREFIX)) add(m, m[1]!, m[2]!, m[3]);
  for (const m of text.matchAll(SUFFIX)) add(m, m[3]!, m[1]!, m[2]);
  return out.sort((a, b) => a.start - b.start);
}

const LABEL_PRIORITY: MoneyLabel[] = ['total', 'paid', 'due', 'price', 'subtotal'];

/**
 * Picks the amount a receipt or bill is "for". A labelled total wins; when no
 * line is labelled, the largest amount is offered but flagged as a choice.
 */
export function pickPrimaryAmount(mentions: MoneyMention[]): { mention: MoneyMention | null; certain: boolean; alternatives: MoneyMention[] } {
  const usable = mentions.filter((m) => !['tax', 'discount', 'shipping', 'mrp', 'refund'].includes(m.label ?? ''));
  for (const label of LABEL_PRIORITY) {
    const hits = usable.filter((m) => m.label === label);
    if (hits.length) {
      // The last "total" on a receipt is normally the grand total.
      const pick = label === 'total' ? hits[hits.length - 1]! : hits[0]!;
      return { mention: pick, certain: hits.length === 1 || label === 'total', alternatives: usable.filter((m) => m !== pick).slice(0, 3) };
    }
  }
  if (usable.length === 1) return { mention: usable[0]!, certain: true, alternatives: [] };
  const sorted = [...usable].sort((a, b) => b.amountMinor - a.amountMinor);
  return { mention: sorted[0] ?? null, certain: false, alternatives: sorted.slice(1, 4) };
}

/** Formats minor units for display with Indian grouping for INR. */
export function formatMoney(amountMinor: number, currency: string, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2 }).format(amountMinor / 100);
}
