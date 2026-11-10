# Design brief — FixTriage

Screens: [App-flow.md](App-flow.md). Rules: [PRD section 7](PRD.md#7-product-rules-canonical-other-files-cite-these-ids). Everything here is a proposal `[P]`; no screen exists and no accessibility conformance is claimed.

## 1. Who is looking, and when

Two situations drive every choice: an owner at a desk at 9 am clearing fifteen routine requests, and the same owner at 2:10 am on a phone with one eye open. The second one decides the design.

## 2. Design decisions

| ID | Decision | Why |
|---|---|---|
| DD-01 | Urgency is always a word plus a shape plus a colour, never colour alone | 2 am legibility; WCAG 1.4.1 |
| DD-02 | One primary action per screen, at the bottom on phones, full width, at least 48 px high | Thumb reach; the acknowledge page has exactly one button |
| DD-03 | What the system decided and why are shown side by side with the tenant's own words; the rule hit and the model proposal are separate, labelled lines | The reviewer must be able to disagree with either |
| DD-04 | Draft, approved and sent are three visibly different states with a text banner; a draft has a dashed outline and the word "Draft — not sent" | No one should believe a vendor was told when it was not |
| DD-05 | Timelines show absolute time and elapsed time, from server timestamps | A countdown must survive refresh and not lie |
| DD-06 | Nothing destructive or external happens from a list row; it happens on a review step | FD-1 |
| DD-07 | The acknowledge page shows the least data needed to decide to get up | Capability link, TRD 8.1 |
| DD-08 | Failures are sorted above successes everywhere | SM-05 |

## 3. Visual system

- Layout: single column up to 720 px for S-04..S-08; S-03 and S-12 use a list with a detail pane from 1024 px. Left navigation from 1024 px, bottom navigation below. Reflows to 320 px with no horizontal scrolling except the S-09 week grid, which becomes a per-day list.
- Type: system font stack; 16 px base, 20 px for tenant message text, 14 px minimum for metadata; line height 1.5; numerals tabular in timelines.
- Colour (text and background pairs to be contrast-checked at build, target at least 4.5:1 for text and 3:1 for control boundaries): ink `#1B1F24` on paper `#FFFFFF`; `life_safety` `#B42318`; `urgent` `#B54708`; `uncertain` `#6941C6`; `routine` `#344054`; success `#067647`; focus ring `#1570EF`, 3 px, offset 2 px. Dark theme deferred.
- Tier chips: `life_safety` octagon icon + "Life safety"; `urgent` triangle + "Urgent"; `uncertain` question mark in circle + "Not sure — needs a person"; `routine` circle + "Routine".
- Components: tier chip; state banner; timeline row (icon, actor, channel, delivery state, time); evidence card (original message, photo strip, translation toggle); decision panel; review step (sheet with summary and confirm); coverage bar; per-row result list; global channel banner; toast for non-critical confirmations only.
- Feedback: every mutation shows pending on the control itself, then a state banner change; failures stay on screen until dismissed.

## 4. Principal screens (enough to sketch)

**S-03 Inbox.** Top: global banner slot. Then stacked sections with counts: "Active incidents (1)" on a tinted band, each row with tier chip, "Maple Court, units 204 and 304", "3 reports", "Paging Level 2 — 6 min" or "Vendor did not confirm — paging Dana", and a single "Open" button. "Needs triage (2)" rows show a countdown "pages Dana in 11 min". Routine rows are denser: chip, unit, first line, age, state. Filters collapse into one "Filter" button on phones.

**S-05 Incident.** Header: tier chip, address, "Received 02:10 — 6 min ago". Sticky bottom bar: "I have this" (before acknowledgement) or "Record outcome" (after). Body: (1) reports, newest first, each an evidence card; (2) timeline: "02:10 Text and call to Dana (Level 1) — text undelivered, call not answered", "02:15 Text and call to Lee (Level 2) — delivered, ringing", "Next: owner at 02:20"; (3) messages sent to the tenant.

**S-06 Acknowledge link.** White page, no navigation. "Urgent: no heat. 1200 Example St. Received 02:10. 2 reports." One button "I have this". Below: "Sign in for details". After the tap: "Recorded 02:16. Please record what you did within 30 minutes."

**S-07 Work order.** State banner at top. Two stacked cards: "Job" (unit, trade, tier, summary, access notes, photos with checkboxes "send to vendor") and "Message to vendor" (recipient selector in preferred order, editable text, character and segment count). Primary button "Review and send". The review step repeats recipient, number and text in a bordered block with "Send to Northside Plumbing (synthetic) at 604-555-0142" and "Back to edit".

**S-09 On-call.** Coverage bar for 14 days above the grid, gaps hatched and labelled in text. Each person row ends with "Test page: acknowledged 3 days ago" or "Test page failed — fix now".

**S-12 Review.** Three tabs as links: "Last night", "To review", "Report". "Last night" rows have two large buttons "Was urgent" and "Was routine". The report shows "Marked correct: 41 of 52 marked (79%). Includes 5 the system was not sure about, counted as not correct. Minimum for the pilot test: 20 marked."

## 5. Microcopy

| Situation | Text |
|---|---|
| Pending operation (S-07) | "Sending to Northside Plumbing… We will show Delivered here when their carrier confirms. You can leave this page." |
| Recoverable error (S-07) | "The text to Northside Plumbing was not delivered (carrier rejected it at 02:24). Nothing else has been sent. Send to the next vendor, or phone 604-555-0142 and note it here." |
| Human approval (S-07 review step) | "You are about to text Northside Plumbing. They will see the address, unit 204 and 2 photos. This cannot be recalled. — Send — Back to edit" |
| Downgrade (S-05) | "Mark as not urgent? Paging will stop. Your reason is recorded and shown in tomorrow's review." |
| Safety reply to tenant, business hours (fixed template, MH-02) | "Example Coast Rentals maintenance (automated). If there is fire, smoke or anyone is in danger, call 911 now. If you smell gas, go outside, then call FortisBC 1-800-663-9911 or 911. Emergency repair phone: 604-555-0100." |
| Safety reply, after hours (chosen by the clock only, EP-10) | Same text plus: "Our office is closed. If this cannot wait, reply URGENT or phone 604-555-0100." |
| Second message, once per sender (MH-15) | "We use your message to arrange repairs. Questions: office 604-555-0100. Reply STOP to stop texts from this number. If you stop them we cannot text you safety information; phone instead." |
| Opt-out confirmation (provider-sent at STOP, wording to be confirmed in T-1.1.4, FD-7) | "You will get no more texts from Example Coast Rentals maintenance. In danger call 911. Emergency repair phone: 604-555-0100. Reply START to resume." |
| Cannot be texted (S-04, S-03) | "This tenant stopped texts on 3 March. They have not received a safety reply by text. Phone 604-555-0177 now, then mark 'I phoned them'." |
| Unacknowledged at 15 minutes (EP-6) | "We are still trying to reach the on-call manager. If anyone is in danger call 911. You can also phone 604-555-0100." |
| Channel banner (S-15) | "Text intake may be delayed since 02:05. Tenants can still phone 604-555-0100. We are working on it." |

Tenant-facing templates are owned by the operator, versioned, and never rewritten or selected by a model: the only selectors are the clock, the sender's history and rule hits. They do not promise an arrival time or a handling date, do not call the text number an emergency line, and give no advice beyond these lines `[C]`.

## 6. Evidence, correction, drafts

- Inspect source evidence: the evidence card always shows the tenant's original text and photos; a translation is an overlay with "Show original". The decision panel lists "Rule: primary-heating v1 matched 'no heat'" and "Model proposed: urgent, heating, unit 204 (confidence 0.82)" on separate lines, plus rule-set and model versions under "Details".
- Correct a suggestion: each of trade, tier and unit has an inline "Change" control. The old value stays visible, struck through with the editor's name. Lowering a tier opens the reason field first.
- Draft versus approved: banner text and outline (DD-04); a sent message is shown read-only as sent, with delivery state; later edits create a new draft, never alter the sent record.

## 7. Accessibility mapping (WCAG 2.2 `[S: SRC-17]`; targets, to be tested, not met claims)

| Criterion | Screens | Manual check |
|---|---|---|
| 1.4.1 Use of Color | S-03, S-05 tier chips; S-09 gaps | View in greyscale: tier and gaps still identifiable from text and shape |
| 1.4.3 Contrast (Minimum), 1.4.11 Non-text Contrast | All; chips, focus ring, coverage bar | Measure each pair in section 3 |
| 1.4.10 Reflow | S-05, S-06, S-07 | 320 px wide: no two-direction scrolling; primary action visible |
| 1.3.1 Info and Relationships | S-05 timeline, S-09 grid, result lists | Screen reader reads timeline as a list in time order; grid has row and column headers |
| 2.1.1 Keyboard | All, including review step, photo strip, S-09 grid | Complete "urgent after hours" path (App-flow section 7) with keyboard only |
| 2.4.3 Focus Order, 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured (Minimum) | Review step, sticky bottom bar | Opening the review step moves focus into it; closing returns it to the trigger; the sticky bar never covers the focused control |
| 2.5.8 Target Size (Minimum) | S-06, S-12 buttons, row actions | Targets at least 24 by 24 CSS px; primary actions 48 px |
| 2.5.7 Dragging Movements | S-10 vendor order, S-09 shifts | Order and shifts can be changed with buttons and form fields; no action needs a drag |
| 3.2.6 Consistent Help | All staff screens | The office and operator contact line sits in the same place in the footer on every screen |
| 2.2.1 Timing Adjustable | S-05 countdowns, session timeout | Countdowns are informational (the escalation is a real-time event); session expiry warns and lets the user extend |
| 3.3.1 Error Identification, 3.3.3 Error Suggestion | S-01, S-04 reason, S-09 gap, imports | After a failed save, focus is on the error summary; each error names the field and the fix |
| 3.3.4 Error Prevention | S-07 send, S-14 delete, merge | Review step or undo exists for each |
| 3.3.8 Accessible Authentication (Minimum) | S-01 | Password managers and paste work in both fields; no puzzle |
| 4.1.3 Status Messages | S-03 new rows, S-05 timeline, S-06 confirmation, S-07 delivery state, S-13 export | Screen reader announces "New urgent incident", "Delivered", "Export ready" without moving focus; urgent changes use an assertive region, others polite |
| 1.1.1 Non-text Content | Tenant photos | Each photo has "Photo 1 of 2 from tenant" plus the model's description labelled as machine-generated |

**Known gaps, not met:** a deaf or hard-of-hearing on-call person cannot use the voice page and depends on the SMS link alone; tenant-facing SMS is English only at launch apart from the lexicon; machine-generated photo descriptions may be wrong; the S-09 week grid on small screens is replaced, not adapted. No automated or assistive-technology test has been run.
