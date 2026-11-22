# Life Agent (automation builder)

Code: `packages/core/src/intelligence.ts`; UI `/app/ai`. Plus feature.

A rule = **trigger** (warranty expiring, return window closing, subscription renewing, trial ending, document expiring, bill due, promise overdue) + **condition** (days before/after) + **proposed action** (suggest a task, a reminder or a checklist) + **stop conditions** (turn off, or stop after N runs). The hourly evaluation turns each match into a **pending proposal** with the evidence attached; it never executes anything.

Approval re-validates the payload (a tampered or stale payload fails and creates nothing), runs only inside LifeOS, records the result, and can be undone for 24 hours. Every step is audited. If the user's plan stops including automations, rules stop being evaluated.

There is no action that sends email, contacts businesses, submits forms, cancels subscriptions, makes payments, changes third-party accounts or deletes files.
