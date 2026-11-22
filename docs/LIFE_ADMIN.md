# LifeAdmin

Code: `packages/core/src/planning.ts`; UI `/app/admin`. Plus feature.

Templates (code, editable after creation): university application, school registration, membership renewal, travel documents, event registration, household paperwork, service application, start from scratch. Each is a generic starting checklist of **documents to gather** and **steps**, explicitly labelled "check the official source".

Workflow fields: title, status, official link, reference number, deadline (reminders 7 and 1 day before), notes, submitted/confirmed dates, evidence (linked Vault documents), history.

Statuses: not started → documents needed → preparing → ready for review → awaiting approval → ready for submission → **user-reported submitted** → awaiting confirmation → **confirmed completed**, or rejected / cancelled. The wording is deliberate: LifeOS never submits anything and never claims an institution accepted it. Closing states cancel reminders.
