# Purchase Protection

Code: `packages/core/src/purchases.ts`; UI `/app/purchases`. Plus feature.

* **Purchases:** product, seller, category, purchase date, amount + currency, order/invoice number, delivery date, notes, receipt (a Vault document), source capture.
* **From a receipt:** one capture can yield a purchase, a saved receipt, a warranty and a return window, all linked to the same source. A warranty needs its purchase confirmed first.
* **Warranties:** start/end (or length in months), provider, terms, `basis` = user-entered or document-confirmed. Reminders 30 and 7 days before the end. **No manufacturer policy is ever assumed.** Claim preparation checklist (receipt, serial/IMEI, description, photos, where to claim, claim number) and claim status.
* **Return windows:** deadline, conditions, status open → return requested → returned → refund pending → refunded / closed. Reminders 2 days before and on the day. Moving to *refund pending* creates a linked follow-up task on the date you choose, waiting on the seller, plus a copy-only follow-up message draft.
* **Service history:** dated service records with provider and cost.
* **Questions:** "Where is my laptop invoice?", "When does my phone warranty expire?", "Which purchases have open refunds?" are answered from these records with links (see [LIFE_AI.md](LIFE_AI.md)).
* **Deletion** removes the purchase, its warranties/returns/service records and their reminders.
