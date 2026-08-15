<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Income and Entry Management (S-03)

- **Plan**: `context/changes/income-and-entry-management/plan.md`
- **Scope**: Full plan — Phases 1–4 of 4
- **Date**: 2026-08-15
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 7 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | FAIL |

Every planned item verified as implemented (13 files, all MATCH). Three minor drifts are documented deviations with equivalent behaviour: `handleDeleted` filters by id instead of comparing `selectedDateRef` (id-filtering is a genuine no-op on a foreign list); entry `type` state was lifted to `DayView` because the plan required the heading to follow it; `?kind=` validation runs before the auth check. All "What We're NOT Doing" guardrails hold — no `/entries` page, hard delete with no undo, `type` and `kind` both immutable, nothing netted, no currency symbol, no test framework, no index on `categories.kind`.

Per-user isolation was traced on every path and holds. No cross-user read or write is reachable through the app, and the 404-vs-400 error split correctly avoids confirming another user's row.

## Findings

### F1 — pgTAP categories suite is red; assertions are non-hermetic

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/categories_rls_test.sql:131-144
- **Detail**: `npx supabase test db` currently fails: `# Failed test 18: "exactly four rows exist total across both users" — have: 6, want: 4`. Assertions 16–18 run as superuser and assert unqualified global `count(*)`, so any row left by manual dev testing breaks them. Confirmed empirically — the local DB holds 2 categories and 1 entry from Phase 3/4 manual verification. The assertion is pre-existing (it was #16 before this change), but this change added two assertions to the same file without fixing it. Per `CLAUDE.md` this suite is the only automated proof of the isolation guarantee and does not run in CI, so a suite that goes red for environmental reasons trains the developer to ignore red.
- **Fix**: Scope the three total-count assertions to the two seed uuids (`where user_id in ('1111…1111','2222…2222')`) — same assertion, passes on a dirty database.
- **Decision**: FIXED — all three assertions scoped to the seed uuids; `npx supabase test db` now passes 38/38 against the un-reset local database.

### F2 — `handleSaved` can duplicate a row and can fabricate a list out of the loading state

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/entries/DayView.tsx:109
- **Detail**: `setEntries((prev) => [...(prev ?? []), entry])`. Its sibling `handleUpdated` (:119-126) does both things correctly; `handleSaved` does neither. (1) No dedupe — the `selectedDateRef` guard checks only the date, not whether the row is already present. POST for day A in flight → user taps day B then day A → a fresh day-A GET fires → the POST commits server-side → the GET returns including the new entry → the POST response lands and appends it again, producing a duplicate React key and a double-counted `Wydatki:` total. (2) `prev ?? []` turns the `null` loading state into a one-element array, replacing "Wczytywanie wpisów…" with a list showing only the just-saved entry until the in-flight GET lands. Note this is pre-existing S-02 code that this change carried forward, but the totals introduced in Phase 4 are what make the duplicate visible as a wrong number.
- **Fix**: Mirror `handleUpdated`: return `prev` untouched when `null`, and skip the append when an entry with that id is already present.
- **Decision**: FIXED — `handleSaved` now returns `prev` untouched while loading and dedupes by id before appending.

### F3 — Shared inline-edit state leaks across rows and across day changes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/entries/DayEntriesList.tsx:45-50, 83, 90, 235-244
- **Detail**: `editingId`/`editForm`/`editError`/`saving` are single-instance, and the `Edytuj` button has no `disabled` prop — unlike `Usuń`, which is guarded per-row by `deletingId === entry.id`. While row Y's PATCH is in flight, row X's `Edytuj` is clickable. On Y's failure path (:83) Y's error renders under X's fields and flips `aria-invalid` on X's inputs; on Y's success path (:90) `setEditingId(null)` silently discards X's freshly opened form. The PATCH body is built synchronously before the await, so this is a UI-state defect, not a wrong-row write. Separately, `DayEntriesList` is mounted without a `key` (DayView.tsx:173) and nothing resets edit state when `entries` is replaced: opening the edit form on an entry, changing the date without saving, navigating to another day and back re-renders that row in edit mode carrying the stale `occurredOn`, indistinguishable from a fresh form.
- **Fix A ⭐ Recommended**: Add `key={selectedDate}` to `<DayEntriesList>` in DayView.tsx:173, and `disabled={saving}` to the `Edytuj` button.
  - Strength: Two lines; the key remounts the list on every day change, which closes the stale-state path completely and hardens the cross-row path.
  - Tradeoff: Remounting also drops edit state on a legitimate same-day refresh.
  - Confidence: HIGH — `key`-based reset is the standard React idiom for exactly this.
  - Blind spot: Have not checked whether any future feature wants edit state to survive a refresh.
- **Fix B**: Capture the row id at save time and gate the writes (`if (editingIdRef.current !== id) return;` before `setEditError`/`setEditingId`), plus per-row state.
  - Strength: Precise — fixes the cross-row case without remounting anything.
  - Tradeoff: More code, and it does not by itself fix the cross-day stale-form case.
  - Confidence: MEDIUM — correct but wordier, and two mechanisms to keep in sync.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `key={selectedDate}` on `<DayEntriesList>` and `disabled={saving}` on the Edytuj button.

### F4 — Soft-deleting a category permanently blocks editing every entry filed under it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/entries.ts:92-97, src/lib/services/categories.ts:124-138
- **Detail**: `softDeleteCategory` sets `deleted_at` with no check for referencing entries. Those entries keep rendering (`SELECT_COLUMNS` embeds `categories(...)` with no `deleted_at` filter — correct for history), but `listCategoriesForEntryForm` filters `.is("deleted_at", null)`, so the chip picker in edit mode shows no selected chip. If the user then edits only the amount, `handleSaveEdit` re-sends the soft-deleted `categoryId` and `assertCategoryUsable`'s `.is("deleted_at", null)` rejects it → 404 "Nie znaleziono kategorii", unconditionally. The entry is not editable at all until the user notices nothing is selected and reassigns. This is newly reachable because Phase 4 is what made entries editable.
- **Fix**: Let `assertCategoryUsable` accept a soft-deleted category when it is the entry's *current* category — an amount-only edit should not require re-filing.
  - Strength: Targets the exact dead end; keeps soft-delete's meaning (hidden from new entries) intact.
  - Tradeoff: The guard needs the entry's current `category_id`, so `updateEntry` passes one more argument.
  - Confidence: MEDIUM — behaviour is clearly better, but it is a product call whether editing should silently retain a deleted category.
  - Blind spot: Have not checked what S-04/S-05 expect soft-deleted categories to do in aggregate views.
- **Decision**: FIXED — `assertCategoryUsable` takes an optional `currentCategoryId` and skips the `deleted_at` filter when the incoming category is the entry's existing one; `updateEntry` now selects `category_id` and passes it.

### F5 — Both cross-user invariants have zero database backstop; a composite FK would close them

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/entries.ts:91-109
- **Detail**: The plan decided deliberately that ownership and type↔kind are app-layer-only and permanently manual-verification-only, and the code documents that honestly. Confirmed empirically against the live local DB: a raw insert by user B pointing at user A's category with a kind mismatch is **accepted** by the database. The only thing preventing it is `assertCategoryUsable` on two call sites; any third write path added later that forgets it leaks silently. There is also a real but benign TOCTOU gap in `updateEntry` — three separate statements at :136, :151, :153 — where the category can be soft-deleted in the window; the ownership consequence is nil because the write is itself RLS-scoped. This finding challenges the plan's own decision rather than its implementation.
- **Fix A ⭐ Recommended**: Add a composite FK so both invariants become structurally impossible and pgTAP can prove them: `alter table public.categories add constraint categories_id_user_id_kind_key unique (id, user_id, kind);` then `alter table public.entries add constraint entries_category_same_owner_and_kind foreign key (category_id, user_id, type) references public.categories (id, user_id, kind);`
  - Strength: Retires both documented "pgTAP cannot prove this" gaps and the lessons.md manual re-verification burden in one migration; also makes the non-null `category` embed genuinely safe.
  - Tradeoff: A new migration and a new slice-sized decision; needs care because `kind` would then be referenced by an FK, hardening immutability further.
  - Confidence: MEDIUM — the constraint is standard and correct, but it has not been applied and tested here.
  - Blind spot: Have not verified the constraint's interaction with soft-delete or with F4's proposed fix.
- **Fix B**: Leave as planned, and add a lessons.md rule that any new `entries` write path must call `assertCategoryUsable`.
  - Strength: Zero schema risk; matches the plan's stated decision, which the user already accepted.
  - Tradeoff: The guarantee stays unprovable and depends on reviewer vigilance forever.
  - Confidence: HIGH — this is exactly what the plan already committed to.
  - Blind spot: None significant.
- **Decision**: SKIPPED — the plan's app-layer-only decision stands as written and documented. The composite-FK option remains available to a later slice.

### F6 — Recency lookback is unindexed and runs twice per dashboard load

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/entries.ts:241-246
- **Detail**: Live schema dump shows `public.entries` has only `entries_pkey` and `entries_user_id_occurred_on_idx (user_id, occurred_on)`. The recency query is `where type = $1 order by created_at desc limit 50` (RLS adds `user_id`), so Postgres must scan and sort every one of the user's entries — the LIMIT cannot be satisfied from an index. This change made it worse: `DayView` now fires both kinds in parallel, so a dashboard load costs two unindexed sorts over the full entry history, growing without bound.
- **Fix**: `create index entries_user_id_type_created_at_idx on public.entries (user_id, type, created_at desc);`
- **Decision**: FIXED — new migration `20260815215924_add_entries_recency_index.sql` adds `entries_user_id_type_created_at_idx (user_id, type, created_at desc)`; applied locally via `supabase migration up` (no reset).

### F7 — `handleDelete` has no `catch`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/entries/DayEntriesList.tsx:98-114
- **Detail**: `try { … } finally { setDeletingId(null); }` with no catch. A network failure rejects, `void handleDelete(entry.id)` discards the rejection, and the user gets an unhandled rejection with zero feedback. `handleSaveEdit` (:91-93) and `EntryForm.handleSubmit` (:133) both catch correctly. Secondary: on a non-ok response it alerts and returns without calling `onDeleted`, so a 404 (row already deleted in another tab) leaves the row in the list indefinitely. This mirrors the same gap in `CategoriesManager.tsx:235-251` — pattern-consistent, but a defect in both.
- **Fix**: Add `catch { window.alert("Nie udało się połączyć z serwerem. Spróbuj ponownie."); }`, and treat 404 as success by calling `onDeleted(id)`.
- **Decision**: FIXED in both files — `catch` added with a Polish connection-failure alert, and 404 treated as success, in `DayEntriesList.handleDelete` and the pre-existing twin in `CategoriesManager.handleDelete`.

### F8 — `?kind=` hand-rolled instead of zod, and validated before auth

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/entries/categories.ts:6, 17, 20
- **Detail**: The validation is sound — `KINDS.includes(kindParam as CategoryKind)` is a pure value comparison, so the assertion cannot launder a bad value, `""` correctly 400s, `null` correctly defaults, and the value reaches Supabase as a parameterised `.eq()`. But `CLAUDE.md` says API routes validate input with zod, and every request body in this change does; this query param uses a hand-rolled array plus two `as CategoryKind` assertions. Separately it validates before the auth check, so an unauthenticated caller can distinguish 400 from 401 — identical to the pre-existing `DATE_PATTERN` check in `entries/index.ts:15`, and it leaks no user data.
- **Fix**: Use `z.enum(["expense","income"]).default("expense")` with `safeParse`, and move the check below the `getUser()` guard.
- **Decision**: FIXED — `?kind=` now parsed by `z.enum([...]).default("expense")` via `safeParse`, both `as CategoryKind` assertions gone, and validation moved below the auth guard.

### F9 — Raw `<input>` duplicating the shadcn `Input` class string

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/entries/DayEntriesList.tsx:165, 198
- **Detail**: Two raw `<input>` elements carry a hand-copied ~200-char Tailwind string, where `CategoryPicker.tsx:28` and `CategoriesManager.tsx:278` use the shadcn `<Input>`. The copied string has drifted from `src/components/ui/input.tsx` — it drops `placeholder:text-muted-foreground`, `disabled:opacity-50`, and the `dark:aria-invalid:ring-destructive/40` variant. The `h-11 min-h-11` deviation is justified (44px tap target, the product's binding constraint), but `<Input className="h-11 min-h-11">` achieves it through `cn()`/tailwind-merge. The pattern originated in `EntryForm.tsx:175` pre-change; this change propagates it to a third and fourth copy.
- **Fix**: Replace the raw inputs with `<Input className="h-11 min-h-11" …>`.
- **Decision**: FIXED — all three raw `<input>` elements (2 in `DayEntriesList`, 1 in `EntryForm`) replaced with `<Input className="h-11 min-h-11">`, so the 44px tap target survives while the rest of the styling comes from `ui/input.tsx` through `cn()`. Side effect: these inputs now pick up `md:text-sm` like every other `Input` in the app.

### F10 — Raw palette classes alongside semantic tokens

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/entries/DayEntriesList.tsx:231, src/components/entries/EntryForm.tsx:152, 156, 193
- **Detail**: Raw palette classes (`text-emerald-400`, `text-blue-100/80`, `text-purple-300`) sit alongside semantic tokens (`text-destructive`, `text-muted-foreground`) in the same files. The raw values will not follow the theme. `text-emerald-400` for income rows is new in this change; the others are pre-existing.
- **Fix**: Introduce a semantic token for the income accent rather than a raw palette value.
- **Decision**: SKIPPED — cosmetic and largely pre-existing; a theming pass is its own piece of work.

## Non-findings worth recording

- **Isolation holds.** `assertCategoryUsable`, `updateEntry` and `deleteEntry` all rest on RLS-scoped statements; `entries_rls_test.sql` passes 20/20 including the new write-policy probes.
- **`handleDeleted` is correct** despite deviating from the plan's "all three guarded by `selectedDateRef`" — id-filtering is a genuine no-op on a list that does not hold the row, and the code comment says so.
- **The migration is correctly backward-compatible.** Additive with a default, and "nothing shipped so far selects `kind`" was verified against `git show 10d59fd:src/lib/services/categories.ts`.
- **`src/pages/api/entries/[id].ts` is a faithful mirror** of `src/pages/api/categories/[id].ts` — same `parseId`, same guard order, same `{error, field}` body, same 204.
- **Cosmetic**: `handleUpdated`'s "moved onto this day" branch appends to the tail while the server orders by `created_at asc`, so a re-dated entry appears last until reload.
- **Cosmetic**: `handleSaveEdit` does not re-check `editValid`; the `disabled` attribute is the sole guard, where `EntryForm.handleSubmit` re-checks `canSubmit`.
