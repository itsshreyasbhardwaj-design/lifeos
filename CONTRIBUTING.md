# Contributing

```bash
pnpm install
pnpm dev            # http://localhost:3200
pnpm verify         # lint + typecheck + tests + build — CI runs the same
pnpm test:e2e       # Playwright (uses a separate build and a throwaway database)
```

## Ground rules
1. **The product refuses to guess.** A missing year, an ambiguous date, an unstated warranty — these become questions for the user, never values. A change that makes LifeOS assert something it can't evidence is a bug.
2. **Suggestions are not records.** Only `confirmCandidate` (with a user) creates records from captures.
3. **Authorization lives in SQL.** New list queries join `memberships`; new tables carry `workspace_id`.
4. **Nothing reaches outside LifeOS on the user's behalf** (no sending, paying, submitting, cancelling).
5. **Tests run against real PostgreSQL** (PGlite). Don't mock the database.
6. Never edit a released migration; add `0002_…sql`. (0001 was edited during initial development — run `pnpm db:reset` if your local DB predates it.)
7. Update `docs/FEATURE_STATUS.md` when a feature's status changes, and say how it was verified.

Translations (Hindi, Bengali) need native-speaker review — corrections to `apps/web/src/i18n/messages.ts` are very welcome.
