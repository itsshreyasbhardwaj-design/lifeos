# LifeOS: Competitive Analysis

**Research date:** 2026-11-22. Every source below was read that day.
**Pricing changes often.** Treat every price here as a snapshot taken on that date. Check it again before using it in a pricing decision or in public copy.

---

## 1. Scope, method and caveats

**What LifeOS is (from the product brief, not verified here):** a web app for organising personal life admin. You capture screenshots, receipts or PDFs. Local OCR and rule-based extraction propose structured records. You confirm them, and they become tasks, reminders, purchases, warranties or subscriptions, with family sharing. LifeOS is India-first. Its INR price hypotheses are Free ₹0, Plus ₹149/mo and Family ₹299/mo.

**Method**
- Sources are vendor-owned wherever possible: official sites, pricing pages, help centres, and App Store listings. App Store listings are written by the developer, and the developer sets the in-app purchase (IAP) prices for each storefront.
- **INR prices** come from the India App Store storefront (`apps.apple.com/in/...`), which shows prices in ₹. **Web prices** are given in the currency the vendor's page showed. No currency has been converted. Nothing here presents a converted figure as an official price.
- The fetch and search tooling ran from a US location. Web pricing pages that adjust by region may therefore have shown USD prices. A visitor in India may see different web prices.
- The India App Store listings often show several SKUs under one product, including promotional, legacy or differently priced items, and the listing doesn't always state the billing period. Where that happens, this document reports the range and says the period isn't stated. Google Play India prices were **not** checked. Tax treatment was not verified.
- Pages were read through an automated fetch-and-summarise tool. Some pages blocked automated access or returned only navigation: an Evernote help article (HTTP 403), india.gov.in (403), and DigiLocker's FAQ subpages (title only). Claims that only those pages could have supported are left out.

**Legend used in the tables**
- **NF** means not found in the official docs reviewed. The capability may still exist.
- **Not offered** means the vendor's own documentation says the product doesn't do it, or no longer does it.
- A blank capability is never read as "lacks".

---

## 2. Products in scope

| Group | Products | Notes |
|---|---|---|
| Task / reminder apps | Todoist, Any.do, TickTick, Apple Reminders, Google Tasks, Google Keep, Microsoft To Do, Notion | Microsoft To Do apps are scheduled to retire (see §3). |
| Family organisers | FamilyWall, Cozi | |
| Document apps | Adobe Scan, Evernote, DigiLocker; Microsoft Lens (retired) | Microsoft Lens is retired, so it's recorded but not compared. DigiLocker is included as the India-specific document wallet. |
| Receipt / warranty trackers | WarrantyVault, Warrantly, MyBillWallet | No large, established consumer warranty tracker turned up. The search did return many small independent App Store apps. The three chosen were current on the App Store when checked. Two are on the US storefront. MyBillWallet is on the India storefront and has an India-based developer [47]. |

---

## 3. Market changes (2025–2026) relevant to LifeOS

- **Microsoft To Do is being retired.** Microsoft states that "Microsoft To Do apps will retire on June 30, 2027", on web, Windows, Mac, iOS and Android, for work and personal accounts [23]. Planner is the suggested destination, but Microsoft says Planner is not available for personal accounts, including Microsoft 365 Personal and Family. It tells those users to choose another task app [23]. Microsoft says an export tool will come, and that retiring the apps doesn't by itself schedule data for deletion [23].
- **Microsoft Lens is retired.** Support ended and the app was removed from the stores on 9 Feb 2026. Scanning stopped on 9 Mar 2026. Microsoft points users to the OneDrive scanner, whose scans can't be saved locally on the device [41].
- **Google Keep reminders moved to Google Tasks** in the second half of 2025. Keep **no longer** creates or delivers location-based reminders, and Keep no longer sends reminder notifications. Users need the Calendar or Tasks app for those [17].
- **Todoist added document and screenshot capture.** Its October 2026 update says a dropped document or screenshot (for example, meeting notes) becomes tasks [3].
- **AI reminder extraction now ships in operating systems.** Apple Intelligence can suggest reminders from text shared into Reminders. It is labelled beta and needs iPhone 15 Pro or later, or an M1-or-later iPad [13]. Gemini Apps can add to-dos from a photo of a list into Google Tasks [18].

---

## 4. Comparison table

There are 12 dimensions, so the table is split into two parts with the same rows. The LifeOS row describes the **intended** scope from the product brief. It is not a verified claim.

### 4a. Capture, intelligence, tasks, reminders, calendar

| Product | Capture methods | OCR | AI extraction | Task management | Reminders | Calendar integration |
|---|---|---|---|---|---|---|
| **LifeOS (intended)** | Screenshot / receipt / PDF upload | Local OCR | Rule-based; user confirms | Tasks, purchases, warranties, subscriptions | Yes (planned) | Not specified in brief |
| Todoist | Quick add, email forwarding, voice (Ramble), document/screenshot → tasks, widgets, AI assistants via MCP [3] | NF as a standalone feature; screenshots/documents turn into tasks [3] | Ramble voice → tasks with dates/priorities [3]; AI date extraction from email on paid plans [3]; 10 AI capture sessions/mo on Beginner, unlimited on Pro [1] | Projects, labels, filters (3 on Beginner, 150 on Pro), deadlines, durations [1] | Task reminders on all plans; custom reminders Pro only (not offered on Beginner) [1] | 1 connected calendar (Beginner), 3 (Pro) [1] |
| Any.do | Voice entry [7]; WhatsApp reminders (Premium) [6] | NF | "AI-powered features" in Premium, not specified [6] | Tasks, lists, daily planner; recurring tasks Premium [6] | Reminders free; WhatsApp + location reminders Premium [6] | Built-in calendar [6]; syncs with phone calendar, Google, Outlook [7] |
| TickTick | Voice, natural-language dates, email-to-task, browser right-click, widget, desktop shortcut [9] | NF | Premium: AI Assistant, AI Voice Capture, Recording Summary, MCP; Free: not offered [8] | Lists (9 Free / 299 Premium), tasks per list 99/999, habits, Pomodoro, Eisenhower matrix [8][9] | 2/5 per task; email reminders Premium only; location reminders (iOS only); constant reminder [8][9] | Multiple calendar views; Google Calendar integration; calendar subscriptions [9] |
| Apple Reminders | Siri; Control Center / Action button (iOS 26); share text to Reminders [11][13] | Scanned-document attachment [11]; text-to-field extraction NF | Apple Intelligence suggests reminders from shared text (beta, device-limited) [13]; Auto-Categorize into sections [14] | Lists, subtasks, tags, smart lists, flags, templates, grocery lists [11][12] | Time, arrive/leave location, "When Messaging", urgent alarms (iOS 26.2) [11] | Scheduled reminders show in Calendar (iOS 18+) [11] |
| Google Tasks | From Gmail, Calendar, Chat [16]; Gemini from chat or a photo of a list [18] | Via Gemini photo-of-list capture [18] | Gemini Apps create/update tasks (Workspace connection + History required) [18] | Lists, subtasks, notes, due dates [16] | Due-date notifications [16]; location reminders not offered [17] | Native in Google Calendar [16][17] |
| Google Keep | Text, image and voice notes [20][21] | OCR text from pictures (per a 2017 Google post) [21] | NF | Notes and lists [19] | Saved as Google Tasks since H2 2025; no location reminders, no Keep notifications (not offered) [17] | Via Tasks/Calendar [17] |
| Microsoft To Do | Flagged Outlook email → tasks (work/school) [24] | NF | NF | Lists, list groups, "Assigned to Me", Planner tasks [24] | Documented for flagged-email tasks [24]; others NF in page read | Outlook integration [24] |
| Notion | File upload; PDF import [29]; Agent turns uploaded files into pages/databases [28] | Scanned/image-only PDFs not reliably searchable without OCR first [29] | Agent reads PDF, CSV, XLSX, DOCX, PPTX, ZIP [28]; Agent and AI Meeting Notes listed for Business, limited trial on lower tiers [26] | General-purpose pages/databases [26][27] | NF | Notion Calendar connects multiple calendars (Free) [26] |
| FamilyWall | Recipe web import; AI email-to-event import (v12.2) [31] | NF | Email-to-event import [31] | Task, chore and packing lists, assignable [31] | Calendar reminders [31] | External calendar import (Free); Google/Outlook sync + URL subscriptions (Premium) [30][31] |
| Cozi | AI Event Import from email inbox (Max) [33] | NF; photo/PDF import not mentioned [33] | Max only: Event Import, Recipe Creator, Meal Planner [33] | Shared to-do and grocery lists [33] | Notifications (Free); up to 3 per event (Gold) [33] | Shared family calendar [33]; subscribe to other calendars [34] |
| Adobe Scan | Camera capture modes, edge detection [35]; finds receipts/docs in photo library [36] | Searchable, editable PDFs [35]; paid raises OCR from 5 to 100 pages [36] | Business-card contact extraction; AI straighten/edge detection [36] | NF (scanner app) | NF | NF |
| Evernote | Document scanning; AI Transcribe [37][38] | Searches text in images, PDFs, Office files, scans and handwriting [39] | AI Assistant, Semantic Search, AI Transcribe, AI Edit, AI Cleanup, MCP; plan mapping not shown [37] | Tasks with dates, reminders, assignment [38] | Reminders on notes and tasks [38] | External calendars: 1 (Free), 5 (paid tiers) [37] |
| DigiLocker | Issuer-pushed documents and user uploads [44] | NF | NF | NF | NF | NF |
| WarrantyVault | Receipt photo [45] | Yes: "AI autofill" reads receipt photos [45] | Product, store, date, price [45] | NF | 30/14/7/1 days before expiry [45] | NF |
| Warrantly | Receipt photo, PDFs/documents [46] | NF | NF | NF | 1–90 days before expiry (choice of 7 intervals) [46] | NF |
| MyBillWallet | Upload bills/receipts [47] | NF | NF | NF | Warranty expiry and bill due dates [47] | NF |

### 4b. Family, documents, search, offline, mobile, pricing

| Product | Family collaboration | Documents | Search | Offline | Mobile apps | Subscription pricing (see §5) |
|---|---|---|---|---|---|---|
| **LifeOS (intended)** | Family sharing (Family tier) | Receipts, PDFs, screenshots | Not specified in brief | Not specified in brief | Web app | ₹0 / ₹149 / ₹299 per month (hypotheses) |
| Todoist | 5 people per personal project [1] | Uploads 5 MB (Beginner) / 100 MB (Pro) [1] | Filter views [1]; attachment full-text NF | Offline mode; syncs on reconnect [4] | Android, iPhone, iPad, Apple Watch, Wear OS + desktop [5] | Free; Pro US$5/mo yearly or US$7 monthly [1]; ₹330/mo, ₹3,149/yr (App Store IN) [2] |
| Any.do | Family plan: 4 members (fixed, can't be increased), shared grocery list, 4 shared projects [6] | Attachments via Drive/OneDrive/Dropbox/Box [6] | NF | NF | iPhone, Android, iPad, Mac, Windows, web, Apple Watch, Wear OS [6] | Premium $7.99/mo or $4.99/mo yearly; Family $9.99/mo or $8.33/mo yearly [6] |
| TickTick | 2 members (Free) / 29 (Premium); shared lists, assign [8][9] | Attachments 1/day (Free) / 199/day (Premium) [8] | NF | NF | "All platforms" (list not on pricing page) [8] | US$49.99/yr [8]; ₹269/mo, ₹2,599/yr (App Store IN) [10] |
| Apple Reminders | Share lists, assign reminders [11] | Photo / scanned-doc attachments [11] | Search lists [12] | NF | iPhone, iPad, Mac, Apple Watch [11]; Android NF | No separate price found; built-in Apple app [11] |
| Google Tasks | Assign group tasks in Chat spaces; Docs assignment (eligible Workspace) [16] | NF | NF | NF | Android, iOS; side panel in Gmail/Calendar/Drive/Docs [16] | No paid tier found; Google Account storage up to 15 GB [22] |
| Google Keep | Share with people or Google Groups; collaborators edit text, lists, images, audio [19] | Images, drawings, audio [19] | Words inside images (2017 post) [21] | NF | Android, iOS [21]; web [20] | No paid tier found [22] |
| Microsoft To Do | Share list by link; assign to members [24] | 25 MB per task; personal lists only, not shared (not offered) [24] | NF | NF | iOS, Android, Windows, web [24]; **apps retire 30 Jun 2027** [23] | Microsoft Store: "Free download" [25] |
| Notion | Guests; teamspaces; external guest limit 10 (plan unclear) [26] | 5 MB/file (Free), 5 GB (paid) [26] | Workspace search; Enterprise Search on Business [26] | Free: chosen pages; paid: Recents/Favourites auto-download [26] | Desktop + mobile [26] | Plus $10, Business $20 per member/mo, "Price in USD" [26]; Plus ₹1,199/mo, ₹11,900/yr (App Store IN) [27] |
| FamilyWall | Shared calendar, lists, messaging, gallery, contacts; Premium location sharing with arrival/departure alerts [31] | Premium document storage, private/shared folders; 25 GB [30][31] | NF | Shopping lists work offline [31] | iOS [31]; Google Play and web purchase mentioned [30] | $7.99/mo, $44.99/yr (App Store US) [31]; ₹299/mo (App Store IN) [32] |
| Cozi | One upgrade covers the whole family [33] | NF | Calendar search (Gold) [33] | NF | "Any device"; mobile month view (Gold) [33] | Gold $39/yr, Max $79/yr [33]; Gold ₹2,999–₹5,900, Max ₹7,900 (App Store IN) [34] |
| Adobe Scan | Scans private unless shared [35] | Adobe Document Cloud storage [35] | Searchable PDFs [35] | NF | iOS 15+, Android 8+; Acrobat web [35] | App free [35]; Scan Plus ₹499/mo, ₹1,999/yr (App Store IN) [36] |
| Evernote | "Easy sharing" listed [37] | Storage 1 GB (Free), 5 GB (Starter), unlimited (Advanced) [37] | In-file text search [39]; Boolean/geographic search [38] | Offline notes (plan mapping not shown) [37] | iOS [40]; devices 1 (Free) / 3 (Starter) / unlimited [37] | Web prices not shown on pages read [37][38]; ₹789 (Personal Monthly) (App Store IN) [40] |
| DigiLocker | NF | Issued documents from 2,000+ issuers; user uploads [44]; 900 crore+ issued documents [42] | NF | NF | Android, iOS, web [42] | Free [43] |
| WarrantyVault | NF | On-device; Pro adds iCloud backup [45] | Search/filter [45] | Works offline, no account [45] | iPhone/iPad [45] | Free up to 5 products; Pro $9.99/yr or $14.99 lifetime [45] |
| Warrantly | NF | Attachments; ZIP export; Apple/Google sign-in sync [46] | Sort/filter [46] | NF | iOS/iPadOS [46] | Free up to 10 warranties; Pro $1.99 lifetime [46] |
| MyBillWallet | NF | Bills/receipts; creates GST invoices [47] | NF | NF | iOS (India storefront) [47] | Free; no IAP listed [47] |

---

## 5. Pricing detail (published currency; INR where the vendor publishes it)

The web column shows the currency as each vendor displayed it, from a US-located fetch. The India App Store column shows ₹ prices from the developer's India storefront listing. Neither column is a conversion.

| Product | Web / official page | India App Store IAP (₹) |
|---|---|---|
| Todoist | Beginner US$0; Pro US$5/mo billed yearly (US$60) or US$7 monthly; Business US$8/user/mo yearly or US$10 monthly, "plus local tax" [1] | Pro ₹330/mo; ₹3,149/yr (Pro and "Pro Legacy" SKUs at the same prices) [2] |
| Any.do | Premium $7.99/mo or $4.99/mo billed annually; Family $9.99/mo or $8.33/mo billed annually (4 members); Teams $7.99 or $4.99/member/mo; "$" with no currency code [6] | Premium monthly SKUs ₹419 and ₹489; 12-month SKUs ₹2,549, ₹2,949 and ₹4,899; promo SKUs from ₹189 [7]. Which SKU a new user sees is not stated. |
| TickTick | Premium US$49.99/yr; no monthly option on the page [8] | ₹269/mo; ₹2,599/yr [10] |
| Apple Reminders | No separate price found | n/a |
| Google Tasks / Keep | No paid tier found; Google Account storage up to 15 GB, shared by Gmail, Drive and Photos (the page doesn't say how Keep counts) [22] | n/a |
| Microsoft To Do | "Free download" (Microsoft Store) [25]; apps retire 30 Jun 2027 [23] | n/a |
| Notion | Free $0; Plus $10; Business $20 per member/mo; Enterprise custom; "Price in USD"; up to 20% off yearly [26] | Plus ₹1,199/mo, ₹11,900/yr; Business ₹2,499 / ₹24,900 [27] |
| FamilyWall | No price on the support article [30]; US App Store $7.99/mo, $44.99/yr [31] | ₹299/mo; yearly SKUs ₹1,499 and ₹2,999; other SKUs ₹119–₹799 with periods not stated [32] |
| Cozi | Free $0; Gold $39/yr; Max $79/yr; "$" with no currency code [33] | Gold SKUs ₹2,999–₹5,900; Max ₹7,900 [34] |
| Adobe Scan | App free; Acrobat Pro trial mentioned, no price shown [35] | Scan Plus ₹499/mo, ₹1,999/yr; Premium SKUs ₹369–₹6,300; PDF Pack ₹769 [36] |
| Evernote | Plan names and limits shown, no prices on pages read [37][38] | "Personal Monthly" ₹789; other SKUs ₹789 and ₹7,699 with periods not stated [40] |
| DigiLocker | n/a | Free [43] |
| WarrantyVault | US store: Pro $9.99/yr, $14.99 lifetime [45] | Not checked |
| Warrantly | US store: Pro $1.99 lifetime [46] | Not checked |
| MyBillWallet | n/a | Free, no IAP listed [47] |

**Facts relevant to the LifeOS price hypotheses.** These compare INR to INR and only state what was observed:
- The India App Store monthly prices found for paid individual tiers are: TickTick ₹269 [10], Todoist ₹330 [2], Any.do ₹419–₹489 [7], Scan Plus ₹499 [36], Evernote ₹789 [40] and Notion Plus ₹1,199 [27]. All are above the ₹149 Plus hypothesis. Any.do also lists promo SKUs at ₹189 and ₹199 [7].
- FamilyWall's India App Store monthly Premium is ₹299 [32], the same figure as the LifeOS Family hypothesis. FamilyWall also lists yearly SKUs at ₹1,499 and ₹2,999 [32].
- On yearly plans: TickTick is ₹2,599/yr [10] and Todoist is ₹3,149/yr [2]. LifeOS hasn't set yearly prices, and 12 months of the monthly hypotheses would be ₹1,788 (Plus) and ₹3,588 (Family).
- Free alternatives are a strong anchor: Apple Reminders, Google Tasks/Keep, Microsoft To Do (until 2027), DigiLocker, Adobe Scan's free tier and Cozi Free.

---

## 6. Notes by category

### Task and reminder apps
- **Todoist** has the most AI capture surfaces: voice (Ramble), AI email parsing, screenshot/document → tasks, and an MCP server [1][3]. The free tier caps AI capture at 10 sessions/month [1].
- **Any.do** is the only task app found offering **WhatsApp reminders** (Premium) [6]. This matters for India-first positioning. It also has a dedicated Family tier capped at 4 members [6].
- **TickTick** has the lowest non-promotional India App Store monthly price among the paid task apps checked: ₹269 [10]. Any.do lists promo SKUs at ₹189 and ₹199 [7]. TickTick's AI is Premium-only [8].
- **Apple Reminders** and **Google Tasks** are free and built into the operating system or account, and both now offer AI capture [13][18]. Apple Intelligence availability "varies" by device, language and region [13][15]. On Apple's India page, English (India) appears only in footnotes for some features, not in the main language list [15].
- **Google Keep's** role in reminders has narrowed. Reminders now live in Tasks, and location reminders are gone [17].
- **Microsoft To Do** consumer users have a published end date and no Microsoft replacement [23].
- **Notion** is a general workspace rather than a reminder app. Its strength is AI that reads files and turns them into structured databases [28]. Scanned PDFs need OCR before they are reliably searchable [29].

### Family organisers
- **FamilyWall** is the closest family-plan analogue to LifeOS Family. It has shared document folders, 25 GB of storage, calendar sync, location sharing and a budget tracker in Premium [30][31], plus AI email-to-event import [31]. Its India monthly price is ₹299 [32].
- **Cozi** puts AI (email event import, meal planning) only in its top Max tier [33].

### Document apps
- **Adobe Scan** and **Evernote** are mature at capture-plus-OCR: searchable PDFs [35], and search inside images, PDFs and handwriting [39]. Neither turns a document into a dated obligation (warranty expiry, renewal) in the docs reviewed. That is NF, not a confirmed gap.
- **DigiLocker** is run by MeitY under Digital India and reports 900 crore+ issued documents [42]. Rule 9A legally equates **issued** documents with physical originals [44]. Its own guidance says user-uploaded scans "are NOT treated as authentic original documents" [44]. LifeOS can't match that legal status for issued documents and shouldn't imply it.
- **Microsoft Lens** is retired (see §3) [41].

### Receipt and warranty trackers
- The App Store has many small, recent independent apps. The three reviewed show few or no ratings: WarrantyVault and Warrantly show "not enough ratings" [45][46], and MyBillWallet shows 6 ratings [47].
- They converge on the same core: photo of a receipt, expiry date, reminders. WarrantyVault adds AI field extraction (product, store, date, price) and an on-device, no-account default [45]. MyBillWallet combines warranty storage with GST invoice creation and bill reminders [47].
- None of the three combines warranties with general task management or family sharing in the docs reviewed. That is NF, not a confirmed gap.

---

## 7. Where competitors are clearly ahead

These points are stated plainly and each one is sourced.

1. **Native mobile apps and OS integration.** Todoist ships on Android, iPhone, iPad, Apple Watch, Wear OS and desktop [5]. Any.do adds Siri and browser extensions [6]. Apple Reminders works with Siri, Control Center and the Action button [11]. Google Tasks lives in the Gmail, Calendar and Drive side panels [16]. LifeOS is a web app, and receipts are mostly captured on a phone.
2. **Distribution and price anchoring.** No paid tier was found for Apple Reminders, Google Tasks or Google Keep. They come with the operating system or a Google Account [11][16][22]. A paid LifeOS tier competes with "already installed and free".
3. **Calendar and email integrations.** Todoist connects 1–3 calendars and accepts forwarded email [1][3]. Any.do syncs with Google and Outlook [7]. TickTick supports calendar subscriptions [9]. FamilyWall syncs with Google and Outlook [30]. Cozi imports events from email [33]. MCP servers exist for Todoist and TickTick, and Evernote lists an MCP connection [3][8][37].
4. **AI extraction breadth.** Apple Intelligence [13], Gemini [18], Todoist Ramble and Email Assist [3], Notion Agent [28] and WarrantyVault's AI autofill [45] use generative or ML extraction. Rule-based extraction will probably handle fewer formats unless LifeOS proves otherwise.
5. **Mature OCR and search.** Evernote searches handwriting and text inside images, PDFs and Office files [39]. Adobe Scan produces searchable PDFs and runs on iOS 15+ and Android 8+ [35].
6. **Family features beyond admin.** FamilyWall offers location sharing, messaging, galleries and a budget tracker [31]. Cozi offers recipes and meal planning [33].
7. **Offline maturity.** Todoist [4] and Notion [26] document offline modes, and WarrantyVault works offline with no account [45].
8. **Scale and legal standing in India.** DigiLocker reports 900 crore+ issued documents [42], and its issued documents have legal equivalence under Rule 9A [44].
9. **Price points already near the LifeOS hypotheses.** TickTick is ₹269/mo [10], and FamilyWall Premium is ₹299/mo [32].

---

## 8. Where LifeOS could genuinely differ (hypotheses to validate)

**These are hypotheses, not claims.** Each one lists what would support it and what would disprove it. None has been tested with users.

| # | Hypothesis | Why it might hold (observed facts) | How to validate | What would disprove it |
|---|---|---|---|---|
| H1 | One capture flow that turns a document into the right **type** of record (purchase → warranty expiry → reminder; renewal → subscription) saves effort compared with juggling a task app and a separate warranty app. | The task apps reviewed extract tasks [3][13][18]. The warranty apps extract receipt fields [45]. Neither group covers both in the docs reviewed (NF, not confirmed absent). | Interview 10–15 Indian households about where receipts and warranties live today. Run a concierge test: users send 20 real documents, and measure how many become correct records. | Users already manage this with Google Drive/WhatsApp plus a reminder app and see no pain. Or the extraction accuracy is too low to beat manual entry. |
| H2 | **Local OCR without cloud AI by default** is a reason to choose LifeOS for privacy-sensitive users. | WarrantyVault sends photos over an encrypted connection for extraction [45]. Apple Intelligence is beta and limited to some devices [13]. Gemini capture needs History on and a Workspace connection [18]. | Pricing-page A/B or interview: ask about willingness to pay for "documents never leave your device", and check whether it ranks above accuracy and convenience. | Users rank accuracy or convenience above privacy, or don't believe local processing makes a difference. |
| H3 | **India-specific extraction** (₹ amounts, GST invoices, Indian date formats, Indian retailer invoices, warranty terms) is under-served by the global apps. | Only MyBillWallet referenced GST, and it's aimed at invoicing [47]. No India-specific extraction was found in the other products' docs (NF). | Build an Indian receipt and invoice test set and measure extraction precision/recall against a generic OCR baseline. Confirm with users that these document types are common. | Generic AI extraction from competitors already handles Indian documents well enough. |
| H4 | The **confirm-before-save** step builds more trust than auto-add AI. | Apple warns that AI "outputs may vary" and asks users to check important information [13][14]. | Usability test: compare error rates and stated trust for confirm-first against auto-add. | Users find confirmation tedious and drop off, or prefer auto-add with undo. |
| H5 | A **household admin** family plan (shared warranties, subscriptions, purchase records) is a different job from calendar/meal/location family apps. | FamilyWall and Cozi focus on calendar, lists, recipes, location and messaging [31][33]. FamilyWall does have document folders and a budget tracker [30]. | Interview family "admins" (often one person per household) about the jobs they do and what they would pay. Test a ₹299 Family offer against FamilyWall's ₹299 [32]. | Families want calendar and location first, or a single admin doesn't need shared access. |
| H6 | **Departing Microsoft To Do users** are reachable. | Personal-account users are told to choose another app before 30 Jun 2027 [23]. | Measure interest from To Do users, for example with a landing page and a To Do import. | That audience isn't India-heavy, or it moves to Todoist/TickTick, which already have imports and native apps. |
| H7 | **Complementing DigiLocker** (for example, linking or referencing DigiLocker documents and tracking renewals) works better than competing as a document store. | DigiLocker holds legally valid issued documents [44] but has no reminders or tasks in the docs reviewed (NF). | Interview users about expiry and renewal pain for DL, RC, insurance and PUC documents. Check what DigiLocker integration access requires. | DigiLocker adds renewal reminders itself, or integration isn't available to a small developer. |
| H8 | A **web app plus browser extension** is enough for capture. | Many invoices arrive by email or on the web, but receipts are often physical. The competitors' strength is native mobile capture (see §7, point 1). | Log capture sources in a pilot: share of desktop/web captures against phone photos. | Most captures are phone photos of paper. That would make a native or PWA camera flow a prerequisite. |

---

## 9. Not verified and open questions

- **Web INR prices:** none of the vendor web pages read showed INR, and the fetch ran from the US. India-localised web pricing may exist and wasn't seen.
- **Google Play India prices:** not checked.
- **Offline support** for Any.do, TickTick, Apple Reminders, Google Tasks/Keep, Microsoft To Do and Cozi: NF in the pages read.
- **Google Keep OCR:** the only official source read is a 2017 Google blog post [21]. Current behaviour wasn't re-verified on a live help page.
- **Evernote plan naming:** the compare page lists Free, Starter, Advanced, Flexible and Unlimited [37]. The search feature page ties in-file search to "Personal, Professional, and Enterprise" plans [39]. Which current tier includes in-file search is unclear.
- **DigiLocker upload storage quota:** secondary sources conflict (10 MB vs 1 GB). No official page read confirmed a figure, so none is stated.
- **Release dates:** the warranty apps' App Store "latest version" dates were shown without a year [45][46]. MyBillWallet's latest version is 15/09/2025 [47].
- **Excluded:** Google Wallet's "add items from a photo" feature was considered and left out. Its India availability couldn't be confirmed on the official help pages read.

---

## Sources

All read on 2026-11-22.

1. Todoist, Pricing: https://www.todoist.com/pricing
2. Todoist, App Store (India storefront): https://apps.apple.com/in/app/todoist-to-do-list-planner/id572688855
3. Todoist, "October 2026: Capture tasks wherever they find you": https://www.todoist.com/help/todoist/product-updates/october-2026-capture-tasks-wherever-they-find-you-reUlb5uSI
4. Todoist Help, Use Todoist while offline: https://www.todoist.com/help/articles/205144561
5. Todoist, Downloads: https://www.todoist.com/downloads
6. Any.do, Pricing: https://www.any.do/pricing
7. Any.do, App Store (India storefront): https://apps.apple.com/in/app/any-do-to-do-list-planner/id497328576
8. TickTick, Upgrade / Premium comparison: https://ticktick.com/about/upgrade
9. TickTick, Features: https://ticktick.com/features?language=en_US
10. TickTick, App Store (India storefront): https://apps.apple.com/in/app/ticktick-to-do-list-calendar/id626144601
11. Apple Support, Use Reminders on your iPhone, iPad or iPod touch: https://support.apple.com/102484
12. Apple, iPhone User Guide: Intro to Reminders (iOS 27 guide): https://support.apple.com/guide/iphone/intro-to-reminders-iph82f8ad5a1/ios
13. Apple Support, Use Apple Intelligence to suggest reminders from any app: https://support.apple.com/124025
14. Apple, Mac User Guide (macOS 26), Reminders with Apple Intelligence: https://support.apple.com/en-ng/guide/mac-help/mchl979b81e9/26/mac/26
15. Apple Support (India), How to get Apple Intelligence / supported languages: https://support.apple.com/en-in/121115
16. Google Tasks Help, Get started with Google Tasks: https://support.google.com/tasks/answer/7675772?hl=en
17. Google Tasks Help, Google Keep reminders migration to Tasks: https://support.google.com/tasks/answer/16540694?hl=en
18. Gemini Apps Help, Capture your tasks & reminders with Gemini Apps: https://support.google.com/gemini/answer/15230285
19. Google Keep Help, Share notes, lists & drawings: https://support.google.com/keep/answer/6101196?hl=en
20. Google Keep Help, Take image notes: https://support.google.com/keep/answer/6395566?hl=en
21. Google Blog, "8 tips to help you keep up in Google Keep" (9 Aug 2017): https://blog.google/products-and-platforms/products/workspace/8-tips-help-you-keep-google-keep/
22. Google One Help, How storage works in your Google Account: https://support.google.com/googleone/answer/9312312?hl=en
23. Microsoft Support, Moving from Microsoft To Do to Microsoft Planner (retirement notice): https://support.microsoft.com/en-us/planner/to-do-to-planner
24. Microsoft Support, What's new in Microsoft To Do: https://support.microsoft.com/en-us/todo/what-s-new-in-microsoft-to-do
25. Microsoft Store, Microsoft To Do listing: https://apps.microsoft.com/detail/9NBLGGH5R558
26. Notion, Pricing: https://www.notion.com/pricing
27. Notion, App Store (India storefront): https://apps.apple.com/in/app/notion-notes-tasks-ai/id1232780281
28. Notion Help, Get started with Notion Agent: https://www.notion.com/help/notion-agent
29. Notion Help, Import data into Notion: https://www.notion.com/help/import-data-into-notion
30. FamilyWall Support, What is included in FamilyWall Premium: https://support.familywall.com/en/support/solutions/articles/47001239196-what-is-included-in-familywall-premium-
31. FamilyWall, App Store (US storefront): https://apps.apple.com/us/app/id496889629
32. FamilyWall, App Store (India storefront): https://apps.apple.com/in/app/familywall-family-organizer/id496889629
33. Cozi, Compare plans: https://www.cozi.com/compare-plans/
34. Cozi, App Store (India storefront): https://apps.apple.com/in/app/cozi-family-organizer/id407108860
35. Adobe, Adobe Scan (scanner app page): https://www.adobe.com/acrobat/mobile/scanner-app.html
36. Adobe Scan, App Store (India storefront): https://apps.apple.com/in/app/adobe-scan-pdf-ocr-scanner/id1199564834
37. Evernote, Compare plans: https://evernote.com/compare-plans
38. Evernote, Pricing page: https://evernote.com/pricing
39. Evernote, Search feature page: https://evernote.com/features/search
40. Evernote, App Store (India storefront): https://apps.apple.com/in/app/evernote-notes-organizer/id281796108
41. Microsoft Support, Retirement of Microsoft Lens: https://support.microsoft.com/en-gb/topic/retirement-of-microsoft-lens-fc965de7-499d-4d38-aeae-f6e48271652d
42. DigiLocker (MeitY / NeGD), Home: https://www.digilocker.gov.in/
43. DigiLocker, App Store (India storefront; seller: National e-Governance Division): https://apps.apple.com/in/app/digilocker/id1320618078
44. NeGD Capacity Building Division, "A Case Study on: DigiLocker" (PDF; cites Rule 9A and DigiLocker's statement on uploaded documents): https://negd.gov.in/wp-content/uploads/2025/10/Charru-Malhotra-DIgilocker-the-digital-Vault-of-India.pdf
45. WarrantyVault: Receipt Scanner, App Store (US storefront): https://apps.apple.com/us/app/id6758866183
46. Warrantly: Warranty Tracker, App Store (US storefront): https://apps.apple.com/us/app/-/id6758876669
47. MyBillWallet: Digital Wallet, App Store (India storefront): https://apps.apple.com/in/app/mybillwallet-digital-wallet/id6479301098
