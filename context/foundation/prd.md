---
project: "PaperTrail"
version: 1
status: draft
created: 2026-08-14
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-09-04
  after_hours_only: true
---

# PaperTrail — Product Requirements

## Vision & Problem Statement

People who track their personal finances in a self-built spreadsheet abandon it at the point of entry. The heavy Google Sheet in use today takes too many taps and screens to log a routine expense, so entries get skipped or batched; the sheet has sprawled across many tabs, its queries are hard to understand or change, and its visualizations are poor. The result is incomplete data and no usable insight into spending. Input friction is the primary pain — the one that alone justifies building this.

Three things the status quo and existing trackers get wrong. First, they impose their own category model and budgeting philosophy; here the categories and the filtering rules over them are fully user-defined. Second, day-to-day spending patterns stay invisible until large recurring costs (rent, car payments, subscriptions) are filtered out — existing tools bury this option or omit it, so their charts are dominated by fixed costs. Third, receipt parsing exists elsewhere, but parsing a receipt and assigning its line items into the *user's own* custom categories does not.

## User & Persona

Primary persona: an individual who already tracks personal expenses and incomes in a self-maintained spreadsheet, and who has enough of an opinion about their own spending to have defined custom categories for it.

- **Context**: manages their own money; not an accountant and not a spreadsheet-query specialist. Willing to log expenses daily, unwilling to fight the tool to do it.
- **The moment they reach for the product**: end of day — a single sit-down to log the day's spending, contextualized by the current day.
- **Scope**: individuals broadly, each with private data. Not a single-user tool and not a household/shared-pot tool.
- **Initial scale**: realistically a handful of users at first, but built multi-user as a real product from day one. The small initial count is a starting point, not the design target — this is what keeps FR-001 and FR-002 binding despite serving very few people on launch day.

## Success Criteria

Scope of the first shippable version: authenticated multi-user access, user-defined custom categories, streamlined day-contextualized entry of expenses and incomes (with back-dating), quick-select date-range visualization, category-distribution visualization, a filter that excludes large recurring costs, and receipt upload with automatic parsing that assigns line items to the user's own categories.

### Primary
- The Google Sheet is retired: 30 consecutive days with no use of it for expense or income tracking.

### Secondary
- A majority of receipt line items land in the correct custom category without manual correction.

### Guardrails
- Strict data isolation: no user's financial data is ever visible to another user.
- No silent bad writes: parsed receipt data is never persisted without explicit user confirmation.
- Durability: a logged expense is never silently lost on crash, refresh, or connection drop.

## User Stories

### US-01: User logs an expense at the end of the day

- **Given** an authenticated user with at least one custom category defined
- **When** they open the app and log a routine expense
- **Then** the entry is saved against the current day without requiring a date selection

#### Acceptance Criteria
- The current day is the default date; same-day entry requires no date interaction.
- Logging an expense against a recent past day is a first-class path, not a buried one — missed days are the normal case.
- Once confirmed, the entry is durable — never silently lost on crash, refresh, or connection drop.
- Logging one routine expense takes no more than 4 interactions and no more than 10 seconds, measured from app open to saved entry.

### US-02: User logs expenses by photographing a receipt

- **Given** an authenticated user with custom categories defined
- **When** they upload a receipt image
- **Then** they are shown parsed line items pre-assigned to their own categories, for review before anything is persisted

#### Acceptance Criteria
- No parsed line item is persisted before explicit user confirmation.
- Every parsed line item's category and amount can be corrected during review.
- Parsing assigns into the user's own category list, not a generic taxonomy.
- If parsing fails or returns nothing usable, the user can still fall back to manual entry.

## Functional Requirements

Each FR carries a `> Socrates:` record from the shaping challenge round, where every requirement was tested against its strongest counter-argument. FR-003 was challenged and dropped; its number is retired rather than reused. FR-016 was created by splitting FR-013.

### Authentication & access
- FR-001: User can create an account and sign in. Priority: must-have
  > Socrates: Counter-argument considered: "auth is the largest chunk of a 3-week build and gates a product with one user on day one; a local-only v1 would test the friction thesis sooner." Resolution: kept. The multi-user persona ("individuals broadly, each with private data") makes accounts necessary; the cost is accepted.
- FR-002: User can read and write only their own financial data. Priority: must-have
  > Socrates: Challenged as a guardrail miscast as a feature (implementable and tickable, when it needs continuous enforcement). No counter-argument accepted — stands as written; the redundancy with the isolation guardrail is deliberate.

### Categories & recurring costs
- FR-004: User can define and manage their own expense categories. Priority: must-have
  > Socrates: Challenged on blank-slate onboarding, renames rewriting chart history, and foreclosing cross-user insight. No counter-argument accepted — stands as written; user-defined categories are one of the three product insights.
- FR-005: User can flag a category as a large recurring cost. Priority: must-have
  > Socrates: Challenged on forcing artificial category splits, conflating "large" with "recurring", and flag changes retroactively rewriting history. No counter-argument accepted — stands as written; per-category is the simplest mechanism and keeps entry fast.

### Daily entry
- FR-006: User can manually log an expense with amount, category, and date. Priority: must-have
  > Socrates: Challenged on mandatory categorization being friction at the exact moment friction is being removed, and on the absence of currency/payment-method losing information irrecoverably. No counter-argument accepted — stands as written.
- FR-007: User can log an expense for the current day in minimal interactions, and can back-date an entry to a recent past day as a first-class, low-friction path. Priority: must-have
  > Socrates: Counter-argument considered: "optimizing hard for today makes logging a missed day the awkward case, and missed days are what actually happens." Resolution: FR amended — today remains the zero-interaction default, but back-dating is explicitly first-class rather than an afterthought.
- FR-008: User can log an income. Priority: must-have
  > Socrates: Challenged on income having a different rhythm with no bearing on the daily-friction thesis, and on mixing signs through every aggregation. No counter-argument accepted — stands as written.
- FR-009: User can review, edit, and delete logged entries. Priority: must-have
  > Socrates: Challenged on irreversible deletion destroying the audit trail, edits silently rewriting past charts, and both paths threatening the durability guardrail. No counter-argument accepted — stands as written; uncorrectable errors would rebuild the distrust that killed the sheet.

### Receipt parsing
- FR-010: User can upload a receipt image for parsing. Priority: must-have
  > Socrates: Challenged on receipts being the most sensitive artifact in the product, on photography fitting the shopping trip rather than the end-of-day ritual, and on image handling being an invisible time sink. No counter-argument accepted — stands as written; receipt upload is the feature that makes this scope worth choosing.
- FR-011: User receives parsed line items pre-assigned to their own categories. Priority: must-have
  > Socrates: Counter-argument considered: "below a quality bar, auto-assignment is slower than typing, because reviewing a wrong guess costs more than entering a value." Resolution: kept. The quality bar is the Secondary success criterion — a majority of line items landing in the correct category without correction. Below that bar the feature is failing, not merely imperfect.
- FR-012: User can review, correct, and confirm parsed line items before they are saved. Priority: must-have
  > Socrates: Challenged on review of a long receipt costing more interaction than typing one total, and on restating a guardrail as a feature. No counter-argument accepted — stands as written; explicit confirmation is what makes probabilistic parsing safe for financial data.

### Visualization
- FR-013: User can view spending over quick-select date ranges (e.g. last week, last month, year-to-date). Priority: must-have
  > Socrates: Counter-argument considered: "a custom range picker is disproportionately hard to build for a need presets largely satisfy." Resolution: FR split — presets remain must-have here; custom range selection demoted to FR-016 (nice-to-have).
- FR-016: User can view spending over a custom date range. Priority: nice-to-have
  > Provenance: split out of FR-013 during the shaping challenge round. Explicitly non-binding for the MVP.
- FR-014: User can view spending distribution across their own categories, and the view remains readable regardless of how many categories are defined. Priority: must-have
  > Socrates: Counter-argument considered: "freely-defined categories produce a long tail of small slices that becomes noise exactly when there is enough data to care." Resolution: FR amended with a readability criterion. How readability is achieved is left to downstream design.
- FR-015: User can exclude large recurring costs from any view. Priority: must-have
  > Socrates: Challenged on whether exclusion should be the default view rather than a toggle, and on doubling the chart surface to design and test. No counter-argument accepted — stands as written; the user gets both views on demand.

## Non-Functional Requirements

- Logging one routine expense takes ≤ 4 interactions and ≤ 10 seconds end to end, measured from app open to saved entry. Any operation that cannot complete immediately shows continuous visible progress rather than an unexplained pause.
- An uploaded receipt image does not persist indefinitely: it is gone once its entries are confirmed, or after a bounded retention window, whichever comes first. `# TODO: retention window — see Open Questions`
- Receipt parsing either returns a result within a stated time or fails visibly, always leaving the user able to complete the entry manually. The user is never left waiting with no exit. `# TODO: parsing timeout — see Open Questions`
- Users are told within the product that receipt contents and their category names are sent outside the product for parsing. Disclosure is required; explicit opt-in is not — parsing is enabled by default.

## Business Logic

**PaperTrail decides which of the user's own categories each purchase on a receipt belongs to.**

The rule consumes two user-facing inputs: a photographed receipt, and the set of categories the user defined for themselves. Its output is a proposed set of line items, each assigned to exactly one of those categories, with an amount. The user encounters it as a pre-filled review — never as a silent write — where every proposed assignment and amount can be corrected before anything is persisted.

A second, subordinate rule partitions recorded spending into structural and discretionary cost using the user's per-category recurring flags, so that day-to-day spending can be viewed with large recurring costs removed (FR-005, FR-015). It is a real domain rule and remains in scope, but it is not the headline: classification is the decision that distinguishes this product.

## Access Control

Multi-user with private per-user data. A single role:

- **User** — signs up, signs in, and can read and write only their own expenses, incomes, and categories. No access to any other user's data.

There is **no in-app admin role**. An operator role was considered during shaping and dropped: it would have contradicted the strict-isolation guardrail, and operational support is handled outside the product rather than through an in-app surface at this user count.

Unauthenticated access to any expense or income data is disallowed. `# TODO: sign-in mechanism, and behavior when an unauthenticated user hits a gated route — see Open Questions`

## Non-Goals

**Functional non-goals**

- **AI financial analysis, insights, and proactive notifications** — excluded from the MVP. It also cannot produce useful output without historical data, which is itself a non-goal below.
- **Any in-app admin surface** — dropped during the shaping challenge round: it contradicted the strict-isolation guardrail, and operational support is handled outside the product at this user count.
- **Bulk import of historical Google Sheet data** — v1 starts empty. Consequence: quick-select date ranges (FR-013) have little to range over in the first weeks, and the sheet's history stays behind after it is retired.
- **Shared or household expenses** — no invitations, no shared pots, no "who paid". Follows from the persona decision and keeps the isolation model simple.
- **Bank or card account sync** — no automatic transaction import from financial institutions. The obvious scope creep for an expense tracker, and it would undercut the manual-entry thesis the product is built on.

**Non-functional non-goals**

- **No offline use** — the app requires a connection; there is no local-first or offline-queue guarantee.
- **No multi-currency** — all amounts are in a single currency. Surfaced as a counter-argument on FR-006 and deliberately allowed to stand.

## Open Questions

1. **Which sign-in mechanism?** — email + password, delegated/social sign-in, or passwordless. Owner: user. Deferrable to the downstream stack-selection step.
2. **What happens when an unauthenticated user hits a gated route?** — not specified. Owner: user. Low urgency.
3. **Numeric thresholds for two quantitative NFRs** — receipt-image retention window and parsing timeout are stated as properties without targets. Owner: user. Resolvable alongside the downstream stack step, since both depend on choices made there.
4. **What carries out the classification rule, and does its accuracy clear the Secondary bar?** — the headline domain rule is delegated outside the product, so the differentiator depends on a choice not yet made. Owner: user. Blocks: any confidence that FR-011 delivers value rather than costing time. Resolve during stack selection.
5. **Is bulk import of the existing Google Sheet really post-MVP?** — the primary success criterion is retiring that sheet for 30 consecutive days, but the historical data stays behind and quick-select ranges (FR-013) have little to range over in the first weeks. Owner: user. Raised during shaping and not yet resolved.
