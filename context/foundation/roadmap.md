---
project: PaperTrail
version: 1
status: draft
created: 2026-08-15
updated: 2026-08-18
prd_version: 2
main_goal: speed
top_blocker: decisions
---

# Roadmap: PaperTrail

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

People who track personal finances in a self-built spreadsheet abandon it at the point of entry: the current Google Sheet takes too many taps to log a routine expense, so entries get skipped and the data goes incomplete. PaperTrail's bet is that removing input friction — plus categories the user defines themselves, a filter that hides large recurring costs so day-to-day patterns become visible, and receipt parsing that assigns line items into *those same user-defined categories* — is enough to retire the sheet for good.

## North star

**S-02: User can log a routine expense against today in ≤4 interactions and ≤10 seconds** — this is the friction thesis made concrete, and the primary success criterion (30 consecutive days off the Google Sheet) is unreachable without it.

> "North star" here means the smallest end-to-end flow whose successful delivery would prove the product's central bet — that removing input friction is enough to retire the spreadsheet. It is placed as early as its prerequisites allow, because everything else only matters if this one works. PRD §Vision states the case directly: "Input friction is the primary pain — the one that alone justifies building this."

## At a glance

| ID    | Change ID                     | Outcome (user can …)                                                        | Prerequisites | PRD refs                    | Status   |
| ----- | ----------------------------- | --------------------------------------------------------------------------- | ------------- | --------------------------- | -------- |
| F-01  | `data-foundation-rls`         | (foundation) migration pipeline + per-user RLS pattern, proven on one table  | —             | FR-001, FR-002, Access Ctrl | done |
| S-01  | `custom-categories`           | define, rename and delete own categories, and flag one as a recurring cost   | F-01          | FR-004, FR-005              | done |
| S-02  | `daily-expense-entry`         | log an expense against today in ≤4 interactions; back-date as a first-class path | F-01, S-01 | US-01, FR-006, FR-007       | done |
| S-03  | `income-and-entry-management` | log an income, and review / edit / delete any logged entry                   | S-02          | FR-008, FR-009              | done |
| S-04  | `date-range-spending-view`    | view spending over quick-select date ranges, with recurring costs excludable | S-01, S-02    | FR-013, FR-015              | done |
| S-05  | `category-distribution-view`  | see spending distributed across own categories, readable at any category count | S-04        | FR-014, FR-015              | done |
| S-06  | `receipt-parsing`             | photograph a receipt and review line items pre-assigned to own categories    | S-01, S-02    | US-02, FR-010, FR-011, FR-012 | done |
| S-07  | `dashboard-category-management` | manage categories from the dashboard itself, and read the day view without clutter or misalignment | S-01, S-02, S-03 | FR-004, FR-005, FR-007, FR-009 | done |
| S-08  | `reports-axis-and-all-time-range` | read every chart's Y-axis labels, and see "Cały okres" start at their first entry | S-04, S-05 | FR-013, FR-014 | done |
| S-09  | `category-icons`              | recognise a category by an icon they chose, everywhere it appears            | S-05, S-07    | FR-004, FR-014, FR-018        | done |
| S-10  | `entry-descriptions-and-receipt-grouping` | say what an entry was, and get one entry per category from a receipt | S-03, S-06 | FR-006, FR-009, FR-012, FR-017 | done |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme               | Chain                                  | Note                                                                                     |
| ------ | ------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| A      | Ledger core         | `F-01` → `S-01` → `S-02` → `S-03`      | The must-have spine under `main_goal: speed`; contains the north star at `S-02`.          |
| B      | Insight             | `S-04` → `S-05`                        | Joins Stream A at `S-02`; needs real entries to range over, so it trails the ledger.      |
| C      | Receipt intelligence | `S-06`                                 | Joins Stream A at `S-02`. Blocked on OQ-2/OQ-3 below — the product differentiator, gated. |
| D      | Daily-use polish    | `S-07` → `S-09` → `S-10` · `S-08` parallel | Post-MVP pass over shipped surfaces, driven by real use rather than by the PRD. Joins Stream A at `S-03`, Stream B at `S-05`, Stream C at `S-06`. |

## Baseline

What's already in place in the codebase as of `2026-08-15` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 SSR + React 19 islands, Tailwind 4, shadcn/ui. `src/layouts/Layout.astro`, `src/components/ui/`. Page content is still starter template (`Welcome.astro`, `index.astro`).
- **Backend / API:** present — Astro API routes at `src/pages/api/auth/*.ts` establishing the uppercase-`POST` + redirect-with-`?error=` convention. `zod` available but unused.
- **Data:** **absent** — no `supabase/migrations/`, no `src/types.ts`, no `src/lib/services/`, and zero table access anywhere in `src/`. Supabase is wired for auth only. This is the single gap every must-have FR sits on.
- **Auth:** present — Supabase end-to-end: `src/lib/supabase.ts`, `src/middleware.ts` (`PROTECTED_ROUTES` + `Cache-Control: private, no-store`), signin/signup/signout endpoints and pages. Deployed and verified 2026-08-15. **FR-001 is satisfied by this baseline**; no slice re-implements it.
- **Deploy / infra:** present — Cloudflare Workers, live at `paper-trail.paper-trail.workers.dev`, `SESSION`/`IMAGES`/`ASSETS` bindings pinned, GitHub Actions CI green on `master`. See `context/deployment/deploy-plan.md`.
- **Observability:** partial — `observability.enabled: true` gives Cloudflare invocation logs and CPU metrics; no error tracking and no structured logging. Deliberately not promoted to a Foundation: the PRD states no observability NFR, and `main_goal: speed` says don't spend here.

## Foundations

### F-01: Per-user data foundation

- **Outcome:** (foundation) a migration pipeline exists and a per-user row-level-security pattern is established and proven end-to-end on the first real table — a signed-in user can read and write only their own rows, verified by test rather than assumed.
- **Change ID:** `data-foundation-rls`
- **PRD refs:** FR-001, FR-002, Access Ctrl
  - FR-001 is marked covered here *only* because the Baseline already satisfies it — this foundation adds the isolation half, not the sign-in half. FR-002 and the §Success Criteria strict-isolation guardrail are the real work.
- **Unlocks:** S-01, S-02, S-03, S-04, S-05, S-06 (every slice writes user-scoped rows). Reduces the blocking risk that FR-002 fails *silently* — the failure mode `CLAUDE.md` and `tech-stack.md` both single out.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** One setup step is outstanding but not gating: the hosted Supabase project is live, but `supabase link` has not been run — it needs the DB password. Deliberately scoped to the *pattern*, not the whole schema: migration tooling, the RLS policy shape, and one table proving it. Prebuilding the full data model here would be horizontal work masquerading as a foundation, and would front-load decisions the later slices should make. The reason it is a foundation rather than folded into S-01 is safety: an RLS mistake leaks one user's finances to another and nothing errors, so the pattern must be verified before any real data exists.
- **Status:** done

## Slices

### S-01: Custom categories

- **Outcome:** User can define, rename and delete their own expense categories, and flag a category as a large recurring cost.
- **Change ID:** `custom-categories`
- **PRD refs:** FR-004, FR-005
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Does renaming a category rewrite chart history, or is the rename versioned? PRD flagged this on FR-004 and let the FR stand without resolving it. Owner: user. Block: no — a first pass can rename in place; revisit if S-05 makes it visible.
- **Risk:** Sequenced first among slices because every other slice references a category, and the PRD makes user-defined categories one of the three product insights. FR-005 (the recurring flag) rides along rather than getting its own slice: it is one boolean on this entity, and splitting it would produce a slice with no independent user-visible outcome. The flag is *defined* here and *consumed* in S-04.
- **Status:** done

### S-02: Daily expense entry — north star

- **Outcome:** User can log an expense with amount, category and date against the current day without touching a date control, and can back-date to a recent day as a first-class path.
- **Change ID:** `daily-expense-entry`
- **PRD refs:** US-01, FR-006, FR-007
  - Also governed by §NFR (≤4 interactions / ≤10s) and the §Success Criteria durability guardrail — both treated as acceptance criteria in Risk below.
- **Prerequisites:** F-01, S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - What counts as an "interaction" for the ≤4 budget — is opening the app one? The NFR measures "from app open to saved entry" but does not settle the unit. Owner: user. Block: no — pick a definition, record it, measure against it consistently.
- **Risk:** This is the north star, so it is placed as early as F-01 and S-01 allow rather than being balanced against other slices. The real risk is that it ships *functionally* correct but misses the interaction budget, which would leave the product's one justifying claim unproven — so the ≤4/≤10s NFR should be treated as an acceptance criterion here, not as polish deferred to later. The durability guardrail ("never silently lost on crash, refresh, or connection drop") also lands here, since this is the first slice that writes user data.
- **Status:** done

### S-03: Income and entry management

- **Outcome:** User can log an income, and can review, edit and delete any previously logged entry.
- **Change ID:** `income-and-entry-management`
- **PRD refs:** FR-008, FR-009
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-06
- **Blockers:** —
- **Unknowns:**
  - Is deletion hard or soft? PRD challenged FR-009 on destroying the audit trail and let it stand without deciding. Owner: user. Block: no.
- **Risk:** Income (FR-008) and entry management (FR-009) are combined because they share one outcome — *the ledger is trustworthy and correctable* — and because FR-008 alone is the entry form with a sign flip, which is not a meaningful slice on its own. The PRD's own reasoning supports pairing them: "uncorrectable errors would rebuild the distrust that killed the sheet." Sequenced after the north star because correction only matters once there is something to correct.
- **Status:** done

### S-04: Date-range spending view with recurring-cost filter

- **Outcome:** User can view spending over quick-select date ranges (last week, last month, year-to-date) and can exclude categories flagged as large recurring costs from the view.
- **Change ID:** `date-range-spending-view`
- **PRD refs:** FR-013, FR-015
- **Prerequisites:** S-01, S-02
- **Parallel with:** S-03, S-06
- **Blockers:** —
- **Unknowns:**
  - Does the recurring-cost filter default to on or off? PRD raised "should exclusion be the default view rather than a toggle" against FR-015 and let the FR stand as a toggle without setting the default. Owner: user. Block: no.
- **Risk:** Carries the FR-015 filter mechanism because it is the first view that can exercise it; S-05 then reuses it rather than reimplementing. Sequenced after entry for an unavoidable reason the PRD names in its own non-goals: v1 starts empty, so quick-select ranges "have little to range over in the first weeks." This slice will look thin in testing regardless of how well it is built — that is a data problem, not a quality signal, and it is the strongest argument for revisiting OQ-3 below.
- **Status:** done

### S-05: Category distribution view

- **Outcome:** User can see spending distributed across their own categories, and the view stays readable regardless of how many categories they have defined.
- **Change ID:** `category-distribution-view`
- **PRD refs:** FR-014, FR-015
- **Prerequisites:** S-04
- **Parallel with:** S-03, S-06
- **Blockers:** —
- **Unknowns:**
  - What is the readability strategy at high category counts — grouping a long tail, capping slices, switching chart form? PRD amended FR-014 with a readability criterion and explicitly left the method "to downstream design." Owner: user/design. Block: no. **Resolved during planning 2026-08-16**: top 8 or above 2% of total (whichever gives fewer slices), tail collapsed into an expandable `Pozostałe (n)`, with an always-visible ranking list as the form that degrades gracefully to any count. See `context/changes/category-distribution-view/plan-brief.md`.
- **Risk:** Depends on S-04 rather than running parallel to it, because it reuses that slice's recurring-cost filter and range selection. The named risk is the one the PRD already surfaced: freely-defined categories produce a long tail of small slices that becomes noise exactly when there is finally enough data to care, so the readability criterion is an acceptance condition, not a refinement.
- **Status:** done

### S-06: Receipt parsing

- **Outcome:** User can upload a photographed receipt and review line items pre-assigned to their own categories, correcting any category or amount before anything is persisted.
- **Change ID:** `receipt-parsing`
- **PRD refs:** US-02, FR-010, FR-011, FR-012
  - Also governed by three §NFRs: image retention, parsing timeout, and the requirement that users be told receipt contents and category names are sent outside the product. The disclosure one is not optional and is easy to forget.
- **Prerequisites:** S-01, S-02
- **Parallel with:** S-03, S-04, S-05
- **Blockers:** No LLM provider selected or contracted — no vendor, no key, no measured accuracy.
- **Unknowns:**
  - Which provider carries out the classification, and does its accuracy clear the Secondary success bar (a majority of line items correctly categorised without correction)? Owner: user. **Block: yes.**
  - What is the parsing timeout, and what is the receipt-image retention window? Owner: user. **Block: yes** for the timeout; the retention half may dissolve entirely — see OQ-3.
- **Risk:** This is the product differentiator and the slice most likely to consume the schedule, which is why it is `blocked` rather than optimistically sequenced. `infrastructure.md`'s pre-mortem predicts exactly how it goes wrong: reaching for the Node recipe (`sharp` to downscale, a storage bucket, a signed upload, a retention job), none of which runs on workerd. The Cloudflare Images binding is already provisioned for this purpose. Note also that FR-011 has a *floor*: below the Secondary bar, auto-assignment is slower than typing, so the feature is failing rather than merely imperfect — worth a spike against real receipts before committing the slice.
- **Status:** done

### S-07: Dashboard as the single capture surface

- **Outcome:** User can create, rename, delete and flag their categories from the dashboard itself — without a separate tab — sees at a glance which are recurring, and reads the day's entries without duplicated sign-out controls or a calendar whose numbers drift off their weekday headers.
- **Change ID:** `dashboard-category-management`
- **PRD refs:** FR-004, FR-005, FR-007, FR-009
- **Prerequisites:** S-01, S-02, S-03
- **Parallel with:** S-08, S-10
- **Blockers:** —
- **Unknowns:**
  - Which five categories are "the first five" before `Pokaż więcej`? The picker's list is already recency-ordered by `listCategoriesForEntryForm`; confirm recency is the intended cut rather than alphabetical. Owner: user. Block: no.
  - The overlay needs a modal primitive and none is installed — hand-roll on the already-present `radix-ui`, or generate shadcn's `dialog`. Owner: implementation. Block: no.
- **Risk:** The widest of the four post-MVP slices, but every item is confined to the dashboard shell and none touches the schema. The one real regression: retiring `/categories` also retires the only surface that can create an *income* category, since the dashboard's picker is scoped to the current entry type — the overlay must carry the kind selector or income categories become uncreatable. The ≤4-interaction NFR that governed S-02 is the acceptance constraint on the collapsed list: `Pokaż więcej` must not add a tap to the common path.
- **Status:** done

### S-08: Reports readability fixes

- **Outcome:** User can read every chart's Y-axis labels without the leading digit clipped, and "Cały okres" plots from their first recorded entry instead of two decades of empty months.
- **Change ID:** `reports-axis-and-all-time-range`
- **PRD refs:** FR-013, FR-014
- **Prerequisites:** S-04, S-05
- **Parallel with:** S-07, S-09, S-10
- **Blockers:** —
- **Unknowns:**
  - What should "Cały okres" resolve to for a user with no entries at all? The existing precedent is the account-creation floor already used for missing-day clamping. Owner: user. Block: no. **Resolved during planning 2026-08-17**: the account-creation date, same source `api/entries/days.ts:52` already uses. See `context/changes/reports-axis-and-all-time-range/plan-brief.md`.
- **Risk:** Two fixes of very different size behind one outcome. The axis half is a width allowance on three charts; the all-time half needs a first-entry lookup that exists nowhere in the codebase today. Note that the twenty-year floor was itself a workaround for the bucket-count guard — a real first-entry date removes the condition that guard was tripping on, so the two halves are the same defect seen from opposite ends.
- **Status:** done

### S-09: Category icons replace colors

- **Outcome:** User can assign an icon to each of their categories and recognise categories by that icon everywhere one appears — entry picker, day list, category manager and the reports charts — instead of maintaining a color per category.
- **Change ID:** `category-icons`
- **PRD refs:** FR-004, FR-014, FR-018
- **Prerequisites:** S-05, S-07
  - Depends on S-07 rather than running beside it because the category editor that gains the icon picker is the one S-07 moves into the dashboard overlay; the alternative is building the picker twice.
- **Parallel with:** S-08, S-10
- **Blockers:** —
- **Unknowns:**
  - A curated icon set, or search across the full icon catalogue? Shipping the whole set into a client island is a bundle-size decision, not only a UX one. Owner: user. Block: no. **Resolved during planning 2026-08-17**: a curated set of 100+ named lucide imports, grouped and filtered by hand-written Polish keywords — sized for the user's expected 50+ categories while staying tree-shaken. See `context/changes/category-icons/plan-brief.md`.
  - Does the per-category color get retired outright, or kept as the chart series color? Owner: user. Block: no — but see Risk for the ordering constraint either answer inherits. **Resolved during planning 2026-08-17**: retired outright; `distribution.ts` derives fills from `categoryId` instead. The column drop is deferred to a follow-up change (`category-color-drop`) so it trails the code by one deploy.
- **Risk:** The narrowest concept with the widest reach — a category marker renders at five call sites plus the chart legends, and the distribution module keys its shade de-duplication off the stored color, so charts need their own color derivation once the user stops choosing one. The deployment trap is ordering: CI applies migrations before the Worker deploys, so dropping the color column (or the category-summary function's color return) must trail the code change by one deploy, or the running Worker queries a column that no longer exists.
- **Status:** done

### S-10: Entries say what they were

- **Outcome:** User can describe an entry in their own words when logging it manually or correcting a receipt, sees those descriptions in "Wpisy tego dnia" — truncated past three items and expandable — and gets one entry per category from a receipt, dated from the receipt itself and correctable when the model misreads it.
- **Change ID:** `entry-descriptions-and-receipt-grouping`
- **PRD refs:** FR-006, FR-009, FR-012, FR-017
- **Prerequisites:** S-03, S-06
- **Parallel with:** S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - Once a receipt collapses to one entry per category, does the existing "save as a single entry at the printed total" shortcut still earn its place? Owner: user. Block: no. **Resolved during planning 2026-08-18**: kept unchanged. It is the only exit from a hard-blocked confirm (missing category, invalid amount, sum mismatch), which the NFR "never left without a way forward" depends on, and the accuracy asymmetry that justified it is untouched by grouping. See `context/changes/entry-descriptions-and-receipt-grouping/plan-brief.md`.
  - How is a grouped description composed and truncated — plain comma-joined item names, or names with amounts? Owner: user. Block: no. **Resolved during planning 2026-08-18**: names *with* amounts, joined by ` · `, so a group is reconstructable from the row alone. Over-long descriptions drop whole items from the tail with a `+N` marker rather than cutting mid-item, and the day list clamps the display to three items with a tap-to-expand.
- **Risk:** No migration needed: the entry description column shipped with S-06, deliberately written but never shown, so this slice is largely the display-and-edit half that was scoped out then — though the update schema omits the field on purpose and has to be opened up for post-save correction. The behavioural change is grouping: a receipt stops producing one entry per printed line and starts producing one per category, which silently redefines what S-06's accuracy log is measuring. Its pre-grouping numbers stop being comparable unless the change is recorded there.
- **Status:** done

## Backlog Handoff

Tracked as GitHub issues in [`Zabicki/paper-trail`](https://github.com/Zabicki/paper-trail/issues), all on the `MVP v1` milestone. The roadmap stays the source of truth for scope; the issues are the execution surface. `gh issue list --label status:ready` answers "what can I pick up now".

| Roadmap ID | Change ID                     | Suggested issue title                                        | GitHub Issue | Ready for `/10x-plan` | Notes                                           |
| ---------- | ----------------------------- | ------------------------------------------------------------ | ------------ | --------------------- | ----------------------------------------------- |
| F-01       | `data-foundation-rls`         | Establish migration pipeline and per-user RLS pattern        | [#1](https://github.com/Zabicki/paper-trail/issues/1)  | yes                   | Run `/10x-plan data-foundation-rls`             |
| S-01       | `custom-categories`           | User-defined expense categories with recurring-cost flag     | [#2](https://github.com/Zabicki/paper-trail/issues/2)  | no                    | Needs F-01                                      |
| S-02       | `daily-expense-entry`         | Log an expense against today in ≤4 interactions              | [#3](https://github.com/Zabicki/paper-trail/issues/3)  | no                    | North star. Needs F-01, S-01                    |
| S-03       | `income-and-entry-management` | Log income; review, edit and delete entries                  | [#4](https://github.com/Zabicki/paper-trail/issues/4)  | no                    | Needs S-02                                      |
| S-04       | `date-range-spending-view`    | Quick-select date-range spending view with recurring filter  | [#5](https://github.com/Zabicki/paper-trail/issues/5)  | no                    | Needs S-01, S-02                                |
| S-05       | `category-distribution-view`  | Category distribution view, readable at any category count   | [#6](https://github.com/Zabicki/paper-trail/issues/6)  | no                    | Needs S-04                                      |
| S-06       | `receipt-parsing`             | Receipt upload, parsing and review into own categories       | [#7](https://github.com/Zabicki/paper-trail/issues/7)  | no                    | Blocked on OQ-2 and OQ-3                        |
| S-07       | `dashboard-category-management` | Manage categories from the dashboard; day-view fixes       | —            | yes                   | Run `/10x-plan dashboard-category-management`   |
| S-08       | `reports-axis-and-all-time-range` | Fix clipped Y-axis labels and the all-time range         | —            | yes                   | Independent of S-07                             |
| S-09       | `category-icons`              | Category icons replace per-category colors                   | —            | no                    | Needs S-07                                      |
| S-10       | `entry-descriptions-and-receipt-grouping` | Entry descriptions; receipt date and per-category grouping | — | no              | Needs S-06 to land                              |

## Open Roadmap Questions

1. **Is bulk import of the existing Google Sheet really post-MVP?** — Owner: user. Block: `roadmap-wide` (does not gate planning, but changes S-04/S-05's value). The primary success criterion is retiring that sheet for 30 consecutive days, yet the history stays behind and the PRD's own non-goals concede that quick-select ranges "have little to range over in the first weeks." Carried from PRD OQ5 and *raised in priority here*, because sequencing has now made the consequence concrete: two of six slices ship into an empty dataset. — tracked in [#8](https://github.com/Zabicki/paper-trail/issues/8)
2. **What carries out the receipt classification, and does its accuracy clear the Secondary bar?** — Owner: user. Block: S-06. Carried from PRD OQ4, still unresolved; the operator has confirmed no provider key is held yet. — tracked in [#9](https://github.com/Zabicki/paper-trail/issues/9)
3. **The two quantitative NFR thresholds: parsing timeout and receipt-image retention window.** — Owner: user. Block: S-06. Carried from PRD OQ3. Note that `infrastructure.md` proposes the receipt image is *never stored* — displayed from an in-memory `File` during review, sent to the model, then discarded — which would dissolve the retention half by construction rather than requiring a number. The timeout half is unaffected and still needs one. — tracked in [#10](https://github.com/Zabicki/paper-trail/issues/10)

> PRD OQ1 (sign-in mechanism) and OQ2 (behaviour when an unauthenticated user hits a gated route) are **resolved by the baseline** and are not carried forward: email + password is shipped, and `src/middleware.ts` redirects to `/auth/signin`. Confirm these match intent; if not, they become new questions rather than reopened ones.

## Parked

- **FR-016 — custom date range selection** — Why parked: PRD marks it nice-to-have and "explicitly non-binding for the MVP"; it was split out of FR-013 during shaping precisely so presets could ship alone. Reinforced by `main_goal: speed`.
- **AI financial analysis, insights and proactive notifications** — Why parked: PRD §Non-Goals. Also cannot produce useful output without historical data, which is itself a non-goal.
- **Any in-app admin surface** — Why parked: PRD §Non-Goals; dropped during shaping because it contradicts the strict-isolation guardrail.
- **Bulk import of historical Google Sheet data** — Why parked: PRD §Non-Goals — but see Open Roadmap Question 1, which argues this deserves a second look.
- **Shared or household expenses** — Why parked: PRD §Non-Goals; follows from the persona decision and keeps the isolation model simple.
- **Bank or card account sync** — Why parked: PRD §Non-Goals; would undercut the manual-entry thesis the product is built on.
- **Offline use** — Why parked: PRD §Non-Goals; no local-first or offline-queue guarantee.
- **Multi-currency** — Why parked: PRD §Non-Goals; surfaced as a counter-argument on FR-006 and deliberately allowed to stand.
- **Custom domain for the deployed app** — Why parked: considered and declined 2026-08-15 during deployment; see `context/deployment/deploy-plan.md`. Revisit only if a domain is wanted for product reasons.
- **Third-party observability (error tracking, structured logging)** — Why parked: no PRD NFR requires it, Cloudflare invocation metrics cover the current need, and `main_goal: speed` says don't spend here.

## Done

- **F-01: (foundation) a migration pipeline exists and a per-user row-level-security pattern is established and proven end-to-end on the first real table — a signed-in user can read and write only their own rows, verified by test rather than assumed.** — Archived 2026-08-15 → `context/archive/2026-08-15-data-foundation-rls/`. Lesson: —.
- **S-01: User can define, rename and delete their own expense categories, and flag a category as a large recurring cost.** — Archived 2026-08-15 → `context/archive/2026-08-15-custom-categories/`. Lesson: pgTAP can't verify app-layer-only invariants like soft-delete — see `context/foundation/lessons.md`.
- **S-02: User can log an expense with amount, category and date against the current day without touching a date control, and can back-date to a recent day as a first-class path.** — Archived 2026-08-15 → `context/archive/2026-08-15-daily-expense-entry/`. Lesson: —.
- **S-03: User can log an income, and can review, edit and delete any previously logged entry.** — Archived 2026-08-15 → `context/archive/2026-08-15-income-and-entry-management/`. Lesson: —.
- **S-04: User can view spending over quick-select date ranges (last week, last month, year-to-date) and can exclude categories flagged as large recurring costs from the view.** — Archived 2026-08-16 → `context/archive/2026-08-16-date-range-spending-view/`. Lesson: —.
- **S-05: User can see spending distributed across their own categories, and the view stays readable regardless of how many categories they have defined.** — Archived 2026-08-17 → `context/archive/2026-08-16-category-distribution-view/`. Lesson: —.
- **S-06: User can upload a photographed receipt and review line items pre-assigned to their own categories, correcting any category or amount before anything is persisted.** — Archived 2026-08-17 → `context/archive/2026-08-16-receipt-parsing/`. Phases 1–3 shipped and reviewed; **Phase 4 (live accuracy assessment) archived unmeasured** — `accuracy-log.md` is an empty scaffold, so the Secondary success bar in FR-011 has no recorded answer. Lesson: —.
- **S-07: User can create, rename, delete and flag their categories from the dashboard itself — without a separate tab — sees at a glance which are recurring, and reads the day's entries without duplicated sign-out controls or a calendar whose numbers drift off their weekday headers.** — Archived 2026-08-17 → `context/archive/2026-08-17-dashboard-category-management/`. Lesson: —.
- **S-08: User can read every chart's Y-axis labels without the leading digit clipped, and "Cały okres" plots from their first recorded entry instead of two decades of empty months.** — Archived 2026-08-17 → `context/archive/2026-08-17-reports-axis-and-all-time-range/`. Lesson: —.
- **S-09: User can assign an icon to each of their categories and recognise categories by that icon everywhere one appears — entry picker, day list, category manager and the reports charts — instead of maintaining a color per category.** — Archived 2026-08-18 → `context/archive/2026-08-17-category-icons/`. Follow-up `category-color-drop` is REQUIRED and not optional: `categories.color`, its CHECK, `category_color` on `entries_category_summary` and the `CATEGORY_COLORS` exports all still exist, because CI applies migrations before the Worker deploys. Also carries a known residual documented at `distribution.ts:212-232` — the chart-fill de-collision walk is invariant to category order but not to membership, so past ~36 categories a bumped category can recolour when its collider leaves the range. Lesson: —.
- **S-10: User can describe an entry in their own words when logging it manually or correcting a receipt, sees those descriptions in "Wpisy tego dnia" — truncated past three items and expandable — and gets one entry per category from a receipt, dated from the receipt itself and correctable when the model misreads it.** — Archived 2026-08-18 → `context/archive/2026-08-18-entry-descriptions-and-receipt-grouping/`. No migration was needed: the description column shipped with S-06, so this slice was the display-and-edit half plus the fold. Archived without an impl-review. Carries four changes made outside the plan by request: receipt parse timeout 30s → 60s, signed/red expense amounts in the day list, a click-to-enlarge receipt photo, and direct camera capture on touch devices. Lesson: —.
