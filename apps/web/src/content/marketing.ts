/**
 * Marketing copy. Rules: no invented user counts, testimonials, awards or
 * accuracy figures; every capability described exists in this codebase, and
 * limitations are stated where a reader would otherwise assume more.
 */
export interface FeaturePage {
  slug: string;
  nav: string;
  title: string;
  kicker: string;
  description: string;
  points: { title: string; body: string }[];
  honest: string;
}

export const FEATURE_PAGES: FeaturePage[] = [
  {
    slug: 'life-inbox', nav: 'Life Inbox', kicker: 'Capture', title: 'One place for everything you need to remember',
    description: 'Paste a message, drop a screenshot, upload a receipt or PDF, save a link, record a voice note — or share straight from your phone. Everything lands in one Inbox first.',
    points: [
      { title: 'Many ways in', body: 'Text, notes, links, screenshots, photos, PDFs, receipts, audio, the browser extension and the installed app’s share sheet (where your browser supports it).' },
      { title: 'Nothing gets lost', body: 'The original is stored before anything is read. If reading fails, the capture stays — marked, retryable, never discarded.' },
      { title: 'Duplicates noticed, never merged', body: 'Save the same receipt twice and LifeOS tells you. It keeps both until you decide.' },
      { title: 'Works on a bad connection', body: 'Notes and captures made offline wait on your device and sync when you’re back — once, without duplicates.' },
    ],
    honest: 'Voice notes are stored as audio; there is no on-device transcription in this version.',
  },
  {
    slug: 'lifegraph', nav: 'LifeGraph', kicker: 'Connect', title: 'Every action remembers where it came from',
    description: 'A task knows the screenshot it came from. A warranty knows its purchase and its receipt. A refund follow-up knows the return. Open any record and see its source and everything connected to it.',
    points: [
      { title: 'Source-backed', body: 'Records created from a capture keep a link to the exact text they were read from.' },
      { title: 'Provenance on every link', body: 'Each connection says whether you made it, confirmed it from a capture, or the system added it.' },
      { title: 'History that stays', body: 'Changes to dates, statuses and links are kept as a readable history.' },
      { title: 'A map when you want one', body: 'The graph view is optional; the related-records list on each page is the everyday way to navigate.' },
    ],
    honest: 'The graph explorer is part of LifeOS Plus. Source links on individual records are free.',
  },
  {
    slug: 'followthrough', nav: 'FollowThrough', kicker: 'Follow through', title: 'From remembering to actually getting it done',
    description: 'Tasks with due dates, times, repeats, checklists, subtasks and dependencies — plus the follow-ups real life needs: waiting on someone, chasing a refund, checking back after a week.',
    points: [
      { title: 'Next steps, suggested from your facts', body: 'When something you were promised is overdue or a return window is about to close, LifeOS suggests a step — and waits for your approval.' },
      { title: 'Waiting is a real state', body: 'Mark a task as waiting on someone. LifeOS notices how long it has been.' },
      { title: 'Completion with evidence', body: 'Add a note or attach the confirmation when you finish.' },
      { title: 'Nothing runs behind your back', body: 'Suggestions only ever create things inside LifeOS, and can be undone for 24 hours.' },
    ],
    honest: 'LifeOS never sends emails, submits forms, makes payments or contacts anyone for you.',
  },
  {
    slug: 'lifeadmin', nav: 'LifeAdmin', kicker: 'Paperwork', title: 'Multi-step paperwork, one clear checklist',
    description: 'University applications, school registration, renewals, travel documents, household paperwork. Start from a template, gather documents, track each step, keep your reference numbers and evidence.',
    points: [
      { title: 'Templates to start from', body: 'Generic starting checklists you edit — always to be checked against the official source.' },
      { title: 'Status you can trust', body: 'From “documents needed” to “you reported submitting” to “confirmed”. LifeOS records what you did; it never claims an office accepted anything.' },
      { title: 'Deadlines with reminders', body: 'A week before and a day before, at your chosen time.' },
      { title: 'Evidence attached', body: 'Link confirmations and receipts from your Vault to the workflow.' },
    ],
    honest: 'LifeOS does not submit forms or verify records with any government system.',
  },
  {
    slug: 'purchase-protection', nav: 'Purchase Protection', kicker: 'Purchases', title: 'Never miss a return window or a warranty again',
    description: 'Capture a receipt or invoice. LifeOS suggests the purchase, the warranty and the return window it can read from the document. You confirm the dates; it reminds you before they pass.',
    points: [
      { title: 'One receipt, several records', body: 'A single invoice can become a purchase, a saved receipt, a warranty and a return deadline — all linked.' },
      { title: 'Terms from your documents only', body: 'If the receipt doesn’t state a warranty, LifeOS doesn’t assume one.' },
      { title: 'Returns and refunds', body: 'Track a return, then set a date to check on the refund. A follow-up message draft is ready to copy.' },
      { title: '“Where is my laptop invoice?”', body: 'Ask in plain words and open the original in one tap.' },
    ],
    honest: 'Claims and returns are made by you with the seller or brand; LifeOS keeps the checklist and the proof.',
  },
  {
    slug: 'familyos', nav: 'FamilyOS', kicker: 'Family', title: 'Share the household, not your private life',
    description: 'A family space for shared tasks, the family calendar, shopping lists and selected documents. Joining it never exposes anyone’s personal notes, purchases, documents or searches.',
    points: [
      { title: 'Roles that make sense', body: 'Owner, adult, member and limited (for a helper or a child: their assigned tasks and the shopping list).' },
      { title: 'Share one document at a time', body: 'Choose who sees it, whether they can download it, and when access ends. Revoke any time.' },
      { title: 'Assign and accept', body: 'Give someone a task; they accept it and get the reminder.' },
      { title: 'Activity, not surveillance', body: 'A shared history of what changed in the family space — no tracking, no profiling.' },
    ],
    honest: 'Invitations are links you send yourself; LifeOS doesn’t send email in this version.',
  },
];

export const FAQ: { q: string; a: string }[] = [
  { q: 'Does LifeOS create tasks automatically from my screenshots?', a: 'No. It suggests what a capture might mean — a task, a deadline, a purchase, a renewal — and shows you the text it came from. Nothing is saved as a task, reminder or record until you confirm it.' },
  { q: 'What happens when a date is ambiguous?', a: 'LifeOS asks. “3 December” with no year gets a year chooser; “04/05/2027” shows both readings; “next Friday” offers both Fridays. It never fills in a year or a time you didn’t give it.' },
  { q: 'Are my documents sent to an AI company?', a: 'No. Text in PDFs and images is read on the LifeOS server with local OCR, and answers come from local rules over your own records. There is no external AI service in this version.' },
  { q: 'Can my family see my things?', a: 'Only what is inside a family space, or a specific document you choose to share. Personal records, purchases, documents and searches stay private.' },
  { q: 'Will reminders definitely reach my phone?', a: 'In-app notifications always work. Browser push depends on your browser and device — on iPhone it requires adding LifeOS to the Home Screen, and some Android battery settings delay notifications. LifeOS shows you exactly what it could deliver.' },
  { q: 'Can LifeOS cancel subscriptions or pay bills for me?', a: 'No. It reminds you before renewals and due dates, keeps a cancellation checklist and your proof, and records what you report. It doesn’t move money or log into other services.' },
  { q: 'What happens to my data if I cancel?', a: 'Nothing is deleted. Premium sections become read-only; tasks, reminders, calendar, capture, search and export stay free.' },
  { q: 'Can I take my data with me?', a: 'Yes. One click exports every record you created and your original files, decrypted, as a .zip.' },
  { q: 'Which languages are supported?', a: 'English, Hindi and Bengali for navigation and the core capture-to-reminder workflow. Reading of dates and amounts handles Indian formats, ₹ and lakh grouping; reading of Hindi or Bengali text in captures is not yet supported.' },
  { q: 'Is there a mobile app?', a: 'LifeOS is an installable web app (PWA) that works on Android and iPhone browsers. Native apps are not available yet.' },
];

export const DIFFERENTIATORS = [
  { title: 'Universal Life Capture', body: 'Screenshots, receipts, PDFs, links, notes and voice — one Inbox.' },
  { title: 'LifeGraph', body: 'Every action linked to its source and the records around it.' },
  { title: 'FollowThrough', body: 'Waiting, chasing and checking back are first-class steps.' },
  { title: 'LifeAdmin', body: 'Paperwork as checklists with honest statuses.' },
  { title: 'Purchase Protection', body: 'Warranties and return windows from your own receipts.' },
  { title: 'Promise Tracker', body: 'What you promised, what you were promised, what you’re waiting on.' },
  { title: 'Private Life Search', body: 'Ask in plain words; answers cite your records.' },
];
