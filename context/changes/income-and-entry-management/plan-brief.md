# Income and Entry Management (S-03) — Plan Brief

> Full plan: `context/changes/income-and-entry-management/plan.md`

## What & Why

FR-008 (log an income) and FR-009 (review, edit, delete logged entries) ship as one slice because they share a single outcome: **the ledger is trustworthy and correctable**. The PRD's own reasoning for pairing them — "uncorrectable errors would rebuild the distrust that killed the sheet" — is the why. Income alone would be the existing form with a sign flip, which isn't a slice.

## Starting Point

S-02 left the door open on purpose. `entries.type` already exists as a `check (type in ('expense','income'))` column that only ever receives `'expense'`, and the `entries_update_own` / `entries_delete_own` RLS policies already exist but are exercised by no route and no test. What's missing is the entire write surface above them: no `PATCH`/`DELETE` endpoints, a read-only `DayEntriesList`, and no answer to what an income entry's mandatory `category_id` should point at.

## Desired End State

`/dashboard` gets a quiet Wydatek/Przychód toggle above the entry form that always resets to Wydatek, so expenses stay zero-interaction and income costs exactly one tap. The day's list below is no longer read-only: every row can be edited (amount, category, date) or deleted, income rows read `+` in green, and a summary shows expense and income totals side by side without netting them. Calendar red-marking now tracks expenses only, so a payday never certifies a day's spending as logged. `/categories` gains an expense/income choice at creation time, shown read-only thereafter.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Income ↔ category model | `kind` flag on `categories` (expense \| income) | Keeps the expense chip picker and later spending charts free of income sources, without relaxing `entries.category_id`'s NOT NULL | Plan |
| Kind mutability | Set at creation, immutable after | Makes "every entry's type matches its category's kind" an invariant that can't be broken retroactively | Plan |
| Delete semantics | Hard delete behind `window.confirm` | Entries are leaves, so the referential reason categories are soft-deleted doesn't apply; avoids a permanently unprovable `deleted_at` filter in every future query | Plan |
| Edit scope | Amount, category and date; type immutable | Covers the realistic corrections including a mis-dated back-date; type changes go through delete + re-add | Plan |
| Where review lives | Inline in the dashboard day list | Zero navigation from where the mistake is noticed; a cross-day page would duplicate S-04's range work | Plan |
| Form switching | Segmented toggle defaulting to Wydatek | Protects the ≤4-tap north-star budget — income costs one tap, expenses cost none | Plan |
| Red-day marking | Only expenses clear a red day | The marking is a "did you log your spending" nudge; income has a different rhythm and shouldn't certify a day | Plan |
| Day-list presentation | Distinct income rows + split totals, never netted | Answers "what did I spend today" without the sign confusion the PRD flagged | Plan |
| Verification line | Extend pgTAP; name the manual-only gaps in writing | Covers everything the database can prove and records what it can't, per `lessons.md` | Plan |

## Scope

**In scope:**
- `categories.kind` migration (defaulted, backward-compatible) + pgTAP for the constraint
- pgTAP finally exercising `entries_update_own` / `entries_delete_own`
- `kind` through the categories service, excluded from the update schema
- `type` on entry creation, type↔kind validation, `updateEntry` / `deleteEntry`, new `/api/entries/[id].ts`
- `/api/entries/days` filtered to expenses; form-categories endpoint filtered by kind
- Kind selection in `CategoriesManager`; type toggle, inline edit/delete and split day totals on `/dashboard`

**Out of scope:**
- A separate `/entries` review page across days (overlaps S-04)
- Soft delete, undo, changing an entry's type, changing a category's kind
- Netting income against expenses anywhere; currency symbols
- Date-range and category-distribution views (S-04/S-05)
- Installing a JS test framework — the app-layer invariants stay manual-only

## Architecture / Approach

Bottom-up, mirroring S-02: schema + its pgTAP proof → service layer and API write surface → categories UI → dashboard UI. Categories UI precedes the dashboard because an income category has to exist before an income can be logged. The type↔kind check rides on the pre-insert category lookup that already exists for the ownership re-check, so it costs no extra round trip on create.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & RLS | `categories.kind`, pgTAP for the constraint and for the two untested entry policies | Migration must stay backward-compatible — CI pushes schema before deploying the Worker |
| 2. Service + API | Income creation, type↔kind check, update/delete, `/api/entries/[id].ts` | `updateCategorySchema` currently aliases the create schema; leaving that alias silently makes `kind` editable |
| 3. Categories UI | Kind on the add form, read-only on edit, grouped list | Low — follows the existing manager patterns closely |
| 4. Dashboard UI | Type toggle, inline edit/delete, split day totals | The toggle sits on the most tap-sensitive screen in the product; a date edit moves a row across days mid-flight |

**Prerequisites:** S-02 complete (it is). Docker running for `supabase db reset` / `test db`.
**Estimated effort:** Single extended session across 4 phases — comparable to S-02, with less new UI but more write-path validation.

## Open Risks & Assumptions

- Three invariants are enforced only in application code and pgTAP cannot reach any of them: entry type ↔ category kind, category ownership on the update path, and category-kind immutability. All three are documented as permanent manual re-verification points per `lessons.md`.
- The ≤4-tap budget survives the toggle by design, but that's a stopwatch judgment during manual verification, not an automated gate.
- Hard delete means a mis-tap is unrecoverable; the PRD raised the audit-trail counter-argument and allowed FR-009 to stand.
- Day totals introduce the first client-side summation of `numeric` amounts — negligible at one day's row count, but S-02's finding F4 about float drift starts applying here.
- Category names stay unique per user across both kinds; if a user genuinely wants the same name for an expense and an income category, that needs a per-kind unique index later.

## Success Criteria (Summary)

- A user can log an income in one tap more than an expense, and the expense path still clears ≤4 taps / ≤10 seconds.
- Any logged entry's amount, category and date can be corrected in place, and any entry can be deleted, without leaving the day view.
- A day carrying only income still shows as missing on the calendar, and deleting a day's last expense makes it red again.
- No user can read, edit or delete another user's entries — proven by pgTAP for RLS, and by hand for the app-layer type↔kind and ownership checks.
