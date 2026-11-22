/** Display formatting. Dates that are date-only are formatted in UTC so they never shift. */
export function fmtDate(iso: string | null | undefined, locale = 'en-IN', opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!iso) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'UTC' : opts.timeZone }).format(d);
}

export function fmtDateTime(at: Date | string | null | undefined, tz: string, locale = 'en-IN'): string {
  if (!at) return '—';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(at));
}

export function fmtTime(at: Date | string, tz: string, locale = 'en-IN'): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(at));
}

export function fmtMoney(minor: number | null | undefined, currency = 'INR', locale = 'en-IN'): string {
  if (minor === null || minor === undefined) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}

export function relDays(iso: string | null | undefined, today: string): string {
  if (!iso) return '';
  const d = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

export function dueTone(iso: string | null | undefined, today: string): string {
  if (!iso) return 'chip';
  if (iso < today) return 'chip chip-rose';
  if (iso === today) return 'chip chip-amber';
  return 'chip chip-blue';
}

export const humanize = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
