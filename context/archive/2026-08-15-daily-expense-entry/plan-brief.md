# Daily Expense Entry (S-02, North Star) — Plan Brief

> Full plan: `context/changes/daily-expense-entry/plan.md`

## What & Why

PaperTrail's north star: a user can log a routine expense against today in ≤4 interactions and ≤10 seconds, and can back-date to a missed day as a first-class path rather than a buried one. This is the flow that has to work for the product's whole bet — that removing input friction is enough to retire the Google Sheet — to be provable at all.

## Starting Point

Only `categories` (S-01) exists as a domain table, with a proven per-user RLS pattern and a client-fetch-JSON-API-plus-React-island convention established for building on top of it. `/dashboard` is still template welcome content. No expense/income table, service, or UI exists yet.

## Desired End State

Signing in lands on `/dashboard`, now a day-view: today's entry form (amount + a searchable, recency-ordered category-chip picker) ready with zero date interaction, a month calendar for navigating any other day, and — the retention nudge the user specifically asked for — days with no logged expenses rendered in red between account creation and yesterday. Selecting a red day back-dates new entries to it and shows what's already logged there.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Screen architecture | Combined day view (calendar + form + day's list, one screen) | Fewest taps/screens from app-open; matches "day-contextualized entry" | Plan |
| Route placement | Replace `/dashboard`'s template content | Already the first post-signin screen — zero new taps to reach it | Plan |
| Entry data model | One `entries` table with a `type` discriminant, amount always positive | Roadmap frames S-03's income as "a sign flip" on the same concept — avoids a later migration/rewrite | Plan |
| Calendar implementation | Custom month grid, no new dependency | Full control over red-marking; no `date-fns`/`react-day-picker` needed | Plan |
| Missing-day range | Navigation unrestricted; red-marking bounded to `[account creation, yesterday]` | User chose unrestricted navigation; the floor/ceiling keep pre-signup months from rendering all-red | Plan |
| Missing-day computation | Dedicated per-month aggregate endpoint | Bounds the query to one indexed group-by, reusable by S-04 | Plan |
| Interaction-budget unit | Taps only, clock starts once the screen renders | Directly measurable; matches the NFR's own wording | Plan |
| Category picker | Recency-first chip grid with live text-filter | One tap to select; typing narrows the grid instead of requiring a scroll | Plan |
| Day detail | Read-only list beside the form | Confirms no double-logging; explains the calendar's red marking | Plan |
| Durability | Form survives a failed save only; no cross-refresh persistence | Covers the failure mode that matters without the offline machinery the PRD excludes | Plan |
| Post-save | Clear and stay, inline confirmation | Supports logging several expenses in one sitting, zero navigation | Plan |
| Zero categories | Block entry, link to `/categories` | Keeps category a hard invariant per FR-006; no synthetic bucket | Plan |

## Scope

**In scope:**
- `entries` table (RLS from creation), amount/category/date constraints, pgTAP suite
- Service layer + JSON API: create, list-by-day, month missing-days aggregate, recency-ordered categories
- Custom month calendar with red missing-day marking
- Entry form (amount + searchable category chips), read-only day list, zero-category block state
- `/dashboard` becomes this screen

**Out of scope:**
- Income entry (S-03) — the `type` column exists but only `'expense'` is ever written
- Edit/delete of logged entries (S-03) — the day list is read-only
- Date-range/category-distribution views (S-04/S-05)
- Any date-picker library — the calendar is hand-built
- Persisting unsaved (not-yet-submitted) form drafts across refresh/crash

## Architecture / Approach

Bottom-up: schema + RLS first, then a service layer (with an app-layer category-ownership re-check that the FK constraint alone can't provide, since Postgres FK checks bypass RLS on the referenced table) plus three API routes, then the calendar shell, then the form/list/edge-cases wired into `/dashboard`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema | `entries` table, RLS, pgTAP suite | Category-ownership isn't provable by pgTAP (FK bypasses RLS) — must be manually verified as an app-layer invariant |
| 2. Service + API | Create/list/month-aggregate/recency-categories routes | Missing the RLS-scoped ownership re-check before insert would silently allow cross-user category references |
| 3. Calendar UI | Month grid, missing-day red marking, date selection | First hand-built calendar in the repo — no existing pattern to copy |
| 4. Entry form + day detail | Amount/category form, day list, edge cases, `/dashboard` wiring | Hitting the ≤4-tap/≤10s budget in practice, not just in design |

**Prerequisites:** F-01 and S-01 complete (they are). Local Docker running for `supabase db reset`/`test db`.
**Estimated effort:** Single extended session, 4 phases — larger than S-01 due to the added calendar/day-browser surface.

## Open Risks & Assumptions

- Category ownership re-check is an app-layer-only invariant (like S-01's soft-delete) — pgTAP cannot prove it; a future change to `createEntry` could silently drop this check with no automated test catching it.
- The ≤4-interaction/≤10s NFR is treated as an acceptance criterion but is ultimately a human stopwatch judgment during manual verification, not an automated gate.
- No currency symbol is defined anywhere upstream (PRD excludes multi-currency); amounts render as plain 2-decimal numbers, which may look bare — revisit if user feedback wants a symbol.

## Success Criteria (Summary)

- A user can log a same-day expense in ≤4 taps and ≤10 seconds from a rendered `/dashboard`.
- Back-dating to any missed day is reachable through the calendar with no more friction than picking the day and filling the same form.
- Missing days between signup and yesterday are visibly marked, and clear once an entry is logged.
- No user can ever see or write against another user's entries or categories, proven by pgTAP for RLS and by manual verification for the category-ownership re-check.
