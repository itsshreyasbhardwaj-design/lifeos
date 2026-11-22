# FamilyOS

Code: `packages/core/src/family.ts`, `access.ts`; UI `/app/family`. Creating a family space needs the Family plan; invited members don't need their own subscription (the owner's plan covers the space).

## Privacy model
A family is its own workspace. Members see what is **in** it: shared tasks, family calendar events, shopping lists, documents explicitly shared into it. Nothing in anyone's personal space is reachable through membership — not notes, purchases, documents, captures or searches. Every list query joins memberships in SQL; tests cover cross-user and cross-family leakage.

| Role | Can |
|---|---|
| Owner | Everything, manage roles, remove people, delete the space |
| Adult | Read/write everything in the space, invite, share documents |
| Member | Read/write everything in the space |
| Limited | See and tick shopping lists; see and complete tasks assigned to them. Nothing else. |

Accounts flagged as minors cannot hold the adult role.

## Collaboration
Invite by email (a single-use link, valid 7 days, only for that address — **you send it yourself**; LifeOS sends no email), accept/revoke, change roles, remove (immediate: access is checked per request; their assignments and reminders in the space are cleared, document grants to them from the remover are revoked), leave, delete space. Shared tasks with assignment + accept/decline, comments, shopping lists, family activity feed (history of the shared space only).

## Children
No covert tracking, location, behavioural profiling or advertising. Consent requirements for minors' accounts (e.g. India DPDP Act verifiable parental consent) are **not** implemented and must be reviewed before minors use the product — see [REMAINING_MANUAL_ACTIONS.md](REMAINING_MANUAL_ACTIONS.md).
