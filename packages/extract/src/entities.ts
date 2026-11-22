/**
 * Named things: merchants, organisations, people, reference numbers,
 * locations. Everything returned here is a *suggestion* tied to the text it
 * came from; nothing is looked up or inferred from outside the source.
 */

export interface Span {
  start: number;
  end: number;
  text: string;
}

export interface ReferenceMention extends Span {
  label: string;
  value: string;
  /** Long digit runs (account, card, policy numbers) are masked in display. */
  sensitive: boolean;
}

export interface NameMention extends Span {
  value: string;
  source: 'labelled' | 'known_merchant' | 'title' | 'org_suffix' | 'first_line';
}

/**
 * Merchants common in Indian e-commerce and retail, plus a few global ones.
 * Recognition only — names, no logos or content.
 */
export const KNOWN_MERCHANTS = [
  'Amazon', 'Flipkart', 'Myntra', 'Meesho', 'Ajio', 'Nykaa', 'Tata CLiQ', 'Croma', 'Reliance Digital', 'Vijay Sales',
  'BigBasket', 'Blinkit', 'Zepto', 'Swiggy', 'Zomato', 'JioMart', 'DMart', 'Decathlon', 'IKEA', 'Pepperfry',
  'Urban Company', 'MakeMyTrip', 'IRCTC', 'Cleartrip', 'Goibibo', 'IndiGo', 'Air India', 'Uber', 'Ola', 'Rapido',
  'Apple', 'Samsung', 'OnePlus', 'Xiaomi', 'Lenovo', 'Dell', 'HP', 'Sony', 'LG', 'Boat', 'Lenskart', 'Titan',
  'Netflix', 'Spotify', 'YouTube Premium', 'Disney+ Hotstar', 'JioHotstar', 'JioCinema', 'Amazon Prime', 'Prime Video',
  'Apple Music', 'iCloud', 'Google One', 'Microsoft 365', 'Adobe', 'Canva', 'Notion', 'Zee5', 'SonyLIV', 'Audible',
  'Airtel', 'Jio', 'Vi', 'BSNL', 'Tata Play', 'ACT Fibernet', 'Hathway',
  'Tata Power', 'Adani Electricity', 'BESCOM', 'MSEDCL', 'BSES', 'CESC', 'TNEB', 'Torrent Power',
  'HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak', 'LIC', 'Star Health', 'HDFC ERGO', 'ICICI Lombard',
];

const MERCHANT_RE = new RegExp(`\\b(${KNOWN_MERCHANTS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\.in|\\.com)?\\b`, 'gi');

export function findKnownMerchants(text: string): NameMention[] {
  const out: NameMention[] = [];
  for (const m of text.matchAll(MERCHANT_RE)) {
    const canonical = KNOWN_MERCHANTS.find((k) => k.toLowerCase() === m[1]!.toLowerCase()) ?? m[1]!;
    out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], value: canonical, source: 'known_merchant' });
  }
  return out;
}

const LABELLED_NAME = /\b(sold\s+by|seller|merchant|store|shop|vendor|billed\s+by|service\s+provider|provider|from)\s*[:\-]\s*([^\n,|]{2,60})/gi;

export function findLabelledMerchant(text: string): NameMention | null {
  for (const m of text.matchAll(LABELLED_NAME)) {
    const value = cleanName(m[2]!);
    if (value.length < 2) continue;
    return { start: m.index!, end: m.index! + m[0].length, text: m[0], value, source: 'labelled' };
  }
  return null;
}

const ORG_SUFFIX = /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,5}\s+(?:Pvt\.?\s+Ltd\.?|Private\s+Limited|Limited|Ltd\.?|LLP|Inc\.?|Bank|Hospital|Clinic|School|University|College|Insurance|Services|Centre|Center|Labs?|Diagnostics|Academy|Institute|Society|Corporation|Board))\b/g;

export function findOrganisations(text: string): NameMention[] {
  const out: NameMention[] = [];
  for (const m of text.matchAll(ORG_SUFFIX)) {
    out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], value: cleanName(m[1]!), source: 'org_suffix' });
  }
  return out;
}

const TITLED_PERSON = /\b(Dr|Mr|Mrs|Ms|Miss|Prof|Shri|Smt|Sri)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g;

export function findPeople(text: string): NameMention[] {
  const out: NameMention[] = [];
  for (const m of text.matchAll(TITLED_PERSON)) {
    out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], value: `${m[1]}. ${m[2]}`.replace('..', '.'), source: 'title' });
  }
  return out;
}

const REF_RE = /\b(order|invoice|bill|receipt|booking|reference|ref|ticket|application|policy|account|consumer|customer|pnr|transaction|txn|registration|confirmation|tracking|awb|case|complaint|claim|serial|imei|membership)[ \t]*(?:no\.?|number|num|#|id|code)?[ \t]*[:#\-.]?[ \t]*(?:is[ \t]+)?([A-Z0-9][A-Z0-9\-/]{3,30})\b/gi;

export function findReferences(text: string): ReferenceMention[] {
  const out: ReferenceMention[] = [];
  for (const m of text.matchAll(REF_RE)) {
    const value = m[2]!;
    // A reference needs at least one digit; "Order Summary" is not a reference.
    if (!/\d/.test(value)) continue;
    const label = normaliseRefLabel(m[1]!);
    const digits = value.replace(/\D/g, '');
    const sensitive = ['account', 'policy', 'consumer', 'customer'].includes(label) || digits.length >= 12;
    out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], label, value, sensitive });
  }
  return out;
}

function normaliseRefLabel(l: string): string {
  const s = l.toLowerCase();
  if (s === 'ref') return 'reference';
  if (s === 'txn') return 'transaction';
  if (s === 'awb') return 'tracking';
  return s;
}

/** Shows only the last four characters of a sensitive reference. */
export function maskReference(value: string): string {
  if (value.length <= 4) return value;
  return `${'•'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

const LOCATION_RE = /\b(venue|location|address|place|at the|clinic address)\s*[:\-]\s*([^\n]{3,120})/gi;

export function findLocation(text: string): Span & { value: string } | null {
  for (const m of text.matchAll(LOCATION_RE)) {
    return { start: m.index!, end: m.index! + m[0].length, text: m[0], value: m[2]!.trim().replace(/[.;]$/, '') };
  }
  return null;
}

export function firstMeaningfulLine(text: string): NameMention | null {
  let offset = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const start = offset + raw.indexOf(line);
    offset += raw.length + 1;
    if (line.length < 3 || line.length > 60) continue;
    if (/^(tax\s+invoice|invoice|receipt|bill|order\s+summary|cash\s+memo|original|duplicate|page\s+\d)/i.test(line)) continue;
    if (/\d{4,}/.test(line) || /^[\d\W]+$/.test(line)) continue;
    return { start, end: start + line.length, text: line, value: cleanName(line), source: 'first_line' };
  }
  return null;
}

function cleanName(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^[\s:,-]+|[\s:,.-]+$/g, '').trim();
}
