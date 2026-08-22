---
date: 2026-08-22T11:29:37+02:00
researcher: Krzysztof
git_commit: 30fbde3d762abff61b1c79f364397a86faa2c845
branch: master
repository: paper-trail
topic: "Isolation beyond the database — grounding rollout Phase 4 (risk #3)"
tags: [research, codebase, rls, ownership, cache-control, middleware, pgtap, route-tests]
status: complete
last_updated: 2026-08-22
last_updated_by: Krzysztof
---

# Research: Isolation beyond the database (rollout Phase 4, risk #3)

**Date**: 2026-08-22T11:29:37+02:00
**Researcher**: Krzysztof
**Git Commit**: `30fbde3d762abff61b1c79f364397a86faa2c845`
**Branch**: `master`
**Repository**: paper-trail

## Research Question

Ground rollout Phase 4 of `context/foundation/test-plan.md` — "Isolation beyond
the database" — against current code. Verify (not accept) the §2 Risk Response
Guidance for risk #3: prove a request authenticated as user A cannot read,
aggregate, or mutate any row owned by user B, including through an aggregation
path or a reference to B's category, and that no authenticated response is
edge-cacheable.

Three assumptions were named for challenge:

1. that "logged in" implies "owns this resource";
2. that RLS on base tables covers aggregate and RPC paths;
3. that a green pgTAP suite covers app-layer ownership filtering (it provably
   cannot).

## Summary

**The response guidance is directionally right but wrong about where the work
is.** Two of the three challenges resolve in the codebase's favour, and the
third is confirmed and sharper than the plan stated.

- **Challenge 2 — aggregate/RPC paths — resolves SAFE, and is already tested.**
  Both aggregate functions are explicitly `security invoker` with
  `set search_path = ''`, take no user-id parameter, contain no `auth.uid()`
  and no user predicate, and are `revoke`d from `public`/`anon`. Isolation is
  inherited wholly from the two tables' RLS. Both pgTAP summary suites already
  assert the cross-user negative _through the RPC_, including that none of A's
  category **names** reach B. **The planned "pgTAP extension" has almost no
  work left to do on this path** — §3's test-types list for Phase 4 overstates
  it.

- **Challenge 1 — "logged in" implies "owns this" — resolves SAFE at every
  endpoint, but is enforced one layer deep.** There is **not one
  `.eq("user_id", …)` anywhere in `src/`**. Ownership is 100% RLS-scoped;
  the application layer contributes only _existence checks on RLS-filtered
  result sets_, which is what turns "someone else's row" into a 404 instead of
  a silent success. That design is deliberate and documented
  (`src/lib/services/reports.ts:274-276`), and it means a single policy
  regression has **zero application-layer backstop**.

- **Challenge 3 — pgTAP cannot cover app-layer ownership — CONFIRMED, and it
  is the whole phase.** `entries.category_id` is a plain FK, and Postgres FK
  checks are **not subject to RLS on the referenced table**. A raw SQL insert
  by user A naming user B's `category_id` is **legal and succeeds** — `user_id`
  defaults to A's `auth.uid()` (satisfying `entries_insert_own`) while the FK
  only checks row existence. The only thing preventing it is application code,
  in **two independently-maintained copies**. `supabase/tests/entries_rls_test.sql:8-17`
  excludes this case in writing.

- **A fourth surface the guidance did not anticipate.** `/api/**` escapes
  `PROTECTED_ROUTES` **entirely**. Every JSON endpoint's `Cache-Control:
private, no-store` rests solely on the `|| context.locals.user` disjunct —
  never on its path. Nothing structural enforces the coupling, there is no
  `_headers` file and no platform-level cache config, so `src/middleware.ts:48-50`
  is the single mechanism in the codebase preventing edge-caching of an
  authenticated response.

**The cheapest useful layer for this phase is the JS route/service test, not
pgTAP** — and that is also the only layer with pull-request enforcement
(`db-test` is `master`-push-only). Every behaviour this phase would assert was
already proven **once, by hand, with `curl`, at ship time** across four archived
slices; none of it has a regression guard.

**Blocker removed:** `src/middleware.ts` is unit-testable **with zero config
change**. Verified empirically this session — see _Verified in this session_.
This corrects `test-plan.md` §6.1.

## Detailed Findings

### 1. The database layer — stronger than the plan assumed

Only two tables exist. Both enable RLS **in the creating migration**, both have
all four per-operation policies, all `to authenticated`, all keyed on
`(select auth.uid()) = user_id`, and neither has an `anon` policy (default-deny).

- `public.categories` — `supabase/migrations/20260815125827_create_categories_table.sql:17` (enable), `:27-46` (four policies)
- `public.entries` — `supabase/migrations/20260815164539_create_entries_table.sql:23` (enable), `:38-57` (four policies)

`user_id` is `not null default auth.uid() references auth.users (id) on delete cascade`
on both (`categories` `:8`, `entries` `:9`). **No `service_role` key exists
anywhere in the repo** (grepped repo-wide: zero hits), and the env schema
declares only `SUPABASE_URL` / `SUPABASE_KEY` / `CF_AI_TOKEN` / `CF_ACCOUNT_ID`
(`astro.config.mjs:36-49`). There is no code path that can bypass RLS.

#### The two aggregate functions — challenge 2, resolved

`entries_summary` is defined once (`20260816103000_add_entries_summary_function.sql:36-60`).
`entries_category_summary` is defined at `20260816150000` and **dropped and
recreated** by `20260818090000_add_category_icon.sql:104-147`, which is the
authoritative current definition. Both carry, verbatim:

```sql
language sql
stable
security invoker
set search_path = ''
```

Neither takes a user-id parameter — the signature is `(date, date, text, boolean)`
in both cases, so a caller has no channel to name another user's uuid. Neither
body contains `auth.uid()` or any user predicate. Grants in both:

```sql
revoke execute on function public.entries_… (date, date, text, boolean) from public, anon;
grant  execute on function public.entries_… (date, date, text, boolean) to authenticated;
```

The drop/recreate at `20260818090000` correctly re-issues the grants (`:144-147`)
— a dropped function takes its grants with it, so omitting that would have left
the function on Postgres's default `EXECUTE TO PUBLIC`. That trap was handled.

The design rationale is stated in the migration itself
(`20260816103000_add_entries_summary_function.sql:11-19`): a `security definer`
function would run as owner and force the `user_id = auth.uid()` predicate to be
re-established by hand inside the body.

**Verdict:** the RPC path is protected by RLS, and by nothing else — the same
single point of failure as the direct-table path, with no second hand-written
copy of the predicate to drift.

**Cross-agent correction.** One agent speculated that a cross-user entry would
diverge between the two boards — counted by `entries_summary`, dropped by
`entries_category_summary`. **That is wrong, and I checked the SQL directly.**
Both bodies use the _same inner join_, `join public.categories c on c.id = e.category_id`
(`20260816103000:53` and `20260818090000:132`). `entries_summary` needs it for
`is_recurring`. So the row drops from **both** boards identically. The archive's
original wording is the accurate one: the entry vanishes from `/reports` while
still appearing in the day list.

#### What the 6 pgTAP suites already prove

Cross-user negatives are **already substantial** — this is not a suite that only
checks "A sees A's own rows".

| File                                | plan(N) | Cross-user negative?                                    |
| ----------------------------------- | ------- | ------------------------------------------------------- |
| `categories_rls_test.sql`           | 19      | yes — select, insert-spoof, update, delete              |
| `entries_rls_test.sql`              | 20      | yes — select, insert-spoof, update, delete, plus `anon` |
| `entries_summary_test.sql`          | 23      | **yes — through the RPC**, 4 assertions                 |
| `entries_category_summary_test.sql` | 26      | **yes — through the RPC**, 3 assertions                 |
| `entries_description_test.sql`      | 6       | no — column shape only, deliberately                    |
| `entries_batch_key_test.sql`        | 10      | no — idempotency key only, deliberately                 |

The sharpest existing assertion is `entries_category_summary_test.sql:254-275`:

```sql
select is((select count(*) from public.entries_category_summary('2027-03-01','2027-03-31','day')
     where category_name like 'CatSum%A')::int, 0,
  'not one of user A''s categories reaches user B, though they share the date range');
```

`entries_rls_test.sql:145-163` handles the harder case — RLS _filters_ silently
rather than raising, so it captures `RETURNING` counts into a `rls_write_probe`
temp table to assert that B's UPDATE against A's row affects **zero** rows, with
`b_updates_own`/`b_deletes_own` = 1 as positive controls.

Two file-level facts worth carrying into the plan:

- **A documented Postgres segfault** blocks the obvious `anon`-denial test.
  `entries_summary_test.sql:216-249`: the local image (CLI `2.98.2`) **segfaults**
  when a function EXECUTE denial is raised inside a `set local role`-impersonated
  transaction — signal 11, every connection dropped, taking the rest of the suite
  with it. The suites therefore assert `has_function_privilege` against the
  catalog instead of making a real denied call. **Do not "improve" this into a
  real call.**
- **The RPC assertions are date-collision-fragile, not user-scoped.**
  `entries_summary_test.sql:24-27`: the post-`reset role` scoping trick used by
  `categories_rls_test.sql` is unavailable because the function takes no user
  filter, so fixtures were pushed to **2027 dates** to stay clear of hand-entered
  data. Any new fixture on this path must do the same.

#### The gap the database cannot close — challenge 3, confirmed

`supabase/migrations/20260815164539_create_entries_table.sql:10`:

```sql
category_id bigint not null references public.categories (id),
```

and the migration says so itself at `:31-36`:

> NOTE: category_id's FK constraint checks row existence only, not ownership —
> Postgres FK checks are not subject to RLS on the referenced table. A user could
> reference another user's category_id and the FK alone would accept it. This is
> re-checked in the service layer (`src/lib/services/entries.ts`) before insert;
> pgTAP cannot prove that app-layer check.

There is **no composite FK, no trigger, no constraint** closing this. The two
application-layer copies:

- `src/lib/services/entries.ts:154-181` — `assertCategoryUsable()`, an RLS-scoped
  `.select("id, kind").eq("id", categoryId)` whose `!data` branch throws
  `CategoryNotFoundError`. Called from `createEntry` (`:184`) and `updateEntry` (`:339`).
- `src/lib/services/entries.ts:241-263` — `createEntriesBatch()` re-implements it
  as a **set-cardinality** check: `.select("id, kind").in("id", requestedIds).is("deleted_at", null)`,
  then `if (usable.length < requestedIds.length) throw new CategoryNotFoundError()`.
  Absent / soft-deleted / someone else's are indistinguishable **on purpose** (`:255-257`).

The comment at `entries.ts:146-149` names the mechanism exactly: _"This select IS
RLS-scoped, so it is what actually stops an entry attaching to another user's
category."_

Two same-class invariants ride along, also app-layer-only: entry `type` ↔ category
`kind` (no schema tie), and the category `icon` enum (no CHECK constraint;
`src/lib/services/categories.ts:13-19` is the only guard). `categories.ts:38`
— `updateCategorySchema = createCategorySchema.omit({ kind: true })` — is the
single line making `kind` immutable.

The counter-example of doing it right is `20260817190000_add_entry_batch_key.sql:33-37`:
`user_id` is deliberately **in** the unique key so "one user's retry can never
collide with — or reveal the existence of — another user's batch."

### 2. The application layer — RLS-only, with 404 conversion

Every route builds its client identically via `createClient(context.request.headers, context.cookies)`
(`src/lib/supabase.ts:5-23`), using the **anon** key plus the caller's cookie, so
every PostgREST call runs as `authenticated` with `auth.uid()` = the caller.

**No route reads `locals.user`.** All 13 API handlers self-guard with
`supabase.auth.getUser()` — `getUser()`, not `getSession()`, so the JWT is verified
against the Auth server rather than merely decoded. This is deliberate and
documented at `src/middleware.ts:4-5`.

| Endpoint                                        | Identifier accepted                   | Enforcement                         | A requests B's id →                                                                                   |
| ----------------------------------------------- | ------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `PATCH /api/categories/[id]`                    | path `id`                             | RLS-only + existence check          | `PGRST116` → `NotFoundError` → **404** (`categories.ts:131-133`, `[id].ts:59-61`)                     |
| `DELETE /api/categories/[id]`                   | path `id`                             | RLS-only + existence check          | `data.length === 0` → **404** (`categories.ts:150-152`). Not a silent 204                             |
| `PATCH /api/entries/[id]`                       | path `id` **+ body `categoryId`**     | RLS-only ×3 + existence checks      | pre-read `null` → **404** (`entries.ts:335-337`); foreign `categoryId` → **404** `field:"categoryId"` |
| `DELETE /api/entries/[id]`                      | path `id`                             | RLS-only + existence check          | `data.length === 0` → **404** (`entries.ts:373-376`). Not a silent 204                                |
| `POST /api/entries`                             | body `categoryId`                     | RLS-only + `assertCategoryUsable`   | **404** `{"error":"Nie znaleziono kategorii","field":"categoryId"}` (`index.ts:67-71`)                |
| `POST /api/receipts/entries`                    | body `batchId` + `items[].categoryId` | RLS-only + set-cardinality          | **404**, whole batch rejected atomically (`receipts/entries.ts:47-51`)                                |
| `GET /api/entries/summary`, `/category-summary` | —                                     | RLS-only via `security invoker` RPC | n/a — no user parameter exists                                                                        |
| all list endpoints                              | —                                     | RLS-only                            | n/a                                                                                                   |

**There is no silent-success no-op anywhere.** Every write path that can affect
zero rows detects it — via `.single()`/`PGRST116`, via `.select("id")` +
`data.length === 0`, or via a `maybeSingle()` pre-read. The `.select(...)`
appended to every update/delete is precisely what makes zero-row detection
possible; removing it would turn these into silent 200/204s. **That is an
assertable property and a real regression target.**

**The 404 body is deliberately identical for "absent" and "not yours."**
`src/lib/services/entries.ts:90-93`: _"'Not found' has to stay ambiguous — saying
'that category is not yours' would confirm another user's id exists."_ Restated
at `src/pages/api/entries/index.ts:65-66`. Already asserted verbatim at
`src/pages/api/receipts/entries.test.ts:188-196` with the note that changing the
string _"is a security decision, not a copy edit."_

**Defense is one layer deep, by design.** `src/lib/services/reports.ts:274-276`:

```
 *   - No `user_id` filter: RLS supplies the predicate, and
 *     entries_user_id_occurred_on_idx (user_id, occurred_on) then covers the
 *     ordered limit-1 read. Don't reach for a security definer function here.
```

Confirmed by grep: the only `user_id` occurrences in `src/` are the `onConflict`
string (`entries.ts:287`) and comments. Also confirmed: **no `select("*")` in
`src/`** (every read names its columns), and **no user id is ever taken from
request input** — it arrives solely from the column default.

One contract oddity, not a cross-user issue: on the replay branch
`POST /api/receipts/entries` returns _all_ rows stored under that `batch_id`,
so a re-select yielding `[]` returns **201 with an empty array** — the only path
in the codebase where a write endpoint can return 2xx having written nothing.

### 3. Edge-cacheability — the surface the guidance under-specified

`src/middleware.ts:6`:

```ts
const PROTECTED_ROUTES = ["/dashboard", "/reports"];
```

Prefix-matched with bare `startsWith` and no boundary character (`:29`), so
`/dashboard-export` also matches — over-matching is fail-safe here. The header
condition (`:48-50`) is a **disjunction**:

```ts
if (isProtected || context.locals.user) {
  response.headers.set("Cache-Control", "private, no-store");
}
```

Working the prefix match against concrete paths: `"/api/entries/summary"`,
`"/api/categories/42"` and `"/api/receipts/parse"` all return `false` for both
array entries. **Every `/api/**`route escapes`PROTECTED_ROUTES`**, so its header
comes *only* from the second disjunct — from `locals.user`, never from its path.
That is deliberate (`src/middleware.ts:4-5`) and safe today because route and
middleware share one cookie-derived client. Nothing structural enforces it.

Supporting facts:

- The header is set **after** `next()` (`:45` then `:48`), mutating the same
  `Response` the route returned. Every API response is built as
  `new Response(body, { status })` with **no `headers` key at all** — a repo-wide
  grep for `Cache-Control` in `src/` returns only the middleware line and one
  prose comment. `.set()` (not `.append()`) means middleware always wins.
- **Latent hazard**: `headers.set()` throws on an immutable headers guard, which
  is what the _static_ `Response.redirect()` produces. There is no
  `Response.redirect` in `src/` today — all redirects use `context.redirect` /
  `Astro.redirect`, which yield mutable responses. A future route using the static
  form would make `:49` throw a 500 for signed-in users. Loud, not silent.
- **No platform-level cache config of any kind.** No `_headers` file exists
  anywhere; `wrangler.jsonc` and `astro.config.mjs` set no cache rules;
  `_routes.json` is build-generated and asset-ignored. `src/middleware.ts:48-50`
  is the only mechanism, and nothing would report its absence.
- **`prerender` audit clean** — zero hits in `src/`; all six pages are SSR under
  `output: "server"`.
- The concrete payload at stake: `src/components/Topbar.astro:35` renders
  `{user.email}` into the SSR body, and it is included by **both** protected pages.

**Gap found:** for an anonymous visitor, `GET /` returns an auth-dependent
`302 → /auth/signin` (`src/pages/index.astro:2-3`) with **no `Cache-Control`** —
neither disjunct fires. The comment at `:31-32` claims coverage of "the
auth-dependent redirect that gates one"; the anonymous half at `/` is not
covered. No body, no PII, so it is not a leak — but it is a cacheable
auth-varying response, and it contradicts a comment.

### 4. Verified in this session — the middleware is testable with no config change

`test-plan.md` §6.1 currently states that mocking a virtual module _"needs a
specifier Vitest can resolve, i.e. the alias-stub below anyway."_ **That is not
true**, and because it contradicts a documented finding I re-ran it myself rather
than take the agent's word (per `lessons.md`, second entry).

Probe: an isolated config (`include: ["probe-tmp/*.probe.ts"]`, alias `@` → `src`),
outside the real discovery glob, run and then removed; `git status` confirmed
clean afterwards. With

```ts
vi.mock("astro:middleware", () => ({ defineMiddleware: (fn: unknown) => fn }));
```

`await import("@/middleware")` **succeeds** — Vitest 4's mock registry intercepts
the specifier before Vite's resolver is consulted, so an unresolvable virtual id
is fine as long as a factory is supplied. `defineMiddleware` is a pure identity
helper at runtime; it only supplies types. Result: **4 tests passed in 303 ms**
on the default `node` environment, no jsdom.

The four cases, all green, driving the real `onRequest` with a hand-built context:

| Request                           | Observed                           |
| --------------------------------- | ---------------------------------- |
| `/api/entries/summary`, signed in | `Cache-Control: private, no-store` |
| `/api/entries/summary`, anonymous | **header absent**                  |
| `/dashboard`, anonymous           | `302` **and** `private, no-store`  |
| `/`, anonymous                    | `302`, **header absent**           |

The second row is the executable statement of the risk: it pins that coverage of
the entire `/api/**` surface rests on `locals.user`, and it goes red the moment
that disjunct is weakened.

### 5. The harness — what exists and what Phase 4 must add

`vitest.config.ts` (27 lines): glob `src/**/*.test.ts` only; alias `@` → `./src`
only; **no** `astro:*` alias; environment unset → `node`; **no setup files, no
globals, no coverage, no `resolve.dedupe`**. Current state: **11 files, 254 tests,
~580 ms**, green.

`src/lib/services/__fixtures__/supabase-fake.ts` (153 lines) is the only fixture.
`createSupabaseFake(responses: FakeResponse[]) → { client, calls }`; 13 chain
links (`from select in is eq order limit upsert insert update delete maybeSingle
single`) plus `then` plus terminal `rpc`. Responses are queued **in call order,
not keyed by table**; underflow throws naming the recorded call chain (`:109-113`).
`rpc` records _and resolves_, consuming at **call** time, so `Promise.all([rpc,rpc])`
takes two entries in array order.

**What Phase 4 must add** — all fixture work, not config work:

1. **No `auth` surface at all.** All three route tests hand-roll
   `auth: { getUser: () => Promise.resolve({ data: { user } }) }` identically
   (`receipts/entries.test.ts:90`, `summary.test.ts:78`, `category-summary.test.ts:53`).
   Note it is **partial on purpose** — real `getUser()` also returns `error`, which
   no route reads. Promoting this into the fixture, parameterised by identity, is
   the single most obvious shared-helper candidate.
2. **No `params` in the route-context helper.** Existing helpers build
   `{ request, cookies, url }`. But `src/pages/api/entries/[id].ts:21,75` and
   `src/pages/api/categories/[id].ts` read `context.params.id`. **Every
   A-requests-B's-id test against those two routes needs a shape no existing
   helper produces.** This is the concrete blocker.
3. **Missing builder methods**: `.gte` / `.lte` are used by
   `listEntryDaysForMonth` (`entries.ts:405-406`) and are absent from the fake —
   that route has no test today.
4. **A second identity constant.** All three files hardcode the same
   `SIGNED_IN = { id: "00000000-0000-4000-8000-000000000001" }`. Reusing the pgTAP
   seed uuids (`11111111-…` / `22222222-…`, `supabase/seed.sql`) would make the JS
   and pgTAP layers legible together.
5. **A `PGRST116` factory.** `FakeResponse.error` is `unknown`, so
   `{ code: "PGRST116" }` works, but there is no shaping helper and the string
   would be copy-pasted across the new suite.

What the fake **cannot** express, and should not be made to: RLS itself. It has
no caller identity and no row store, so "RLS returned zero rows for a foreign id"
is expressed by _queueing what PostgREST would have returned_. The honest claim a
route test can make is: **given a client that returns nothing for B's id, A gets
a 404 whose body does not confirm B's row exists.** Proving RLS remains pgTAP's job.

The reusable route-test pattern (identical across all three files) is: module-scope
mutable holder + `vi.mock("@/lib/supabase", …)` + `const { GET } = await import("./x")`
_after_ it, with `type RouteContext = Parameters<typeof GET>[0]` derived rather
than imported from Astro. Host convention `https://papertrail.test`.

### 6. Where new tests actually run

`.github/workflows/ci.yml`:

| Job                                        | PR to master                                    | Push to master               |
| ------------------------------------------ | ----------------------------------------------- | ---------------------------- |
| `ci` (lint → typecheck → **test** → build) | **runs**                                        | runs                         |
| `db-test` (pgTAP)                          | **skipped** (`if: github.event_name == 'push'`) | runs                         |
| `deploy`                                   | skipped                                         | runs, `needs: [ci, db-test]` |

**Planning consequence:** a new JS route test is picked up by the existing glob
and earns **pull-request enforcement immediately, with no workflow edit**. A new
pgTAP suite gets **zero** PR coverage — its only pre-merge proof is a developer
running `npm ci && npx supabase test db` locally. If the phase wants pgTAP on PRs
that is a workflow change, and `CLAUDE.md` warns `db-test` must **never** adopt the
deploy job's `supabase/setup-cli@v1` / `2.114.0` block.

This reinforces the layer recommendation: the route layer is both cheaper _and_
better-enforced for this risk.

## Code References

- `supabase/migrations/20260815125827_create_categories_table.sql:17,27-46` — RLS enable + four policies
- `supabase/migrations/20260815164539_create_entries_table.sql:10,23,31-36,38-57` — the FK, RLS enable, the ownership caveat, four policies
- `supabase/migrations/20260816103000_add_entries_summary_function.sql:36-60,65-66` — `security invoker`, grants
- `supabase/migrations/20260818090000_add_category_icon.sql:104-147` — authoritative `entries_category_summary`, grants re-issued
- `supabase/tests/entries_rls_test.sql:8-17,145-163` — the excluded FK case; the `rls_write_probe` idiom
- `supabase/tests/entries_summary_test.sql:24-27,193-221,216-249` — 2027-date rationale, RPC cross-user block, segfault disclaimer
- `supabase/tests/entries_category_summary_test.sql:254-275` — the strongest existing cross-user assertion
- `src/lib/services/entries.ts:90-93,142-153,154-181,241-263` — anti-enumeration rule; the ownership comment; both app-layer copies
- `src/lib/services/reports.ts:274-276` — the documented "no `user_id` filter" decision
- `src/lib/supabase.ts:5-23` — the only client factory, anon key + cookie
- `src/middleware.ts:1,4-6,29,45,48-50` — `astro:middleware` import; `PROTECTED_ROUTES`; prefix match; ordering; the header disjunction
- `src/pages/index.astro:2-3` — the uncovered anonymous redirect
- `src/components/Topbar.astro:35` — the PII payload on both protected pages
- `src/pages/api/entries/[id].ts:21,75`, `src/pages/api/categories/[id].ts` — `context.params.id`, the missing helper shape
- `src/lib/services/__fixtures__/supabase-fake.ts:63-84,99,109-113,146-149` — method list, signature, underflow error, terminal `rpc`
- `src/pages/api/receipts/entries.test.ts:23-29,82-85,188-196` — why the route is reachable; selective method carry; the security-string assertion
- `.github/workflows/ci.yml:32` — the `db-test` push-only guard

## Architecture Insights

- **Isolation here is a one-layer design, deliberately.** RLS is the sole
  predicate; the app layer only _observes_ its effect. This is defensible (it
  removes the drift risk of a duplicated predicate, and the index covers it) but
  it means the blast radius of one bad policy is total, and it raises the value of
  the pgTAP suite rather than lowering it.
- **The single exception is where the guarantee actually lives in TypeScript** —
  the cross-user FK reference. That inversion is the whole reason this phase
  exists: the one invariant RLS does _not_ supply is the one with two hand-written
  copies and no database backstop.
- **Two failure directions, not one.** The FK gap fails _closed_ on read (an
  entry under B's category disappears from both aggregates via the inner join)
  and _open_ on write (the row lands at all). The archive accepted the read half;
  the write half is what a test must catch.
- **Error-shape uniformity is a security property.** Absent and not-yours must
  stay indistinguishable. That makes "assert the 404 body" a real isolation
  assertion, not a copy test.
- **Cache-Control coverage is path-blind.** It follows the _user_, not the route.
  Correct today, but it means adding a route that serves user data through any
  auth path the cookie-derived client cannot see produces a cacheable response
  with nothing failing — the silent mode `CLAUDE.md` warns about.

## Historical Context (from prior changes)

The two accepted findings this phase inherits:

- **F10 — the aggregate silently drops entries filed under another user's
  category.** `context/archive/2026-08-16-date-range-spending-view/reviews/impl-review.md:161-169`:
  _"SKIPPED — accepted. The service-layer ownership check holds; revisit if that
  path ever changes."_ Carried and made worse on Board B
  (`context/archive/2026-08-16-category-distribution-view/plan.md:31` — "here it is
  a **missing slice**"), re-confirmed as shipped at that slice's
  `reviews/impl-review.md:261`, and explicitly routed to _this_ phase by
  `context/archive/2026-08-21-testing-reports-aggregation-truth/research.md:462-465`.
- **F5 — both cross-user invariants have zero database backstop.**
  `context/archive/2026-08-15-income-and-entry-management/reviews/impl-review.md:80-97`.
  Confirmed empirically at the time against the live local DB: a raw insert by B
  pointing at A's category with a kind mismatch is **accepted**. Recommended fix
  was a composite FK (`unique (id, user_id, kind)` + a three-column FK);
  **SKIPPED** — "the plan's app-layer-only decision stands as written and
  documented. The composite-FK option remains available to a later slice."

**Four archived slices each verified this behaviour once, by hand:**

- `context/archive/2026-08-15-custom-categories/plan.md:308` — "PATCH/DELETE on another user's id returns 404 — bc78f65"
- `context/archive/2026-08-15-daily-expense-entry/plan.md:377` — "Posting another user's categoryId returns 404 — 489453b"
- `context/archive/2026-08-15-income-and-entry-management/plan.md:374` — "PATCH /api/entries/<id> against another user's entry returns 404 — a20c35b"
- `context/archive/2026-08-16-receipt-parsing/plan.md:493` — "curl with another user's categoryId returns 404 and inserts nothing — 0412e51"

All four were `curl` checks at ship time. **None has a regression guard.** That is
the precise deliverable of this phase.

Also relevant: `context/archive/2026-08-16-date-range-spending-view/reviews/impl-review.md:151-159`
— **F9**, an authenticated user POSTing directly to `/rest/v1/rpc/entries_summary`
bypasses the bucket-count guard. SKIPPED, **explicitly no isolation impact**
("Only their own data is reachable"), and already restated inside the test code at
`src/lib/services/reports.test.ts:68-73`. Do not re-litigate it here.

The hinge that makes F5 and F10 newly testable is `context/foundation/lessons.md`,
first entry: app-layer-only invariants route to a JS test rather than
"manual forever" **since `testing-runner-bootstrap` (2026-08-21) a JS runner exists**.

## Corrections to backport into `test-plan.md`

Three, all response-guidance or cookbook — none adds a file anchor to §2.

1. **§2 Risk Response Guidance, risk #3, "Must challenge" row is partly
   resolved.** "That RLS on base tables covers aggregate and RPC paths" is
   **verified true** — both functions are `security invoker` with no user
   parameter, and both pgTAP summary suites already assert the cross-user negative
   through the RPC. The live challenge is narrower: _ownership of a **referenced**
   row is not an RLS question at all_, because FK checks are not subject to RLS.
2. **§2 "Likely cheapest layer" should invert its emphasis.** It reads "pgTAP
   extension for anything expressible in SQL; route-boundary integration for
   app-layer-only ownership." Grounded: the pgTAP half is nearly done, and the
   route half is both the real work **and** the only layer with PR enforcement.
3. **§6.1's virtual-module limit is wrong in one clause.** `vi.mock` on a
   **direct**, unresolvable `astro:*` import works with no config change —
   verified this session. §6.1 currently says such a mock "needs a specifier
   Vitest can resolve, i.e. the alias-stub anyway." That sentence should be
   corrected when §6.4 is written, since it is what would otherwise send the plan
   down an unnecessary `vitest.config.ts` change.

Additionally, §3's Phase 4 test-types cell ("pgTAP extension, route integration,
response-header assertion") is accurate in kind but misleading in weight — the
pgTAP extension is the smallest of the three, not the first.

## Open Questions

1. **Does the phase close F5 (the composite FK), or only test around it?** The
   recommended fix exists and was declined once. Adding
   `unique (id, user_id, kind)` on `categories` plus a three-column FK on `entries`
   would move the invariant from TypeScript into the schema and make it
   pgTAP-provable — but it is a migration, which brings risk #4's deploy-window
   concern into a testing phase. **Testing the existing behaviour is the in-scope
   reading of "Isolation beyond the database"; the migration is a product change.**
   Worth an explicit decision at plan time rather than a silent one.
2. **Is the anonymous `GET /` missing `Cache-Control` in scope?** It is a real
   (if benign) gap, a one-line middleware fix, and it contradicts the comment
   directly above it. Assert-and-leave, or fix?
3. **Does `listEntryDaysForMonth` get a test?** It is the one service with no
   coverage, and adding it requires `.gte`/`.lte` on the fake. In scope only if
   the phase wants the fake complete.
4. **Which uuids do the JS tests use?** Reusing the pgTAP seed uuids costs nothing
   and makes the two layers read together; keeping the existing
   `00000000-…-0001` literal keeps the three current route tests untouched.
5. **Should `db-test` widen to pull requests?** Out of this phase's scope per
   `test-plan.md` §5 (recorded as a cost decision, not a correctness one), but if
   any pgTAP is added here it lands with no PR gate — worth naming so it is not
   mistaken for coverage.
