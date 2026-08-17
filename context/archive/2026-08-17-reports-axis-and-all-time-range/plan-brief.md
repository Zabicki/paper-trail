# Reports Readability Fixes — Plan Brief

> Full plan: `context/changes/reports-axis-and-all-time-range/plan.md`

## What & Why

Two defects on the already-shipped `/reports` surface make correct numbers unreadable. Every chart's Y-axis is boxed at 44px while its ticks are `pl-PL` compact amounts (`12,5 tys.` — nine characters), so the leading digit is clipped for any bucket above 1000 zł. And `Cały okres` resolves to a relative twenty-year floor, so it plots ~252 empty month buckets in front of the few the user actually has.

## Starting Point

Three charts hardcode the same `<YAxis … width={44} …>` (`TrendChart.tsx:62`, `CumulativeChart.tsx:140`, `CategoryTrendChart.tsx:139`). Range presets resolve entirely client-side in `range.ts`, where `ALL_TIME_YEARS_BACK = 20` carries a comment explaining itself as a workaround for the aggregate's `MAX_BUCKETS = 400` guard. There is no first-entry-date lookup anywhere in the repo, and no page reads Supabase server-side today.

## Desired End State

Y-axis ticks read in full at every magnitude, on both boards and all three charts, desktop and mobile. `Cały okres` plots from the user's earliest entry to today — so a three-week-old account gets day buckets over three weeks instead of 252 empty months — and falls back to the account-creation date when there are no entries at all.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Axis fix mechanism | `width="auto"` | Typed and supported at the pinned Recharts 3.10.1, and correct at every magnitude — no constant to re-tune as amounts grow. |
| Zero-entry all-time | Account-creation date | Reuses the exact floor `api/entries/days.ts:52` already applies to missing-day clamping, so both surfaces agree on how far back the account goes. |
| Recurring filter ↔ all-time start | Unfiltered earliest entry | Keeps the X-axis fixed when the toggle flips, so the filter changes the bars rather than silently re-scaling the chart — and needs one lookup per page load, not one per toggle. |
| Back-dated outlier (year `0202`) | Clamp the start | Caps the span at what the 400-bucket guard allows (~33 years), so one absurd row can never take the whole preset down. |
| First-entry delivery | Server prop on `reports.astro` | The value is needed before the first summary request can be built, so a route would add a sequential round trip and a loading branch; folding it into the summary endpoint would mean a second copy of `bucketFor` server-side. |
| Scope | Strictly the two fixes | The raw ISO caption and every other shipped behaviour stay untouched. |
| Phasing | One phase | Both halves are small, share no code, and share one verification surface. |

## Scope

**In scope:** `width="auto"` on the three chart axes; `getFirstEntryDate` in `src/lib/services/reports.ts`; server-resolved `allTimeStart` on `reports.astro`; `resolveRange` gaining a third required parameter plus the guard-safe clamp; the prop threaded through `ReportsView` to both boards.

**Out of scope:** the range caption's format; `MAX_BUCKETS` / `bucketCountUpperBound` / the truncation check; `formatCurrencyCompact` and every other formatter; the recurring filter's semantics; `bucketFor`; both aggregate endpoints and RPCs; `min`/`max` on the entry date input; any migration, index or new API route.

## Architecture / Approach

```
reports.astro (server)
  ├─ createClient(headers, cookies) → getFirstEntryDate()  → "2026-08-02" | null
  ├─ Astro.locals.user.created_at                          → "2026-08-01"
  └─ allTimeStart = firstEntry ?? accountCreated ?? today
        └─ <ReportsView allTimeStart={…} client:load />
              ├─ OverviewBoard   → resolveRange(preset, today, allTimeStart)
              └─ CategoriesBoard → resolveRange(preset, today, allTimeStart)
```

Only the start date of one preset moves from a hardcoded constant to a server-resolved value; range resolution stays client-side, where `today` has to be a browser-local date. The clamp lives inside the `all-time` branch so no caller can forget it. `entries_user_id_occurred_on_idx (user_id, occurred_on)` already covers the lookup under the RLS predicate — no migration.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Legible axes and a real all-time range | Unclipped Y-axis ticks on all three charts; `Cały okres` starting at the first entry with an account-creation fallback and a guard-safe clamp | `width="auto"` is measurement-driven, so it can only be proven by looking at it — and `reports.astro` becomes the repo's first page to call `createClient()`, which must be null-checked or an unconfigured deploy 500s the page |

**Prerequisites:** S-04 and S-05 shipped (both archived). Local Supabase stack with at least one account holding entries, plus a second account holding none, for the zero-entry check.
**Estimated effort:** ~1 session.

## Open Risks & Assumptions

- `width="auto"` measures rendered tick text; if it oscillates or leaves an oversized gutter at small magnitudes, the fallback is a shared fixed constant sized to the worst realistic tick. Manual verification covers both.
- The first-entry date is resolved once per page render, so a user who logs their very first entry in another tab keeps the account-creation fallback until they reload. Only the zero-to-one transition is affected.
- **Neither half is reachable by automated verification.** There is no test framework in this repo, and pgTAP cannot see rendering or client arithmetic — so lint/build prove only that it compiles, and the manual checklist is the actual release gate. Per `lessons.md`, that manual step is a standing re-verification requirement for any future change to `resolveRange` or the chart axes.

## Success Criteria (Summary)

- No chart on either board clips a Y-axis label, at any range or viewport width.
- `Cały okres` starts at the user's first recorded entry, agrees across both boards, and does not move when the recurring filter is toggled.
- A brand-new account sees `Cały okres` starting at its creation date with the normal empty-state copy — never an error.
