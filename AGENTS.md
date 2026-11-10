# AGENTS.md — FixTriage

Canonical instructions for any agent or person working in this repository. `CLAUDE.md` adds product-specific guidance and defers to this file.

**State of the repository: planning documents only. No application code, scripts, migrations or infrastructure exist. Every command in any file is proposed and has never been run.**

## 1. Reading order

1. [Decision.md](Decision.md) — whether to build at all; label legend (section 0); gates (section 9.3).
2. [PRD.md](PRD.md) — must-haves MH-01..MH-16 (all P0) and the canonical product rules (section 7: UR, EP, DU, FD, HI).
3. [TRD.md](TRD.md) — architecture decisions AD-01..AD-12, runtime sequences, security and AI boundaries.
4. [App-flow.md](App-flow.md) and [design.md](design.md) — screens S-01..S-16, states, copy.
5. [schema.md](schema.md) — tables, permissions, retention, migrations.
6. [execution-plan.md](execution-plan.md) — tasks and tests.
7. [verification-report-fixing.md](verification-report-fixing.md) — what is verified, risks R-01..R-22, findings.

## 2. Sources of truth

| Topic | Only defined in | Others must |
|---|---|---|
| Prices, economics, gates, sources, departures from the brief | Decision.md | cite section or GAP/SRC ID |
| Requirements, urgency tiers, escalation timings, duplicate and dispatch rules, metrics | PRD.md | cite MH, UR, EP, DU, FD, SM IDs; never restate numbers |
| Stack, APIs, jobs, security controls, AI boundary | TRD.md | cite AD or section |
| Routes, screens, states | App-flow.md | cite S-nn |
| Tables, permissions, retention | schema.md | cite table names |
| Tasks, estimates, tests | execution-plan.md | cite T, UT, IT, E2E IDs |
| Risks, findings, verification status | verification-report-fixing.md | cite R-nn, F-nnn |

If two files disagree, the file in the middle column wins and the other is fixed in the same change.

## 3. What to update when something changes

| Change | Update |
|---|---|
| A requirement (MH) or product rule (UR, EP, DU, FD) | PRD.md; then the traceability matrix; affected screens in App-flow.md; tests in execution-plan.md; CLAUDE.md if the highest-consequence failure or a prohibited shortcut is touched |
| A screen or route | App-flow.md; design.md; TRD 5.1; matrix |
| A role or permission | PRD section 5; schema.md section 4; App-flow.md section 1; IT-10 and E2E-10 |
| A table, column, index or retention period | schema.md; TRD if a transaction boundary changes; privacy pack (T-1.1.3) if retention or a subprocessor changes |
| A price, rate, cost or other operating assumption | Decision.md sections 6-10 with the arithmetic re-run; execution-plan hours if affected; SC-06 |
| A source re-read or newly opened | Decision.md section 13 with date |
| A reviewer finding fixed | Findings register row (fix, by the author); retest left to the reviewer |

## 4. Product boundaries

- Build only what a must-have or a risk row requires. PRD section 10 lists non-goals; adding any of them needs the evidence in PRD section 13 and an owner decision.
- No build task starts before gate G-build is recorded (T-0.2.4).
- There is one go-live point: M-3.1 exit plus the account's EP-9 gate (execution-plan.md section 1). Do not introduce a smaller release for a live account.
- BC only. Another province needs its own rule set after its tenancy law is read.

## 5. Architecture conventions (proposed)

- TypeScript monorepo: `apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/platform`. Apps import only package entry points; apps never import each other.
- `packages/core` is pure: no network, database, clock or environment access except through parameters.
- All outbound messages go through the outbox. All timers are database rows. All links come from the public URL builder. Failure detection lives in the external monitor, never in the process being watched (TRD 8.9).
- Deterministic code decides tiers' floor, business hours, routing, timers, permissions and metrics. A model proposes; it never decides alone and never lowers a tier.

## 6. Reuse

Before writing a helper, search `packages/core` and `packages/platform`. There is exactly one of each: business-hours calendar, tier ordering, configuration loader, logger, correlation helper, storage-key builder, URL builder, account-scoped database helper. A second one is a defect (R-03, R-06).

## 7. Account safety

- "Account" is the paying brokerage; "tenant" is a renter. Do not use "tenant" for software tenancy in code, comments or documents.
- Every read or write of account data goes through `withAccount`. The only access outside it is the list of resolver functions and poll views in schema.md section 4 (channel, session, login, capability token, delivery status, due-work polls); each returns IDs only, and a new one needs a row there and a case in IT-10. Never pass `account_id` from a request body or query string. Jobs carry it in their payload. Storage keys start with it.
- Any new table that holds account data gets `account_id`, RLS, a composite foreign key and a row in IT-10. Operators are not users of any account (`operators` table).
- Logs and audit events never contain message text, names, phone numbers, emails, addresses or tokens.

## 8. Migrations

Additive first; generated from the ORM schema; one linear sequence; concurrent index builds in their own file; `lock_timeout` set; backfills resumable. Run the proposed `pnpm check:migrations` before every merge once it exists. Details: schema.md section 9.

## 9. Tests

- A change to rules, escalation, outbox, duplicates or permissions is not complete without the listed UT/IT/E2E for it passing and the emergency fixture set re-run.
- Use synthetic fixtures only. Real requests collected in Phase 0 stay outside the repository.
- Provider calls are faked in tests; no test sends a real SMS, call or email.

## 10. Git hygiene

- Branch from `main`; name `T-x.y.z-short-slug`; one task per branch; delete after merge.
- Never force-push a shared branch; never rewrite `main`; never commit secrets, `.env` files, exports or real data.
- The repository root holds exactly the ten planning files until implementation is authorized; scratch checkers and briefs live in the coordination folder outside this repository.

## 11. Reporting completion accurately

- Say "written" for documents, "implemented" only for code that exists, "passed" only for a check that was run, with its output.
- Application checks stay `Not run` in the verification file until executed; then record date, commit and result.
- A planned control is never reported as compliance with ASVS or WCAG. Requirements recorded as "not met" stay listed until tested.
- Report anything skipped, blocked or assumed. If a source could not be opened, say so.
