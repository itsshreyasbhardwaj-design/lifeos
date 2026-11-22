/**
 * Turns text into reviewable action candidates.
 *
 * Each candidate carries the excerpt it came from, the rule that produced it,
 * and a list of fields the reviewer must look at. Nothing here is a fact: the
 * application only creates records after a person confirms a candidate.
 */
import { type IsoDate, type PartialDate, addDays, addMonths, compareIso, partialToIso } from './calendar.ts';
import { type DateContext, type DateMention, type RecurrenceRule, type TimeOfDay, type Uncertainty, findDates, findRecurrence, normaliseDigits } from './dates.ts';
import { type MoneyMention, findMoney, pickPrimaryAmount } from './money.ts';
import {
  type ReferenceMention,
  findKnownMerchants,
  findLabelledMerchant,
  findLocation,
  findOrganisations,
  findPeople,
  findReferences,
  firstMeaningfulLine,
} from './entities.ts';

export const ENGINE = { name: 'lifeos-rules', version: '0.1.0' } as const;

export type CandidateKind = 'task' | 'event' | 'deadline' | 'purchase' | 'warranty' | 'return_window' | 'subscription' | 'bill' | 'promise' | 'document';

export type DocumentType = 'receipt' | 'subscription_notice' | 'bill' | 'appointment' | 'travel' | 'certificate' | 'policy' | 'message';

export interface Evidence {
  excerpt: string;
  start: number;
  end: number;
}

export interface DateValue {
  /** Full ISO date, or null when any part was not written. */
  iso: IsoDate | null;
  partial: PartialDate;
  written: string;
  time: string | null; // HH:MM, only when written
}

export interface Candidate {
  key: string;
  kind: CandidateKind;
  title: string;
  fields: Record<string, unknown>;
  evidence: Evidence[];
  uncertain: Uncertainty[];
  provenance: { engine: string; version: string; rules: string[] };
  relatesTo: string[];
}

export interface ExtractionOutput {
  documentType: DocumentType;
  candidates: Candidate[];
  dates: DateMention[];
  amounts: MoneyMention[];
  references: ReferenceMention[];
  text: string;
}

export interface ExtractOptions extends DateContext {
  /** Hint from the capture source; a file named "invoice.pdf" is probably a receipt. */
  sourceHint?: string;
}

// ------------------------------------------------------------ classification

const DOC_SIGNALS: [DocumentType, RegExp[]][] = [
  ['receipt', [/\b(tax\s+invoice|invoice|receipt|order\s+(?:summary|confirmation|placed|id|#|no)|cash\s+memo|bill\s+of\s+supply|gstin|hsn|qty|quantity|sold\s+by|thank\s+you\s+for\s+(?:your\s+)?(?:order|purchase|shopping))\b/i, /\b(grand\s+total|order\s+total|amount\s+paid|total\s+amount)\b/i, /\b(warranty|return\s+(?:policy|window)|replacement)\b/i]],
  ['subscription_notice', [/\b(subscription|membership|auto-?renew(?:al|s)?|renews?\s+on|next\s+billing|billing\s+cycle|free\s+trial|trial\s+(?:ends|expires|period)|plan\s+(?:renewal|will\s+renew)|recurring\s+payment|auto-?debit|mandate)\b/i, /\b(per\s+month|\/\s*mo(?:nth)?|monthly|annual(?:ly)?|yearly|\/\s*yr)\b/i]],
  ['bill', [/\b(amount\s+due|due\s+date|pay\s+by|last\s+date\s+(?:of|for)\s+payment|bill\s+(?:date|amount|period)|outstanding|statement\s+date|minimum\s+due)\b/i, /\b(electricity|water|gas|broadband|postpaid|mobile\s+bill|maintenance|rent|premium|school\s+fees?|tuition)\b/i]],
  ['appointment', [/\b(appointment|consultation|scheduled\s+(?:for|on)|meeting|interview|webinar|parent[- ]teacher|ptm|check-?up|session|visit|reporting\s+time|slot\s+(?:booked|confirmed))\b/i]],
  ['travel', [/\b(pnr|boarding|departure|arrival|flight|train|coach|berth|seat\s+no|check-?in|e-?ticket|itinerary|booking\s+(?:id|confirmed))\b/i]],
  ['certificate', [/\b(certificate|certify|certified|licen[cs]e|registration\s+certificate|passport|identity\s+card|marksheet|transcript)\b/i, /\b(valid\s+(?:till|until|up\s*to)|date\s+of\s+expiry|expiry\s+date|expires\s+on)\b/i]],
  ['policy', [/\b(policy\s+(?:no|number|schedule|period)|sum\s+insured|insured|premium|policyholder|nominee|coverage)\b/i]],
];

export function classifyDocument(text: string, hint = ''): DocumentType {
  // The first signal of each type is "strong": a type only counts when its
  // strong signal is present, so "annual day" alone is not a subscription.
  let best: DocumentType = 'message';
  let bestScore = 0;
  const hay = `${hint}\n${text}`;
  for (const [type, [strong, ...weak]] of DOC_SIGNALS) {
    if (!strong!.test(hay)) continue;
    const score = 2 + weak.reduce((n, re) => n + (re.test(hay) ? 1 : 0), 0);
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }
  return best;
}

// ------------------------------------------------------------ sentences

interface Sentence {
  text: string;
  start: number;
  end: number;
}

function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^\n.!?]+(?:[.!?](?!\d)|\n|$)+/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const trimmedStart = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t.length < 3) continue;
    out.push({ text: t, start: m.index! + trimmedStart, end: m.index! + trimmedStart + t.length });
  }
  return out;
}

const fmtTime = (t?: TimeOfDay): string | null => (t ? `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}` : null);

function dateValue(m: DateMention): DateValue {
  return { iso: partialToIso(m.date), partial: m.date, written: m.text, time: fmtTime(m.time) };
}

function renameUncertain(list: Uncertainty[], field: string): Uncertainty[] {
  return list.map((u) => ({ ...u, field }));
}

function within(m: { start: number; end: number }, s: { start: number; end: number }): boolean {
  return m.start >= s.start && m.end <= s.end + 1;
}

function cleanTitle(raw: string): string {
  let t = raw
    .replace(/^(?:hi|hello|dear)\b[^,]*,\s*/i, '')
    .replace(/^(?:please\s+)?(?:remember\s+to|remind\s+me\s+to|don'?t\s+forget\s+to|do\s+not\s+forget\s+to|make\s+sure\s+(?:to|you)|you\s+need\s+to|i\s+need\s+to|need\s+to|have\s+to|kindly)\s+/i, '')
    .replace(/^please\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s,;:.!-]+$/, '')
    .trim();
  if (t.length > 140) t = `${t.slice(0, 137).trimEnd()}…`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function stripSpan(text: string, spans: { start: number; end: number }[], offset: number): string {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    const a = s.start - offset;
    const b = s.end - offset;
    if (a < 0 || b > text.length) continue;
    out = `${out.slice(0, a)} ${out.slice(b)}`;
  }
  return out
    .replace(/\b(?:on|by|before|at|from|until|till|due|for)\s*(?=[,.;]|$)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const TASK_START = /^(?:please\s+|kindly\s+)?(?:remember\s+to|remind\s+me\s+to|don'?t\s+forget\s+to|do\s+not\s+forget\s+to|make\s+sure\s+to|need\s+to|have\s+to|i\s+need\s+to|you\s+need\s+to|must)?\s*(submit|send|pay|call|book|renew|buy|collect|bring|pick\s+up|drop|email|reply|respond|complete|fill|upload|register|apply|schedule|confirm|cancel|return|check|verify|sign|print|prepare|update|finish|attend|visit|meet|get|order|recharge|file|claim|follow\s+up|share|deposit|carry|review|download|install|clean|fix|arrange|inform|contact|write|read|study|practice|water|feed)\b/i;
const DEADLINE = /\b(last\s+date|deadline|due\s+(?:date|on|by)|submit\s+(?:by|before)|no\s+later\s+than|latest\s+by|on\s+or\s+before|before|closes\s+on|expires?\s+on)\b/i;
const EVENT = /\b(appointment|consultation|scheduled\s+(?:for|on)|meeting|interview|webinar|class|exam|ceremony|party|wedding|function|check-?up|session|parent[- ]teacher|ptm|reporting\s+time|flight|train|departure|event|concert|match|visit|rehearsal|performance|annual\s+day|sports\s+day|orientation|workshop|seminar|conference|reception|celebration|birthday|anniversary|puja|programme|program|screening|game|tournament|dinner|lunch\s+with)\b/i;
const WAITING = /\b(your\s+(?:refund|order|request|application|claim|complaint|replacement|ticket|document)s?\s+(?:will|has\s+been|is\s+being|is)|refund\s+(?:will|of)|will\s+be\s+(?:processed|credited|delivered|shipped|refunded|resolved|reviewed|dispatched|sent)|expected\s+(?:delivery|by|on|to\s+arrive)|get\s+back\s+to\s+you|we\s+will\s+(?:contact|call|update|notify|revert))\b/i;
const PROMISE_I = /\b(I\s*(?:will|'ll|shall)|I\s+promise\s+to)\s+([^.!?\n]{3,140})/i;
const PROMISE_WE = /\b(we\s*(?:will|'ll|shall)|he\s*(?:will|'ll)|she\s*(?:will|'ll)|they\s*(?:will|'ll))\s+([^.!?\n]{3,140})/i;

/** Drops greetings and labels ("Hi parents, reminder: …") so the verb is at the start. */
function stripLead(s: Sentence): Sentence {
  let t = s.text;
  let start = s.start;
  for (let k = 0; k < 3; k++) {
    const m = /^(?:(?:hi|hello|dear|hey|namaste)\b[^,:\n]{0,40}[,:]|(?:reminder|note|important|fyi|update|notice|attention|ps|p\.s\.)\s*[:\-])\s*/i.exec(t);
    if (!m) break;
    t = t.slice(m[0].length);
    start += m[0].length;
  }
  return { text: t, start, end: s.end };
}

// ------------------------------------------------------------ main entry

export function extractCandidates(input: string, opts: ExtractOptions): ExtractionOutput {
  const text = normaliseDigits(input.replace(/\r\n?/g, '\n').replace(/\u0000/g, ''));
  const docType = classifyDocument(text, opts.sourceHint);
  const dates = findDates(text, opts);
  const amounts = findMoney(text);
  const references = findReferences(text);
  const sents = sentences(text);
  const candidates: Candidate[] = [];
  const usedSentences = new Set<number>();
  let seq = 0;
  const key = (k: string) => `${k}-${++seq}`;
  const prov = (...rules: string[]) => ({ engine: ENGINE.name, version: ENGINE.version, rules });
  const ev = (s: { start: number; end: number }): Evidence => ({ excerpt: text.slice(s.start, s.end).trim().slice(0, 400), start: s.start, end: s.end });
  const sentenceIndexOf = (pos: number) => sents.findIndex((s) => pos >= s.start && pos <= s.end);
  const labelledDate = (re: RegExp): DateMention | null => {
    for (const s of sents) {
      if (!re.test(s.text)) continue;
      const d = dates.find((dm) => within(dm, s));
      if (d) return d;
    }
    // Label on one line, date on the next ("Due Date\n25/11/2026").
    for (const m of text.matchAll(new RegExp(re.source, 'gi'))) {
      const after = dates.find((dm) => dm.start >= m.index! && dm.start - m.index! < 60);
      if (after) return after;
    }
    return null;
  };
  const merchantGuess = () => {
    const labelled = findLabelledMerchant(text);
    if (labelled) return { value: labelled.value, certain: true, span: labelled };
    const known = findKnownMerchants(text)[0];
    if (known) return { value: known.value, certain: true, span: known };
    const org = findOrganisations(text)[0];
    if (org) return { value: org.value, certain: false, span: org };
    const first = firstMeaningfulLine(text);
    return first ? { value: first.value, certain: false, span: first } : null;
  };

  // ---------------------------------------------------------------- receipts
  let purchaseKey: string | null = null;
  if (docType === 'receipt') {
    const merchant = merchantGuess();
    const amount = pickPrimaryAmount(amounts);
    const purchaseDate = labelledDate(/\b(order(?:ed)?\s+(?:date|on)|invoice\s+date|bill\s+date|purchase(?:d)?\s+(?:date|on)|date\s+of\s+purchase|placed\s+on|transaction\s+date|date)\b/i) ?? dates.find((d) => d.kind === 'absolute') ?? null;
    const deliveryDate = labelledDate(/\b(delivered\s+on|delivery\s+date|date\s+of\s+delivery|arriving|expected\s+delivery)\b/i);
    const product = findProduct(text, amounts);
    const orderRef = references.find((r) => ['order', 'invoice', 'bill', 'receipt', 'transaction'].includes(r.label));
    const uncertain: Uncertainty[] = [];
    if (!product) uncertain.push({ field: 'productName', reason: 'guessed_name', message: 'No product name could be read. Enter what you bought.' });
    else if (!product.certain) uncertain.push({ field: 'productName', reason: 'guessed_name', message: `Product read as "${product.value}". Check it.` });
    if (merchant && !merchant.certain) uncertain.push({ field: 'merchant', reason: 'guessed_name', message: `Seller guessed from "${merchant.span.text.trim()}". Check it.` });
    if (amount.mention && !amount.certain) {
      uncertain.push({ field: 'amountMinor', reason: 'amount_choice', message: 'Several amounts appear and none is labelled as the total. Pick the one you paid.', alternatives: [amount.mention, ...amount.alternatives].map((a) => a.amountMinor) });
    }
    if (purchaseDate) uncertain.push(...renameUncertain(purchaseDate.uncertain, 'purchaseDate'));
    else uncertain.push({ field: 'purchaseDate', reason: 'date_missing', message: 'No purchase date found. Add it so warranty and return dates can be worked out.' });
    const spans = [merchant?.span, amount.mention, purchaseDate, product?.span].filter(Boolean) as { start: number; end: number }[];
    purchaseKey = key('purchase');
    candidates.push({
      key: purchaseKey,
      kind: 'purchase',
      title: product?.value ? `${product.value}${merchant ? ` from ${merchant.value}` : ''}` : `Purchase${merchant ? ` from ${merchant.value}` : ''}`,
      fields: {
        productName: product?.value ?? null,
        merchant: merchant?.value ?? null,
        purchaseDate: purchaseDate ? dateValue(purchaseDate) : null,
        deliveryDate: deliveryDate ? dateValue(deliveryDate) : null,
        amountMinor: amount.mention?.amountMinor ?? null,
        currency: amount.mention?.currency ?? 'INR',
        orderRef: orderRef?.value ?? null,
      },
      evidence: spans.length ? spans.map(ev) : [ev({ start: 0, end: Math.min(text.length, 300) })],
      uncertain,
      provenance: prov('receipt.purchase'),
      relatesTo: [],
    });

    const pIso = purchaseDate ? partialToIso(purchaseDate.date) : null;
    const dIso = deliveryDate ? partialToIso(deliveryDate.date) : null;

    // Warranty — only when the document states a term.
    const w = findWarrantyTerm(text, dates);
    if (w) {
      const u: Uncertainty[] = [];
      let endsOn: IsoDate | null = w.until ? partialToIso(w.until.date) : null;
      const startsOn = pIso;
      if (!endsOn && w.months && startsOn) {
        endsOn = addDays(addMonths(startsOn, w.months), -1);
        u.push({ field: 'endsOn', reason: 'derived_from_term', message: `Worked out from "${w.text}" starting on the purchase date. Warranties sometimes start at delivery or registration — check the warranty card.` });
      }
      if (!startsOn) u.push({ field: 'startsOn', reason: 'date_missing', message: 'Add the date the warranty starts (usually the purchase or invoice date).' });
      if (!endsOn) u.push({ field: 'endsOn', reason: 'date_missing', message: 'The end date could not be worked out. Enter it from the warranty card.' });
      candidates.push({
        key: key('warranty'), kind: 'warranty',
        title: `Warranty${product?.value ? ` — ${product.value}` : ''}`,
        fields: { months: w.months, startsOn, endsOn, terms: w.text },
        evidence: [ev(w)], uncertain: u, provenance: prov('receipt.warranty_term'), relatesTo: [purchaseKey],
      });
    }

    // Return window — only when the document states one.
    const r = findReturnTerm(text, dates);
    if (r) {
      const u: Uncertainty[] = [];
      let deadline: IsoDate | null = r.until ? partialToIso(r.until.date) : null;
      let basis: 'purchase' | 'delivery' | null = null;
      if (!deadline && r.days) {
        const from = dIso ?? pIso;
        basis = dIso ? 'delivery' : pIso ? 'purchase' : null;
        if (from) {
          deadline = addDays(from, r.days);
          const alt = dIso && pIso && dIso !== pIso ? addDays(dIso === from ? pIso : dIso, r.days) : null;
          u.push({
            field: 'deadline', reason: 'window_start',
            message: `"${r.text}" counted from the ${basis} date. Sellers differ on whether the window starts at purchase or delivery — check the policy.`,
            ...(alt ? { alternatives: [deadline, alt] } : {}),
          });
        }
      }
      if (!deadline) u.push({ field: 'deadline', reason: 'date_missing', message: 'Enter the last day to return this item.' });
      if (r.until) u.push(...renameUncertain(r.until.uncertain, 'deadline'));
      candidates.push({
        key: key('return'), kind: 'return_window',
        title: `Return window${product?.value ? ` — ${product.value}` : ''}`,
        fields: { days: r.days, deadline, basis, terms: r.text },
        evidence: [ev(r)], uncertain: u, provenance: prov('receipt.return_term'), relatesTo: [purchaseKey],
      });
    }
    for (const s of sents) if (s.end <= (amount.mention?.end ?? 0) + 200) usedSentences.add(sents.indexOf(s));
  }

  // ---------------------------------------------------------------- subscriptions
  if (docType === 'subscription_notice') {
    const merchant = merchantGuess();
    const periodic = amounts.find((a) => a.period) ?? pickPrimaryAmount(amounts).mention;
    const renewal = labelledDate(/\b(renew(?:s|al)?(?:\s+(?:on|date))?|next\s+(?:billing|payment|charge)(?:\s+date)?|will\s+be\s+charged\s+on|billing\s+date|valid\s+(?:till|until)|expires?\s+on)\b/i);
    const trial = labelledDate(/\b(trial\s+(?:ends|expires|period\s+ends)(?:\s+on)?|free\s+until)\b/i);
    const cycleWord = /\b(annual(?:ly)?|yearly|per\s+year|\/\s*yr|12\s+months)\b/i.test(text) ? 'yearly' : /\b(quarterly|every\s+3\s+months)\b/i.test(text) ? 'quarterly' : /\b(weekly|per\s+week)\b/i.test(text) ? 'weekly' : /\b(monthly|per\s+month|\/\s*mo(?:nth)?|every\s+month)\b/i.test(text) ? 'monthly' : null;
    const cycle = periodic?.period === 'year' ? 'yearly' : periodic?.period === 'month' ? 'monthly' : periodic?.period === 'quarter' ? 'quarterly' : periodic?.period === 'week' ? 'weekly' : cycleWord;
    const u: Uncertainty[] = [];
    if (!cycle) u.push({ field: 'cycle', reason: 'cycle_missing', message: 'How often it renews is not written. Choose monthly, yearly, etc.' });
    if (merchant && !merchant.certain) u.push({ field: 'name', reason: 'guessed_name', message: `Service name guessed from "${merchant.span.text.trim()}".` });
    if (!merchant) u.push({ field: 'name', reason: 'guessed_name', message: 'Enter the service name.' });
    if (renewal) u.push(...renameUncertain(renewal.uncertain, 'nextRenewalDate'));
    else u.push({ field: 'nextRenewalDate', reason: 'date_missing', message: 'No renewal date found. Add it to get a reminder before you are charged.' });
    const spans = [merchant?.span, periodic, renewal, trial].filter(Boolean) as { start: number; end: number }[];
    candidates.push({
      key: key('subscription'), kind: 'subscription',
      title: merchant?.value ?? 'Subscription',
      fields: {
        name: merchant?.value ?? null,
        amountMinor: periodic?.amountMinor ?? null,
        currency: periodic?.currency ?? 'INR',
        cycle,
        nextRenewalDate: renewal ? dateValue(renewal) : null,
        trialEndsOn: trial ? dateValue(trial) : null,
      },
      evidence: spans.length ? spans.map(ev) : [ev({ start: 0, end: Math.min(300, text.length) })],
      uncertain: u, provenance: prov('subscription.notice'), relatesTo: [],
    });
    sents.forEach((_, i) => usedSentences.add(i));
  }

  // ---------------------------------------------------------------- bills
  if (docType === 'bill') {
    const merchant = merchantGuess();
    const due = labelledDate(/\b(due\s+date|pay\s+by|last\s+date\s+(?:of|for)\s+payment|payment\s+due|due\s+on|due\s+by|on\s+or\s+before)\b/i);
    const amt = amounts.find((a) => a.label === 'due') ?? pickPrimaryAmount(amounts).mention;
    const category = /\belectric/i.test(text) ? 'electricity' : /\bwater\b/i.test(text) ? 'water' : /\b(gas|lpg|png)\b/i.test(text) ? 'gas' : /\b(broadband|fibre|fiber|internet|wi-?fi)\b/i.test(text) ? 'internet' : /\b(mobile|postpaid|prepaid)\b/i.test(text) ? 'mobile' : /\brent\b/i.test(text) ? 'rent' : /\b(premium|insurance)\b/i.test(text) ? 'insurance' : /\b(school|tuition|college|fees?)\b/i.test(text) ? 'education' : /\bmaintenance\b/i.test(text) ? 'maintenance' : 'other';
    const u: Uncertainty[] = [];
    if (due) u.push(...renameUncertain(due.uncertain, 'dueDate'));
    else u.push({ field: 'dueDate', reason: 'date_missing', message: 'No due date found. Add it to get a reminder.' });
    if (!amt) u.push({ field: 'amountMinor', reason: 'amount_choice', message: 'No amount found. Leave empty if it varies.' });
    if (merchant && !merchant.certain) u.push({ field: 'name', reason: 'guessed_name', message: `Biller guessed from "${merchant.span.text.trim()}".` });
    const spans = [merchant?.span, amt, due].filter(Boolean) as { start: number; end: number }[];
    candidates.push({
      key: key('bill'), kind: 'bill',
      title: `${merchant?.value ?? (category === 'other' ? 'Bill' : category[0]!.toUpperCase() + category.slice(1))} bill`,
      fields: { name: merchant?.value ?? null, payee: merchant?.value ?? null, category, amountMinor: amt?.amountMinor ?? null, currency: amt?.currency ?? 'INR', dueDate: due ? dateValue(due) : null },
      evidence: spans.length ? spans.map(ev) : [ev({ start: 0, end: Math.min(300, text.length) })],
      uncertain: u, provenance: prov('bill.statement'), relatesTo: [],
    });
    if (due) usedSentences.add(sentenceIndexOf(due.start));
  }

  // ---------------------------------------------------------------- documents with an expiry
  if (docType === 'certificate' || docType === 'policy' || docType === 'travel') {
    const expiry = labelledDate(/\b(valid\s+(?:till|until|up\s*to|thru|through)|date\s+of\s+expiry|expiry\s+date|expires?\s+on|policy\s+(?:end|expiry)\s+date|valid\s+upto)\b/i);
    const title = firstMeaningfulLine(text)?.value ?? (docType === 'policy' ? 'Insurance policy' : docType === 'travel' ? 'Travel booking' : 'Certificate');
    const issuer = findOrganisations(text)[0]?.value ?? findKnownMerchants(text)[0]?.value ?? null;
    const u: Uncertainty[] = [{ field: 'title', reason: 'guessed_name', message: 'Title taken from the first line. Rename it if needed.' }];
    if (expiry) u.push(...renameUncertain(expiry.uncertain, 'expiresOn'));
    candidates.push({
      key: key('document'), kind: 'document', title,
      fields: { title, category: docType === 'policy' ? 'insurance' : docType === 'travel' ? 'travel' : 'certificate', issuer, expiresOn: expiry ? dateValue(expiry) : null, references: references.map((r) => ({ label: r.label, value: r.value, sensitive: r.sensitive })) },
      evidence: [ev(expiry ?? { start: 0, end: Math.min(text.length, 200) })],
      uncertain: u, provenance: prov(`document.${docType}`), relatesTo: [],
    });
  }

  // ---------------------------------------------------------------- per-sentence: events, deadlines, tasks, promises
  const recurrence = findRecurrence(text);
  sents.forEach((raw, i) => {
    if (usedSentences.has(i)) return;
    const s = stripLead(raw);
    const sDates = dates.filter((d) => within(d, s));
    const first = sDates[0];

    // Events: appointment-like wording plus a date, or a stated time with no task verb.
    const timedOnly = first?.time !== undefined && !TASK_START.test(s.text) && !DEADLINE.test(s.text) && !PROMISE_I.test(s.text) && !PROMISE_WE.test(s.text) && !WAITING.test(s.text);
    const eventLike = EVENT.test(s.text) || timedOnly;
    if (eventLike && first && (docType === 'appointment' || docType === 'travel' || docType === 'message')) {
      const loc = findLocation(text.slice(s.start, Math.min(text.length, s.end + 160)));
      const person = findPeople(s.text)[0];
      const u = renameUncertain(first.uncertain, 'date');
      const title = cleanTitle(stripSpan(s.text, sDates, s.start).replace(/\s+(?:is|are|will\s+be)(?:\s+(?:held|scheduled|planned))?\s+(?:on|for|at)?(?=\s+(?:in|at)\b|\s*[,.]|\s*$)/i, '').replace(/^the\s+/i, '')) || 'Appointment';
      candidates.push({
        key: key('event'), kind: 'event', title,
        fields: {
          title, date: dateValue(first), endDate: first.endDate ? { iso: partialToIso(first.endDate), partial: first.endDate } : null,
          startTime: fmtTime(first.time), endTime: fmtTime(first.endTime), allDay: !first.time,
          location: loc?.value ?? null, withPerson: person?.value ?? null,
        },
        evidence: [ev(s)], uncertain: u, provenance: prov('sentence.event'), relatesTo: [],
      });
      usedSentences.add(i);
      return;
    }

    // Waiting on someone else.
    if (WAITING.test(s.text)) {
      const org = findOrganisations(text)[0]?.value ?? findKnownMerchants(text)[0]?.value ?? null;
      const u: Uncertainty[] = first ? renameUncertain(first.uncertain, 'expectedBy') : [];
      candidates.push({
        key: key('promise'), kind: 'promise', title: cleanTitle(s.text),
        fields: { direction: 'waiting_on', description: cleanTitle(s.text), counterparty: org, expectedBy: first ? dateValue(first) : null },
        evidence: [ev(s)], uncertain: u, provenance: prov('sentence.waiting'), relatesTo: purchaseKey ? [purchaseKey] : [],
      });
      usedSentences.add(i);
      return;
    }

    // Promises: "I'll send it by Friday" / "We will call you tomorrow".
    const mi = PROMISE_I.exec(s.text);
    const mw = mi ? null : PROMISE_WE.exec(s.text);
    if (mi || mw) {
      const what = cleanTitle((mi ?? mw)![2]!);
      const u: Uncertainty[] = first ? renameUncertain(first.uncertain, 'expectedBy') : [];
      u.push({
        field: 'direction', reason: 'direction',
        message: mi ? 'Read as something you promised. If someone else wrote "I will", switch it to "they promised".' : 'Read as something someone promised you. Switch it if you wrote it.',
        alternatives: mi ? ['i_promised', 'they_promised'] : ['they_promised', 'i_promised'],
      });
      const counterparty = findPeople(s.text)[0]?.value ?? findOrganisations(s.text)[0]?.value ?? null;
      candidates.push({
        key: key('promise'), kind: 'promise', title: what,
        fields: { direction: mi ? 'i_promised' : 'they_promised', description: what, counterparty, expectedBy: first ? dateValue(first) : null },
        evidence: [ev(s)], uncertain: u, provenance: prov(mi ? 'sentence.promise_first_person' : 'sentence.promise_third_person'), relatesTo: [],
      });
      usedSentences.add(i);
      return;
    }

    // Deadlines: "Last date to submit is 30/11/2026".
    if (DEADLINE.test(s.text) && first) {
      const title = cleanTitle(stripSpan(s.text, sDates, s.start)) || 'Deadline';
      candidates.push({
        key: key('deadline'), kind: 'deadline', title,
        fields: { title, dueDate: dateValue(first), recurrence: null },
        evidence: [ev(s)], uncertain: renameUncertain(first.uncertain, 'dueDate'), provenance: prov('sentence.deadline'), relatesTo: [],
      });
      usedSentences.add(i);
      return;
    }

    // Tasks: imperative or "remind me to …".
    if (TASK_START.test(s.text) || /\b(remind\s+me|todo|to-do)\b/i.test(s.text)) {
      const rec = recurrence && within(recurrence, s) ? recurrence : null;
      const strip = [...sDates, ...(rec ? [rec] : [])];
      const title = cleanTitle(stripSpan(s.text, strip, s.start));
      if (title.length < 3) return;
      candidates.push({
        key: key('task'), kind: 'task', title,
        fields: { title, dueDate: first ? dateValue(first) : null, recurrence: rec?.rule ?? null },
        evidence: [ev(s)], uncertain: first ? renameUncertain(first.uncertain, 'dueDate') : [], provenance: prov(rec ? 'sentence.task_recurring' : 'sentence.task'), relatesTo: [],
      });
      usedSentences.add(i);
    }
  });

  return { documentType: docType, candidates: dedupe(candidates), dates, amounts, references, text };
}

function dedupe(list: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const date = JSON.stringify(c.fields.dueDate ?? c.fields.date ?? c.fields.expectedBy ?? null);
    const k = `${c.kind}|${c.title.toLowerCase()}|${date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ------------------------------------------------------------ receipt helpers

function findProduct(text: string, amounts: MoneyMention[]): { value: string; certain: boolean; span: { start: number; end: number; text: string } } | null {
  const labelled = /\b(?:item|product|description|item\s+name|product\s+name)\s*[:\-]\s*([^\n]{3,80})/i.exec(text);
  if (labelled) {
    const v = labelled[1]!.replace(/\s+(?:qty|quantity|x\s*\d).*$/i, '').replace(/(₹|rs\.?|inr)\s*[\d,]+(?:\.\d+)?.*$/i, '').trim();
    if (v.length >= 3) return { value: v, certain: true, span: { start: labelled.index, end: labelled.index + labelled[0].length, text: labelled[0] } };
  }
  const ordered = /\b(?:you\s+ordered|your\s+order\s+(?:of|for)|order\s+for|purchased|thank\s+you\s+for\s+(?:buying|purchasing))\s*[:\-]?\s*([A-Z0-9][^\n.]{2,80})/i.exec(text);
  if (ordered) {
    const v = ordered[1]!.replace(/\s+(?:has|is|was|will)\b.*$/i, '').trim();
    if (v.length >= 3) return { value: v, certain: false, span: { start: ordered.index, end: ordered.index + ordered[0].length, text: ordered[0] } };
  }
  // A line that carries an unlabelled price and reads like a product.
  const lines = text.split('\n');
  let offset = 0;
  for (const line of lines) {
    const start = offset;
    offset += line.length + 1;
    const priced = amounts.find((a) => a.start >= start && a.end <= start + line.length && (a.label === null || a.label === 'price'));
    if (!priced) continue;
    const name = line.slice(0, priced.start - start).replace(/\b(qty|quantity)\b.*$/i, '').replace(/[\s:x×*\d.-]+$/i, '').trim();
    if (name.length >= 3 && /[a-z]{3}/i.test(name) && !/\b(total|tax|gst|discount|shipping|amount|paid|due|subtotal|price|mrp)\b/i.test(name)) {
      return { value: name, certain: false, span: { start, end: start + line.length, text: line } };
    }
  }
  return null;
}

interface TermMatch {
  start: number;
  end: number;
  text: string;
  months?: number | null;
  days?: number | null;
  until?: DateMention;
}

const NUM_WORD: Record<string, number> = { one: 1, two: 2, three: 3, five: 5, six: 6, seven: 7, ten: 10, fifteen: 15, thirty: 30 };
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : (NUM_WORD[s.toLowerCase()] ?? null));

function findWarrantyTerm(text: string, dates: DateMention[]): (TermMatch & { months: number | null }) | null {
  const a = /\b(\d{1,2}|one|two|three|five|six)\s*[- ]?\s*(years?|yrs?|months?|mos?)\s+(?:of\s+)?(?:manufacturer(?:'s)?\s+|brand\s+|limited\s+|extended\s+|standard\s+|comprehensive\s+)?warranty\b/i.exec(text);
  const b = /\bwarranty\s*(?:period|term|duration)?\s*[:\-]?\s*(?:of\s+)?(\d{1,2}|one|two|three|five|six)\s*(years?|yrs?|months?|mos?)\b/i.exec(text);
  const m = a ?? b;
  if (m) {
    const n = num(m[1]!);
    if (n === null) return null;
    const months = /^y/i.test(m[2]!) ? n * 12 : n;
    return { start: m.index, end: m.index + m[0].length, text: m[0], months };
  }
  const c = /\bwarranty\s+(?:valid|is\s+valid)?\s*(?:till|until|up\s*to|upto|ends\s+on|expires\s+on)\b/i.exec(text);
  if (c) {
    const until = dates.find((d) => d.start >= c.index && d.start - (c.index + c[0].length) < 20);
    if (until) return { start: c.index, end: until.end, text: text.slice(c.index, until.end), months: null, until };
  }
  return null;
}

function findReturnTerm(text: string, dates: DateMention[]): (TermMatch & { days: number | null }) | null {
  const a = /\b(\d{1,3}|seven|ten|fifteen|thirty)\s*[- ]?\s*days?\s+(?:easy\s+|free\s+|hassle[- ]free\s+|no[- ]questions?[- ]asked\s+)?(?:return|replacement|refund|exchange)s?(?:\s+(?:policy|window|period))?\b/i.exec(text);
  const b = /\b(?:return|replacement|exchange)\s*(?:window|policy|period)?\s*(?:of|:|-|within)?\s*(\d{1,3})\s*days?\b/i.exec(text);
  const m = a ?? b;
  if (m) {
    const n = num(m[1]!);
    if (n !== null) return { start: m.index, end: m.index + m[0].length, text: m[0], days: n };
  }
  const c = /\b(?:return(?:able)?|eligible\s+for\s+return|return\s+window\s+closes|replace(?:able|ment))\s*(?:by|until|till|before|on|on\s+or\s+before)\b/i.exec(text);
  if (c) {
    const until = dates.find((d) => d.start >= c.index && d.start - (c.index + c[0].length) < 20);
    if (until) return { start: c.index, end: until.end, text: text.slice(c.index, until.end), days: null, until };
  }
  return null;
}

/** Latest of two optional ISO dates. */
export function maxIso(a: IsoDate | null, b: IsoDate | null): IsoDate | null {
  if (!a) return b;
  if (!b) return a;
  return compareIso(a, b) >= 0 ? a : b;
}

export type { RecurrenceRule };
