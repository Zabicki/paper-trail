---
date: 2026-08-22T13:00:06+02:00
researcher: Krzysztof
git_commit: 588d492ce9dd92b8d39aaf39899b8ad045f4402b
branch: master
repository: paper-trail
topic: "Rollout Phase 5 — client-state truth in the day list (risk #5) and document-level horizontal overflow at phone widths (risk #6)"
tags: [research, codebase, entries, day-list, react-islands, viewport, overflow, component-testing, vitest, phase-5]
status: complete
last_updated: 2026-08-22
last_updated_by: Krzysztof
---

# Research: Client state + viewport regressions (test-plan §3 Phase 5)

**Date**: 2026-08-22T13:00:06+02:00
**Researcher**: Krzysztof
**Git Commit**: `588d492ce9dd92b8d39aaf39899b8ad045f4402b`
**Branch**: `master` (24 commits ahead of `origin/master` — this commit is **unpushed**, so no GitHub permalinks are given; all references are local `file:line`)
**Repository**: paper-trail

## Research Question

Ground the two risks that `context/foundation/test-plan.md` §3 Phase 5 must cover, per the §2 _Risk Response Guidance_ rows:

- **Risk #5** — "the day list shows something the database does not contain." Research must ground: how list state is derived and updated after each mutation; where per-row edit state is keyed; behaviour on request failure and on rapid day navigation.
- **Risk #6** — "one element gives the _whole document_ horizontal scroll." Research must ground: which pages and components mix user-supplied strings with controls; which rely on intrinsic-width utilities; **whether built CSS alone suffices or a signed-in render is required**.

Plus the harness question the phase inherits: both test types are new capabilities (§4 lists them as "none yet — see §3 Phase 5"), and `vitest.config.ts` is standalone.

**Scope decisions taken with the user before research:** read-only mapping (no installs, no spikes — so every tooling feasibility question below is reported as unverified rather than proven); all routes and both mechanisms for #6; `src/components/entries/` plus its data boundary for #5.

## Summary

**Risk #5 is misnamed by its own risk statement, in a way that matters.** Nothing in the entries island is optimistic. All four write paths — create, inline edit, delete, receipt batch — are **server-echo**: the list is patched only after the response lands, using the DTO the server returned (`DayView.tsx:121-183`). The `Must challenge` line in the brief, "that an optimistic update matches the server's result", has no subject in this codebase. The one optimistic patch anywhere in the island is on the _category_ lists (`DayView.tsx:196-206`), and it matters only because it pulls the lever that opens the real race.

What the three archived incidents produced is **three guards that stand today with no automated protection**: a `selectedDateRef` day guard, an id-keyed dedupe, and a `key={selectedDate}` remount. Each was installed by an impl-review finding, each is one deletable line, and each currently has zero regression cover. That — characterisation of three live guards — is the honest deliverable, and it is sharper than "prove the list tells the truth."

**Two unguarded gaps surfaced that the risk statement does not name, and both fail in the _losing_ direction rather than the duplicating one:**

1. **The inverse race.** A same-day GET fired by `entriesRefreshKey` that resolves _after_ a POST response has appended, wholesale-replaces the array with a pre-insert snapshot (`DayView.tsx:94`), silently dropping the just-saved row. The `cancelled` flag guards effect supersession only; nothing correlates a GET with a mutation on the same day.
2. **The `prev === null` drop.** A save or batch confirm resolving while the day's GET is still in flight discards the entry outright (`DayView.tsx:127-129`, `:147-149`), deliberately. Phase 2's research explicitly handed this to Phase 5 (`context/archive/2026-08-21-testing-receipt-confirm-integrity/research.md:582-585`) and it is **not** in §2's risk-#5 source column.

**Risk #6 has one finding that decides the phase's shape: both shipped instances of the bug are behind the session wall.** `/dashboard` and `/reports` are the only pages carrying `Topbar` (the S-11 surface) and `ReceiptReview` (the S-12 surface), and both are in `PROTECTED_ROUTES` (`src/middleware.ts:6`). A headless browser with no session reaches exactly three rendered pages — `/auth/{signin,signup,confirm-email}` — which are one shell with **no user-supplied strings** except the `?error=` query parameter. `lessons.md:33`'s "no dev server and no sign-in needed" is true of a **hand-written HTML fixture** linking the built stylesheet; it is **not** true of a check that navigates to URLs. The plan must pick one, and they cost differently.

Supporting facts that shape either choice: `astro build` emits **zero static HTML** (`output: "server"`, no `prerender` anywhere) but does emit the whole stylesheet as one standalone content-hashed file. **Nothing masks the symptom** — there is no `overflow-x` rule anywhere in the built CSS — but `position: fixed` dialogs are structurally invisible to a document-level assertion, and the cleanest _unfixed_ mechanism-A instance in the repo lives inside one.

**On the harness: the expensive question does not bind.** Not one island in `src/components/entries/` reaches an `astro:*` or `cloudflare:workers` specifier, directly or transitively. §6.1's direct-vs-transitive fork — the thing that cost Phases 2–4 their thinking — is simply not this phase's problem. What blocks component tests is the absent DOM environment, the absent React renderer, and a discovery glob that **silently** will not collect a `.test.tsx` file.

---

## Detailed Findings

# Part 1 — Risk #5: what the day list actually does

## 1.1 One island owns everything; there is no SSR data

`src/pages/dashboard.astro:12` mounts `<DayView client:load />` and passes **no props**. The page frontmatter (`:1-5`) never touches `Astro.locals` or a service. `src/layouts/Layout.astro:29-45` renders only the config banner and a `<slot />`.

So the initial list is **fetched client-side on mount**, and `DayView` owns every piece of state. The entry array is a single hook at `src/components/entries/DayView.tsx:31`:

```ts
const [entries, setEntries] = useState<Entry[] | null>(null);
```

`null` is a third state meaning "loading", rendered as `Wczytywanie wpisów…` (`DayEntriesList.tsx:209-211`). `DayEntriesList` takes it as a **read-only prop** (`:19`, `:93-100`) and never writes to it, reporting mutations upward through `onUpdated` / `onDeleted` (`:23-24`).

A day change does **both** a refetch and a remount: the effect keyed `[selectedDate, entriesRefreshKey]` (`DayView.tsx:78-106`) GETs `/api/entries?date=…` (`:88`), and `key={selectedDate}` on the child (`:262`) destroys and rebuilds it.

## 1.2 The four write paths — all server-echo, none optimistic

| Path          | Trigger                                                       | What touches the list                                            | Guard                                  |
| ------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| Create        | `EntryForm.tsx:138-178` → POST `/api/entries`                 | `handleSaved` (`DayView.tsx:121-137`) appends the **echoed** DTO | day guard `:122` + id dedupe `:133`    |
| Inline edit   | `DayEntriesList.tsx:147-180` → PATCH `/api/entries/{id}`      | `handleUpdated` (`DayView.tsx:158-176`) upserts-or-evicts by id  | day guard `:159`, `some()` test `:167` |
| Delete        | `DayEntriesList.tsx:182-203` → DELETE                         | `handleDeleted` (`DayView.tsx:180-183`) filters by id            | none needed — see below                |
| Receipt batch | `ReceiptCapture` → `handleBatchSaved` (`DayView.tsx:143-156`) | `Set`-based dedupe over N rows `:150-151`                        | day guard `:144`                       |

Every one of these runs **after** `await response.json()`. The row on screen keeps its pre-edit values until the PATCH returns; the row being deleted stays visible with a spinner until the 204 arrives. **There is nothing to roll back on failure, because nothing was ever applied ahead of the server.**

Delete needs no day guard and the source says why (`DayView.tsx:178-179`): filtering by id is a no-op on a list that does not hold the row, so a late response cannot corrupt another day's list.

**The one optimistic patch in the island** is `handleCategoryCreated` (`DayView.tsx:196-206`), which appends a `Category` before its refetch lands and then calls `refreshAfterCategoryMutation()`. That helper bumps **both** `categoriesRefreshKey` and `entriesRefreshKey` (`:191-194`) — making a category mutation the **only** thing that refetches the day's entries without a day change. That is the lever that opens §1.4's race.

## 1.3 The three archived incidents are three guards standing today

All three are impl-review findings, not standalone bug reports, and all three shipped with a plan and a review.

**(a) Stale-day race at save** — `context/archive/2026-08-15-daily-expense-entry/reviews/impl-review.md:31-39`, finding F1 (S-02, APPROVED with warning). Quoted at `:37`: "_if a user submits for day A, then switches to day B before the POST response lands, the late response's `handleSaved` call splices day A's entry into what's now rendered as day B's list._" Fixed in commit `a754080` by adding `selectedDateRef` and guarding the append. **The guard today is `DayView.tsx:34-37` + `:122`.**

**(b) Duplicate row from optimistic save** — `context/archive/2026-08-15-income-and-entry-management/reviews/impl-review.md:37-45`, finding F2 (S-03, NEEDS ATTENTION). Quoted at `:43`: "_No dedupe — the `selectedDateRef` guard checks only the date, not whether the row is already present. POST for day A in flight → user taps day B then day A → a fresh day-A GET fires → the POST commits server-side → the GET returns including the new entry → the POST response lands and appends it again, producing a duplicate React key and a double-counted `Wydatki:` total._" The same finding names a second half: `prev ?? []` turned the `null` loading state into a one-element array. Fixed in `0b8bd2a`. **The guards today are `DayView.tsx:133` (id dedupe) and `:127-129` (the `null` early-return).**

Note the review's own provenance line — the (a) fix is what _created_ the surface for (b), and Phase 4's totals are what made the duplicate visible as a wrong number.

**(c) Shared inline-edit state across rows and days** — same file, `:47-64`, finding F3. Quoted at `:53`: "_While row Y's PATCH is in flight, row X's `Edytuj` is clickable. On Y's failure path Y's error renders under X's fields and flips `aria-invalid` on X's inputs; on Y's success path `setEditingId(null)` silently discards X's freshly opened form. […] `DayEntriesList` is mounted without a `key` and nothing resets edit state when `entries` is replaced: opening the edit form on an entry, changing the date without saving, navigating to another day and back re-renders that row in edit mode carrying the stale `occurredOn`, indistinguishable from a fresh form._" Fixed in `0b8bd2a`. **The guards today are `DayView.tsx:262` (`key={selectedDate}`) and `DayEntriesList.tsx:372` (`disabled={saving}`).**

**Regression cover for all three: none.** `git ls-files` shows no test file anywhere under `src/components/entries/`. The only trace is one manual checkbox in the next slice's plan (`context/archive/2026-08-15-income-and-entry-management/plan.md:408`).

**And (c)'s fix carries a recorded, unresolved tradeoff.** The same review states at `:56` that remounting "_also drops edit state on a legitimate same-day refresh_", and at `:58` that nobody has checked "_whether any future feature wants edit state to survive a refresh._" A Phase 5 test asserting "per-row edit state never survives a day change" therefore pins behaviour with an open question attached — which §6.2's cookbook rule says must be labelled a characterisation test naming its decision record, not presented as desired behaviour.

## 1.4 Two unguarded gaps the risk statement does not name

Both are "the list shows something the database does not contain" in the **losing** direction. §2's risk #5 names duplication and wrong-row edits only.

**Gap 1 — the inverse race.** The (b) fix covers _GET resolves first, POST appends second_. The reverse ordering has no guard: if a GET is already in flight when the POST commits and the POST response lands **first** (appending at `DayView.tsx:133`), the older GET then resolves and `setEntries(data)` at `:94` **wholesale-replaces** the array with a snapshot taken before the insert. The just-saved row silently disappears from the display. `cancelled` (`:79`, `:104`) cancels only a GET whose _effect_ has been superseded; a GET fired by `entriesRefreshKey` on the same day is never cancelled by a POST, and nothing correlates the two. Reachable via the §1.2 lever: save an entry, then create a category from the same screen.

**Gap 2 — the `prev === null` drop.** When the day GET is still in flight, `handleSaved` returns `prev` untouched (`DayView.tsx:127-129`) and `handleBatchSaved` does the same (`:147-149`) — the entry is **discarded from the view entirely**, by deliberate design, on the assumption that the in-flight GET was issued after the insert committed. That assumption is not enforced anywhere. Phase 2's research flagged exactly this and handed it forward (`context/archive/2026-08-21-testing-receipt-confirm-integrity/research.md:582-585`): "_Not investigated: whether the `prev === null` drop in `DayView.tsx:147-149` (a confirm resolving while the day's GET is in flight) can lose a batch from the visible list. It is client-state behaviour and belongs to §3 Phase 5 / risk #5, but it surfaced here and should not be lost._"

## 1.5 Per-row edit state: keyed by id, but the draft is not keyed at all

All edit state is a **single set of hooks in the parent list**, `DayEntriesList.tsx:101-116`: `editingId: number | null`, one flat `editForm` object, `editFilterText`, `editError`, `saving`, `deletingId`, and `expandedIds: Set<number>`.

**The key is the entry id — a `number`, never an array index.** `editingId` holds `entry.id` (`:129`), the render selects with `editingId === entry.id` (`:241`), and the `<li>` React key is `entry.id` (`:240`). Field `id`/`htmlFor` pairs are suffixed with the entry id (`:244-256`, `:275-289`, `:294-309`), so labels are unambiguous per row.

**The draft is hoisted above the row and is not keyed.** `editForm` is one object shared by every row; only `editingId` says which row it belongs to. `startEdit` (`:128-140`) re-seeds all four fields _and_ `editingId` in one call, so opening row B while row A held a draft silently discards A's rather than showing it under B.

**What resets it:** a day change (via the `key={selectedDate}` remount at `DayView.tsx:262`, which resets all seven hooks at once — the comment at `:258-260` names it deliberate: "_a half-typed correction must not survive a day change and come back looking like a fresh form_"); a successful save (`:174`, which clears `editingId` only — `editForm` lingers, unreachable); and cancel (`:142-145`, same). A **failed** save resets nothing. **No effect watches `entries`**, so if a refetch removes the row being edited, `editingId` points at an absent id, the form vanishes from the DOM, and the draft persists invisibly.

**The cross-row guard is asymmetric.** `Edytuj` is `disabled={saving}` on every row (`:372`, with the reason in the comment at `:369-371`); `Usuń` is disabled only by its own `deletingId === entry.id` (`:387`), so a delete can be started on any row while a PATCH is in flight.

## 1.6 Day navigation: two independent guards, neither an AbortController

There is **no `AbortController` and no sequence counter anywhere in `src/components/entries/`** — the only one in the client tree is `ReceiptCapture.tsx:91,142,165`. Instead, two mechanisms:

1. **Per-effect cancellation flag** on the day GET (`DayView.tsx:78-106`): `const cancelled = { current: false }` at `:79`, checked before `setEntries` (`:93`) and before `setEntriesError` (`:97`), set true in cleanup (`:104`). React runs the previous effect's cleanup before the new one, so on rapid multi-day navigation only the **final** day's response can write, regardless of network ordering. The requests themselves are not aborted — they complete and are discarded. `setEntries(null)` at `:84` runs synchronously at the top of each effect body, so the list correctly blanks per hop. `context/archive/2026-08-16-receipt-parsing/research.md:317` records this closure-guard idiom as a deliberate house choice over `AbortController`.
2. **A live `selectedDateRef`** (`DayView.tsx:34-37`), read at `:122`, `:144`, `:159`. The mutation callbacks are held in closures inside `EntryForm` / `ReceiptCapture` / `DayEntriesList` that may predate the day change, so the ref is the only way they can see the _current_ day.

`MonthCalendar.tsx:36-58` carries the identical `cancelled` pattern with the same limits; its `refreshKey` is bumped by all four mutation handlers (`DayView.tsx:136,155,175,182`).

Also worth knowing for test setup: there is **no URL state, no router, no history entry** — `selectedDate` is pure React state initialised from the clock. And `entriesError` is never cleared by a mutation, only at the top of the next GET (`:86`), while `loadError` short-circuits the whole list (`DayEntriesList.tsx:205-207`).

## 1.7 Failure handling

| Path                                  | non-2xx                                                                                                                           | thrown fetch                    | Can the list disagree with the DB?                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create (`EntryForm.tsx:159-162`)      | `setError(await parseErrorBody(…))`, early return; form fields **retained**                                                       | `:173-175` → connection message | Yes — a POST that committed but whose response never arrived leaves the row in the DB and absent from the list until a day change or category refresh |
| Update (`DayEntriesList.tsx:166-169`) | `setEditError(…)`, early return; `editingId` **stays set**, draft intact, error rendered against `editError.field`                | `:175-177`                      | Same shape                                                                                                                                            |
| Delete (`:192-196`)                   | `window.alert(body.error)`, early return — **except 404, treated as success** (`:189-192`) and falling through to `onDeleted(id)` | `:198-200`                      | Yes — a committed-but-timed-out DELETE leaves a phantom row; the retry 404s and removes it                                                            |

`saving` and `deletingId` clear in `finally` (`:177-179`, `:200-202`), so the UI never sticks.

## 1.8 What a test can query — and four Unicode traps

UI language is **Polish** throughout (`Layout.astro:21` sets `lang="pl"`).

Row anatomy (`DayEntriesList.tsx:331-396`): category name as bare text beside a decorative `CategoryIcon` (`aria-hidden`); optional description of up to 3 items joined by `" · "`; a signed amount; and two icon-only buttons with `aria-label="Edytuj"` and `aria-label="Usuń"`. Totals above the list read `Wydatki: …` / `Przychody: …` (`:233-236`). The three non-row states are `Wczytywanie wpisów…` (`:210`), `Brak wpisów tego dnia.` (`:214`), and the load-error paragraph (`:206`).

**The traps, all of which will silently fail a naive `getByText`:**

- **U+2212 MINUS SIGN**, not an ASCII hyphen, on expense amounts (`:358-364`, comment at `:358-360`). Income uses ASCII `+`.
- **U+00A0 NO-BREAK SPACE** inside `formatCurrency` output — `Intl.NumberFormat("pl-PL", …)` (`src/lib/format.ts:5-10`) emits it both as the thousands separator and before `zł`. `12.5` renders as `12,50 zł` with U+00A0. §6.6's Phase 2 note already records this class of trap for `formatAmountPlain`.
- **U+2026 ELLIPSIS** in `Wczytywanie wpisów…`, `Zapisywanie…`, `Szukaj kategorii…` — one character, not three dots.
- **`aria-label` overrides visible text** on the description expander (`:78-88`): visible `+{n}` / `Zwiń`, but accessible name `Pokaż pozostałe pozycje opisu (${n})` / `Zwiń opis wpisu`. Same for the two icon buttons, and for recurring category chips (`CategoryPicker.tsx:91`), where a **non**-recurring chip has no `aria-label` and a recurring one does.

`CategoryPicker` renders a `role="radiogroup"` of `role="radio"` chips (`:81-101`); `MonthCalendar` day cells carry `aria-pressed` / `aria-current="date"` and composed `aria-label`s (`:115-132`).

## 1.9 Clock reads, and one free unit target

Two modules read the clock internally with no injection point, which makes them non-deterministic under test:

- `DayView.tsx:15` — `useState(() => toLocalDateString(new Date()))`, the initial selected day.
- `MonthCalendar.tsx:61` — `const today = toLocalDateString(new Date())`, recomputed every render, driving `aria-current="date"` and the `, dziś` label.

Contrast `src/components/reports/range.ts`, which the test plan praises at §6.1 for taking `today` as a **required parameter**. These two do not, so a component test needs `vi.setSystemTime` or an equivalent.

**`src/components/entries/date-utils.ts` is an ordinary §6.1 unit target today and is untested.** Zero imports, no JSX, no hooks, no fetch; every exported function takes its input as a parameter (`:9`, `:13`, `:17`, `:21`, `:27`, `:32`, `:55`). It is exactly the `range.ts` / `distribution.ts` shape §6.1 already calls out at `test-plan.md:230-238`. One caveat for oracle-writing: it constructs **local** `Date`s at `:23`, `:29`, `:34`, so tests must pin `TZ`.

---

# Part 2 — Risk #6: what a viewport check can and cannot reach

## 2.1 The deciding fact — both shipped mechanisms are behind the session wall

`PROTECTED_ROUTES` is `["/dashboard", "/reports"]` (`src/middleware.ts:6`), prefix-matched at `:29`, redirecting at `:43-44`.

| Path                                                  | Anonymous GET                                  | Renders markup anonymously?                                               |
| ----------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| `/`                                                   | 302 (`src/pages/index.astro:3`)                | **Never renders, for anyone** — the file is frontmatter only, no template |
| `/dashboard`                                          | 302 → `/auth/signin`                           | no — session required                                                     |
| `/reports`                                            | 302 → `/auth/signin`                           | no — session required                                                     |
| `/auth/signin`, `/auth/signup`, `/auth/confirm-email` | 200                                            | **yes**                                                                   |
| `/categories`                                         | 302 → `/dashboard` (`src/middleware.ts:12-14`) | no markup                                                                 |

`Topbar` — the S-11 surface, which renders the email only in the `user ?` branch (`src/components/Topbar.astro:33-35`) — is imported **only** by `dashboard.astro:3` and `reports.astro:3`. `ReceiptReview` — the S-12 surface — is mounted from `ReceiptCapture.tsx:377` ← `DayView.tsx:248`, on `/dashboard` only.

**So a check that navigates to URLs cannot exercise either shipped mechanism without an authenticated session.** The three anonymous pages are one shell (`bg-cosmic flex min-h-screen items-center justify-center p-4` → `w-full max-w-sm …`) with **zero user-supplied strings** except `Astro.url.searchParams.get("error")`.

`lessons.md:33` says this is "_verifiable cheaply in headless Chromium against the built CSS; no dev server or sign-in needed_" — that is true of a **hand-written HTML fixture** that reproduces component markup and links the built stylesheet. It is **not** true of visiting the live route. Do not read the lesson as endorsing the URL-visiting variant as session-free.

**Faking a session has no seam.** `src/lib/supabase.ts:12` reads the raw `Cookie` header via `@supabase/ssr`'s `parseCookieHeader`, and `src/middleware.ts:20-23` calls `supabase.auth.getUser()`, which validates against the Supabase server. A real sign-in against local Supabase using the seed users (`supabase/seed.sql:57,65`) is the only way to make `/dashboard` render as shipped.

## 2.2 What the build emits

`output: "server"` (`astro.config.mjs:11`), adapter `cloudflare()` (`:37`), and `grep -rn "prerender" src/` returns **nothing**.

Verified against the stale local build (gitignored, `.gitignore:14-15`): `find dist -name '*.html' | wc -l` → **0**. No static HTML for any page. `dist/client/` holds only `_astro/`, favicon, template image and sitemaps; `dist/server/` holds the Worker bundle.

**But the stylesheet is a single standalone file a fixture can link**: `dist/client/_astro/Layout.<hash>.css` (~49 KB), referenced from the Worker bundle and injected as a `<link>` into every SSR response. It contains everything needed — all Tailwind utilities (`.max-w-full{max-width:100%}` and `.break-all{word-break:break-all}` both verified present), the `@utility bg-cosmic` gradient, `Banner.astro`'s scoped styles, and Layout's global rule. **The filename is content-hashed and changes on every CSS edit**, so a fixture must resolve it by glob, never by literal.

## 2.3 Nothing masks the symptom — and one rule is fragile

`grep -o "overflow-x:[^;}]*"` over the built CSS returns **zero hits**. There is no `overflow-x: hidden` on `html`, `body`, or any wrapper anywhere in the repo. A `documentElement.scrollWidth > clientWidth` assertion will see real overflow.

The one global rule is `src/layouts/Layout.astro:50-55`, emitted unscoped as `html,body{margin:0;width:100%;height:100%}`. `width: 100%` resolves against the initial containing block and does **not** clip, so `clientWidth` stays the viewport width while `scrollWidth` grows. **This is load-bearing for the gate**: anyone "tidying" it into `max-width: 100vw` + `overflow-x: hidden` would silently disable the entire check while making every page look fixed. Worth a comment pointing at the test.

## 2.4 The blind spot: `position: fixed` content

`src/components/ui/dialog.tsx:57` is `fixed top-1/2 left-1/2 … max-w-[calc(100%-2rem)]`. In Chrome a fixed-position box wider than the viewport does **not** contribute to the document's scrollable overflow — no scrollbar, no `scrollWidth` growth.

Consequence: **the cleanest unfixed instance of mechanism A in the repo will not fail a document-level check.** `CategoriesManager.tsx:470-483` renders `{category.name}` as a `font-medium` span with no `min-w-0` and no break rule, inside `flex items-center gap-2` inside `flex items-center justify-between gap-3` — textbook S-11 shape — and it renders only inside that dialog. The same applies to the `IconPicker` / add-form tree (`CategoriesManager.tsx:126-177,340-400`) and the enlarged-photo dialog (`ReceiptReview.tsx:420`).

This needs confirming in the target browser. If it holds, dialogs need a per-element measurement, or an explicit exclusion with the limit stated — the §6.4 precedent for writing down what a layer structurally cannot claim.

Two other surfaces are invisible for different reasons: Recharts tooltips (`chart.tsx:185`, `CategoryDonut.tsx:130`, `CategoryTrendChart.tsx:163`) exist only on hover, and never render on a static load.

## 2.5 The class, not the instance: lesson 4's recipe is in the shared primitive

`src/components/ui/button.tsx:8`, the `buttonVariants` base:

```
inline-flex items-center justify-center gap-2 whitespace-nowrap … shrink-0 …
```

`inline-flex` + `whitespace-nowrap` + `shrink-0`, and **no `max-w-full`**. Every `<Button>` in the app is therefore a non-shrinking, non-wrapping box whose width is its label's max-content — exactly the mechanism `lessons.md:35-43` describes. Only **two** call sites add the bound back: `ReceiptReview.tsx:192` (the S-12 fix itself) and `MonthCalendar.tsx:125`. `buttonVariants` is also applied to a `<label>` at `ReceiptCapture.tsx:326`.

`roadmap.md:245` already states the binding rule — "_anything using `self-start`, `w-fit` or `inline-flex` to avoid full width must carry `max-w-full`_" — and the primitive predates it.

## 2.6 Live AT-RISK inventory

**Mechanism A (unshrinkable user string in a flex row):**

| Anchor                                                                           | Why                                                                                                                                                                                                                                                                                                                                  | Verdict                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `CategoryPicker.tsx:95-104` — `{category.name}` in the chip                      | chip is itself `display:flex`; name is an anonymous flex item that cannot shrink. No `min-w-0`, no truncate, no `max-w-full`. Parent `flex flex-wrap gap-2` (`:81`) gives the chip its own line but not a narrower one. Rendered in **three** places (`EntryForm.tsx:255`, `DayEntriesList.tsx:262`, `ReceiptReview.tsx:281`,`:387`) | **AT RISK — highest**                                                    |
| `ReceiptReview.tsx:251-262` — same chip shape                                    | as above                                                                                                                                                                                                                                                                                                                             | **AT RISK**                                                              |
| `DayEntriesList.tsx:336-339` — `{entry.category.name}`                           | the sibling description one line below got `break-words` (`:71`, rationale `:68-70`); the category name did not. `min-w-0` sits on the column (`:335`), not on the name                                                                                                                                                              | **AT RISK**                                                              |
| `DayEntriesList.tsx:350-364` — amount + two `size-11` buttons in `flex shrink-0` | `formatCurrency` emits non-breaking spaces, so `−99 999 999,99 zł` is one unbreakable token; the block is explicitly `shrink-0`. ~215px of non-shrinkable width against ~216px of content at 320px                                                                                                                                   | **AT RISK in aggregate**                                                 |
| `CategoriesManager.tsx:470-483`                                                  | textbook S-11 shape, unfixed — **but see §2.4**, it is inside a fixed dialog                                                                                                                                                                                                                                                         | **AT RISK, likely unreachable by the check**                             |
| `ServerError.tsx:11-13` — the `?error=` string                                   | `flex items-center gap-2 …`, `shrink-0` on the icon, **no `min-w-0`, no break rule** on the text                                                                                                                                                                                                                                     | **AT RISK — and the only mechanism-A surface reachable with no session** |

Protected, and each is a regression guard worth pinning because removing it reintroduces a shipped bug: `Topbar.astro:35,69` (`min-w-0 break-all`, the S-11 fix); `DayEntriesList.tsx:71` (`break-words`), `:335` (`min-w-0`); `ReceiptReview.tsx:162`, `:192`, `:231`, `:326-328`; `CategoryRanking.tsx:51`; `CategoryDonut.tsx:132`; `CategoryTrendChart.tsx:169`; `MonthCalendar.tsx:125`; `input.tsx:11` (`w-full min-w-0` — this is why every `Input` shrinks).

**Mechanism B (intrinsic-width controls), beyond the primitive itself:**

| Anchor                       | Label / class                                                                                                                                                                                                                                                        | Verdict                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ReceiptReview.tsx:376`      | `Zapisz jako jeden wpis ({formatCurrency(total)})` — ~36 chars on a nowrap primitive, amount non-breaking-spaced. Parent `flex flex-wrap gap-2` (`:359`)                                                                                                             | **AT RISK — longest hardcoded label in the repo**                                       |
| `ReceiptReview.tsx:400`      | `Zapisz jeden wpis (…)` inside a `flex flex-col` fixed box (`:385`) — cross-axis stretched, nowrap label overflows                                                                                                                                                   | **AT RISK**                                                                             |
| `CategoryPicker.tsx:120`     | `… self-start rounded-full px-3 …`, **no `max-w-full`** — the one remaining unpaired `self-start` in the repo. It is `flex` not `inline-flex` and has no `whitespace-nowrap`, so it can wrap at the space; severity lower, but it violates `lessons.md:41` literally | **AT RISK**                                                                             |
| `ReceiptCapture.tsx:342-348` | `<input type="file">` with no `w-full` / `max-w-full`; a replaced control whose intrinsic width includes the UA-rendered filename and locale-dependent native button text                                                                                            | **UNCLEAR — not verifiable from source**                                                |
| `ui/LibBadge.astro:10`       | `inline-flex …` no bound                                                                                                                                                                                                                                             | **not reachable** — `grep -rn "LibBadge\|Welcome" src/` returns nothing. Dead component |

`MonthCalendar.tsx:125`'s `max-w-full` is load-bearing arithmetic worth pinning: 7 × 44px + 6 × 4px gap = 332px against ~240px of content at 320px, and `max-w-full` is what lets the grid squeeze the cells.

## 2.7 A decision the plan must make: when the assertion samples

`src/components/ui/chart.tsx:10` sets `INITIAL_DIMENSION = { width: 320, height: 200 }`, passed to Recharts' `ResponsiveContainer` at `:86`. On the server render and on the first client paint **before `ResizeObserver` fires**, every chart lays out at a hardcoded **320 CSS px** inside a container that is ~336px wide at a 390px viewport and ~240px at 320px. This is genuine document overflow present in the SSR HTML itself, on `/reports`, at four call sites (`TrendChart.tsx:49`, `CumulativeChart.tsx:129`, `CategoryTrendChart.tsx:138`, `CategoryDonut.tsx:113`).

Sampling early flags it; sampling late misses it — even though a real phone flashes it. Either answer is defensible; the plan must choose one and say so, because the choice silently determines whether `/reports` is covered.

## 2.8 Injection points for worst-case strings

| Surface                      | Source at runtime                                                                                                                                                                                            | Injectable without a database?                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Topbar email                 | `Astro.locals.user.email` (`Topbar.astro:2`) ← `src/middleware.ts:23`                                                                                                                                        | **No** — needs a real session, and an account created with a long address |
| Category names (A2/A3/A5/A7) | `GET /api/entries/categories` (`DayView.tsx:48-49`), `GET /api/entries` (`:88`), `GET /api/categories`                                                                                                       | **Only** by stubbing the fetch or seeding rows                            |
| Amount                       | same responses; bounded by `numeric(10,2)` → max `99 999 999,99 zł`                                                                                                                                          | same                                                                      |
| Receipt line names           | `POST /api/receipts/parse` (`ReceiptCapture.tsx:181-183`); real path needs an image, the AI Gateway, and `CF_AI_TOKEN`/`CF_ACCOUNT_ID`; names already server-truncated at `src/lib/services/receipts.ts:174` | **Only** by stubbing the parse response                                   |
| Entry description            | same `GET /api/entries`; client-capped at 200 code points (`EntryForm.tsx:279`, `DayEntriesList.tsx:305`)                                                                                                    | fetch stub or seeded rows                                                 |
| **Auth error**               | `Astro.url.searchParams.get("error")` (`signin.astro:5`, `signup.astro:5`) → `ServerError.tsx:12`                                                                                                            | **YES — pure URL.** No auth, no database, no JS                           |
| Filename                     | never rendered by app code — `ReceiptCapture.tsx:156` hardcodes `"paragon.jpg"`                                                                                                                              | not app-controlled                                                        |

**There is exactly one worst-case string this risk cares about that a bare URL can inject, and it is on an anonymous page.** Everything else needs a signed-in session plus seeded rows, or request-level response stubbing. Any plan promising "realistic worst-case user strings on every page" is committing to one of those two capabilities.

## 2.9 Surface count — and why URL count understates it

**7 URL paths exist; 5 produce markup; 3 are anonymously reachable; there are only 2 shells.**

- Three auth pages are byte-for-byte the same wrapper (`signin.astro:9-10`, `signup.astro:9-10`, `confirm-email.astro:22-25`), differing only in which form fills the `max-w-sm` card. Layout-wise, one surface; the only thing worth varying is `?error=`.
- Two app pages differ only in `max-w-2xl` vs `max-w-4xl` (`dashboard.astro:8-14`, `reports.astro:35-44`, rationale `reports.astro:8-10`).

Two shells is exactly why `lessons.md:29,33` says one component's overflow reads as a global fault: `bg-cosmic` paints one viewport-width on both, while `body`'s near-black `bg-background` (`src/styles/global.css:139-141`) fills the canvas beyond it.

**But the risky markup is behind client state no URL reaches.** `/dashboard` alone has at least six distinct render states — idle, `ReceiptCapture` expanded (`ReceiptCapture.tsx:282`), `ReceiptReview` mounted (`:377` — the S-12 surface), `CategoryManagerDialog` open (`EntryForm.tsx:297`), per-row inline edit (`DayEntriesList.tsx:241`), `CategoryPicker` expanded (`CategoryPicker.tsx:113`). Only `/reports`' two boards are URL-addressable, via `ReportsView.tsx:99`'s `pushState` (`?board=categories&range=ytd&recurring=hidden`).

A pure "visit N URLs at 3 widths" check covers the two shells, the auth error string, and the `/reports` boards. It does **not** reach the category chips, `CategoriesManager`, the receipt review, or the S-12 surface itself.

**One environment-dependence to control for:** `Layout.astro:29-44` prepends a `Banner` per entry in `missingConfigs` (`src/lib/config-status.ts:30`). With Supabase and the AI Gateway both unset, **two** full-width banner strips render above every page. They wrap normally (`Banner.astro:16-21`) so they are not themselves an overflow risk, but their presence depends on env vars and will differ between a local run and CI.

---

# Part 3 — Harness constraints

## 3.1 The expensive question does not bind this phase

**Not one island in `src/components/entries/`, `categories/`, `receipts/`, or `reports/` reaches an `astro:*` or `cloudflare:workers` specifier — directly or transitively.** Repo-wide there are exactly six such importers, all outside the island graph: `src/middleware.ts:1`, `src/lib/config-status.ts:1`, `src/lib/services/receipts.ts:3`, `src/lib/supabase.ts:3`, `src/pages/api/receipts/parse.ts:2`, `src/lib/receipt-image.ts:11`.

Worth noting because the name misleads: `receipts/image-downscale.ts` is a real module with **zero imports** — it does **not** go through `src/lib/receipt-image.ts`, the `cloudflare:workers` one.

So §6.1's direct-vs-transitive fork, which cost Phases 2–4 their thinking, is not this phase's problem. **What blocks component tests is the missing DOM environment and React renderer.**

The third-party surface that _does_ bind is different: `recharts@3.10.1` (4 report islands directly, plus everything importing `ui/chart.tsx:2`), which sizes itself from container measurements; `radix-ui@1.6.7` via `ui/{checkbox,dialog,label}.tsx`, reached by `EntryForm`, `CategoriesManager`, `ReceiptReview`, `RecurringToggle`, `CategoryManagerDialog`, using portals and focus traps; and `ReceiptCapture.tsx:1`'s `useSyncExternalStore` plus `image-downscale.ts`'s Canvas / `createImageBitmap`. **None of these was verified under a DOM shim** — see Open Questions.

For the record, the entries islands are the _light_ end of that spectrum: `MonthCalendar.tsx` imports only react, `ui/button`, and `@/lib/utils`; `DayEntriesList.tsx` reaches `radix-ui` only through `ui/label`; `DayView.tsx:5` pulls the whole receipts subtree in via `ReceiptCapture`.

## 3.2 The glob will silently not collect a `.test.tsx`

`vitest.config.ts:22` is `include: ["src/**/*.test.ts"]` — a literal `.ts` suffix, which does **not** match `foo.test.tsx`. A component test written as `Component.test.tsx` would be **silently never collected**: no error, just a suite that does not exist. Either the glob widens to `*.test.{ts,tsx}`, or component tests keep `.ts` and cannot contain JSX under `jsx: "react-jsx"`. **Hard prerequisite.**

`lint-staged` already globs `*.{ts,tsx,astro}` (`package.json:68`), so pre-commit picks up a `.test.tsx` with no change. `tsconfig.json:3`'s `include: ["**/*"]` covers it too, and `eslint.config.js:17-18`'s `projectService: true` means type-aware lint reaches it.

## 3.3 What the standalone config does not inherit

`vitest.config.ts` sets exactly two things: the `@` alias (`:17-19`) and the include glob (`:22`). No `environment`, no `plugins`, no `setupFiles`. There is no `vitest.workspace.*` file.

From `astro.config.mjs`, a component test would plausibly need — and does **not** inherit:

- **`resolve.dedupe: ["react", "react-dom"]`** — confirmed present at `astro.config.mjs:25-27`, with an 8-line rationale at `:18-24`: without it Vite's pre-bundling can produce two `react-dom` instances, each with its own `ReactSharedInternals`, throwing `Cannot read properties of null (reading 'useHostTransitionStatus')` and crashing hydration.
- **`vite.plugins: [tailwindcss()]`** (`:17`) — and this is the structural argument for keeping the two capabilities separate. `src/styles/global.css` is imported exactly once, from `Layout.astro:2`, never from any `.tsx`. Under the current Vitest config **no Tailwind CSS is generated or applied**, so a rendered island has zero computed styles and every `className` is an inert string. **Overflow cannot be asserted at the component layer**; it is a property of the built CSS, which only exists after `astro build`.
- **`integrations: [react(), …]`** (`:15`) — what installs the React/JSX Vite plugin into the Astro build.

There is no `define`, no `optimizeDeps`, and no second alias in `astro.config.mjs`.

**Do not re-spike `getViteConfig`.** `context/archive/2026-08-21-testing-runner-bootstrap/research.md:578-587` already carries a section titled "Implication for test-plan Phase 5 (React `resolve.dedupe`)", concluding: "_Phase 5 must **restate** `dedupe` (and the React plugin, and `environment: "jsdom"`) in the standalone Vitest config, and accept that it is now a second copy that can drift from `astro.config.mjs`. Worth a comment in both files pointing at the other._" The same file at `:289-292` predicted an ESLint test-file override would be needed.

## 3.4 What is and is not installed

| Package                                                                            | Status                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jsdom`, `happy-dom`                                                               | **absent from `node_modules` and from `package-lock.json` entirely** — but both are declared optional peers of the installed `vitest@4.1.11`                                                                |
| `@testing-library/{react,dom,user-event,jest-dom}`                                 | **absent from the lockfile entirely**                                                                                                                                                                       |
| `playwright`, `@playwright/test`, `puppeteer`, `puppeteer-core`, `chrome-launcher` | **absent from the lockfile entirely**                                                                                                                                                                       |
| `@vitest/browser`                                                                  | **absent — and at 4.1.11 that is not the package name.** Browser mode is split into `@vitest/browser-{playwright,preview,webdriverio}`, none installed                                                      |
| `@vitejs/plugin-react@5.2.0`                                                       | **present but transitive** — an optional dependency of `@astrojs/react@5.0.4`, hoisted. Not in `package.json`. Depending on it from `vitest.config.ts` would rely on hoisting, not on a declared dependency |
| `@cloudflare/vite-plugin@1.36.3`                                                   | present, transitive via `@astrojs/cloudflare` — this is the package that breaks `getViteConfig`                                                                                                             |
| `vitest` / `vite`                                                                  | `4.1.11` pinned exact (`package.json:61`) / `7.3.3` via root `overrides` (`:64-66`)                                                                                                                         |

So the DOM environment is a plain add of an already-declared optional peer; every browser-driving option is a from-zero add.

## 3.5 Lint applies the full production React ruleset to test files

`eslint.config.js` has **no test-file override** — its only `files:` scopes are `**/*.{js,jsx,ts,tsx}` (`:41`) and `**/*.astro` (`:63`), and the base block (`:14-38`) has no `files` at all. For a `.tsx` test file this means, at **error** severity:

- **`react-compiler/react-compiler`** (set explicitly at `:58`).
- **All 34 `astro/jsx-a11y/*` rules** — `eslint.config.js:90` spreads `eslintPluginAstro.configs["flat/jsx-a11y-recommended"]`, whose final element has **no `files` key**, so they apply to `.tsx` too: `label-has-associated-control`, `click-events-have-key-events`, `no-static-element-interactions`, `role-supports-aria-props`, and the rest.
- **`react-hooks/*` v7 at error**, including `rules-of-hooks`, `purity`, `set-state-in-effect`, `static-components`, `preserve-manual-memoization`.
- **`eslint-plugin-react` recommended at error**: `jsx-key`, `display-name`, `no-unescaped-entities`.

Practical consequence: **inline JSX harness components written as arrow functions inside a `describe` will fail `react-hooks/static-components` and `react/display-name`.** This is on top of the `strictTypeChecked` consequences §6.2 already records at `test-plan.md:340-345`.

## 3.6 Where the two gates slot into CI

`.github/workflows/ci.yml` triggers on `push` to `master` **and** `pull_request` targeting `master` (`:3-7`).

- **`ci`** (`:10-32`) has **no trigger guard** — it runs on both. Steps: `npm ci` (`:20`) → `npx astro sync` (`:21`) → lint (`:22`) → typecheck (`:27`) → **`npm run test` (`:28`)** → `npm run build` (`:29`).
- **`db-test`** (`:38-67`) and **`deploy`** (`:69-113`) are both guarded `if: github.event_name == 'push'` (`:39`, `:70`) — master-push only, confirming §5's characterisation.

**Component tests** need **zero workflow change**: if the glob widens, they are collected by the existing `npm run test` at `:28`, and the gate becomes required by virtue of files existing. A separate Vitest project for a `jsdom` environment is still fronted by that one command.

**The overflow check** needs a new step, and §5's "CI on PR" is already satisfied because `ci` runs on PRs unguarded. The natural position is **after `npm run build` (`:29`)** — the check needs built CSS, and `ci` is the only job that builds on a PR. Placing it before `build` would test against no CSS at all.

Two costs worth naming: adding a browser dependency enlarges `npm ci` on **all three** jobs, including `db-test` (`:54`) and `deploy` (`:82`), which have no use for it. And the `db-test` job's `if: failure()` log-dump step (`:66-67`) exists because a failure mode there produced illegible output — a browser step has a comparable class of opaque failure and deserves the same precedent.

## 3.7 The per-edit hook layer is not greenfield

- **`.husky/`** exists with exactly one file, `pre-commit`, containing `npx lint-staged`. No `pre-push`.
- **`lint-staged`** (`package.json:67-74`) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}` — **no test invocation, no typecheck**.
- **`lefthook.yml` is absent**; Lefthook is not installed.
- **`.claude/settings.json` already carries a `PostToolUse` hook** matching `Write|Edit` that pipes the edited path into `npx eslint --fix … --quiet` and ends in `; true`, so it never blocks.

So §5's "post-edit hook — recommended after §3 Phase 5" is half-built: the lint half exists and is non-blocking; the test and overflow halves do not. (Configuring it remains out of this lesson's scope.)

---

## Code References

**Risk #5 — the guards to pin:**

- `src/components/entries/DayView.tsx:31` — the single `Entry[] | null` the whole feature renders from
- `src/components/entries/DayView.tsx:34-37`, `:122`, `:144`, `:159` — the `selectedDateRef` day guard (incident **(a)**'s fix)
- `src/components/entries/DayView.tsx:133`, `:150-151` — the id dedupe (incident **(b)**'s fix)
- `src/components/entries/DayView.tsx:127-129`, `:147-149` — the `prev === null` drop (unguarded gap 2)
- `src/components/entries/DayView.tsx:78-106` — the day GET and its per-effect `cancelled` flag
- `src/components/entries/DayView.tsx:94` — the wholesale replace that loses a just-appended row (unguarded gap 1)
- `src/components/entries/DayView.tsx:191-194`, `:196-206` — the only optimistic patch, and the `entriesRefreshKey` lever it pulls
- `src/components/entries/DayView.tsx:262` — `key={selectedDate}` (incident **(c)**'s fix)
- `src/components/entries/DayEntriesList.tsx:101-116` — all seven pieces of edit state, in the parent
- `src/components/entries/DayEntriesList.tsx:128-140` — `startEdit`, which re-seeds the unkeyed draft
- `src/components/entries/DayEntriesList.tsx:372` — `disabled={saving}` on `Edytuj` (incident **(c)**'s other half); contrast `:387`, where `Usuń` is not
- `src/components/entries/DayEntriesList.tsx:189-192` — DELETE treats 404 as success
- `src/components/entries/date-utils.ts` — zero imports, fully parameterised, untested: a free §6.1 unit target
- `src/lib/format.ts:5-10` — the `Intl.NumberFormat("pl-PL")` that emits U+00A0

**Risk #6 — the deciding anchors:**

- `src/middleware.ts:6` — `PROTECTED_ROUTES = ["/dashboard", "/reports"]`, the fact that gates everything
- `src/pages/index.astro:3` — `/` is frontmatter-only and never renders markup
- `src/layouts/Layout.astro:50-55` — `html,body{margin:0;width:100%;height:100%}`, unmasked and fragile
- `src/components/ui/button.tsx:8` — `inline-flex whitespace-nowrap shrink-0` with no `max-w-full`, in the shared primitive
- `src/components/ui/dialog.tsx:57` — `position: fixed`, the blind spot
- `src/components/ui/chart.tsx:10`, `:86` — `INITIAL_DIMENSION = { width: 320 }`, the timing decision
- `src/components/entries/CategoryPicker.tsx:95-104` — the unbounded category chip, rendered in three places
- `src/components/entries/CategoryPicker.tsx:120` — the one remaining unpaired `self-start`
- `src/components/receipts/ReceiptReview.tsx:192` — the S-12 fix, with the canonical rule stated at `:186-191`
- `src/components/receipts/ReceiptReview.tsx:376`, `:400` — the two longest hardcoded labels
- `src/components/Topbar.astro:35,69` — the S-11 fix (`min-w-0 break-all`), rationale at `:21-26`
- `src/components/auth/ServerError.tsx:11-13` — the only anonymously-injectable user string
- `src/components/categories/CategoriesManager.tsx:470-483` — unfixed mechanism A, inside a fixed dialog

**Harness:**

- `vitest.config.ts:22` — the glob that will not match `.tsx`
- `astro.config.mjs:25-27` — `resolve.dedupe`, with rationale at `:18-24`
- `astro.config.mjs:17` — the Tailwind Vite plugin the standalone config does not inherit
- `eslint.config.js:90` — the unscoped `jsx-a11y` spread
- `.github/workflows/ci.yml:28-29` — where both gates slot in

---

## Architecture Insights

1. **This island is defensive by accretion, not by design.** Three separate impl-reviews each added one guard to `DayView`. The result is correct but the guards are individually deletable, mutually load-bearing, and documented only in prose in three archived review files. That is precisely the shape §6.2's characterisation rule was written for.

2. **Server-echo is the house pattern, and it is why the failure mode is subtraction rather than duplication.** Because nothing is optimistic, there is no rollback to get wrong. Every remaining failure is "a truthful row never reaches the list, or is replaced by a stale snapshot." A test suite written to the risk statement as phrased — hunting duplicates — would look in the wrong direction.

3. **`src/components/` is still not the component layer.** §6.1 learned this in Phase 3 with `range.ts` and `distribution.ts`; `date-utils.ts` is the third instance and is uncovered today. Before concluding that something under `src/components/` needs the new runner, read its imports.

4. **Parameterised time is the difference between a unit target and an environment fake.** `range.ts` takes `today` as a required parameter and is testable with no clock faking; `DayView.tsx:15` and `MonthCalendar.tsx:61` read `new Date()` internally and are not. The design choice, not the layer, decides the cost.

5. **The two capabilities cannot be merged, and the reason is structural.** Under Vitest there is no Tailwind plugin and no CSS, so a rendered island has no computed styles; overflow is a property of built CSS that exists only after `astro build`. Component tests answer risk #5 and cannot answer risk #6.

6. **Risk #6's real subject is a primitive, not a page.** `button.tsx:8` bakes lesson 4's exact recipe into every button in the app, with the bound restored at only two call sites. Any check that enumerates pages will keep finding new instances of one class.

7. **A document-level assertion has a matching blind spot to its strength.** It is immune to CSS masking (there is none) but blind to fixed-position content — and the repo's cleanest unfixed bug lives in a dialog. Whatever the plan chooses, §6.4's precedent applies: write down what the layer structurally cannot claim, in the file's header comment.

---

## Historical Context (from prior changes)

- `context/archive/2026-08-15-daily-expense-entry/reviews/impl-review.md:31-39` — incident (a), the stale-day race, and the `selectedDateRef` fix (commit `a754080`).
- `context/archive/2026-08-15-income-and-entry-management/reviews/impl-review.md:37-45` — incident (b), the duplicate row; `:47-64` — incident (c), shared edit state. Both fixed in commit `0b8bd2a`. `:56` and `:58` record the remount fix's **unresolved** tradeoff and blind spot.
- `context/archive/2026-08-15-income-and-entry-management/plan.md:408` — the sole manual regression checkbox: "Editing mid-navigation does not splice a row into the wrong day (S-02 F1 regression)".
- `context/archive/2026-08-21-testing-receipt-confirm-integrity/research.md:582-585` — the explicit **handoff to Phase 5** of the `prev === null` drop; `:204` warns that `ReceiptCapture` is deliberately **not** keyed on `selectedDate` (`DayView.tsx:243-252`), a purposeful exception to incident (c)'s remount strategy that Phase 5 must not "fix".
- `context/archive/2026-08-21-testing-runner-bootstrap/research.md:578-587` — the `resolve.dedupe` / `getViteConfig` question, already answered; `:289-292` predicts the ESLint test-file override.
- `context/archive/2026-08-16-receipt-parsing/research.md:317` — records the `const cancelled = { current: false }` closure guard as a deliberate house idiom chosen over `AbortController`.
- `context/foundation/roadmap.md:233` — S-11's measurement, which the Phase 5 check should reproduce: "_At 360px the bar's min-content came to 422px […] Measured before and after in headless Chromium at 320/360/390/768/1280 (`scrollWidth` vs `clientWidth`): 422/360 → 360/360._"
- `context/foundation/roadmap.md:234`, `:265-266`, `:302-303` — confirm both S-11 and S-12 shipped "_directly on `master`, no plan or change folder_". Verified: no such folder exists in `context/changes/` or `context/archive/`. The commits are **`12ea5ed`** "Mobile view fixes" (2026-08-18) and **`c2b8781`** "Fix receipt review view, improve top bar" (2026-08-18) — both with bare, non-conventional messages carrying no change-id, unlike every planned slice.
- **What those diffs actually changed** matters for what a guard must catch. S-11: `Topbar.astro` gained `flex-wrap-reverse … gap-x-4 gap-y-2` and `min-w-0 break-all` on the email; `ReportsView.tsx` lost its `sticky top-0 … backdrop-blur-md` pinning. S-12: `ReceiptReview.tsx` changed **one class token** (`self-start` → `max-w-full self-start`) and **one label string** (`Wróć do dnia z kalendarza ({occurredOn})` → `Ustaw obecny dzień`). **A class-list lint would have missed the label half entirely, and a pixel snapshot would never have said the document overflowed.** That is the argument for the rendered-document measurement, from the record rather than from first principles.
- `context/foundation/roadmap.md:233` also leaves a standing constraint: "_Anything that pins a control bar again inherits that trade._"

---

## Corrections to `test-plan.md` this research produced

Recorded here because §1 principle #3 says research is ground truth where the two disagree.

1. **"An optimistic update" has no subject in the entries island.** §2's risk-#5 _Must challenge_ column leads with "that an optimistic update matches the server's result." Every entry write path is server-echo (§1.2). The only optimistic patch is on category lists, and it matters as a _refetch trigger_, not as a state-matching question. The challenge worth keeping is the one underneath it: _does a mutation response and a concurrent refetch of the same day agree._

2. **The risk statement names duplication; the live gaps are subtractive.** Two unguarded paths lose a truthful row (§1.4). Neither is in §2's source column, and one was explicitly handed forward by Phase 2's research.

3. **`lessons.md:33`'s "no dev server and no sign-in needed" is strategy-specific.** True of a static fixture; false of visiting a URL, because both shipped mechanisms are behind `PROTECTED_ROUTES` (§2.1). §2's risk-#6 row already asks research to settle this — the answer is that the URL-visiting variant needs auth.

4. **The churn figures are file-touch counts, not commit counts, and one claim overstates.** The numbers reproduce exactly for the window `2026-07-22 … 2026-08-21` — `entries/` 35, `reports/` 40, `lib/services/` 21, `receipts/` 14, `migrations/` 14 — but those are `--name-only` line counts; the corresponding **commit** counts are 16, 13, 17, 7 and 12. §1's "49 commits" baseline is correct as stated. §2's "_the three top-churning files in the repo all sit in it_" is **not supported**: the top files are `DayEntriesList.tsx` (10), then a three-way tie at 9 between `src/types.ts`, `EntryForm.tsx` and `CategoriesManager.tsx`. The defensible restatement is **"`entries/` holds the single most-churned file and 3 of the top 5."** Also worth noting: `src/components/Topbar.astro` is itself a top-10 churn file at 7 touches, and it is the risk-#6 surface.

5. **The interview answers for Q2, Q3 and Q4 are not on disk.** Searched every `.md` under `context/`; the only occurrences of those citations are the citations themselves (`test-plan.md:45,46,49,50` and the paraphrase in this change's `change.md:19,26`). `test-plan.md` first entered git in commit `b2aec29`, after the interview, so history carries no earlier draft. Only **Q5** survives, indirectly, as §7's four exclusion bullets. A plan cannot quote more than the one-line characterisations; if exact wording matters it has to be re-asked.

---

## Related Research

- `context/archive/2026-08-21-testing-runner-bootstrap/research.md` — the runner, the `getViteConfig` dead end, and the explicit Phase 5 `resolve.dedupe` handoff (`:578-587`).
- `context/archive/2026-08-21-testing-receipt-confirm-integrity/research.md` — the recording Supabase fake, the extraction precedent (`review-model.ts`), and the `prev === null` handoff (`:582-585`).
- `context/archive/2026-08-21-testing-reports-aggregation-truth/research.md` — the `max_rows` truncation finding, and §6.6's note that both boards discard the error body and render a generic message, deferred to "_a UI change that needs the component layer §3 Phase 5 delivers_" (`test-plan.md:569-576`).
- `context/archive/2026-08-22-testing-cross-user-isolation/research.md` — the route-context fixture and the "_state what the layer cannot claim_" header-comment convention this phase should copy.
- **Nothing on disk researches the viewport side.** No `research.md` anywhere mentions `scrollWidth`, viewport widths, or headless Chromium. Risk #6's only prior art is the S-11 roadmap paragraph and the two `lessons.md` entries — incident narrative, not research.

---

## Open Questions

**Unverifiable without installing or running something** (the user scoped this research read-only; every item below is inherited by the plan as an explicit unknown):

1. Whether `jsdom` or `happy-dom` boots under this standalone config. Both are optional peers of the installed `vitest@4.1.11`, both absent from `node_modules` **and** from `package-lock.json`.
2. Whether restating `resolve.dedupe` suffices, or component rendering also needs `@vitejs/plugin-react` in `plugins` — and whether depending on it is acceptable given it is only a hoisted transitive optional dependency of `@astrojs/react`, not a declared one. Whether Vitest's own esbuild transform handles `.tsx` under `jsx: "react-jsx"` without it is untested.
3. Whether `recharts@3.10.1` renders at all under a DOM shim, given it measures its container. Reached by four report islands directly and by every consumer of `ui/chart.tsx`.
4. Whether `radix-ui@1.6.7` Dialog/Checkbox/Label (portals, focus traps, `ResizeObserver`) work in the chosen environment.
5. Whether `ReceiptCapture`'s `useSyncExternalStore` and `image-downscale.ts`'s Canvas / `createImageBitmap` are satisfiable outside a real browser. **Relevant to risk #5 specifically**, because `DayView.tsx:5` imports `ReceiptCapture` — testing `DayView` at all drags this in unless it is mocked.
6. Whether `ubuntu-latest` provides a usable headless Chromium and its system libraries, and the wall-clock cost of any browser install on a PR. `ci.yml:11` states only `runs-on: ubuntu-latest`; the file says nothing about browsers, and there is no browser-binary cache step.
7. **Whether a `position: fixed` box wider than the viewport contributes to `documentElement.scrollWidth` in the target browser.** §2.4 assumes it does not. This single answer decides whether dialogs — including `CategoriesManager`'s unfixed instance — are covered or must be excluded in writing.
8. The current whole-suite runtime. Docs claim ~460 ms (`test-plan.md:316`) but that predates Phases 3–4; there are now 15 test files and 223 `it(` calls. Any per-edit-hook cost budget rests on an unmeasured number.
9. Whether widening the glob to `*.test.{ts,tsx}` disturbs the existing 15 suites (expected: no).

**Decisions for the plan, not unknowns:**

10. **Fixture or session?** A hand-written HTML fixture linking `dist/client/_astro/Layout.*.css` (resolved by glob) reaches every component's markup with no auth and no database, but asserts against markup a human transcribed — it can drift from the real page silently. A signed-in render against local Supabase seed users reaches the real pages but needs a running stack, and still cannot reach the interaction-gated states (§2.9) without driving the UI. §2.8 shows only the `?error=` string is injectable by URL alone.
11. **When does the assertion sample?** §2.7 — before or after `ResizeObserver` settles the charts. The answer silently determines whether `/reports` is covered.
12. **How far does risk #5's suite reach up the tree?** Testing `DayView` covers all four write paths and both race guards but drags in `ReceiptCapture` (open question 5). Testing `DayEntriesList` alone covers the edit-state incident cleanly but cannot reach `handleSaved` / the day guard at all.
13. **Whether to write the two subtractive gaps (§1.4) as failing tests or as documented findings.** They are live defects, not regressions — §7's precedent for accepted risk exists, as does Phase 2's precedent (F2, the code-point/code-unit bound) for recording a found defect without fixing it in the same phase.
