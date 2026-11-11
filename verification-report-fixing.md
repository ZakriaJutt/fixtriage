# Verification, report and fixing — FixTriage

Status on 2026-11-10, after fix round 1: **documents only. No application exists; every application check is `Not run`.** Update 2026-11-11: build milestone B1 was implemented on the owner's authorisation; the application checks that ran are in [section 7](#7-build-milestone-b1-2026-11-11), all others remain `Not run`. Independent review round 1 raised 17 findings (section 4). The independent reviewer's retest on 2026-11-10 (note `fixtriage-round2.md` and `fixtriage-verdicts.json` in the coordination folder) returned 14 closed, 3 closed with a part open, 0 still open. Edits made after that retest are marked in the register and were checked by the lead, not re-reviewed. Labels and IDs: [Decision.md section 0](Decision.md#0-how-numbers-are-labelled-used-in-all-ten-files).

Highest-consequence failure tracked by this file, named as in the PRD and CLAUDE.md: **HCF — an after-hours urgent case is missed or delayed.**

## 1. Checks performed on the documents and repository

Performed by the author (self-check, not independent review). Details in section 5.

| Check | Method | Result |
|---|---|---|
| Ten required files, nothing else | Directory listing | Pass (SC-01) |
| Internal links and anchors resolve | Script over all Markdown links | Pass (SC-02) |
| Every referenced MH, S, AD, DD, T, UT, IT, E2E, SM, SRC, GAP ID is defined | Script | Pass (SC-03) |
| Every MH appears in the traceability matrix | Script | Pass (SC-04) |
| 22 risk rows, numbering as in the specification, each with an existing task ID | Script | Pass (SC-05) |
| Economics reproduce from stated inputs | Script re-run of Decision.md sections 7-9 | Pass (SC-06) |
| Screens, routes, tables, jobs and tasks agree across files | Script plus reading | Pass with notes (SC-07) |
| Primary sources opened | Listed in Decision.md section 13 | 21 opened; 4 items blocked or not opened (SC-08) |
| No credentials, no real personal data | Reading; phone numbers use 555-01xx; names are synthetic | Pass (SC-09) |
| Mermaid blocks parse | Not rendered by a tool; syntax read by eye only | **Not verified** (SC-10) |

Resources: arc42 section order was used for TRD.md and the Spec Kit separation of outcomes (PRD), plan (TRD) and independently checkable tasks (execution plan) was used as the structure; neither site was re-opened on 2026-11-10. OWASP ASVS 5.0.0 and WCAG 2.2 texts were opened and informed TRD 8.7 and design.md 7.

## 2. Application checks planned for future implementation

All `Not run`. Fixtures, actions and expected results are in [execution-plan.md section 7](execution-plan.md#7-tests-all-not-run).

| Group | IDs | Status |
|---|---|---|
| Unit | UT-01..UT-11 | B1: UT-01..UT-07, UT-09..UT-11 passed (section 7); UT-08 Not run |
| Integration | IT-01..IT-21 | B1: IT-01..IT-04, IT-06..IT-14, IT-16, IT-18..IT-21 passed, IT-10 and IT-14 in part (section 7); IT-05, IT-15, IT-17 Not run |
| End-to-end | E2E-01..E2E-10 | B1: E2E-03, E2E-04 passed at API/service level only (no browser); the rest Not run |
| Classifier release gates (TRD 8.5) | 90% on labelled set `[C]`; 100% non-routine on emergency set; injection set | Not run; fixtures do not exist yet (T-0.1.4, T-0.2.5) |
| Failure drills | T-3.1.2 | Not run |
| Accessibility manual checks (design.md 7) | T-3.1.3 | Not run; no WCAG conformance claimed |
| Security checks against ASVS 5.0.0 rows (TRD 8.7) | T-3.1.4 | Not run; no ASVS compliance claimed; three requirements recorded as not met (V6.3.4 in part, V14.2.1 for capability links, V5.4.3) |
| Backup restore and rollback rehearsal | T-3.1.5 | Not run |
| Carrier delivery tests per sender; opt-out confirmation wording and block behaviour | T-1.1.4 | Not run |

Workflow walk-through on paper (author):

| Promise or failure | Requirement | Screen / API | Authorization | Schema | Recovery | Task | Test |
|---|---|---|---|---|---|---|---|
| Paid-pilot promise: "refunded if fewer than 80% are categorised correctly by the customer's own review" `[C]` | MH-08, MH-13, SM-03 | S-04, S-12; `POST /api/requests/:id/review`, `GET /api/review/report` | Named reviewer only (`users.is_reviewer`) | `reviews`, `classifications` | Fewer than 20 marks → extension (Decision 5) | T-2.3.1, T-2.3.9, T-4.1.3 | UT-08, E2E-08, classifier gates |
| HCF, failed-dispatch branch: 02:30 vendor silent, approver asleep | MH-10 (FD-3), MH-05 (EP-11) | Page, S-06, S-05, S-07 review step | Capability token to acknowledge; session to approve the next vendor | `dispatches`, `escalations` (trigger `dispatch_failed`, `dispatch_id`), `escalation_steps` | Chain to Level 2, Level 3, operators; EP-11a if no outcome | T-2.2.4, T-2.3.6 | IT-12, IT-19 |
| HCF: 02:10 no heat, model down, Level 1 silent | MH-02, MH-03, MH-04, MH-05, MH-06 | S-06, S-05; webhooks, `/a/:token`, `/api/incidents/:id/outcome` | Capability token to acknowledge; session for outcome | `inbound_messages`, `classifications`, `incidents`, `escalations`, `escalation_steps`, `outbound_messages` | EP-3..EP-7; operator at Level 4; replay script | T-2.2.1..T-2.2.6 | IT-02, IT-03, IT-06, IT-07, E2E-03, E2E-04 |

## 3. Traceability of must-haves

| MH | Screen / API | Decision | Schema / permission | Task | Planned test |
|---|---|---|---|---|---|
| MH-01 | S-02, S-11; `/webhooks/twilio/sms`, `/webhooks/postmark/inbound` | AD-02, AD-10 | `channels`, `inbound_messages` (unique provider ID), `attachments` | T-2.2.1, T-2.3.4, T-2.3.7 | IT-01, IT-17, UT-09 |
| MH-02 | Tenant SMS or email; S-04 and S-03 for tenants who cannot be texted | AD-05, AD-12 | `outbound_messages` (`safety_reply`, template version), `inbound_messages.safety_reply_id`, `requests.cannot_text` | T-2.2.2, T-2.3.10 | IT-02, IT-18, UT-10, E2E-05 |
| MH-03 | S-04 decision panel; `/api/requests/:id/correct` | AD-04, DD-03 | `rule_sets`, `classifications`, tier-lowering trigger; downgrade limited to `owner`, `manager` | T-2.2.3, T-1.1.1 | UT-01, UT-02, IT-04 |
| MH-04 | S-03 needs-triage; S-05 | AD-04 | `requests.tier` default `uncertain`; `classifications.status` | T-2.2.3, T-2.3.1 | IT-03, E2E-06 |
| MH-05 | S-09, S-05, S-06, S-16; `/api/settings/on-call`, `/a/:token`, `/webhooks/twilio/voice-ack` | AD-03, AD-08, DD-02, DD-07 | `oncall_shifts` (exclusion constraint), `escalations` (trigger, one live per incident), `escalation_steps` (`target_operator_id` for Level 4), `operators`, `capability_tokens` | T-2.2.4, T-2.2.5, T-2.2.6, T-3.1.6, T-4.1.1 | UT-04, UT-05, IT-05, IT-06, IT-07, IT-19, E2E-01, E2E-03, E2E-04 |
| MH-06 | S-05, S-06, S-16; `/api/incidents/:id/ack`, `/outcome`, `/downgrade` | AD-03, DD-05 | `escalations` (`acknowledged_by`, `acknowledged_via`, `relayed_by_operator_id`), `capability_tokens.user_id` and `escalation_step_id`, `incidents` (outcome, version) | T-2.2.4, T-2.2.6 | IT-08, E2E-03, E2E-04 |
| MH-07 | S-05 reports; `/api/incidents/:id/merge`, `/unmerge` | AD-02 | `requests.incident_id` and `incident_link_state`, `incidents.building_wide`, `work_orders` unique per incident | T-2.2.8 | IT-01, UT-06, IT-20, E2E-05 |
| MH-08 | S-03, S-04 | AD-09, DD-03 | `classifications` (model, prompt version) | T-2.3.1, T-2.3.2, T-2.3.3 | IT-03, classifier gates |
| MH-09 | S-07; `/api/work-orders/:id/approve-dispatch` | AD-11, DD-04, DD-06 | `work_orders`, `dispatches`, check `approved_by` on dispatch messages | T-2.3.6 | IT-11, E2E-02 |
| MH-10 | S-07, S-08, S-03; `/webhooks/twilio/status`, `/v/:token`, `/api/dispatches/:id/redispatch` | AD-12, DD-08 | `outbound_messages.status`, `dispatches.result`, `escalations.dispatch_id`, `tenant_contacts.sms_opted_out_at`, `requests.cannot_text` | T-2.2.2, T-2.2.4, T-2.3.6, T-2.3.10 | IT-09, IT-12, IT-13, IT-18, IT-19 |
| MH-11 | S-10; `/api/settings/vendors` | AD-02 | `vendors`, `vendor_trades`; edit by `owner` | T-2.3.5, T-2.3.4 | IT-17 |
| MH-12 | S-13; `/api/exports` | AD-10 | `exports` | T-2.3.8 | E2E-02 |
| MH-13 | S-12, S-04; `/api/requests/:id/review`, `/api/review/report` | DD-03 | `reviews` | T-2.3.9, T-4.1.2 | UT-08, E2E-08 |
| MH-14 | S-01, S-14; all routes | AD-07, AD-02 | RLS, resolver functions and views, `users`, `operators`, `sessions`, `audit_events`; role matrix in schema.md 4 | T-2.1.2, T-2.1.3 | IT-10, IT-21, E2E-10 |
| MH-15 | S-14, S-11; `/api/privacy-requests` | AD-10 | `privacy_requests`, `deletion_log`, retention in schema.md 7 | T-1.1.3, T-2.3.10 | IT-15, IT-18 |
| MH-16 | S-15, S-16; `/webhooks/twilio/voice`, `/readyz` | AD-08, TRD 8.9 | `probe_runs`, `channels.last_inbound_at`; external monitor outside the schema | T-2.2.7, T-3.1.6, T-1.1.4 | IT-16 |

## 4. Findings register

Independent review round 1, 2026-11-10: 17 findings (0 blocker, 12 major, 5 minor). Source: the reviewer's round-1 note in the coordination folder. Owner of every fix: Author B. The "Retest result" column quotes the independent reviewer's verdicts of 2026-11-10 exactly as recorded in `fixtriage-verdicts.json` (note file `fixtriage-round2.md`, coordination folder). Where a row was edited after that retest it says "edited after retest; checked by the lead, not re-reviewed". No finding is disputed.

| ID | Severity | File and location | Evidence (reviewer) | Impact | Fix (author, fix round 1) | Files changed | Retest result |
|---|---|---|---|---|---|---|---|
| F-001 | Major | execution-plan 1, M-2.2, M-3.1, Phase 4; Decision 5.1, 7.5; PRD 8 | "Pilot slice" omitted the classifier and other P0 work; two different go-live points; M-2.2 called first build milestone | Go-live without classification; hours and live month understated | Pilot slice removed. One go-live point, worded the same in Decision 5.1 and execution-plan 1: M-3.1 exit (all of Phases 1-3, 286-397 h) plus EP-9. All must-haves P0. M-2.1 is the first build milestone; M-2.2 internal. First live account moved from month 3 to month 5; ramp recomputed | Decision, PRD, execution-plan, CLAUDE, AGENTS | Closed. Then edited after retest; checked by the lead, not re-reviewed (build hours re-estimated to 307-427 and G-build wording aligned) |
| F-002 | Major | PRD SM-03; Decision 5; App-flow S-03 | SM-03 excluded `uncertain`, counted unedited approvals, allowed batch marks | Offer narrowed without a GAP; score could be raised by labelling cases `uncertain` | `uncertain` counts as not correct; only the named reviewer's explicit single marks count; batch mark removed; agreement wording task updated; GAP-12 records the removed narrowing; UT-08 now expects 41/52 = 78.8% | PRD, Decision, App-flow, design, schema, execution-plan | Closed |
| F-003 | Major | TRD 3, 6.3; MH-16; R-07; IT-16 | Watchdog ran inside the worker; 15-minute interval could not give 5-minute detection | Worker death undetected | Detection moved to an external monitor: check-in every 60 s from `web` and `worker`, alert after 180 s silence, monitor cycle up to 60 s = 300 s worst case; readiness probe exposes stuck timers; IT-16 kills the worker and still expects the alert; TRD 8.9 added | PRD, TRD, schema, App-flow, execution-plan, CLAUDE, AGENTS, this file | Closed |
| F-004 | Major | MH-16; Decision 7.1, 7.2 | Per-account synthetic SMS every 15 min ≈ CAD 100 per account, uncosted | Starter margin negative or MH-16 unbuildable | Per-account synthetic messages removed. Costed at source prices: messaging 8 → 10 per account (pages, weekly test pages); fixed 700 → 740 (external monitor, 6-hourly platform probe). Recomputed: gross profit 117.38 (78.8%), per tier 68.83 / 165.93 / 360.13, payback 3.55, break-even 8 and 65, ramp and troughs, downside. GAP-10 records the change from the chat's 7 (63). Stated residual: silent provider-path failure detectable only by the 6-hourly probe | Decision, PRD, TRD, schema, execution-plan | Closed, part open: silent provider-path failure is caught only by a 6-hourly platform probe (stated in PRD/TRD, not in the buyer-facing answer, pilot agreement or SM-01), and a fault on one account's own number is not probed. Then edited after retest; checked by the lead, not re-reviewed (gap stated in Decision 10.7, T-0.2.3 agreement contents, SM-01 and MH-16(f)) |
| F-005 | Major | FD-3; TRD 6.3; schema 3.3; IT-12 | Failed emergency dispatch paged the approver once with no acknowledgement, timeout or next contact; schema had one escalation per incident | Vendor silent and approver asleep: nobody else contacted | EP-11 added: failed emergency dispatch reopens the incident's escalation (approver and Level 1, then Levels 2, 3, operators, until acknowledged). Schema: several escalations per incident with `trigger`, `dispatch_id`, one live at a time. IT-19 added; IT-12 updated; SM-01 counts an unreached failed dispatch | PRD, TRD, schema, App-flow, design, execution-plan, this file | Closed. Then edited after retest; checked by the lead, not re-reviewed (tick idempotency key now includes cycle) |
| F-006 | Major | EP-1, EP-5; TRD 7; schema 3.3, 4; O-9 | Level 4 was one person with no timeout; operator acknowledgement undefined; operator references broke composite keys | Last owner unreachable; operator could stop a chain with nobody of the account reached | EP-5 rewritten: primary operator at 15 min, backup at 20, re-paged every 5; "engaged" never ends the escalation or stops re-paging; only an account person's acknowledgement, or an operator-relayed acceptance naming that person, ends it. Two operators required before the first live account (EP-9, T-3.1.6). `operators` table outside accounts with plain foreign keys. **Open:** the second person is not named (O-9) | PRD, TRD, schema, App-flow, execution-plan, CLAUDE | Closed, part open: second Level 4 operator required before the first live account is not named |
| F-007 | Major | MH-02, FD-5, EP-6, EP-10; design 5; IT-18 | `STOP` blocked safety texts; "conversation" undefined; EP-10 reassurance selected by the model | Safety instructions depended on opt-out state, an undefined window and AI | (a) FD-7: provider blocks all texts after `STOP` until `START` (SRC-21) and CASL requires prompt effect (SRC-14 s.11(3)); remaining path is the opt-out confirmation text, email, mandatory staff phone call and an after-hours page; `STOP` line moved out of the safety text. (b) Safety reply per sender per 30-minute window, always re-sent on a rule hit. (c) After-hours wording chosen by the clock only; no model-selected tenant text. **Open:** whether the confirmation text can carry the 911 line on a Canadian long code, and the CASL position, are unverified (O-5, O-6) | PRD, TRD, design, App-flow, schema, execution-plan, Decision | Closed, part open: opt-out confirmation carrying the 911 line and the CASL position on safety texts after STOP are unverified |
| F-008 | Major | DU-3, DU-4; schema 5, 6; E2E-05 | A suggested duplicate from another unit could be attached without a page before any human confirmed; `report_count` semantics inconsistent | A separate urgent case silently attached | DU-4 rewritten: a different unit, a higher tier or any `life_safety` report on an acknowledged incident reopens the escalation until a human confirms; only a human "building-wide" flag suppresses later pages. Report count is computed from link states. IT-20 added; E2E-05 rewritten | PRD, schema, App-flow, execution-plan, CLAUDE | Closed |
| F-009 | Major | Decision 4, GAP-03; O-7 | "INVITE ONLY" is on the DoorLoop page above Multiply | A verified brief finding was reported as a departure | Page re-opened by direct download; label confirmed. DoorLoop row, GAP-03 and SRC-06 corrected; GAP-03 now records only the Receptionist Agent on Connect as new | Decision, this file | Closed |
| F-010 | Major | Decision 9.3 | Gates needed 10 calls where the funnel gives 7.2; no error rates | G-build usually undecidable | Interview gates use all completed gate interviews with a minimum of 6 and share thresholds; decidability 0.727; false-stop and missed-stop rates given for n = 6, 7, 10; P(G-build decidable and at least 1 paid pilot) = 0.604; undecided case sends the plan to batch 2 | Decision, execution-plan | Closed. Then edited after retest; checked by the lead, not re-reviewed ("ten discovery calls" wording corrected) |
| F-011 | Major | TRD 8.2; schema 4, 5; AGENTS 7; CLAUDE | "Everything through `withAccount`" was impossible for pre-account lookups and cross-account polls | Undocumented bypasses; IT-10 blind to them | Named resolver functions and poll views with column lists (TRD 8.2, schema 4); AGENTS and CLAUDE wording corrected; IT-10 extended to call each one | TRD, schema, AGENTS, CLAUDE, execution-plan | Closed |
| F-012 | Major | TRD 8.7, 8.1; this file | V3.5.1, V3.3.2, V6.4.4, V6.5.1, V11.4.2 not selected; V6.3.6 called "satisfied"; count of not-met rows wrong | Forged downgrade could stop paging; overclaim | Rows added with planned controls (anti-forgery token, SameSite, lost-factor procedure, single-use codes, Argon2id); IT-21 added; V6.3.6 reworded as planned and unverified; count corrected to three | TRD, schema, execution-plan, this file | Closed |
| F-013 | Minor | Decision 7.2 GAP-01 | 416.67 depends on the author's 75% rate | Provenance overstated | GAP-01 states the dependency and the bounds 312.50 and 625.00 | Decision | Closed |
| F-014 | Minor | execution-plan 1, 2; Decision 7.3 | Phase 0 estimates sum to 76-98 h against 70 | Founder-loaded cost understated | Reconciled: 76-98 first batch, 64-82 (midpoint 73) per repeating batch; founder-loaded cost 2,951 at 73 h, 2,847 at the brief's 70 | Decision, execution-plan | Closed |
| F-015 | Minor | TRD 6.1, 6.2 | Semicolons in sequence-diagram text | Diagram may not render | Semicolons and arrow-like text removed from all message and note text. **Open:** still not rendered by a tool (O-11) | TRD | Closed |
| F-016 | Minor | schema 3.3; MH-06 | Capability token had no person or step reference | Link acknowledgement could not record who | `capability_tokens.user_id` and `escalation_step_id` added; matrix row MH-06 updated | schema, App-flow, this file | Closed |
| F-017 | Minor | PRD 1, CLAUDE; Decision 5 vs PRD 11; GAP-08 | HCF wording against UR-7; vendor list required and optional; partner regional endpoints omitted; brief gates unmentioned | Small contradictions | HCF wording aligned with UR-7; vendor list optional everywhere; GAP-08 names partner regional endpoints as unverified; GAP-11 lists every brief roadmap gate and outreach approach as used, replaced or deferred | PRD, CLAUDE, Decision | Closed |

Fresh-reader gaps without a finding number, also addressed: number of on-call people and levels (EP-1, Decision 5); who ends an escalation at Level 4 (EP-5); ramp timing against the gate (Decision 7.5, 9.3).

### Outstanding items

Known open points; none is hidden.

| # | Item | Needed to close |
|---|---|---|
| O-1 | Number of qualifying BC firms unknown; at assumed rates no plausible BC pool reaches 8 accounts (Decision 8) | T-0.1.1 count; measured conversion from batch 1 |
| O-2 | Willingness to pay unproven; no customer interviewed | T-0.1.3, T-0.2.3 |
| O-3 | Build is 307-427 hours (re-estimated after the retest for the scope added in fix round 1), all before the first live account in month 5, against the brief's 140 (GAP-06); who builds and at what cost is not decided | Owner decision |
| O-4 | Model inference leaves Canada on the provider's own API; a partner regional route in Canada is unverified (GAP-08) | Buyer acceptance in T-1.1.3, or a verified Canadian-region route |
| O-5 | F-007, part open per reviewer (legal half): CASL status of tenant and vendor service messages (including any safety text after `STOP`), PIPA s.35(1) applicability, and the service-provider relationship are not reviewed by counsel | Written legal opinion on whether a safety text may be sent after `STOP`, and on the PIPA points; until then FD-7 assumes it may not |
| O-6 | F-007, part open per reviewer (provider half): Twilio: toll-free verification duration, carrier-fee columns, long-code filtering rate, and whether the opt-out confirmation text on a Canadian long code can be worded to carry the 911 line, are not confirmed | T-1.1.4 result recorded word for word: the confirmation text actually received after `STOP` on the pilot long code; if it cannot carry the 911 line, FD-7(a) is struck and the agreement says so |
| O-7 | DoorLoop Receptionist Agent (Connect) and Buildium agent scope and price not established (GAP-03, GAP-04); the chat's stop condition may already hold for some prospects | G-incumbent answers |
| O-8 | Hosting and external-monitor prices not read at source; fixed cost 740 is the brief's 700 plus an assumed 40 | Price AD-06 and the monitor before T-3.1.5 |
| O-9 | F-006, part open per reviewer: the second Level 4 operator is required before the first live account but is not named; a contracted answering service is the fallback | Owner decision naming the person or service, and that person completing the Level 4 dry run in T-3.1.6; go-live stays blocked by EP-9 until then |
| O-10 | Three ASVS requirements recorded as not met (TRD 8.7); accessibility gaps recorded in design.md 7 | Owner acceptance or build work |
| O-11 | Mermaid diagrams not rendered by a tool (F-015) | Render on GitHub after push |
| O-12 | F-004, part open per reviewer: a silent provider-path failure is detected only by the 6-hourly platform probe (up to 6 h 5 min), and a fault on one account's own number is not probed. Now stated to the buyer (Decision 10.7), in the pilot agreement contents (T-0.2.3), in SM-01 and in MH-16(f); the gap itself remains | Evidence that the provider's webhook-failure alerts exist and fire per number (T-1.1.4), or a costed per-account signal such as an alert on inbound silence against `channels.last_inbound_at` with a threshold taken from pilot traffic; then an owner decision to build it |
| O-13 | Buyers who pay in month 2 wait until month 5 for the live product; G-build is undecided after batch 1 about 40% of the time (F-001, F-010) | Batch 1 results; owner decision on developer capacity |
| O-14 | Refund is more likely under the corrected SM-03 because safety escalations count against it; the 75% conversion assumption does not reflect this (F-002) | Pilot data |

## 5. Author self-check log (not independent review)

| ID | Check | Result |
|---|---|---|
| SC-01 | File inventory | 10 files, names exact |
| SC-02 | Links and anchors | All relative links and heading anchors resolve |
| SC-03 | ID definitions | Re-run after fix round 1: every cited MH-01..16, S-01..16, AD-01..12, DD-01..08, UT-01..11, IT-01..21, E2E-01..10, SM-01..08, SRC-01..22, GAP-01..12, UR-1..8, EP-1..11, DU-1..5, FD-1..7, HI-1..13 and task ID is defined once |
| SC-04 | Matrix coverage | 16 of 16 MH rows present |
| SC-05 | Risk register | 22 rows; each names a task that exists in the execution plan |
| SC-06 | Arithmetic | Re-computed after fix round 1 with a script that follows the reviewer's recurrence (go-live shift of two months): gross profit 117.38 (78.8%); per tier 68.83, 165.93, 360.13; CAC 416.67 (bounds 312.50, 625.00); payback 3.55; break-even 8 and 65; steady state 36.0; downside 63.83, 1,250.00, 19.58, 557, 5,072; ramp rows; troughs -7,893 / -79,893 and -12,510 / -84,510; month 13 net +26; prospects 2,223 and 18,056; 10.8% = 30x; binomial 0.578, 0.217, 0.070, 0.764, 0.376, 0.188, 0.006, 0.727, 0.604, 0.422 and the gate error rates; messaging 9.69, probe 7.36, removed heartbeat 100.55; founder-loaded 2,951 and 2,847; hours 307-427 (286-397 before the post-retest re-estimate), 7.7-10.7 weeks, build cash 30,700-42,700; UT-08 78.8% |
| SC-07 | Cross-file agreement | Routes in App-flow match TRD 5.1; tables named in the matrix exist in schema.md; jobs in TRD 6.3 map to tasks. Note: `backfill_progress` and `schema_migrations` are infrastructure tables described in schema.md 9 only |
| SC-08 | Sources | Opened: SRC-01..SRC-19, SRC-21, SRC-22; SRC-06 re-opened in fix round 1. Not opened or blocked: SRC-20, BCFSA statistics page (403/404), LandlordBC and PAMA directories, Twilio toll-free verification help article (empty page returned) |
| SC-09 | Synthetic data only | Company, person and vendor names are invented; phone numbers are 604-555-01xx except the published FortisBC emergency line and 911 |
| SC-10 | Diagrams | Seven Mermaid blocks; syntax checked by reading and by a script that finds no semicolon inside any block; not rendered |
| SC-11 | Brief fidelity | Chat offer and stop rule quoted verbatim with translation; departures listed as GAP-01..12; every changed rule labelled `[P]` |
| SC-13 | Step after retest | Reviewer verdicts copied from the JSON; F-004 residue stated in four places; leftover wordings corrected; build hours re-estimated (+21 to +30); link, ID, risk-row and hour-sum checks re-run; ramp unchanged because the first live account stays in month 5 |
| SC-12 | Fix round 1 | 17 findings addressed in the register; link, ID, matrix, risk-row and arithmetic checks re-run; stale terms (per-account heartbeat, pilot slice, stored report count) searched and removed |

## 6. Production risk register

Single home of R-01..R-22. Tests are `Not run`. "Task" is the responsible task in the [execution plan](execution-plan.md).

| ID | Risk | Impact for this product | Prevention | Detection signal | Test and expected outcome | Task |
|---|---|---|---|---|---|---|
| R-01 | Out-of-order or duplicate events overwrite a newer job state | A late "delivered" or a repeated webhook re-opens an acknowledged escalation, or a stale "failed" hides that the on-call person was reached; the owner is paged again or, worse, a live page is marked done | Forward-only status rank; `version` check on every transition; unique provider IDs and step keys | Audit events with rejected transitions; count of late events | IT-09, IT-08, UT-07: state never moves backward; one acknowledgement **B1 2026-11-11: IT-09, IT-08, UT-07 passed (section 7).** | T-2.2.4 |
| R-02 | A caller timeout prevents reconciliation with a valid later completion | A page send times out but was delivered, or a vendor dispatch times out and is re-sent so two plumbers arrive; a late model answer overwrites a human decision | Stored provider reference and lookup; pages re-sent, dispatches never re-sent without a human; late model results can only raise | `unknown` status count; "delivery unknown" items older than 5 minutes | IT-13: page re-sent, dispatch held for the approver **B1 2026-11-11: IT-13 passed (3 cases) (section 7).** | T-2.2.2 |
| R-03 | New utilities duplicate behavior already owned by shared code | Two after-hours calculators disagree, so the same message is "business hours" in the inbox and "after hours" in the escalation engine | One calendar, one tier ordering, one key builder, in `packages/core` and `packages/platform`; lint against duplicates | Lint failure; code review checklist in AGENTS.md | UT-03 runs against the single module; lint rejects a second implementation **B1 2026-11-11: UT-03 against the single calendar passed; duplicate-utility lint not built (section 7).** | T-2.1.5 |
| R-04 | Applications import private code across architectural boundaries | The worker imports a web route helper and silently loses the account context that helper expected from a session | Import-boundary lint; public entry points only | CI lint | Lint fixture with a deep import fails CI **B1 2026-11-11: import-boundary lint test passed (test/boundary-lint.test.ts) (section 7).** | T-2.1.1 |
| R-05 | Tenant enforcement is scattered or bypassed through APIs, workers, caches, or files | One brokerage sees another's tenants' names, numbers, addresses and photos; a page for building A goes to brokerage B's on-call | RLS forced; `withAccount` for all account data; a closed list of ID-only resolver functions and poll views for pre-account lookups (schema.md 4); account-prefixed storage keys; no cross-request cache | Cross-account test suite; RLS denial counter | IT-10: zero rows or not found on every route, job and storage read; resolvers return only listed columns **B1 2026-11-11: IT-10 passed for B1 routes, jobs, resolvers and poll views; storage read not run (no storage path in B1) (section 7).** | T-2.1.2 |
| R-06 | Workers copy configuration and utility modules, causing behavioral drift | The worker keeps a 5-minute timeout while the web app shows 3 minutes after a settings change, so the timeline lies to the on-call person | Single configuration module; product constants in `packages/core` | Startup prints a configuration checksum that must match across deployables | Deploy check compares checksums; mismatch blocks release | T-2.1.5 |
| R-07 | Worker logging imports web-only modules and crashes during startup | The worker does not start after a deploy; no safety replies or pages are sent while the web app looks healthy | Logger in `packages/platform` with no framework imports; worker image built without web dependencies | External monitor: worker check-in missing for 180 s; `/readyz` due-item ages | Worker boots in an image without the web framework; IT-16(a): with the worker killed, both operators are alerted within 5 minutes by the external monitor **B1 2026-11-11: worker-without-web-framework test and IT-16(a) passed (fake monitor) (section 7).** | T-2.1.5 |
| R-08 | ORM declarations omit indexes or constraints present in migrations | The unique provider-ID constraint or the on-call overlap exclusion exists in one place only; duplicates or schedule overlaps appear in production | Migrations generated from the ORM schema; diff check in CI | `check:migrations` output | IT-14: diff between ORM and migrated database is empty **B1 2026-11-11: IT-14 ORM diff empty; `npm run check:migrations` pass (section 7).** | T-2.1.2 |
| R-09 | Interrupted migrations or backfills cannot resume safely | A half-applied backfill leaves some requests without `after_hours`, so SM-01's denominator is wrong and the refund figure is disputed | Transactional migrations; resumable batch backfills with stored progress | `backfill_progress` not complete; migration task exit code | IT-14: killed at 40%, resumes to 100%, no duplicates | T-2.1.2 |
| R-10 | Merged branches introduce conflicting migration order | Deploy fails or applies in a different order on staging and production during a live pilot | Linear sequence; CI rejects two migrations with the same parent | CI check | IT-14 fixture with conflicting parents fails CI **B1 2026-11-11: IT-14 conflicting-parents case passed (journal order check; no CI yet) (section 7).** | T-2.1.4 |
| R-11 | Index creation locks busy production tables during deployment | Inbound webhooks block on `inbound_messages` during a deploy; safety replies and pages are delayed for minutes | Concurrent index builds; `lock_timeout` 3 s; additive changes only | Webhook latency alert; lock-wait log | Staging deploy during `load:burst`: p99 safety reply stays ≤ 60 s | T-2.1.2 |
| R-12 | Correlation IDs disappear across jobs and retries, or sensitive data leaks into logs | After a missed emergency nobody can reconstruct what happened to that message; or tenant numbers and message text sit in logs outside the retention schedule | Correlation ID stored on the inbound row and copied to every job and message; scrubber; logs hold IDs only | Log lines without correlation ID; scrubber test | UT-11; E2E-03 trace shows one correlation ID from webhook to acknowledgement **B1 2026-11-11: UT-11 passed; correlation ID carried webhook -> jobs -> outbound rows (not separately asserted end to end) (section 7).** | T-2.1.5 |
| R-13 | Upload keys collide or fail to isolate tenant, source, and purpose | A leak photo from one brokerage's tenant appears on another brokerage's work order or is overwritten by another file | Key `acct/{account_id}/{purpose}/{yyyy}/{mm}/{uuid}`; never user file names | Storage access logs; key-format check | UT-09; IT-10 storage read denied across accounts **B1 2026-11-11: UT-09 key format passed; storage read across accounts not run (section 7).** | T-2.3.7 |
| R-14 | Temporary uploads survive retention expiry or failed cleanup | Exports full of tenant data and raw payloads persist after the promised 7 or 30 days, contrary to the privacy schedule | Storage lifecycle rule plus sweep job; `expires_at` on exports | Sweep report of objects past expiry (should be zero) | IT-15: expired objects and rows gone after sweep | T-2.3.10 |
| R-15 | Missing persistent volumes cause data loss after service recreation | An open escalation and its audit trail vanish on redeploy; paging stops silently | No state in containers; managed database and object storage; named volumes locally | Restore drill; row counts before and after task recreation | T-3.1.5 check: recreate tasks, open escalation continues, counts equal | T-3.1.5 |
| R-16 | Generated file links use internal hosts or `localhost` behind a public proxy | The acknowledge link in a 2 am page or the vendor link does not open; the on-call person cannot acknowledge from the text | All links from `PUBLIC_BASE_URL`; startup rejects a non-HTTPS or internal host in production | Link-click failures; UT on builder | UT-09; T-2.2.6 check opens the link on a real phone from staging **B1 2026-11-11: UT-09 passed (section 7).** | T-2.2.6 |
| R-17 | Local dependencies and workers lack a reliable single startup command and health checks | A developer tests the web app with the worker not running and ships a change that never pages | One proposed command that fails loudly; `/healthz`, `/readyz` for both | Health summary at start | Fresh clone to healthy state with one command; killing the worker turns readiness red **B1 2026-11-11: `npm run dev` started healthy on 2026-11-11; IT-16(b) readiness red with a stuck tick passed (section 7).** | T-2.1.1 |
| R-18 | Browser Back, refresh, or deep links lose the user's result or task state | The on-call person refreshes and the countdown restarts, or goes Back and re-sends a dispatch | State server-side; URL-addressable views; idempotency keys; server-time countdowns | E2E navigation tests | E2E-07: state kept, no double send | T-2.3.3 |
| R-19 | Bulk processing skips files, hides partial failures, or duplicates successful work on retry | A unit import silently drops 3 units, so texts from those tenants land in "unknown sender" at 2 am; a re-run duplicates vendors | Per-row results; idempotent matching; failures listed first | Import result counts; unknown-sender rate | IT-17: 97 added, 3 reported; re-run adds only the 3 | T-2.3.4 |
| R-20 | Unclear labels, icons, stale routes, or broken links misdirect users | "Acknowledge" read as "resolved"; the owner believes a vendor was told when the work order is still a draft | Words with every icon; state banners (DD-04); labels tested with a buyer; route table is single-sourced in App-flow | Buyer walkthrough; link check | T-1.1.2 unaided walkthrough; SC-02 link check | T-1.1.2 |
| R-21 | Unrequested features consume effort without a requirement or pilot need | Building integrations, voice intake or automatic vendor failover before one paid pilot exists, while the safety spine is unfinished | Gate record lists the MH set for the slice; PRD non-goals; every task cites an MH or risk | Tasks or pull requests without an MH or R reference | Review of the task list at G-build: none without a linked need | T-0.2.4 |
| R-22 | Misnamed, duplicate, or stale branches obscure the active work or endanger unmerged changes | A fix for a missed-emergency bug sits on a forgotten branch while production runs the old rule set | Branch names carry the task ID; protected `main`; weekly stale-branch report; no force-push to shared branches | Stale-branch report; rule-set version shown on S-16 | CI name check rejects a branch without a task ID; report lists branches older than 14 days | T-2.1.4 |

## 7. Build milestone B1 (2026-11-11)

**Authorisation.** On 2026-11-11 the owner authorised implementation in all ten repositories at once, **before this product's Phase 0 sales gate (G-build, Decision.md 9.3) had passed**. The decision text in Decision.md is unchanged; this section records the departure. No real tenant number, provider account, key or customer data was used.

**Where.** Branch `feat/b1-foundation`, code under `code/` (npm workspaces: `apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/platform`, `packages/services`, `tools/monitor-fake`). Local PostgreSQL 16 databases `fixtriage_dev` and `fixtriage_test`, application role `fixtriage_app` (NOSUPERUSER NOBYPASSRLS; every isolation test runs as it). API port 8109; port 3109 runs the fake external monitor (no frontend in B1). Redis database 8 was assigned but is not used (AD-02).

### 7.1 Tasks implemented

| Task | Scope in B1 | Not done in B1 |
|---|---|---|
| T-2.1.1 | Layout (TRD 5, under `code/`), `npm run dev` one-command start with health wait, `/healthz`, `/readyz`, import-boundary lint | Compose file (Docker not available) |
| T-2.1.2 | Drizzle schema, generated migration plus custom migration (FORCE RLS, exclusion constraint, UR-6 trigger, append-only audit, resolver functions, poll views, grants), `withAccount`, ORM-diff check, `check:migrations` | Backfill runner, concurrent-index convention file (no backfill or new index yet) |
| T-2.1.3 | Session resolution and anti-forgery check on state-changing routes (IT-21) | Password, Argon2id, TOTP, recovery codes, reset, lost-factor procedure, operator sign-in |
| T-2.1.5 | One configuration module, JSON logger with correlation ID and scrubber, provider interfaces | — |
| T-2.2.1 | Twilio SMS/status/voice/voice-ack and Postmark inbound handlers with signature or secret check; idempotent ingest | Media fetch job; storing messages to an unknown destination (no table, gap below) |
| T-2.2.2 | Outbox with retry, forward-only status, unknown-result reconciliation, fixed versioned templates, safety reply with 30-minute window, rule-hit resend and clock-selected after-hours variant, purpose notice | — |
| T-2.2.3 | Rule set v1 (English lexicon with misspellings), tier ordering, UR-3 uncertainty, UR-5 final tier, database guard for UR-6 | Pilot-language lexicons (no language named yet) |
| T-2.2.4 | Escalation state machine as database rows; tick; voice+SMS pages; keypress, link, app and operator-relay acknowledgement; EP-4, EP-5 (Level 4 primary/backup, "engaged"), EP-6, EP-7, EP-11 a-c | Weekly test pages |
| T-2.2.5 | Coverage check function (UT-05) | S-09 screen, settings route, test-page flow |
| T-2.2.6 | Capability tokens, acknowledge link (GET minimal data, POST acknowledges), public URL builder | S-05, S-06 screens |
| T-2.2.7 | Worker check-in, `/readyz` with due-item ages and probe result, fake external monitor, inbound call forward | Monitor product choice, probe job, S-15, S-16 |
| T-2.2.8 | DU-2 threading, DU-3 suggestion, DU-4 a-d, "separate problem", building-wide flag | Confirm and unmerge routes |
| T-2.3.1 | Classifier interface, fake, classify job with timeouts and UR-3 fallback | Real model client, prompts, evaluation harness |
| T-2.3.6 | Approve dispatch with text hash and version (FD-1), dispatch watch (FD-3, FD-4), vendor YES/NO, failed emergency dispatch reopening the escalation with the next vendor pre-drafted | Draft generation, S-07, S-08, redispatch route, tenant "vendor booked" text |
| T-2.3.10 | STOP/START recording, FD-7 a-d safety path (email safety reply, cannot-text request, page) | Retention sweep, export, deletion, privacy log |

Blocked or out of scope for B1, with reason: T-1.1.4 and every real Twilio/Postmark/model client (needs provider accounts and toll-free verification); T-2.1.4 CI and branch rules (no push in B1; the lead pushes); T-2.3.2-T-2.3.5, T-2.3.7-T-2.3.9 (UI, drafting, digest, export, review metrics; not the deterministic core); Phase 3 and 4 (need staging, operators and a buyer).

### 7.2 Commands and results (run from `code/` on commit `3b68879`, clean test database)

Superseded by the fix-round-1 run in 7.5 (commit `699c429`, 139 passed); the table below is the original B1 run.

| Command | Result |
|---|---|
| `npm run lint` (ESLint 9 with typescript-eslint, boundary rules) | Pass, 0 problems |
| `npm run typecheck` (`tsc --noEmit`, strict) | Pass, 0 errors |
| `npm run db:reset-test` (drop schema, re-migrate, seed rule set v1) | Applied `0000_tables`, `0001_rls_functions_views_grants` |
| `npm run check:migrations` | Order linear; drizzle-kit: no pending schema change; ORM vs database diff: empty |
| `npm test` (Vitest 3.2.7, 23 files) | **99 passed, 0 failed** |
| `npm run dev` | web `/healthz` and `/readyz` 200, worker and fake monitor running; unsigned webhook answered 403 |

The ORM-diff check was itself checked: dropping an index and a check constraint, removing FORCE RLS and changing a NOT NULL produced four named differences.

### 7.3 Test IDs that ran

| ID | File (under `code/`) | Result | Notes |
|---|---|---|---|
| UT-01 | `packages/core/test/ut-01-emergency-set.test.ts` | Pass (4) | 210 synthetic items (75 life_safety, 115 urgent, 20 uncertain: photo-only, empty, 14 non-English); every item ends with its labelled tier by rules + uncertainty alone; none routine |
| UT-02 | `packages/core/test/ut-02-final-tier.test.ts` | Pass (16) | Includes an injection text and five routine texts with no rule hit |
| UT-03 | `packages/core/test/ut-03-business-hours.test.ts` | Pass (5) | Fixture changed: see finding B1-F1 |
| UT-04 | `packages/core/test/ut-04-escalation-schedule.test.ts` | Pass (5) | 0, 2, 5, 7, 10, 12; operators 15 and 20, both every 5 min; Levels 1-3 at 30, 45, 60 with and without an operator engaged |
| UT-05 | `packages/core/test/ut-05-coverage.test.ts` | Pass (4) | Function only; no S-09 |
| UT-06 | `packages/core/test/ut-06-duplicates.test.ts` | Pass (3) | |
| UT-07 | `packages/core/test/ut-07-delivery-status.test.ts` | Pass (3) | |
| UT-09 | `packages/platform/test/ut-09-keys-and-links.test.ts` | Pass (3) | |
| UT-10 | `packages/core/test/ut-10-safety-reply.test.ts` | Pass (6) | |
| UT-11 | `packages/platform/test/ut-11-scrub.test.ts` | Pass (1) | |
| IT-01, IT-02 | `apps/web/test/it-01-02-intake.test.ts` | Pass (4) | Safety reply queued at receipt and sent on the first outbox pass with the classify queue never run |
| IT-03, IT-04 | `apps/web/test/it-03-04-tiering.test.ts` | Pass (5) | Model "hang" (timeout) and "down" both end `uncertain` with a page |
| IT-06, IT-07, IT-08 | `apps/web/test/it-06-07-08-escalation.test.ts` | Pass (4) | IT-06 simulates the dead worker by withholding ticks and restarts two tick runners at once |
| IT-09, IT-18, IT-20 | `apps/web/test/it-09-18-20.test.ts` | Pass (4) | |
| IT-10 | `apps/web/test/it-10-isolation.test.ts` | Pass (7), **in part** | All B1 routes and jobs, every resolver and poll view, every account table outside `withAccount`. Not run: storage read of another account's key (no storage path in B1) and routes not yet built |
| IT-11 | `apps/web/test/it-11-approve.test.ts` | Pass (1) | API level; no second browser tab |
| IT-12, IT-13, IT-19 | `apps/web/test/it-12-13-19-dispatch.test.ts` | Pass (6) | |
| IT-14 | `packages/db/test/it-14-migrations.test.ts` | Pass (3), **in part** | Empty database, ORM diff, re-run, edited-migration refusal, conflicting parents. Not run: "previous release" and "backfill killed at 40%" (no earlier release, no backfill) |
| IT-16 | `test/it-16-liveness.test.ts` | Pass (4) | (a) a real worker process killed with SIGKILL; the fake monitor, a separate component on its own clock, alerts both operators 240 s after the last check-in; (b) `/readyz` over real HTTP fails on a stuck tick, alert within 5 min; (c) a withheld probe reply fails readiness (the 6-hourly probe job itself is not built); (d) call forward |
| IT-21 | `apps/web/test/it-21-csrf.test.ts` | Pass (2) | |
| E2E-03, E2E-04 | `apps/web/test/e2e-03-04-hcf.test.ts` | Pass (4), **API/service level only** | Same sequences driven through the HTTP handlers and the worker passes with a fake clock; the browser half (S-05, S-06) was not run |
| — | `test/boundary-lint.test.ts`, `apps/worker/test/no-web-framework.test.ts` | Pass (4, 1) | T-2.1.1 lint check; T-2.1.5 worker import graph has no Next.js or React file |

Not run: UT-08, IT-05, IT-15, IT-17, E2E-01, E2E-02, E2E-05..E2E-10, classifier release gates, all of T-3.1.x.

### 7.4 Findings from implementation and the document changes made

| ID | Finding | Change |
|---|---|---|
| B1-F1 | UT-03's "clock change 2027-03-14" does not exist for America/Vancouver in the tz database shipped with Node 24.22.2 (tzdata 2026e: UTC-7 all year from 2026-03-08). Legal basis (fix round 1, B1-008): BC news release 2026AG0013-000209 of 2 March 2026, Decision.md SRC-23, opened by the reviewer, not re-opened by the developer. East Kootenay and Golden still change clocks (America/Edmonton). A startup and readiness guard now refuses older tzdata | execution-plan.md UT-03 row; test covers Vancouver 2026-03-08 and Toronto 2027-03-14 |
| B1-F2 | UR-3 names a model confidence threshold but no number | PRD.md UR-3: 0.80 `[P]`, owner to confirm; code constant `MODEL_CONFIDENCE_THRESHOLD` cites it |
| B1-F3 | A request with no rule hit has no tier until the model answers; defaulting it to `uncertain` and then letting the model set `routine` contradicts "a model never lowers a tier" | schema.md 3.2 and 3.5: `tier_source = 'pending'` (shown as `uncertain`, first decision may be any tier) |
| B1-F4 | `escalation_steps` unique key cannot hold two people paged at the same step (EP-5 both operators; EP-11 acknowledger with Level 1; FD-3 approver with Level 1) | schema.md 3.5: `target_role` in the key |
| B1-F5 | The acknowledged escalation needs timers (EP-7 reminder, EP-11a) but `due_escalations` only covered `paging` | schema.md 5 index and view |
| B1-F6 | Status for an unknown provider ID "stored and retried" had no table; `Idempotency-Key` had no table | schema.md 3.5: `pending_status_events`, `idempotency_keys` |
| B1-F7 | `packages/db` may import only `packages/platform`, and apps may not import each other, so workflows shared by web and worker had no home | TRD 5: `packages/services`; AGENTS.md 5 |
| B1-F8 | pg-boss replaced by a `jobs` table and view `due_jobs` | TRD AD-02 and 6.3, schema.md 4 and 3.5 |
| B1-F9 | The repository root may hold only the planning files, `.gitignore` and `Makefile` during B1, so the TRD layout lives under `code/`; `pnpm` and Docker are not installed, so commands are npm scripts and Compose stays proposed | TRD 5 and 7, AGENTS.md state line and section 12, execution-plan 8 note |
| B1-F10 | T-2.2.1 says a message to an unknown destination is "stored for the operator", but no table existed; the reviewer also found that a correctly addressed email in another letter case was dropped | Fixed in round 1 (B1-004): `unrouted_inbound`, metadata only, alerts through `/readyz`; case-insensitive resolution. Keeping message text for the operator remains an owner decision |
| B1-F11 | TRD 6.2's note ("SMS undelivered and call unanswered" is not a double failure) means an unanswered call is not a delivery failure | Implemented as written: Twilio `no-answer`/`busy` map to `sent`; only `failed`/`canceled` calls count for EP-4 |
| B1-F12 | When the previous acknowledger or approver is also the Level 1 on-call person, EP-11/FD-3 page them twice | Not changed; a duplicate page is acceptable (TRD 6.3) |

These edits were made by the developer and have not been re-reviewed.

### 7.5 Fix round 1 (2026-11-11)

Review `_coordination/review/fixtriage-b1-round1.md` (independent reviewer, HEAD `df7a4eb`): 1 blocker, 4 majors, 5 minors. All fixed on `feat/b1-foundation`, code commit `699c429`; not re-reviewed yet.

| Finding | Fix | Regression test (under `code/`) |
|---|---|---|
| B1-001 blocker: an undecided after-hours request whose classify job died never paged; `/readyz` stayed green | Deterministic sweep `sweepUndecided` in the safety loop over new view `due_undecided`: a `pending` request becomes `uncertain` 30 s after receipt (PRD UR-3 `[P]`) and follows EP-8 (after hours at once, business hours at 15 min), independent of the classify job; model output validated strictly; `/readyz` fails on any dead job and on an overdue undecided request | `apps/web/test/fix-round1.test.ts` B1-001 (4 cases incl. dead classify job -> page and red readyz; business-hours 15 min); view-vs-constant check |
| B1-002 major: classification shared the worker loop with outbox and tick; a client ignoring abort hung it | Worker runs two loops: safety loop (intake, sweep, tick, dispatch watch, outbox, status retry) and model loop (`processClassifyJobs`, concurrency 4, each job raced against a runner-enforced hard timeout; each model call also raced); `processDueJobs` never runs model jobs | fix-round1 B1-002: 8 queued classify jobs on an abort-ignoring model; the gas safety reply and the life_safety page leave in one safety pass under 2 s; the model runner returns within its hard timeout |
| B1-003 major: 5 of the reviewer's 34 phrasings had no rule floor | Rule set v2 (v1 frozen): negations ("doesnt/does not/isnt/wont/won t" of heat, heater, furnace, boiler, radiator, power), falls, unit cannot be secured, spreading leaks; v2 normaliser for split contractions and short-word misspellings (gass, gaz, smel, heet, smoek) | UT-01 fixture now 269 items incl. all 34 reviewer phrasings and 25 more; UT-02 routine negatives; fix-round1 B1-003 (7 phrasings, model routine 0.95 after hours -> paged) |
| B1-004 major: case-variant email and unknown destinations dropped | `unrouted_inbound` (metadata only) with `/readyz` alert; Postmark answered 503 so it retries, Twilio 200 (no inbound retry); `lower(address)` unique index and comparison; malformed correlation IDs replaced instead of failing ingest | fix-round1 B1-004 (3 cases); IT-10 case-insensitive resolution |
| B1-005 major: building-wide flag suppressed a second-unit life_safety report | `du4Decision`: `life_safety` always reopens; PRD DU-4(d) states the exception does not cover life_safety | UT-06 case; fix-round1 B1-005 (acknowledged building-wide fire, unit 305 smoke -> reopened, Level 1 paged) |
| B1-006 minor: confidence 1.5 accepted | `validateModelAnswer`: finite, in [0, 1], known lower-case tier, else `malformed` -> `uncertain` | UT-02 (8 invalid answers); fix-round1 B1-001/006 (12, Infinity, 1.5, -1) |
| B1-007 minor: check-in on an independent interval | Check-in only after a completed safety pass | fix-round1 B1-007: a hung outbox send stops check-ins |
| B1-008 minor: legal source and guard | SRC-23 cited (Decision.md 13, TRD 12, execution-plan UT-03); `checkTimezoneData` at web and worker start and in `/readyz` (tzdata >= 2026e and Vancouver winter offset UTC-7); East Kootenay noted | fix-round1 B1-008 |
| B1-009 minor: invalid calendar could fail T1 | Trigger `accounts_validate`; `afterHours` treats an unevaluable calendar as after hours | fix-round1 B1-009 (2 cases) |
| B1-010 minor: ASVS not read by the reviewer | No code change; no ASVS claim is made (TRD 8.7 rows stay "planned, not verified") | — |

Commands, from `code/`, clean test database (`npm run db:reset-test` applied `0000`..`0003`): `npm run lint` 0 problems; `npm run typecheck` 0 errors; `npm run check:migrations`: order linear, no pending drizzle change, ORM vs database diff empty; `npm test` **24 files, 139 passed, 0 failed**; `npm run dev` healthy with the new readiness checks green.

Reviewer's script `fixtriage-b1-adversarial.mts` (not edited): before **23/35**, after **34/35**. The remaining FAIL, A13b, counts rows in `inbound_messages`; the message to an unknown number is now kept in `unrouted_inbound` (metadata only, which the review's retest condition accepts) and alerts through `/readyz`, so the case's check is narrower than its retest condition. A10a and A11 call `processDueJobs`, which no longer runs model jobs; the abort-ignoring client is covered by the runner test above.

Documents changed in round 1: PRD (UR-3 invalid output and 30 s deadline `[P]`, DU-4(d) life_safety), TRD (5.1 readiness, 6.3 classify runner and check-in, 8.9, 12 tz guard), schema.md (3.5 round-1 table, 4 views, 5 indexes), Decision.md (SRC-23 source row only; decision text unchanged), execution-plan (UT-03 note), AGENTS.md (utilities index), this file. Not re-reviewed.

### 7.6 Retest (round 2) and fix round 2 (2026-11-11)

Reviewer's verdicts from `_coordination/review/fixtriage-b1-verdicts.json`, copied unchanged (retest of HEAD `9edfd54`):

```json
{
  "B1-001": "Closed",
  "B1-002": "Closed",
  "B1-003": "Closed, part open: 'pipe bursted under the sink', 'the pipe has bursted', 'pipes busted' and 'water main broke' have no rule floor in rule set v2 (s('burst') is exact; 'burst' and 'busted' are under the 6-letter fuzzy limit); after hours with model routine 0.95 the request ends routine with 0 pages (N4b)",
  "B1-004": "Closed",
  "B1-005": "Closed",
  "B1-006": "Closed",
  "B1-007": "Closed",
  "B1-008": "Closed",
  "B1-009": "Closed",
  "B1-010": "Still open: reviewer note only (no ASVS 5.0.0 IDs cited); unchanged by design"
}
```

Edits made after that retest (**fixed after retest**, not re-reviewed), code commit `91b6c0a`:

| Item | Fix | Regression test (under `code/`) |
|---|---|---|
| B1-003 residue: "pipe bursted under the sink", "the pipe has bursted", "pipes busted", "water main broke" had no rule tier; after hours a model `routine` 0.95 paged nobody | Rule set v3: `burst*`, `brust*`, pipe with bust/broke/split/crack/blew/exploded, water main, hose or tank burst. Ruling's stem layer: `safetyCandidate` marks a message by word stems (burst, bust, leak, flood, gas, smoke, fire, spark, monoxide, heat, sewage and others) with prefix and edit-distance tolerance (5+ letters), weak stems only in pairs; after hours a candidate with no rule tier is decided `uncertain` at intake (`intakeFloor`), so the model alone can never close it and it is paged (EP-8). PRD UR-3 `[P]` | UT-01: fixture set 286 items incl. the four phrasings and 13 more burst/main variants; the stem layer alone marks every English emergency fixture; 6 candidate and 9 non-candidate texts. `apps/web/test/fix-round2.test.ts`: the four phrasings after hours with model routine -> urgent, paged; three candidate texts with no rule tier after hours with model routine -> `uncertain`, Level 1 paged; the same in business hours may be routine |
| Reviewer note (round 2): `/readyz` stays red until dead jobs are cleared, no route | `GET /ops/jobs/dead`, `POST /ops/jobs/:id/requeue` and `/dismiss`: role `operator` only (staff 403, anonymous 401), anti-forgery token, reason required, audit row with the operator as actor; job state `dismissed`; view `dead_jobs` | fix-round2 operator cases (3): refusals, requeue -> `/readyz` dead_jobs green and job then runs, dismiss |

Commands, from `code/`, clean test database (`npm run db:reset-test` applied `0000`..`0005`): `npm run lint` 0 problems; `npm run typecheck` 0 errors; `npm run check:migrations`: order linear, drizzle-kit no pending change, ORM vs database diff empty; `npm test` **25 files, 167 passed, 0 failed**. Reviewer's round-2 script `fixtriage-b1-adversarial.mts` (not edited): **41/41 passed** (it reported 40/42 at `9edfd54`).

B1-010 stays open as the reviewer's note (no ASVS 5.0.0 IDs cited; no compliance claimed). Documents changed in this round: PRD (UR-3 safety-candidate floor), TRD (5.1 `/ops/*`, 8.5 "Not AI"), schema.md (3.5 round-2 table, 4 `dead_jobs`), AGENTS.md (utilities index), this file. Not re-reviewed.
