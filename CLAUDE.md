# CLAUDE.md — FixTriage

Read [AGENTS.md](AGENTS.md) first; it is canonical. This file adds only what is specific to this product. B1 (the deterministic safety spine with provider fakes) is implemented under `code/`; see AGENTS.md state line and section 12 for what exists. Everything else is proposed.

## The question this repository answers

Can a small property manager improve after-hours handling without missing urgent cases? If a change does not help answer that, it is probably out of scope ([PRD section 10](PRD.md#10-non-goals-mvp)).

## The buyer's workflow

A BC rental property management brokerage with 20-150 doors and 1-8 staff. Tenants text or email a repair request. Today the owner's phone is the after-hours system. With FixTriage: every first message gets a fixed safety reply; rules and a classifier set urgency; urgent and unclear cases page a named on-call chain until a person acknowledges; a human approves every vendor message; a reviewer marks each request so both sides can compute accuracy.

## Highest-consequence error

**HCF — an after-hours urgent case is missed or delayed.** Urgent case means no heat, flood, gas smell, fire or an after-hours lockout (every one is urgent, so that a vulnerable tenant is never missed and nobody judges vulnerability, UR-7), and anything in tiers `life_safety` or `urgent` ([PRD 7.1](PRD.md#71-urgency-tiers-ur)). Everything in MH-02..MH-07, MH-10 and MH-16 exists to prevent it, including the less obvious paths: a vendor who does not answer an emergency dispatch (FD-3, EP-11), a second unit's report attached to someone else's incident (DU-4), a tenant who sent `STOP` (FD-7), and a worker that has died quietly (MH-16). When in doubt between paging someone unnecessarily and not paging, page.

## Sensitive data

Tenant names, mobile numbers, emails, home addresses, message text, photos of the inside of homes, and anything a tenant volunteers about health, age or household. Vendor and staff mobile numbers. BC PIPA applies; the brokerage is responsible for it and FixTriage holds it on the brokerage's behalf (Decision.md SRC-03). Message text and photos go to a model provider outside Canada (GAP-08); do not describe the product as Canada-only processing.

## Prohibited shortcuts

1. Never let a model, a tenant's later message, the time of day or a missing field lower an urgency tier. Only a signed-in `owner` or `manager` can, with a reason (UR-5, UR-6).
2. Never make the safety reply depend on classification, a model, a queue shared with classification, or a per-account toggle (MH-02).
3. Never default a request to `routine`. The default is `uncertain` (UR-3).
4. Never end, pause or auto-close an escalation by timer; only an acknowledgement by a person of the account ends it. An operator's "engaged" does not (EP-5).
5. Never send anything to a vendor without a human approving that exact text and recipient, including the second vendor after a failure (FD-1, FD-3, AD-11).
6. Never suppress a tenant's safety reply or drop a report because it looks like a duplicate, and never let an unconfirmed duplicate suggestion suppress a page for a different unit (DU-3, DU-4, DU-5).
7. Never treat an exception flag (`uncertain`, unknown sender, undelivered, `unknown` send status) as a pass, and never let it stop the other deterministic checks on the same request.
8. Never use in-memory timers, direct provider sends outside the outbox, or links built from request host headers.
9. Never read or write account data outside `withAccount`; the only exceptions are the named resolver functions and poll views in schema.md section 4, and adding one needs a row there and in IT-10. Never log message text, numbers, names or tokens.
10. Never call the SMS number an emergency line or imply it replaces the landlord's emergency telephone contact (RTA s.33(2)); never write tenant-facing advice beyond the fixed templates.
11. Never use email links or SMS codes as an authentication factor for staff.
12. Never weaken EP-9 so that an account can go live with a schedule gap, untested on-call numbers or fewer than two operators.
13. Never let the worker be the thing that detects the worker's own failure, and never send per-account synthetic texts as a health check (MH-16, TRD 8.9).
14. Never let a model choose which tenant-facing template is sent; the clock, sender history and rule hits are the only selectors (EP-10).
15. Never count anything but the named reviewer's explicit mark toward SM-03, and never exclude `uncertain` requests from it.

## First verification checks when implementation begins

Run in this order; each is defined in [execution-plan.md section 7](execution-plan.md#7-tests-all-not-run).

1. IT-10 — cross-account isolation on every route, job and storage path.
2. IT-01 and IT-02 — one stored message per provider ID; safety reply within 60 s with the model down.
3. UT-01 and UT-02 — every item of the emergency fixture set ends non-routine; a model answer cannot lower a rule result.
4. IT-03 — model failure after hours results in a page.
5. IT-06, IT-07, IT-08 — worker restart, double delivery failure and simultaneous acknowledgement.
6. E2E-03 and E2E-04 — the HCF sequence, and the chain exhausted to the operators.
7. IT-12, IT-19 and IT-13 — a failed emergency dispatch pages up the chain until a person acknowledges; pages are re-sent on unknown status, dispatches are not.
8. IT-20 and IT-18 — a second unit's report still pages; a tenant who sent `STOP` still reaches a person.
9. IT-16 — a killed worker alerts both operators within 5 minutes from outside the application.

B1 status of this list (2026-11-11): items 1-9 were run at API/service level and passed, with the parts not run named in [verification section 7](verification-report-fixing.md#7-build-milestone-b1-2026-11-11) (IT-10 storage path, IT-14 backfill, browser halves of E2E-03/E2E-04). These are the first checks, not the go-live bar. The go-live bar is the single point in execution-plan.md section 1: every test passing (M-3.1 exit) plus the account's EP-9 gate. Until then, do not connect a real tenant-facing number.

## Before changing anything

- Product rule numbers (timeouts, windows, thresholds) live only in [PRD section 7](PRD.md#7-product-rules-canonical-other-files-cite-these-ids); cite the ID.
- Record results honestly in [verification-report-fixing.md](verification-report-fixing.md): `Not run` stays `Not run` until a check is executed.
