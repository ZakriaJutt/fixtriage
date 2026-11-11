# Decision — FixTriage

Decisive pilot question: **can a small property manager improve after-hours handling without missing urgent cases?** Every file in this repository serves that question. Nobody has interviewed a customer; willingness to pay is unproven.

Related files: [PRD](PRD.md) · [TRD](TRD.md) · [App flow](App-flow.md) · [Design](design.md) · [Schema](schema.md) · [Execution plan](execution-plan.md) · [Verification](verification-report-fixing.md) · [AGENTS](AGENTS.md) · [CLAUDE](CLAUDE.md)

## 0. How numbers are labelled (used in all ten files)

| Label | Meaning |
|---|---|
| `[C]` | Stated in the earlier chat or its decision brief (chat answer, research record, or site economics model). A `[C]` figure from the model is still an assumption about the world; the label records where it came from. |
| `[S: SRC-nn]` | Read at the named source in [section 13](#13-sources-and-assumptions) on 2026-11-10. |
| `[A]` | Assumption with no source. |
| `[P]` | Proposal by the author; not decided in chat. |

IDs: `MH-nn` must-haves (PRD), `S-nn` screens (App-flow), `AD-nn` architecture decisions (TRD), `DD-nn` design decisions (design), `T-p.m.t` tasks (execution plan), `R-01..R-22` risks, `F-nnn` reviewer findings, `SC-nn` author self-checks (verification file), `SRC-nn` sources, `GAP-nn` departures from the brief (section 12). "Account" always means the paying brokerage; "tenant" always means a renter, never a software tenant.

## 1. Proposed decision

**Test, do not build yet** `[C: research verdict "test"]`. Run Phase 0 of the [execution plan](execution-plan.md) (list, outreach, discovery calls (7.2 expected per batch, at least 6 needed for the gates), hand-run three-request test, paid pilot agreement) and start the build only if gate G-build in [section 9](#9-stop-rule) passes.

Two results of this document's own arithmetic limit the decision and are stated plainly:

1. At the brief's funnel rates, 300 contacts produce 1.44 paid pilots, and the brief's stop rule (fewer than 2 paid pilots after 300 contacts) fires with probability 57.8% even if every assumed rate is true ([section 9](#9-stop-rule)).
2. At those same rates each distinct prospect becomes a recurring account with probability 0.36%. Reaching the 8-account break-even needs about 2,223 distinct qualifying firms and the 65-account break-even about 18,056. The number of qualifying BC firms is unknown and no primary count was obtained ([section 8](#8-funnel-from-distinct-reachable-prospects)). **Unless measured conversion is several times the assumed rate, BC alone cannot reach break-even with founder compensation.** Phase 0 exists to measure that rate before any code is written.

## 2. Who pays, who uses, what is billed

| Item | Definition |
|---|---|
| Buyer and budget owner | Owner or managing broker of a BC residential rental property management brokerage `[C]`. |
| Daily user | The person who reads repair messages today: the owner, a property manager or an office administrator (1-8 employees `[C]`). After hours it is whoever is on call, usually the owner `[C: qualify criterion]`. |
| **One paying account** `[P]` | One brokerage (one legal entity, one BCFSA brokerage licence) with one active subscription covering its whole managed portfolio. Branch offices under the same licence are the same account. |
| **One billable unit** `[P]` | One door (rental unit under management) per month, sold in tier allowances: Starter up to 50 doors, Pro up to 150, Business up to 400; CAD 1.50 per door per month above the allowance `[C]`. Requests, messages and users are not billed. |
| Other parties | Tenant (sends the request, never pays, never logs in). Vendor (receives a dispatch, never logs in). Property owner-client of the brokerage (not a user in the MVP). |

## 3. Launch market, problem, workaround

- Launch market: BC licensed rental property management brokerages with 20-150 doors, Vancouver first `[C]`. BC rental managers are licensed by BCFSA, whose public register can be searched by "Rental Property Management" and by business type `[S: SRC-15]`.
- Problem `[C]`: requests arrive by text, email and voicemail with missing details; someone asks follow-up questions, decides urgency, picks a vendor and re-keys the job. Frequency assumption: 3 to 5 requests per 10 doors per month `[C, assumption]`.
- Current workaround `[C]`: shared inbox or phone, a vendor spreadsheet, manual texting; some type the request into the work-order module of Buildium or DoorLoop.
- Legal backdrop: a BC landlord must post or give in writing the name and telephone number of a person to contact for emergency repairs `[S: SRC-01, s.33(2)]`. Emergency repairs are urgent, necessary for health or safety or the preservation or use of the property, and made to repair major leaks in pipes or the roof, damaged or blocked water or sewer pipes or plumbing fixtures, the primary heating system, damaged or defective locks that give access to a rental unit, or the electrical systems `[S: SRC-01, s.33(1)]`. A tenant may have such repairs made only after at least 2 attempts to telephone the number provided and reasonable time for the landlord to act, and the landlord must then reimburse on a written account with receipts `[S: SRC-01, s.33(3), (5)]`. Product consequence: a text or email to FixTriage is **not** the s.33 telephone contact and the product must never present itself as one (MH-02, MH-16 in the [PRD](PRD.md)).

## 4. Competitor gap, evidence, counterargument

Competitor prices are USD list prices read on vendor pages; none is a measured customer outcome. Conversion to CAD uses the scenario rate 1 USD = 1.38 CAD, direction USD to CAD, a model assumption dated 2026-11-10 and not a sourced rate `[C]`. All rows are per month.

| Vendor | What the vendor page states `[S]` | Cost for a 100-door firm, CAD per month | Status against the brief |
|---|---|---|---|
| Property Meld | Ops USD 2.00 per unit; USD 200 monthly minimum; MAX On-Call add-on USD 1.50 per unit; "works best" at 100+ doors; under 100 doors the team "will reach out to assess" `[S: SRC-04]` | USD 200 = CAD 276.00 (USD 350 = CAD 483.00 with On-Call) | Verified as in brief. |
| AppFolio | Core "starting at" USD 1.49 per unit, 50-unit minimum, "minimum spend" applies (amount not published); Plus from USD 3.20; Max from USD 5.00; Core lists work order management and "Realm-X Assistant & Messages" `[S: SRC-05]` | At least USD 149 = CAD 205.62 for a full suite; true minimum unknown | Verified as in brief. Not like-for-like: a full PM suite, not an intake layer. |
| DoorLoop | One from USD 2.50, Connect from USD 4.00, Multiply from USD 5.00 per unit; minimum spend and units apply (not published); the page labels Multiply "INVITE ONLY" and lists its "Maintenance Ops Agent" there; Connect lists a "Receptionist Agent" that answers tenant texts, calls and portal messages around the clock; the comparison table marks agents "available as an add-on" `[S: SRC-06]` | USD 400-500 = CAD 552-690 for the whole suite | Brief verified: Maintenance Ops Agent on the invite-only Multiply plan at USD 5.00. **Addition GAP-03:** the Receptionist Agent on the cheaper Connect plan is not in the brief and is the part that bears on the stop condition. |
| Buildium | Essential from USD 65, Growth from USD 202, Premium from USD 420; lists task and work order management, "Maintenance Contact Center" and "Lumina AI Workforce" (account-specific pricing) without stating plans `[S: SRC-07]` | Plan depends on unit count (not read) | **Departure GAP-04:** the brief says no AI triage agent is shown; the page lists AI and contact-centre items whose scope and price were not read. |
| Vendoroo | Receptionist and Maintenance Coordinator plans, "After-Hours Human Support" add-on; no prices, no minimum stated `[S: SRC-08]` | Unknown | Verified. Third-party figure of USD 3-6 per door is secondary and was not opened `[C: secondary, SRC-20]`. |
| **FixTriage** `[C]` | Starter CAD 99 (50 doors), Pro CAD 199 (150), Business CAD 399 (400) | CAD 199.00 (CAD 1.99 per door) | — |

- **Gap claimed** `[C]`: firms under 100 doors fall below the minimums or target size of dedicated AI maintenance tools, and bundled agents need a platform switch. Verified part: Property Meld's USD 200 minimum and 100+ door positioning. Unverified part: that small BC firms want this and cannot get it from their current suite.
- **Like-for-like per door** (computed): Starter at 50 doors CAD 1.98; Pro at 150 doors CAD 1.33; but Starter at 20 doors is CAD 4.95 and Pro at 51 doors CAD 3.90, above the brief's "CAD 1.30 to 2.00 per door" range `[C]`.
- **Strongest supporting evidence:** four vendors publish paid per-unit prices for maintenance coordination, so the category is paid for `[S: SRC-04..07]`; the legal duty in s.33(2) means every prospect already has an after-hours obligation `[S: SRC-01]`.
- **Strongest counterargument:** incumbents are bundling agents (DoorLoop Receptionist Agent, Buildium Lumina, AppFolio Realm-X `[S: SRC-05..07]`), which is exactly the chat's stop condition; and the modelled benefit shrinks for small accounts: a 40-door firm at 4 requests per 10 doors has 16 requests x 12 minutes = 3.2 hours x CAD 35 = CAD 112 per month against a CAD 99 fee unless an avoided call-out (CAD 250) also occurs `[A, computed from C inputs]`. The brief's own example (100 doors, 40 requests, CAD 280 + CAD 250 = CAD 530) is compared in the brief with a CAD 149 fee, but a 100-door firm pays Pro CAD 199 (GAP-02).

## 5. Offer, channel, pilot

| Item | Value |
|---|---|
| Offer `[C]` | Forward the maintenance inbox and one phone number; get categorised, prioritised work orders, an emergency page and a drafted vendor message for approval. No tenant app, no migration. |
| Free first step `[C]` | Three-request test: the prospect sends three anonymised recent requests; the founder returns finished work orders by hand (task T-0.2.1). |
| Paid pilot, verbatim `[C]` | Chat (owner's chat, translated): a 30-day pilot for CAD 99, refunded if fewer than 80% are correct. Research record: "30-day paid pilot at CAD 99 for the whole portfolio, refunded if fewer than 80 percent of requests are categorised correctly by the customer's own review." |
| What CAD 99 buys `[P]` | 30 consecutive days of live intake for the whole portfolio on one email address and one SMS number, the static safety reply, emergency paging to the account's on-call chain, work orders with drafted vendor dispatch, daily digest, CSV export, a weekly accuracy report and an end-of-pilot report. Taxes extra; tax treatment not decided. |
| Who signs / pays `[P]` | The managing broker signs a one-page pilot agreement with a privacy schedule (task T-0.2.3). The brokerage pays the invoice at signature, before go-live. |
| Buyer supplies `[P]` | Required: unit list (property address, unit label); the s.33(2) emergency contact name and phone; business hours; at least two different on-call people with mobile numbers, placed on Levels 1-3 (Level 3 is the owner, who may also hold Level 1 or 2; EP-1); forwarding of the maintenance inbox; a named reviewer. Optional (absence adds manual steps, never blocks): vendor list by trade; tenant phone and email per unit. |
| Clock `[P]` | The 30 days start at go-live (first live inbound message after the go-live gate in MH-05), not at signature. |
| Refund criterion, computable | Metric SM-03 in the [PRD](PRD.md), kept on the chat's base "of requests" `[C]`: requests the buyer's named reviewer explicitly marked correct for both trade category and urgency tier, divided by all requests the reviewer marked. A request the system left `uncertain` counts as **not correct**. Only an explicit mark counts; approving a work order is not a mark and there is no bulk marking. Evidence is the review log, exported to both parties weekly. Below 80% `[C]` with at least 20 marked requests `[P]`: full refund within 10 business days, no dispute step. Fewer than 20 marked by day 37: one 15-day extension at no charge, then the buyer chooses refund or continue `[P]`. The reviewer names the corrected value for each "incorrect", so a refund always leaves a labelled record. Any missed urgent case attributable to FixTriage (SM-01) also triggers a full refund `[P]`. Consequence stated to the buyer: the safety rules escalate unclear messages, which lowers this score; they are not relaxed to protect the fee. |
| Conversion step `[P]` | Day 25: pilot report delivered and reviewed on a call. By day 30 the broker signs the plan order form for the tier matching the door count and adds a payment method; the first monthly invoice is dated day 31. No signature: channels are switched off on day 31, with the forwarding-removal checklist. |
| Pilot before software | See [section 5.1](#51-how-a-paid-pilot-is-delivered-before-software-exists). |
| Channel `[C]` | Cold email plus phone to BCFSA-licensed rental management firms; backup LandlordBC and PAMA events and newsletters. |
| Sales cycle `[C]` | 21 days from first contact to paid pilot. |
| Trial in the research pricing record `[C]` | "14-day free trial on the customer's real inbox, then a paid first month with a money-back guarantee." This conflicts with the chat's paid pilot; the chat's paid pilot is used and no free trial is offered during validation `[P]` (GAP-05). |

### 5.1 How a paid pilot is delivered before software exists

| Mode | When | What happens | What it can prove |
|---|---|---|---|
| H, hand-run shadow `[P]` | From signature until the go-live point below | The buyer forwards a copy of each maintenance email and a daily export or screenshot of repair texts. The founder returns work orders by 10:00 the next business day using a fixed prompt and the rule list. FixTriage contacts no tenant and no vendor, and is not in the after-hours path; the buyer's existing emergency phone stays the only route. Days in Mode H do not count toward the 30 days. | Classification accuracy (SM-03) on real requests. It cannot answer the decisive question. |
| L, live `[P]` | **One go-live point, the same in the [execution plan](execution-plan.md#1-sequence-and-gates):** milestone M-3.1 has passed its exit criteria (all of Phases 1-3, 307-427 hours) and the account has passed its own go-live gate (EP-9) | The product described in the PRD. | After-hours handling (SM-01, SM-02) and the refund metric (SM-03). |

The invoice is paid at signature in both cases; a buyer who signs before software exists is told the expected Mode L date in writing and may cancel for a full refund until go-live.

## 6. Reconciling tier prices, pilot price and assumed revenue per account

- Tier prices `[C]`: Starter CAD 99, Pro CAD 199, Business CAD 399 per month; overage CAD 1.50 per door; annual discount 15%; no setup fee. The research record also lists a "launch price" of CAD 149 that is not a tier.
- Assumed monthly revenue per account (ARPU): CAD 149 `[C, assumption]`. Reconciliation `[P]`: 0.5 x 99 + 0.5 x 199 = 149.00, i.e. **half Starter, half Pro, no Business, no overage, all monthly billing**. Any annual-plan share lowers it (15% discount). The 20-150 door profile cannot buy Business.
- Pilot price CAD 99 `[C]` equals Starter. A Pro-sized pilot account pays CAD 99 in the pilot month instead of CAD 199; the ramp books CAD 99 for every pilot.
- Usage behind the cost notes `[C]`: about 50 requests per account per month, 6 model calls each, about 300 SMS segments, one number, 15 minutes of support. At 3-5 requests per 10 doors, 50 requests corresponds to 100-167 doors, the top of the profile; a Starter account would send 6-25. The cost figures are therefore conservative for Starter accounts and tight for the largest Pro accounts.

## 7. Unit economics

All amounts CAD per month unless stated. Every input is an assumption; `[C]` marks those carried from the brief's model. Figures changed in fix round 1 are listed in GAP-10.

### 7.1 Inputs

| Input | Base | Downside `[A]` |
|---|---|---|
| ARPU | 149 `[C]` | 99 (all Starter) |
| Variable cost excluding payment fee | AI 4 `[C]` + hosting 2 `[C]` + storage 1 `[C]` + messaging 10 `[A]` + support 10 `[C]` = 27 (brief: 25 with messaging 8) | 32 (support 15) |
| Payment fee 2.9% + 0.30 `[C]` | 0.029 x 149 + 0.30 = 4.62 | 0.029 x 99 + 0.30 = 3.17 |
| Fixed cost excluding founder | 700 `[C]` + 40 `[A]` external monitoring and platform probe = 740 | 740 |
| Founder compensation | 6,000 `[C]` | 6,000 |
| Monthly churn | 3% `[C]` | 5% |
| Contacts per 4-week batch | 300 `[C]` | 300 |
| Reply / meeting / close rates | 6% / 40% / 20% `[C]` | 4% / 40% / 15% |
| Pilot to recurring conversion | 75% `[A]` (not in brief) | 50% |
| Acquisition cash per batch | 450 = email tooling 150 + association listing or event 300 `[C: budget30 lines]` | 450 |
| Startup build | 140 hours at CAD 100 = 14,000 `[C, model]`; this plan's own estimate is 307-427 hours ([execution plan](execution-plan.md), GAP-06) | same |

Messaging at source prices `[S: SRC-10, SRC-22]`, USD, per account per month: conversation 300 segments x (0.0083 + 0.0087 carrier fee, lower column, mapping not confirmed) + number 1.15 = 6.25; weekly test page to 3 on-call people, 13 x (0.017 SMS + 0.014 for a one-minute call) = 0.40; real pages, 4 incidents x 3 attempts x 0.031 `[A]` = 0.37; total 7.02 = CAD 9.69, rounded to **10**. No per-account synthetic messages are sent: the first design (a text through every account's number every 15 minutes) would have cost 2,880 x 0.0253 = USD 72.86 = CAD 100.55 per account and was replaced (MH-16, [TRD 8.9](TRD.md#89-liveness-and-channel-monitoring)). The platform-wide probe (120 round trips x 0.0253 + two numbers 2.30 = USD 5.34 = CAD 7.36) and an external monitoring service (about CAD 30, not priced at source `[A]`) are fixed cost, rounded to 40. Model cost cross-check: 300 calls of about 2,000 input and 300 output tokens on Claude Haiku 4.5 at USD 1 and USD 5 per million tokens = USD 1.05 = CAD 1.45 against the brief's 4 `[S: SRC-19]`.

### 7.2 Gross profit, CAC, payback

**CAC (one definition, used in every file): acquisition cash spent divided by accounts that convert from pilot to a recurring paid plan.** Founder time is not in CAC because founder compensation is already a fixed cost.

| Step | Base | Downside |
|---|---|---|
| Variable cost | 27 + 4.62 = 31.62 | 32 + 3.17 = 35.17 |
| Gross profit per account | 149 - 31.62 = 117.38 (78.8%) | 99 - 35.17 = 63.83 (64.5%) |
| Paid pilots per batch | 300 x 0.06 x 0.40 x 0.20 = 1.44 | 300 x 0.04 x 0.40 x 0.15 = 0.72 |
| Recurring accounts per batch | 1.44 x 0.75 = 1.08 | 0.72 x 0.50 = 0.36 |
| CAC | 450 / 1.08 = 416.67 | 450 / 0.36 = 1,250.00 |
| Payback | 416.67 / 117.38 = 3.55 months | 1,250 / 63.83 = 19.58 months |
| Lifetime gross profit | 117.38 / 0.03 = 3,912.67 | 63.83 / 0.05 = 1,276.60 |

Gross profit per tier at base variable cost 27 plus the fee on that price (usage is not scaled by tier; a 400-door account would cost more to serve):

| Tier | Price | Fee | Variable | Gross profit |
|---|---|---|---|---|
| Starter | 99 | 3.17 | 30.17 | 68.83 (69.5%) |
| Pro | 199 | 6.07 | 33.07 | 165.93 (83.4%) |
| Business | 399 | 11.87 | 38.87 | 360.13 (90.3%) |

The 50/50 mix gives (68.83 + 165.93) / 2 = 117.38. The chat's "Margin 80%" `[C]` becomes 78.8%.

**GAP-01:** the brief's model uses CAC 400 `[C]`. This repository uses 416.67, which **depends on the author's own `[A]` 75% pilot-to-recurring rate** and is not derivable from the brief alone. Bounds from the same CAD 450: 312.50 if every paid pilot counts as a customer (450 / 1.44, the chat's reading), 625.00 at 50% conversion. 600 / 1.44 (the brief's whole 30-day budget) also happens to give 416.67.

### 7.3 Churn replacement and break-even

Churn-replacement cost per account per month = churn x CAC. Break-even accounts = fixed cost / (gross profit - churn x CAC), rounded up.

| | Base | Downside |
|---|---|---|
| Churn replacement | 0.03 x 416.67 = 12.50 | 0.05 x 1,250 = 62.50 |
| Contribution after replacement | 117.38 - 12.50 = 104.88 | 63.83 - 62.50 = 1.33 |
| Break-even without founder | 740 / 104.88 = 7.06 → **8** | 740 / 1.33 = 556.8 → 557 |
| Break-even with founder | 6,740 / 104.88 = 64.26 → **65** | 6,740 / 1.33 = 5,071 → 5,072 |
| Steady-state accounts at one batch a month (arrivals / churn) | 1.08 / 0.03 = 36.0 | 0.36 / 0.05 = 7.2 |

The chat's "Break-even 7 (63)" `[C]` reproduces with the brief's inputs (700 and 6,700 over 107.38 or 106.88) and becomes **8 (65)** once pages, test pages and monitoring are costed (GAP-10). **36 is below 65**: one founder sending 300 contacts a month at the assumed rates never reaches break-even with founder compensation, in any market. In the downside case the business does not work at any scale one founder can reach.

Founder-loaded acquisition cost (reported separately, not CAC): the brief gives 70 founder hours per batch `[C]`; this plan's recurring Phase 0 tasks sum to 64-82 hours, midpoint 73 ([execution plan section 2](execution-plan.md#2-phase-0--validation-and-go-to-market-no-application-exists)). At 6,000 / 160 hours = CAD 37.50: 73 x 37.50 = 2,737.50 per batch; (2,737.50 + 450) / 1.08 = **CAD 2,951** per recurring account (CAD 2,847 at the brief's 70 hours).

### 7.4 Pilot economics

One pilot: revenue 99.00, variable cost 27 + 3.17 = 30.17, contribution 68.83 before any refund. A refunded pilot costs 30.17. The ramp below charges pilots the recurring-account variable cost of 31.62 for simplicity (CAD 1.45 per pilot too high).

### 7.5 Cash during the acquisition ramp

Month 1 starts 2026-11-16 `[P]`; months are 4 weeks. Timeline `[P]`, identical to the execution plan:

- Batch 1 is contacted in month 1 (weeks 1-4). Its last contacts close 21 days later, so gate G-build is read by week 7 (month 2). Month 2 has no outreach.
- The build (all of Phases 1-3, 307-427 hours at 40 hours a week = 7.7-10.7 weeks) starts in week 8 with one full-time developer besides the founder and ends in weeks 16-19. **The first live account is in month 5** (weeks 17-20). Two developers could reach month 4; a founder who also builds alone could not reach month 5.
- Outreach continues monthly from month 3. Pilots sold in months 2-5 pay at signature, wait in Mode H, and all go live in month 5; they convert in month 6. From month 5 on, a batch contacted in month m pays in m+1, is live in m+1 and converts in m+2.
- Active accounts A(m) = 0.97 x A(m-1) + new. Net = pilot fees x 99 + A x 149 - 31.62 x (A + live pilots) - acquisition - 740. Fractions are expected values.

Base case:

| Month | Contacts | Pilot fees paid | Live pilots | New recurring | Active recurring | Revenue | Variable | Acquisition | Net, no founder | Cumulative, no founder | Cumulative, with founder |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 300 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 450 | -1,190 | -1,190 | -7,190 |
| 2 | 0 | 1.44 | 0.00 | 0.00 | 0.00 | 143 | 0 | 0 | -597 | -1,787 | -13,787 |
| 3 | 300 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 450 | -1,190 | -2,977 | -20,977 |
| 4 | 300 | 1.44 | 0.00 | 0.00 | 0.00 | 143 | 0 | 450 | -1,047 | -4,025 | -28,025 |
| 5 | 300 | 1.44 | 4.32 | 0.00 | 0.00 | 143 | 137 | 450 | -1,184 | -5,209 | -35,209 |
| 6 | 300 | 1.44 | 1.44 | 3.24 | 3.24 | 625 | 148 | 450 | -713 | -5,922 | -41,922 |
| 7 | 300 | 1.44 | 1.44 | 1.08 | 4.22 | 772 | 179 | 450 | -597 | -6,519 | -48,519 |
| 8 | 300 | 1.44 | 1.44 | 1.08 | 5.18 | 914 | 209 | 450 | -485 | -7,004 | -55,004 |
| 9 | 300 | 1.44 | 1.44 | 1.08 | 6.10 | 1,052 | 238 | 450 | -377 | -7,381 | -61,381 |
| 10 | 300 | 1.44 | 1.44 | 1.08 | 7.00 | 1,185 | 267 | 450 | -272 | -7,653 | -67,653 |
| 11 | 300 | 1.44 | 1.44 | 1.08 | 7.87 | 1,315 | 294 | 450 | -169 | -7,822 | -73,822 |
| 12 | 300 | 1.44 | 1.44 | 1.08 | 8.71 | 1,441 | 321 | 450 | -70 | -7,893 | -79,893 |

- **Cash trough, base:** CAD -7,893 without founder compensation at month 12 (monthly net turns positive in month 13, +26); CAD -79,893 with founder compensation at month 12 and still falling.
- **Downside case** (same recurrence, downside inputs): active recurring 2.70 at month 12; month-12 net -972; cumulative **-12,510 without founder, -84,510 with founder**, still falling.
- Not in the table: the build. If developers are unpaid co-founders it is not cash; if contracted at the model's CAD 100 per hour it is CAD 30,700-42,700 (307-427 hours) in months 2-5, against the brief's CAD 14,000 `[C]`. Who builds and at what cost is a missing input.
- The table needs 3,300 distinct prospects in 12 months, more than a BC-only list can plausibly hold ([section 8](#8-funnel-from-distinct-reachable-prospects)); months 3-12 are therefore conditional on markets outside BC, whose emergency-repair rules this repository has not read.
- Buyers who pay in month 2 wait about three months for the live product. That wait is an unpriced refund and cancellation risk `[A]`.

### 7.6 What would have to be true (thresholds, not forecasts)

| Target | Requirement at base prices and costs |
|---|---|
| 8 concurrent accounts | 0.24 new recurring accounts a month to hold 8 against churn; about 2,223 distinct prospects to acquire 8 at 0.36% each. |
| 65 concurrent accounts | 1.95 new recurring accounts a month, i.e. 1.81 times the base rate from the same 300 contacts, and about 18,056 distinct prospects at the base rate. |
| 65 accounts from a 600-firm pool `[A]` | Contact-to-recurring conversion of at least 10.8% (65 / 600), about 30 times the assumed 0.36%, before churn. |

## 8. Funnel from distinct reachable prospects

- **Distinct reachable prospects: unknown.** The BCFSA register search page was opened and offers a "Rental Property Management" service filter and a brokerage business-type filter, with no count and no bulk download `[S: SRC-15]`. The BCFSA licensing statistics page returned HTTP 403/404 on 2026-11-10. A search-result snippet (not opened, secondary) reports 1,552 brokerages at 2022-03-31 across all categories, including branch offices. The number licensed for rental property management and managing 20-150 doors is not published anywhere that was reached; door counts are not on the register at all and must be asked on the first call.
- Task T-0.1.1 counts the list by running the register search and deduplicating by licence number, then adds LandlordBC, PAMA and Google Maps listings `[C]` (those directories were not opened).
- Funnel per 300 distinct contacts `[C rates]`: 300 → 18 replies → 7.2 meetings or hand tests → 1.44 paid pilots → 1.08 recurring accounts `[A: 75%]`. The chat's line "300 → 18 → 7 demos → 1-2 customers" `[C]` is the same arithmetic rounded.
- Per distinct prospect: 0.06 x 0.40 x 0.20 x 0.75 = 0.0036. A pool of 600 `[A]` yields 2.16 recurring accounts in total; a pool of 1,552 (every BC brokerage of any kind) yields 5.59. **Neither reaches 8.**
- Internal inconsistency in the brief (GAP-07): its weekly plan targets 2 pilots in week 3 and 2 paying customers in week 4, while its funnel yields 1.44 pilots per 300 contacts over a 21-day cycle. The funnel is used.

## 9. Stop rule

### 9.1 The chat's rule, exactly as stated

- Chat `[C]` (owner's chat, translated): stop when their existing software gives this same feature for free.
- Research record `[C]`: "Stop if fewer than 2 paid pilots after 300 contacts and 10 demos, or if prospects say their PM software vendor already gave them this at no cost."
- Research invalidation `[C]`: "Ten interviews in which most managers say intake takes under 2 hours a month or that they would not pay CAD 99."

### 9.2 Checks on the stated rule

| Check | Result (binomial, all assumed rates true) |
|---|---|
| Expected paid pilots after 300 contacts | 1.44; per-contact probability 0.0048 |
| P(fewer than 2 paid pilots in 300 contacts) | 0.2361 + 0.3416 = **0.578** |
| P(at least 10 demos from 300 contacts) | 0.188; expected demos are 7.2, so "300 contacts and 10 demos" is usually not reached with one batch |
| P(fewer than 2 pilots from exactly 10 demos at 20%) | 0.376 |
| Time | 300 contacts take 4 weeks; the last contacts close 21 days later; the rule cannot be read before week 7 |
| "Free from their existing software" | No threshold, sample or question wording is given |

The stated rule would stop a product whose assumptions are all true more often than not.

### 9.3 Proposed revision `[P]` — a change to the chat's rule, not a restatement

The funnel delivers an expected 7.2 discovery conversations per batch, not 10, so the interview gates below use every completed gate interview (meetings, hand-test follow-ups and answered day-3 phone calls in which the three gate questions were asked) with a minimum of 6, and thresholds as shares. P(at least 6 meetings from 300 contacts) = 0.727; answered phone calls can only raise that, by an unknown amount `[A]`.

| Gate | Evidence | Decision | Error rates (binomial) |
|---|---|---|---|
| G-interview | All completed gate interviews, minimum 6 (T-0.1.3) | Stop if 60% or more say intake takes under 2 hours a month or they would not pay CAD 99 `[C wording, P threshold]`: 4 of 6, 5 of 7, 6 of 10. The brief's roadmap gate "at least 6 of 10 say intake costs them 5+ hours a month" `[C]` is recorded as a second reading, not a stop (GAP-11). | False stop if the true share is 30%: 0.070 (n=6), 0.029 (n=7), 0.047 (n=10). Missed stop if the true share is 70%: 0.256, 0.353, 0.150. |
| G-incumbent | Same interviews, question "Does your current software already triage after-hours repair messages at no extra cost?" | Stop if 50% or more answer yes `[P]`: 3 of 6, 4 of 7, 5 of 10. This makes the chat's rule countable. Re-ask in every later batch. | False stop if the true share is 20%: 0.099, 0.033, 0.033. Missed stop if the true share is 60%: 0.179, 0.290, 0.166. |
| G-build | End of batch 1 plus 21 days (week 7) | Start the build only with at least 1 paid pilot invoice paid and G-interview and G-incumbent decided and passed. Fewer than 6 interviews, or no paid pilot: undecided, run batch 2 first and read again at week 11. The brief's roadmap gate "at least 2 paid or card-on-file pilots" `[C]` is not used because P(at least 2 from 300) is 0.422 (GAP-11). | P(decidable and at least 1 paid pilot after batch 1) = 0.604 if all rates are true and the interview gates pass; P(at least 1 paid pilot) alone is 0.764. So about 40% of the time the build decision waits for batch 2 and the ramp in section 7.5 slips by two months. |
| G-product | 600 distinct contacts plus 21 days | Stop if fewer than 2 paid pilots. | Expected 2.88; false-stop probability 0.217 (0.070 at 900 contacts). |
| G-safety | Any live pilot | Stop onboarding new accounts on any missed urgent case (SM-01) until its cause is fixed and replayed (roadmap gate "zero missed emergencies" `[C]`). | — |
| G-channel | Batch 1 | Drop cold email as first channel if replies are under 3% (fewer than 9 of 300) and move to phone-first `[P]`. | P = 0.006 if 6% is true. |

## 10. Go-to-market plan

Uses the same inputs as sections 7 and 8: 300 distinct contacts per 4-week batch (75 a week), 6% / 40% / 20% / 75%, 21-day cycle, CAC 416.67.

### 10.1 Ideal customer profile
BC brokerage licensed for rental property management, 20-150 residential doors, 1-8 staff, no dedicated maintenance coordinator, requests arriving by text or email, owner personally takes after-hours calls `[C]`. Triggers `[C]`: an administrator quits, a missed emergency causes an owner complaint, the portfolio passes about 60 doors, heating season starts (the proposed start date falls in it). Disqualifiers `[P]`: under 20 doors; a staffed call centre or contracted answering service the firm is happy with; a suite that already triages after hours at no extra cost (G-incumbent); strata-only or commercial-only portfolios; no one able to name two on-call people.

### 10.2 Named roles
Feels the pain: owner or property manager who answers after hours. Signs and pays: managing broker. Can block: the managing broker's compliance view of tenant personal information (BC PIPA), and the property owner-clients if their management agreements restrict subcontracting `[A]`. Supplies sample data: office administrator (three anonymised requests; later unit, vendor and on-call lists).

### 10.3 Prospect list
Sources `[C]`: BCFSA register search (rental property management), LandlordBC directory, PAMA member list, Google Maps for Metro Vancouver, Victoria and Kelowna. Count: unknown (section 8). Build: T-0.1.1 records licence number, brokerage name, city, public office phone and email, source and date; deduplicates by licence number; drops strata-only firms; door count stays blank until the first call. Check: 20 random rows re-verified against the register before sending. Lead cost about CAD 60 per 100 prospects `[C]`, treated as inside the CAD 150 tooling line.

### 10.4 Channel and sequence
First channel: cold email plus phone `[C]`. Steps: day 0 email; day 3 mid-morning call to the office line asking who handles repair calls after 5 pm `[C]`; day 7 follow-up email offering the three-request test; day 14 last call. Volume: 75 new firms a week, 300 per batch, 70 founder hours per batch `[C]`. Canadian anti-spam law prohibits a commercial electronic message without express or implied consent and requires sender identification, contact information and an unsubscribe mechanism `[S: SRC-14, s.6(1)-(2)]`; the basis for implied consent for each address is recorded in the list (legal basis not reviewed by counsel `[A]`). The brief's other approaches `[C]` — LinkedIn connect and follow-up messages, partners (LandlordBC, PAMA, plumbing and restoration contractors, Buildium or DoorLoop consultants) and a referral month — are kept as later channels and are not in the first batch or in these numbers (GAP-11).

### 10.5 Message (synthetic)

First touch:

> Subject: after-hours repair texts at Example Coast Rentals
>
> Hi Dana, I am a Vancouver developer building a tool for BC rental managers under 150 doors. Tenants keep texting or emailing; every message gets an immediate reply telling them to call 911 for danger, emergencies page whoever is on call until a person answers, and the rest become work orders with a drafted vendor message for your approval. Nothing changes in your current software.
> Send me three recent requests with names removed and I will return them as finished work orders, free. If that is useful, the pilot is 30 days for CAD 99, refunded if fewer than 80% are categorised correctly by your own review. You would provide your unit list, on-call numbers and vendor list.
> Sam Example, FixTriage, 000 Example St, Vancouver BC. Reply "no thanks" and I will not write again.

Follow-up (day 7):

> Hi Dana, one question instead of a pitch: who picked up the last repair call that came in after 9 pm, and how long did it take to reach a vendor? If you send three anonymised requests I will return work orders by tomorrow 10:00. Reply "no thanks" to stop.

### 10.6 Pilot offer and conversion
As in section 5: CAD 99, 30 live days, whole portfolio, refund under 80% of marked requests correct (unclear ones count against us) or on any missed urgent case, order form and payment method by day 30, first recurring invoice day 31.

### 10.7 Objections

| Objection | Honest answer |
|---|---|
| "My software already has work orders" (Buildium, DoorLoop, AppFolio) `[C]` | It stores them; this fills them in from raw messages and exports CSV. If your suite's agent already answers tenant texts after hours at no extra cost (DoorLoop lists one on Connect `[S: SRC-06]`), you should not buy this, and we want to know. |
| "What if it misses an emergency?" `[C]` | Every tenant gets a fixed 911 and gas-line reply that does not use AI. Keyword rules, not the model, decide the floor; anything unclear after hours pages you; paging continues up your chain until a person acknowledges. It has not been proven on live traffic yet; the pilot measures it and refunds on any miss. Not covered: a failure between the phone carriers and us that the provider does not report is caught only by a platform-wide test every 6 hours (up to 6 hours 5 minutes), and a fault that affects only one account's own number is not tested at all (MH-16); in both cases your tenants' emergency phone number is unchanged and is on every reply they have had. The pilot agreement says this in the same words. |
| "Property Meld / an answering service does this" | Property Meld is USD 200 a month minimum and says it works best at 100+ doors `[S: SRC-04]`. An answering service gives a human voice, which this does not; if tenants mostly phone rather than text, keep the service. |

### 10.8 First 30, 60 and 90 days (expected values; matches the ramp table)

| Point | Weekly activity | Cumulative contacts | Replies | Calls / hand tests | Paid pilots | Recurring accounts | Cash out (cumulative, no founder) | Founder hours |
|---|---|---|---|---|---|---|---|---|
| Day 30 (month 1) | 75 new firms, 20 calls, 2 hand tests a week | 300 | 18 | 7.2 | 0 paid yet (1.44 expected to pay in month 2) | 0 | 450 + 740 = 1,190 | 76-98 (first batch includes one-off fixture work) |
| Day 60 (month 2) | No new outreach; pilot agreements, G-build at week 7, rule confirmation with pilot buyers, Mode H, privacy pack | 300 | 18 | 7.2 | 1.44 paid, none live | 0 | 1,787 net of 143 pilot fees | 40 `[A]` |
| Day 90 (month 3) | 75 new firms a week; batch 1 buyers in Mode H; build under way | 600 | 36 | 14.4 | 1.44 paid (2.88 expected by month 4), none live before month 5 | 0 (3.24 expected in month 6) | 2,977 | 64-82 |

### 10.9 GTM stop rule
Gates G-interview, G-incumbent, G-build, G-product and G-channel in section 9.3, with the probabilities shown there.

## 11. What buyer evidence would change the decision

| Evidence | Effect |
|---|---|
| 5 of 10 calls report a no-cost incumbent after-hours agent | Stop (chat's rule). |
| Median reported intake under 2 hours a month or refusal of CAD 99 | Stop (research invalidation). |
| Paid pilots at 3 times the assumed rate (4 or more from 300) | Proceed; re-run section 7 with measured rates. |
| Buyers say tenants phone rather than text after hours | Voice intake becomes the product; this plan's MVP is the wrong one. Re-plan. |
| Buyers will not name two on-call people | The escalation design cannot be met; do not go live for that account. |
| A missed urgent case in a live pilot | G-safety. |
| Buyers refuse US-processed AI on tenant messages | Needs a Canadian-region model route (not verified to exist); see GAP-08. |

## 12. Missing inputs and departures from the brief

| ID | Item |
|---|---|
| GAP-01 | CAC 400 `[C]` replaced by 416.67, which depends on the `[A]` 75% conversion; bounds 312.50 and 625.00 (section 7.2). |
| GAP-02 | ARPU 149 is not a tier; reconciled as a 50/50 Starter/Pro mix `[P]`. The brief's benefit example compares a 100-door firm with a CAD 149 fee; its tier price is CAD 199. |
| GAP-03 | DoorLoop: the brief's "invite-only Multiply" claim is verified (page re-opened in fix round 1; an earlier statement here that it was not found was wrong). Addition: a Receptionist Agent on the Connect plan answers tenant texts and calls around the clock and is not in the brief. |
| GAP-04 | Buildium lists AI and contact-centre items; the brief's "no AI triage agent shown" is not supported as written. |
| GAP-05 | Free 14-day trial (pricing record) conflicts with the paid pilot (chat); paid pilot used. |
| GAP-06 | Build estimate 140 hours / 18 days `[C]` against this plan's 307-427 hours (286-397 before the scope added in fix round 1 was estimated), all of which precede the first live account. |
| GAP-07 | Weekly plan targets (2 paying customers by week 4) exceed the funnel (1.44 pilots per batch, 21-day cycle, first live account in month 5). |
| GAP-08 | "Canadian data residency as a selling point" `[C]`: storage can be in Canada, but the provider's own API offers only "global" or "us" inference geography `[S: SRC-19]`. The same page says partner platforms offer regional endpoints (for example Amazon Bedrock regional routing at a 10% premium); whether the chosen model is offered in AWS ca-central-1, where AD-06 hosts the application, was not verified. Until it is, tenant messages sent for classification leave Canada and residency is not claimed. |
| GAP-09 | The brief's emergency list is "no heat, flooding, gas smell"; the rule set here follows s.33(1) and adds fire, smoke, carbon monoxide and after-hours lockouts. |
| GAP-10 | Break-even 7 (63) `[C]` becomes 8 (65), margin 80% becomes 78.8%, payback 3.35 becomes 3.55 months, after adding CAD 2 of messaging (pages, weekly test pages) and CAD 40 of fixed monitoring cost that the brief's cost notes omit. |
| GAP-11 | Brief items used differently or not used: roadmap gate "6 of 10 say 5+ hours a month" (recorded, not a stop); roadmap gate "2 paid or card-on-file pilots" (replaced by G-build); roadmap gate "90 percent correct trade and urgency" (used, TRD 8.5); roadmap gate "2 customers paying CAD 99 or more and zero missed emergencies" (zero misses used as G-safety; 2 paying by week 4 not achievable, GAP-07); LinkedIn, partner and referral approaches (later channels); "Twilio SMS and voice transcription" in the suggested stack (voice intake is a non-goal for the MVP; calls are forwarded, MH-16); magic-link sign-in (replaced, AD-07). |
| GAP-12 | The refund base is all marked requests with `uncertain` counted as not correct. An earlier draft excluded `uncertain`; that narrowing of the chat's offer was removed. |
| Missing | Count of qualifying firms; measured reply, meeting, close and conversion rates; share of after-hours requests arriving by phone call; who builds and at what cost; the second Level 4 person (EP-5); tax treatment (GST/PST); whether management agreements permit a subprocessor; baseline after-hours response times; Twilio carrier-fee column mapping; external monitoring price; legal review of CASL and PIPA positions, including safety messages after `STOP`. |

## 13. Sources and assumptions

All consulted 2026-11-10. "Opened" means the page text was read by the author; restrictions are stated.

| ID | Source | Jurisdiction | Scope used | Access |
|---|---|---|---|---|
| SRC-01 | Residential Tenancy Act, SBC 2002 c.78, https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02078_01 | BC | s.29(1)(f) emergency entry; s.32 repair duty; s.33 emergency repairs (full text read) | Opened |
| SRC-02 | BC Government, Repairs and maintenance, https://www2.gov.bc.ca/gov/content/housing-tenancy/residential-tenancies/during-a-tenancy/repairs-and-maintenance | BC | Plain-language emergency repair steps | Opened |
| SRC-03 | Personal Information Protection Act, SBC 2003 c.63, https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/03063_01 | BC | ss.4, 5, 6, 8, 10, 18(1)(k), 23, 24, 29, 34, 35; the phrase "outside Canada" does not occur in the Act text | Opened |
| SRC-04 | Property Meld pricing, https://propertymeld.com/pricing/ | US vendor | Ops price, minimum, On-Call add-on, 100+ doors statement; currency symbol "$" only | Opened |
| SRC-05 | AppFolio pricing, https://www.appfolio.com/pricing | US vendor | Plan starting prices, 50-unit minimum, feature names | Opened; minimum spend not published |
| SRC-06 | DoorLoop pricing, https://www.doorloop.com/pricing | US vendor | Plan prices, agent names, "INVITE ONLY" label above Multiply | Opened twice; first reading was truncated, second by direct download |
| SRC-07 | Buildium pricing, https://www.buildium.com/pricing/ | US vendor | Starting prices, feature names | Opened; plan-feature mapping not readable |
| SRC-08 | Vendoroo plans, https://vendoroo.ai/plans | US vendor | Plan and add-on names; no prices | Opened |
| SRC-09 | Twilio Canada SMS guidelines, https://www.twilio.com/en-us/guidelines/ca/sms | Canada | Sender types; toll-free "requires verification"; short code 12-16 weeks; alphanumeric not supported; strict carrier filtering of A2P; opt-in, HELP/STOP | Opened |
| SRC-10 | Twilio SMS pricing Canada, https://www.twilio.com/en-us/sms/pricing/ca | Canada | Per-segment and number prices; carrier fees (column mapping unclear); failed-message fee | Opened; currency not named on page |
| SRC-11 | Twilio error 30032, https://www.twilio.com/docs/api/errors/30032 | US and Canada | Unverified toll-free traffic to US and Canada blocked since 2024-01-31 | Opened |
| SRC-12 | Twilio A2P 10DLC overview, https://www.twilio.com/docs/messaging/compliance/a2p-10dlc | US | Registration regime for US long-code traffic; Canada appears only as a tax-ID type | Opened |
| SRC-13 | FortisBC, Gas leaks and odour, https://www.fortisbc.com/safety-outages/natural-gas-safety/gas-leaks-and-odour | BC | Go outside, then call 1-800-663-9911 (24 hours) or 911 | Opened |
| SRC-14 | An Act to promote the efficiency and adaptability of the Canadian economy… (CASL), S.C. 2010 c.23, https://laws-lois.justice.gc.ca/eng/acts/E-1.6/page-1.html and page-2.html | Canada | s.6(1), (2), (6); s.11(1), (3) (unsubscribe given effect without delay, at most 10 business days) | Opened; regulations not read |
| SRC-15 | BCFSA Find a Professional, https://www.bcfsa.ca/public-resources/real-estate/find-professional | BC | Search filters; "unofficial search" notice | Opened by direct download; statistics page blocked (403/404); terms of use not read |
| SRC-16 | OWASP ASVS 5.0.0 (English CSV, tag v5.0.0), https://github.com/OWASP/ASVS | — | Requirement texts cited in TRD and verification file | Opened |
| SRC-17 | WCAG 2.2, https://www.w3.org/TR/WCAG22/ | — | Success criteria cited in design.md | Opened |
| SRC-18 | Postmark pricing, https://postmarkapp.com/pricing | US vendor | Inbound processing on Pro (USD 16.50) and Platform plans | Opened |
| SRC-19 | Anthropic pricing, https://platform.claude.com/docs/en/about-claude/pricing | US vendor | Haiku 4.5 USD 1 / 5 and Haiku 5.5 USD 0.10 / 0.50 per million tokens; inference geography "global" or "us" | Opened |
| SRC-21 | Twilio error 21610 and Advanced Opt-Out, https://www.twilio.com/docs/api/errors/21610 and https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out | Provider | After an opt-out keyword the number is added to a block list and later outgoing messages fail with 21610 until the subscriber sends START; "stop" cannot be removed as a keyword | Opened |
| SRC-22 | Twilio voice pricing Canada, https://www.twilio.com/en-us/voice/pricing/ca | Canada | Outbound local call USD 0.0140 per minute; inbound local USD 0.0085 per minute | Opened; currency not named on page |
| SRC-20 | sfailabs guide (Vendoroo, Latchel price ranges) | — | Secondary claim in brief | **Not opened** |
| SRC-23 | BC Government news release 2026AG0013-000209, 2 March 2026 (permanent Pacific Time) | BC | Clocks moved ahead on 8 March 2026 for the last time and did not fall back on 1 November 2026; Pacific Time is UTC-7 all year; East Kootenay and Golden keep changing clocks with Alberta (America/Edmonton). Used for business hours (TRD 12, B1-008) | Opened by the independent code reviewer on 2026-11-11 (review fixtriage-b1-round1.md); **not re-opened by the developer**. Agrees with tzdata 2026e |
| — | LandlordBC and PAMA directories; Twilio toll-free verification duration ("3-5 business days", search snippet); BCFSA brokerage count snippet | — | — | **Not opened; unverified** |

Assumptions preserved from the brief: every unit-economics input, the 3-5 requests per 10 doors, the 12 minutes saved, the CAD 250 call-out, the CAD 35 hourly rate, all funnel rates, the 1.38 exchange rate. None is a finding.
