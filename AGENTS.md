# AGENTS.md — FixTriage

Canonical instructions for any agent or person working in this repository. `CLAUDE.md` adds product-specific guidance and defers to this file.

**State of the repository (2026-11-11): build milestone B1 implemented on branch `feat/b1-foundation`, authorised by the owner on 2026-11-11 before the Phase 0 sales gate (G-build) passed. Code lives under `code/` (npm workspaces). Implemented: the deterministic safety spine (intake, safety reply, rule set v1, tier floor, escalation chain, outbox, duplicate rules, failed-dispatch reopen, STOP path, readiness) with provider fakes only. Not implemented: real provider clients, sign-in, UI screens, AI drafting, digest, export, retention, deployment. Test results: [verification file section 7](verification-report-fixing.md#7-build-milestone-b1-2026-11-11). Commands not listed in section 12 remain proposed and have never been run.**

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

- TypeScript monorepo under `code/` (the repository root keeps only the planning files, `.gitignore` and `Makefile`): `code/apps/web`, `code/apps/worker`, `code/packages/core`, `code/packages/db`, `code/packages/platform`, `code/packages/services` (transactional workflows shared by web and worker; added in B1, TRD 5), `code/tools/monitor-fake`. Apps import only package entry points; apps never import each other. The import-boundary lint is `code/eslint.config.mjs`, tested by `code/test/boundary-lint.test.ts`.
- `packages/core` is pure: no network, database, clock or environment access except through parameters.
- All outbound messages go through the outbox. All timers are database rows. All links come from the public URL builder. Failure detection lives in the external monitor, never in the process being watched (TRD 8.9).
- Deterministic code decides tiers' floor, business hours, routing, timers, permissions and metrics. A model proposes; it never decides alone and never lowers a tier.

## 6. Reuse

Before writing a helper, search `packages/core` and `packages/platform`. There is exactly one of each: business-hours calendar, tier ordering, configuration loader, logger, correlation helper, storage-key builder, URL builder, account-scoped database helper. A second one is a defect (R-03, R-06).

Utilities index (B1, paths under `code/`):

| Utility | Location | Entry |
|---|---|---|
| Business-hours calendar | `packages/core/src/business-hours.ts` | `isAfterHours`, `addBusinessMinutes` |
| Tier ordering | `packages/core/src/tiers.ts` | `maxTier`, `tierRank`, `isLower` |
| Final tier (UR-3, UR-5) | `packages/core/src/final-tier.ts` | `finalTier`, `raiseOnly` |
| Rule set v1 and engine | `packages/core/src/rules/` | `evaluateRules`, `ruleFloor`, `RULES_V1` |
| Escalation policy and step planner | `packages/core/src/escalation-policy.ts` | `EP`, `planSteps` |
| On-call coverage check (EP-1, EP-9) | `packages/core/src/coverage.ts` | `checkCoverage` |
| Duplicate rules (DU-2..DU-4) | `packages/core/src/duplicates.ts` | `appendsToOpenRequest`, `suggestsDuplicate`, `du4Decision` |
| Delivery status rank | `packages/core/src/delivery-status.ts` | `applyStatus` |
| Fixed templates | `packages/core/src/templates.ts` | `renderSafetyReply` and others |
| Configuration loader | `packages/platform/src/config.ts` | `loadConfig`, `parseConfig` |
| Logger and scrubber | `packages/platform/src/logger.ts`, `scrub.ts` | `createLogger`, `scrub` |
| Correlation helper | `packages/platform/src/correlation.ts` | `withCorrelation`, `currentCorrelationId` |
| Storage-key builder, URL builder, capability tokens | `packages/platform/src/keys-and-urls.ts` | `storageKey`, `publicUrl`, `newCapabilityToken` |
| Provider interfaces and fakes (SMS/voice/email, model, storage, monitor) | `packages/platform/src/providers/` | `MessagingProvider`, `Classifier`, `ObjectStorage`, `MonitorClient` |
| Account-scoped database helper, resolvers, poll views | `packages/db/src/client.ts` | `withAccount`, `resolvers`, `poll`, `oldestDue` |
| Migration runner, ORM-diff check | `packages/db/src/migrate.ts`, `orm-diff.ts` (entry `@fixtriage/db/migrate`) | `migrate`, `ormDiff` |
| Clock | `packages/platform/src/clock.ts` | `systemClock`, `FakeClock` |
| Decision-deadline sweep (B1-001) | `packages/services/src/decide.ts` | `sweepUndecided` |
| Model-output validation (B1-001, B1-006) | `packages/core/src/final-tier.ts` | `validateModelAnswer` |
| Rule set v2 (B1-003) | `packages/core/src/rules/lexicon-v2.ts` | `RULES_V2`, `CURRENT_RULES` |
| Rule set v3 and safety-candidate layer (fix round 2) | `packages/core/src/rules/lexicon-v3.ts`, `safety-candidate.ts` | `RULES_V3`, `safetyCandidate`, `intakeFloor` |
| Operator dead-job actions (fix round 2) | `packages/services/src/ops.ts` | `listDeadJobs`, `actOnDeadJob`, `authenticateOperator` |
| Rule set v4 and safety-candidate configurations (round 3) | `packages/core/src/rules/lexicon-v4.ts`, `safety-candidate.ts` | `RULES_V4`, `SAFETY_CANDIDATE_V3`, `SAFETY_CANDIDATE_V4` |
| After-hours URGENT prompt (PRD EP-10a) | `packages/core/src/templates.ts` | `renderUrgentPrompt`, `URGENT_KEYWORD_LINE` |
| Materialise a request from a stored message (B1-011) | `packages/services/src/intake.ts` | `materialiseRequest` |
| tz database guard (B1-008) | `packages/platform/src/tzdata.ts` | `checkTimezoneData` |
| Job runners: safety loop and model loop (B1-002) | `packages/services/src/jobs.ts` | `processDueJobs`, `processClassifyJobs` |

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

## 12. Commands that exist (B1)

Run from `code/` (or `make <target>` from the root). `pnpm`, `uv` and Docker are not installed on the build machine, so the proposed `pnpm` commands run as `npm` scripts and the Compose setup of TRD 7 stays proposed.

| Proposed command | Exists as | Status |
|---|---|---|
| `pnpm dev` | `npm run dev` (`make dev`): role, migrations and seed on `fixtriage_dev`, fake monitor on 3109, web on 8109, worker; waits for `/healthz` and `/readyz` | Exists; run 2026-11-11, healthy |
| `pnpm check:migrations` | `npm run check:migrations` | Exists; run 2026-11-11, pass |
| — | `npm run lint`, `npm run typecheck`, `npm test`, `npm run db:reset-test`, `npm run db:migrate`, `npm run db:setup`, `npm run verify` | Exist |
| `pnpm seed:synthetic`, `eval:classifier`, `replay:inbound`, `drill:restore`, `probe:run`, `load:burst` | — | Still proposed, not written |
