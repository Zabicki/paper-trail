# Category Icons Replace Colors — Implementation Plan

## Overview

Roadmap slice **S-09** (`category-icons`, FR-004 / FR-014 / FR-018), plus a dashboard de-texting pass the user asked for alongside it.

Two outcomes under one change:

1. A category carries a **user-chosen icon** instead of a user-chosen color. The icon renders everywhere a category is named — entry picker, day list, category manager, receipt review, and the three Board-B chart surfaces. The reports charts stop reading a stored hex and derive their own fills from `categoryId`.
2. The dashboard's per-row **text actions become icon buttons** — `Edytuj` → a pen, `Usuń` → a trash can — and the `cykliczny` text pill becomes the `Repeat` glyph the picker already uses.

`categories.color` is **not dropped here.** CI applies migrations before `wrangler deploy`, so the drop trails this change by one deploy in a separate follow-up change (see [Migration Notes](#migration-notes)).

## Current State Analysis

**A category's visual marker today is a colored dot**, driven by a 12-hex palette the user picks from. That value is stored, validated at three layers, and read at eight render sites:

| Layer | Where |
| --- | --- |
| Schema | `supabase/migrations/20260815145611_add_category_fields.sql:10-16` — `color text not null default '#64748b'` + an unnamed CHECK pinning the 12 hexes |
| DB function | `supabase/migrations/20260816150000_add_entries_category_summary_function.sql:60,70,78,79` — `entries_category_summary` returns `category_color` |
| Types | `src/types.ts:1-18` (`CATEGORY_COLORS`, `CategoryColor`, `DEFAULT_CATEGORY_COLOR`), `:29` (`Category.color`), `:42` (`Entry.category` Pick), `:99` (`CategoryTotal.color`) |
| Services | `categories.ts:7,11,26,48,54,60,83,104`; `entries.ts:94,97,402,425,433`; `reports.ts:281,315` |
| Render — dots | `CategoriesManager.tsx:412-416` (`size-4`), `CategoryPicker.tsx:99-103` (`size-3`), `DayEntriesList.tsx:229-233` (`size-3`), `ReceiptReview.tsx:231-235` (`size-3`) |
| Render — charts | `CategoryDonut.tsx:122` (`size-2.5 rounded-[2px]`), `CategoryRanking.tsx:40,57` (`size-2.5 rounded-full` + bar), `CategoryTrendChart.tsx:154` (`size-2.5 rounded-[2px]`) |
| Editor | `CategoriesManager.tsx:92-131` — `ColorSwatchPicker`, a 12-button radiogroup |
| Demo data | `20260816120000_seed_demo_account.sql:65-76` (10 categories) and `20260816151000_extend_demo_categories.sql:43-79` (22 more), colors chosen to be **deliberately collision-heavy** |
| pgTAP | `categories_rls_test.sql:39-43` (default) and `:71-76` (CHECK), `plan(18)`; `entries_category_summary_test.sql:141-155` (passthrough + collision), `plan(25)` |

**`src/components/reports/distribution.ts` is the load-bearing consumer.** ~250 lines, of which roughly 200 exist *only* because 12 fixed hexes with no uniqueness rule guarantee collisions: `hexToRgb`/`rgbToHsl`/`hueToChannel`/`toHex`/`hslToHex` (`:57-121`), `shiftedFill` (`:150-176`), and the duplicate-count pre-pass that sizes each shift so the mapping stays injective (`:223-237`). All of it is downstream of *the user choosing the hex*.

**On the button side:** `button.tsx:22-27` has `size: "icon"` at `size-9` (36px) — below the 44px tap target enforced by `min-h-11` at `EntryForm.tsx:217,258`, `CategoryPicker.tsx:97`, `ReceiptReview.tsx:212` and others. `MonthCalendar.tsx:72-94` already uses `size="icon"` and already violates it. The base class at `button.tsx:8` auto-sizes SVG children to `size-4`, so an icon child needs no class of its own.

**Three constraints that shape the work:**

- `eslint.config.js:90` wires `jsx-a11y` through `eslintPluginAstro.configs["flat/jsx-a11y-recommended"]`, which targets `.astro` only. The `reactConfig` block (`:39-59`) does not include it. **A missing accessible name on a `.tsx` icon button will not fail `npm run lint`** — it is manual-verify-only.
- There is no test framework. Automated verification is `astro sync`, lint, build, `supabase db reset` and `npx supabase test db` only.
- Per `lessons.md`, run `npm ci` before any `npx supabase` command — an unpinned CLI strips the local database's grants and every pgTAP file fails with `permission denied` before a single assertion runs.

## Desired End State

A user opens the category dialog, picks an icon from a grouped, filterable grid, and that glyph then identifies the category in the entry picker, the day list, the receipt review rows, the manager list, and the reports ranking and tooltips. No color swatch appears anywhere in the UI. The reports charts still color their arcs, bars and swatches — but from a value the app derives, stable for a given category across every range and reload.

The day list and the category manager show a pen and a trash can instead of `Edytuj` and `Usuń`; a delete in flight spins its glyph rather than swapping to `Usuwanie…`.

Verified by: `npx supabase test db` green with the two extended suites; `npm run build` clean; and a manual browser pass at 375px covering the picker, the day list, the manager, receipt review and both report boards.

### Key Discoveries

- **`entries_category_summary` needs a drop + recreate, not an `alter`.** Postgres cannot alter a function's `returns table` shape in place. That is true both for *adding* `category_icon` here and for *removing* `category_color` in the follow-up — two recreates, one per deploy.
- **Distinctness only matters among visible slices.** `TOP_N = 8` (`distribution.ts:20`) means at most eight categories plus `Pozostałe` are ever on screen, however many the user has defined. The old machinery guaranteed injectivity across the *entire* list; that was necessary only because expanding `Pozostałe` must not recolor an on-screen arc.
- **`src/types.ts` must stay lucide-free.** It is imported by services and API routes; pulling the icon-component map in there would drag ~100 React components into every server bundle. Names live in `types.ts`, components in a UI-side catalogue.
- **The `leading` slot already exists** at `CategoryRanking.tsx:29,106-112` — built to inject a chevron for the `Pozostałe` row, and exactly the right seam for a category icon.
- **`radix-ui@^1.6.7` already ships `react-tooltip`**, but no tooltip is being added — `aria-label` is the chosen pattern, matching `MonthCalendar.tsx:76` and `PasswordToggle.tsx:14`.
- **The demo seeds exist to exercise `distribution.ts`.** Their headers (`20260816151000:10-24`) say so explicitly. Once color derivation moves to `categoryId`, the colors in those `VALUES` lists stop meaning anything — but they must stay until the follow-up change drops the column, because the column is still `not null`.

## What We're NOT Doing

- **Not dropping `categories.color`**, its CHECK constraint, the `CATEGORY_COLORS` palette export, or `category_color` from the DB function. All of that is the follow-up change `category-color-drop`.
- **Not removing** `categories_rls_test.sql:71-76` (the palette CHECK assertion) — the constraint still exists this deploy.
- **Not touching the demo seed migrations' color values** — the column is still `not null` with no default change.
- Not rendering glyphs on the donut arcs themselves (only in its tooltip).
- Not converting `MonthCalendar.tsx:72-94`'s `‹`/`›` text glyphs to lucide chevrons.
- Not adding a tooltip primitive, and not replacing `window.confirm` with an inline confirm.
- Not adding a test framework, and not adding a DB CHECK on `icon`.
- Not changing `entries_summary` (it never returned color).
- Not S-10 (`entry-descriptions-and-receipt-grouping`).

## Implementation Approach

Three phases, ordered so the independent piece ships first and the riskiest piece ships last.

**Phase 1 is standalone** — it touches no schema, no types and no service, so it can land, deploy and be judged on its own.

**Phase 2 is the spine**: one migration, the type and service changes it implies, the icon catalogue, the picker, and every dashboard render site. It is deliberately not split further, because a half-migrated state (schema has `icon`, UI still shows dots) has no user-visible value and no independent verification worth pausing on.

**Phase 3 is reports-only** and is where the algorithmic change lives, isolated so a problem there cannot destabilise the dashboard.

Throughout: the icon carries *identity*, the color carries *arc linkage*. In the charts the two coexist — the ranking row and both tooltips render the icon tinted with the slice's derived fill, so the glyph says which category and the tint says which arc.

## Critical Implementation Details

**Deploy ordering.** `.github/workflows/ci.yml` runs `supabase db push` between the build and `wrangler deploy`, so between those two steps the **previous** Worker runs against the **new** schema. Everything this change's migration does must therefore be backward-compatible with the currently-deployed Worker: `icon` is added, `category_icon` is added to the function's return, and nothing is removed. The old Worker keeps selecting `color` and reading `category_color`, both of which still exist. This is what makes the follow-up change necessary rather than optional.

**Chart color derivation must not depend on rank.** Today a category's chart color is stable because it is stored. Deriving it from position in the descending-total list would recolor the donut whenever the range or the recurring toggle changes. Deriving it from `categoryId`, and resolving any collision by walking the list sorted by `categoryId` ascending rather than by total, keeps the mapping invariant to both.

**The lightness-band precondition survives, in reduced form.** `distribution.ts:48-55` documents that every palette hex must sit strictly inside `[0.22, 0.84]` with room on both sides. Shade tiers still rely on that, so the comment must be carried forward rather than deleted with the rest of the collision machinery.

**Icon-only delete loses its in-flight signal.** `deletingId === entry.id` currently drives a label swap to `Usuwanie…` (`DayEntriesList.tsx:266`, `CategoriesManager.tsx:445`). With no label there is nothing to swap, so the same condition must drive a spinning glyph plus `aria-busy` — otherwise a slow delete looks like a dead button.

---

## Phase 1: Icon-only row actions

### Overview

Strip the text off the dashboard's per-row actions. No schema, no types, no services — purely presentational, and independently shippable.

### Changes Required:

#### 1. A touch-sized icon button

**File**: `src/components/ui/button.tsx`

**Intent**: The existing `size="icon"` is 36px, below the 44px target the rest of the codebase enforces. Add a second token so the rule is expressible rather than patched per call site, and leave `icon` alone so `MonthCalendar`'s arrows are unaffected.

**Contract**: `buttonVariants` `size` gains `"icon-touch": "size-11"` alongside the existing `icon: "size-9"` (`:22-27`). No change to the base class string — `[&_svg:not([class*='size-'])]:size-4` at `:8` already sizes the glyph child.

#### 2. Day-list row actions

**File**: `src/components/entries/DayEntriesList.tsx`

**Intent**: Replace the `Edytuj` / `Usuń` text buttons with a pen and a trash can, preserving both the `disabled={saving}` guard on edit (an intentional fix recorded in the S-03 impl review) and the in-flight delete signal.

**Contract**: The two `<Button>`s at `:243-267` keep their `variant` (`outline` / `destructive`), their handlers and their `disabled` conditions; `size` becomes `"icon-touch"`, the text child becomes `<Pencil />` / `<Trash2 />`, and each gains `aria-label="Edytuj"` / `aria-label="Usuń"`. While `deletingId === entry.id` the trash child becomes `<Loader2 className="animate-spin" />` and the button gains `aria-busy={true}`. New import from `lucide-react`: `Pencil`, `Trash2`, `Loader2`.

#### 3. Category manager row actions

**File**: `src/components/categories/CategoriesManager.tsx`

**Intent**: Same conversion at `:424-446`. Note this pair lacks the `disabled={saving}` guard its `DayEntriesList` twin has — that asymmetry is pre-existing and stays out of scope; do not "fix" it here.

**Contract**: Identical shape to change 2. The wrapping `<div className="flex gap-2">` gains `items-center` to match the day list.

#### 4. Recurring marker consistency

**File**: `src/components/categories/CategoriesManager.tsx`

**Intent**: The same fact reads as a word here and as a glyph in the picker. Swap the text pill for the glyph, keeping the fact announced to screen readers.

**Contract**: The `cykliczny` badge at `:418-422` becomes `<Repeat className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />`, matching `CategoryPicker.tsx:104` byte-for-byte in class and opacity. The row's category name span gains an accessible suffix in the same shape the picker uses at `CategoryPicker.tsx:78` — `aria-label={category.isRecurring ? \`${category.name}, duży koszt cykliczny\` : undefined}`.

#### 5. Receipt review row delete

**File**: `src/components/receipts/ReceiptReview.tsx`

**Intent**: This is the third per-row `Usuń` on the same page; leaving it as text would make it the only one. It is also currently `variant="outline"` while the other two are `destructive` — unify that while converting.

**Contract**: The `<Button>` at `:240-250` becomes `variant="destructive" size="icon-touch"` with a `<Trash2 />` child and `aria-label="Usuń pozycję"`. `disabled={submitting}` is unchanged. This row has no per-row in-flight state, so no spinner.

### Success Criteria:

#### Automated Verification:

- Type checking and lint pass: `npm run lint`
- Production build succeeds: `npm run build`
- No text action labels remain in the three converted files: `grep -nE '>(Edytuj|Usuń)<' src/components/entries/DayEntriesList.tsx src/components/categories/CategoriesManager.tsx src/components/receipts/ReceiptReview.tsx` returns nothing
- The `cykliczny` string is gone: `grep -rn 'cykliczny<' src/` returns nothing

#### Manual Verification:

- Every converted button is at least 44×44px at 375px width, and rows do not wrap or overflow
- Each icon button announces its Polish name in VoiceOver / the accessibility inspector — **lint cannot catch a missing `aria-label` on `.tsx`, so this check is the only guard**
- Deleting an entry shows a spinning glyph, not a dead-looking button; the `window.confirm` still appears and cancelling still aborts
- Editing an entry while another row is mid-save is still blocked (the `disabled={saving}` guard survived)
- A recurring category shows the `Repeat` glyph in the manager list and reads as "duży koszt cykliczny"

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Icons end to end

### Overview

Add the `icon` column and carry it through schema, function, types, services, the editor and every dashboard render site. The color dot disappears from the UI; the column stays in the database.

### Changes Required:

#### 1. Migration — column, backfill, function

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_add_category_icon.sql`

**Intent**: Add the icon column with a neutral default, backfill known Polish category names as a one-shot convenience, and recreate `entries_category_summary` so the reports path can read the icon. Nothing is removed — this must be safe for the currently-deployed Worker.

**Contract**: Three statements.

`alter table public.categories add column icon text not null default 'tag';` — no CHECK constraint by decision; the allowed set is `z.enum` in the service layer. Record in the migration header that this makes the allowed-value invariant app-layer-only and therefore **not pgTAP-provable**, per `lessons.md`.

A single `update` mapping lowercased names to lucide kebab-case names, covering the 32 demo categories plus a dozen common ones, everything else left at `'tag'`. Write it as a `from (values …) as m(name, icon)` join on `lower(c.name) = m.name`, not a chain of `case` branches. The mapping is a one-shot convenience keyed on Polish names — say so in a header comment so no one later mistakes it for a maintained feature:

```
jedzenie→utensils, restauracje→utensils-crossed, kawa→coffee, transport→car,
paliwo→fuel, parking→parking-circle, rata samochodu→car-front, dom→sofa,
czynsz→house, naprawy→wrench, chemia domowa→droplet, rośliny→flower-2,
abonamenty→credit-card, elektronika→smartphone, poczta→mail, rozrywka→party-popper,
kino→clapperboard, hobby→puzzle, sport→dumbbell, książki→book-open, prasa→newspaper,
papiernicze→pencil, zdrowie→heart-pulse, apteka→pill, fryzjer→scissors,
kosmetyki→sparkles, ubrania→shirt, zwierzęta→paw-print, prezenty→gift,
darowizny→heart, wynagrodzenie→banknote, freelance→briefcase
```
plus `zakupy→shopping-cart, rachunki→receipt-text, podróże→plane, edukacja→graduation-cap, internet→wifi, telefon→phone, prąd→zap, woda→droplet, gaz→flame, ubezpieczenie→shield-check, oszczędności→piggy-bank, inwestycje→trending-up`.

`drop function public.entries_category_summary(date, date, text, boolean);` then recreate it verbatim from `20260816150000_add_entries_category_summary_function.sql` with `category_icon text` added to the `returns table` list, `c.icon as category_icon` in the select, and `c.icon` added to **both** non-empty grouping sets (`:78`, `:79`) — omitting it from either produces a silent aggregate error. Keep `category_color` in place. Re-issue the same `grant execute` statements as `:87-88`; a dropped function takes its grants with it.

#### 2. Icon names as shared data

**File**: `src/types.ts`

**Intent**: Give the services and the zod schema a validated name list, without importing any lucide component — this module is reachable from server code.

**Contract**: `CATEGORY_ICON_NAMES` as an `as const` tuple of ~100 kebab-case lucide names; `export type CategoryIconName = (typeof CATEGORY_ICON_NAMES)[number]`; `export const DEFAULT_CATEGORY_ICON: CategoryIconName = "tag"`. `Category.color` (`:29`) becomes `icon: CategoryIconName`; the `Entry.category` Pick (`:42`) becomes `"id" | "name" | "icon"`; `CategoryTotal.color` (`:99`) becomes `icon: CategoryIconName`. `CATEGORY_COLORS` / `CategoryColor` / `DEFAULT_CATEGORY_COLOR` **stay exported** — `reports.ts` still needs the palette for derivation, and the follow-up change owns their removal. Add a comment saying this file must never import from `lucide-react`.

#### 3. Category service

**File**: `src/lib/services/categories.ts`

**Intent**: Validate, persist and return the icon in place of the color. Because `updateCategorySchema` is `createCategorySchema.omit({ kind: true })` (`:26`), swapping the field once covers both create and update.

**Contract**: `:7` `categoryColorValues` becomes `categoryIconValues` derived from `CATEGORY_ICON_NAMES`; `:11` the schema's `color` field becomes `icon: z.enum(categoryIconValues).default(DEFAULT_CATEGORY_ICON)`; `CategoryRow` (`:48`) and `SELECT_COLUMNS` (`:54`) swap `color` for `icon`; `toDto` (`:60`), the insert (`:83`) and the update (`:104`) follow. Note the insert no longer writes `color`, which is fine — the column keeps its `'#64748b'` default.

#### 4. Entries service

**File**: `src/lib/services/entries.ts`

**Intent**: Carry the icon on the embedded category snapshot and on the entry-form category list.

**Contract**: `EntryRow.category` (`:94`) and the embedded select at `:97` (`category:categories(id, name, icon)`); `listCategoriesForEntryForm`'s select at `:402`, its row type at `:425` and its map at `:433`.

#### 5. Reports service

**File**: `src/lib/services/reports.ts`

**Intent**: Read the new `category_icon` column off the RPC. Color is no longer read from the row at all — Phase 3 derives it — but the boundary type keeps `category_color` for now so the shape still matches what the function returns.

**Contract**: `CategorySummaryRow` (`:281`) gains `category_icon: CategoryIconName | null`; the mapping at `:315` replaces the color line with `icon: row.category_icon ?? DEFAULT_CATEGORY_ICON`. Leave `category_color` in the row type, unread, with a comment pointing at the follow-up change. The sort at `:334` is unchanged.

#### 6. Icon catalogue and renderer

**File**: `src/components/categories/icon-catalogue.ts`

**Intent**: The UI-side half of the icon set — the lucide component map, the group structure and the Polish keywords that make the filter usable for a Polish-speaking user searching English icon names. Co-located with the feature, following the `distribution.ts` / `date-utils.ts` precedent.

**Contract**: Exports `ICON_COMPONENTS: Record<CategoryIconName, LucideIcon>` (named imports only — a dynamic import defeats tree-shaking) and `ICON_GROUPS: { label: string; icons: { name: CategoryIconName; keywords: string[] }[] }[]` over eight groups: `Jedzenie i napoje`, `Transport`, `Dom i rachunki`, `Zdrowie i uroda`, `Rozrywka i czas wolny`, `Zakupy i usługi`, `Finanse i praca`, `Inne`. Every name in `CATEGORY_ICON_NAMES` must appear in exactly one group — add a module-level assertion or an exhaustive `Record` type so a name added to `types.ts` without a group fails type-check rather than silently vanishing from the picker.

**File**: `src/components/categories/CategoryIcon.tsx`

**Intent**: One place that turns a stored name into a glyph, so an unknown or stale name degrades to the fallback instead of crashing a render.

**Contract**: `({ name, className }: { name: string; className?: string })` → looks up `ICON_COMPONENTS`, falls back to the `tag` component when the name is not in the map, renders with `aria-hidden="true"` and the caller's className.

#### 7. The picker replaces the swatch picker

**File**: `src/components/categories/CategoriesManager.tsx`

**Intent**: Swap the 12-button color radiogroup for a grouped, filterable icon grid, and show the icon instead of the dot in the list rows.

**Contract**: `ColorSwatchPicker` (`:92-131`) is replaced by an `IconPicker` keeping the same `role="radiogroup"` shape and per-option `aria-label` (the Polish group label plus the icon's first keyword), with `aria-label="Ikona kategorii"` on the group. A filter `<input>` above the grid matches case- and diacritic-insensitively against each icon's keywords; when the filter is non-empty the group headings collapse to a single flat result grid. Buttons are `size-11` to hold the tap target. Form state (`:12`, `:19`), `startEdit` (`:203`) and the PATCH body (`:226`) swap `color` for `icon`; the two render sites (`:319-324`, `:375-380`) swap the component and their label reads `Ikona`. The list row (`:412-416`) replaces the `size-4 rounded-full` dot with `<CategoryIcon name={category.icon} className="size-4 shrink-0" />`.

#### 8. Entry-side render sites

**Files**: `src/components/entries/CategoryPicker.tsx`, `src/components/entries/DayEntriesList.tsx`, `src/components/receipts/ReceiptReview.tsx`

**Intent**: Replace each colored dot with the category's glyph at the same footprint.

**Contract**: `CategoryPicker.tsx:99-103` → `<CategoryIcon name={category.icon} className="size-4 shrink-0" />` (the dot was `size-3`; a glyph needs `size-4` to read, and the chip is `min-h-11` so it absorbs the extra 4px). `DayEntriesList.tsx:229-233` and `ReceiptReview.tsx:231-235` take the same substitution. In all three the icon keeps `aria-hidden` via `CategoryIcon`, so the existing `aria-label` composition at `CategoryPicker.tsx:78` is untouched.

#### 9. pgTAP

**Files**: `supabase/tests/categories_rls_test.sql`, `supabase/tests/entries_category_summary_test.sql`

**Intent**: Prove the column default and the function's new passthrough. Note what cannot be proven: with no CHECK on `icon`, the allowed-name set is enforced only by `z.enum` in `categories.ts`, so it is manual-verify-only — call that out in the test file header, per `lessons.md`.

**Contract**: `categories_rls_test.sql` → `plan(19)`, one `is()` asserting `icon` defaults to `'tag'` when unspecified, placed beside the existing color-default assertion at `:39-43`. The palette CHECK assertion at `:71-76` is **left alone**. `entries_category_summary_test.sql` → `plan(26)`, one `is()` asserting a known fixture category reports its own `category_icon`, mirroring the soft-delete colour assertion at `:141-147`; give the fixture inserts at `:44-49` explicit `icon` values so the assertion has something non-default to check.

### Success Criteria:

#### Automated Verification:

- Dependencies installed with the pinned CLI first: `npm ci`
- Types regenerated: `npx astro sync`
- Migrations apply from scratch: `npx supabase db reset`
- pgTAP suite green, including the two extended files: `npx supabase test db`
- Lint and build pass: `npm run lint && npm run build`
- Every category has an icon after backfill — in Studio, `select count(*) from categories where icon = 'tag'` is well below the row count for the demo user
- `src/types.ts` imports nothing from lucide: `grep -n 'lucide' src/types.ts` returns nothing
- No color dot survives on the dashboard surfaces: `grep -rn 'backgroundColor: category.color\|backgroundColor: entry.category.color' src/components/` returns nothing

#### Manual Verification:

- Creating a category opens the icon grid, the Polish filter finds icons by Polish word (e.g. "jedzenie", "auto", "dom"), and the chosen glyph appears immediately in the picker chip
- Editing a category's icon updates it in the day list without a reload — the S-07 `categoriesRefreshKey` path still works
- The demo account's 32 categories show sensible backfilled glyphs, not 32 tags
- Receipt review rows show glyphs, and filing an item still works end to end
- Category creation from the entry-form dialog still auto-selects and closes (S-07 behaviour intact), and logging a routine expense is still ≤4 interactions
- Soft-delete still removes the category from the list and frees its name — an app-layer-only invariant pgTAP cannot reach

**Implementation Note**: Pause here for manual confirmation before proceeding.

---

## Phase 3: Derived chart colors and icons in reports

### Overview

`distribution.ts` stops consuming a stored hex and derives fills from `categoryId`. The ranking rows and both chart tooltips gain the category glyph, tinted with the derived fill.

### Changes Required:

#### 1. Derive the fill

**File**: `src/components/reports/distribution.ts`

**Intent**: Replace the user-hex-plus-collision-shift model with a deterministic derivation from `categoryId`. This deletes the reason the module's colour math existed: the duplicate-count pre-pass, the per-direction band fitting, and the injectivity argument that `shiftedFill`'s comment block defends.

**Contract**: A category's base hex is `CATEGORY_COLORS[categoryId % 12].value` and its shade tier is `floor(categoryId / 12) % 3` — tier 0 the hex itself, tier 1 one `LIGHTNESS_STEP` lighter, tier 2 one step darker. Three tiers is what the band supports for every palette entry: the tightest headroom measured in the existing comment at `:48-53` is 0.1773 above (`#8b5cf6`) and 0.1800 below (`#14b8a6`), both greater than `LIGHTNESS_STEP = 0.13`. **Carry that precondition comment forward** — it still binds.

That yields 36 distinct values. Because ids are global rather than per-user, two of a user's categories can still collide (ids 36 apart), so keep a de-collision pass — but walk the full category list **sorted by `categoryId` ascending**, not by total, bumping a duplicate to the next unused tier. Sorting by id is what makes the resolution invariant to range and to the recurring toggle; sorting by total would recolour the donut whenever the user switches range.

`hexToRgb` / `rgbToHsl` / `hueToChannel` / `toHex` / `hslToHex` (`:57-121`) are retained — the tier shift still needs them. `shiftedFill` (`:150-176`) collapses to a fixed-step `tierFill(hex, tier)`. `DistributionSlice` (`:178-184`) now extends a `CategoryTotal` carrying `icon` rather than `color`; it keeps `fill`. `POZOSTALE_FILL`, `TOP_N`, `MIN_SHARE`, `colorFor` and `formatCollapsedLabel` are unchanged. Rewrite the module's header comment: the "12 fixed hexes with no per-user uniqueness constraint" rationale at `:35-42` is no longer why duplicates happen.

#### 2. Ranking rows

**File**: `src/components/reports/CategoryRanking.tsx`

**Intent**: Show the glyph as the row's identity marker while keeping the tint that links it to its donut arc.

**Contract**: The `size-2.5 rounded-full` dot at `:40` becomes `<CategoryIcon name={icon} className="size-4 shrink-0" style={{ color: fill }} />` — `color`, not `backgroundColor`, so the glyph's strokes take the tint. `RankingRow` gains an `icon` prop; the `Pozostałe` row (`:102`) passes a neutral `more-horizontal` glyph tinted `POZOSTALE_FILL`. The proportional bar at `:57` still uses `backgroundColor: fill` and is unchanged. The `leading` slot (`:29`) keeps carrying the expand chevron — glyph and chevron coexist on the `Pozostałe` row.

#### 3. Chart tooltips

**Files**: `src/components/reports/CategoryDonut.tsx`, `src/components/reports/CategoryTrendChart.tsx`

**Intent**: Same substitution in the two tooltips, which today render a `size-2.5 rounded-[2px]` square.

**Contract**: `CategoryDonut.tsx:122` and `CategoryTrendChart.tsx:154` become a tinted `CategoryIcon` at `size-4`. The donut's `DonutDatum` (`:26-39`) gains `icon` alongside `fill`; the trend chart resolves its icon by series key the same way `fillForSeries` (`:99-101`) resolves fill, falling back to the neutral glyph for the collapsed series. The `<Pie>` arcs and the `<Bar>` fills are unchanged — no glyphs on the arcs themselves.

### Success Criteria:

#### Automated Verification:

- Lint and build pass: `npm run lint && npm run build`
- No stored colour is read on the reports path: `grep -n 'category.color\|row.category_color' src/components/reports/ src/lib/services/reports.ts` returns only the unread boundary-type field in `reports.ts`
- The duplicate-count pre-pass is gone: `grep -n 'duplicateCounts' src/components/reports/distribution.ts` returns nothing

#### Manual Verification:

- On the demo account's 30+ categories, the donut's eight visible slices are all visually distinct, and expanding `Pozostałe` does not recolour any slice already on screen
- **Switching range (last week → YTD → Cały okres) and toggling the recurring filter leaves every category's colour unchanged** — this is the property the stored hex used to guarantee and the one most likely to regress
- The ranking rows, the donut tooltip and the trend tooltip all show the same glyph and the same tint for a given category
- `Pozostałe` still reads as distinct from a real category at its position, in both light and dark mode
- Board B renders correctly at 375px — the glyph is 4px larger than the swatch it replaced

**Implementation Note**: Pause here for manual confirmation. This is the last phase; on success, open the follow-up change (see Migration Notes) before closing this one out.

---

## Testing Strategy

There is no JS test framework, so the automated layer is `astro sync` + lint + build + pgTAP, and everything behavioural is manual.

### Database (pgTAP):

- `icon` defaults to `'tag'` — `categories_rls_test.sql`
- `entries_category_summary` returns `category_icon` faithfully, including for a soft-deleted category — `entries_category_summary_test.sql`
- **Not provable**: that a stored icon name is one of the ~100 allowed. No CHECK exists by decision; `z.enum` in `categories.ts` is the only guard. Per `lessons.md` this is a permanent manual re-verification requirement for any future change to that schema.
- **Not provable**: soft-delete visibility and `kind` immutability — pre-existing, unchanged, still manual.

### Manual testing steps:

1. `npm ci`, then `npx supabase start -x vector`, `npx supabase db reset`, `npx supabase test db`. Read the dev-server port out of the banner rather than assuming 4321.
2. Sign in as the demo user. Confirm the 32 categories show backfilled glyphs.
3. Create a category, filter the icon grid by a Polish word, pick a glyph, save. Confirm it appears in the picker chip, the day list after logging an entry, and the manager row.
4. Edit that category's icon; confirm every surface updates without a reload.
5. Log an expense and count interactions — still ≤4.
6. Delete an entry and a category; confirm the spinner, the `window.confirm`, and that the category's name becomes reusable.
7. Upload a receipt, confirm glyphs in the review rows, file the items.
8. Open Board B. Step through every range and both recurring-toggle states, confirming no category changes colour. Expand and collapse `Pozostałe`.
9. Repeat steps 3–8 at 375px and in dark mode.
10. Tab through the day list and the manager; confirm every icon button announces a Polish name.

## Performance Considerations

The icon catalogue is ~100 named lucide imports in a client island. Each lucide icon is a small SVG component; the set should add on the order of tens of KB before compression, and named imports keep it tree-shaken to exactly what the catalogue references. Verify the actual delta in `npm run build` output against the pre-change baseline; if it is materially worse than expected, the group structure already provides a natural seam to trim the set rather than to switch loading strategy.

`distribution.ts` gets cheaper: the duplicate-count pre-pass over the full category list disappears, leaving one derivation per category plus a single de-collision walk.

## Migration Notes

**This change is the first half of a two-deploy sequence.** It only adds. `categories.color`, its CHECK constraint, `CATEGORY_COLORS` / `CategoryColor` / `DEFAULT_CATEGORY_COLOR`, `category_color` on the DB function, and the two pgTAP colour assertions all survive this deploy, because between `supabase db push` and `wrangler deploy` the previous Worker is still selecting them.

**After this change is deployed and verified**, open `category-color-drop` (`/10x-new category-color-drop`) to:

- drop `category_color` from `entries_category_summary` (another drop + recreate) and the unread field from `CategorySummaryRow`;
- `alter table public.categories drop column color` — the CHECK constraint goes with it;
- remove `CATEGORY_COLORS`, `CategoryColor` and `DEFAULT_CATEGORY_COLOR` from `src/types.ts`, replacing them with a chart-only palette inside `distribution.ts`, which is by then their only consumer;
- delete `categories_rls_test.sql:39-43` and `:71-76` and drop `plan(19)` to `plan(17)`; delete the two colour assertions in `entries_category_summary_test.sql`;
- drop the `color` column from both demo-seed migrations' insert lists and rewrite their headers, which currently explain a collision-heavy palette that no longer drives anything.

Rollback for *this* change is a plain Worker rollback — the schema additions are inert to the old code.

## References

- Roadmap slice S-09: `context/foundation/roadmap.md:193-206`
- FR-018: `context/foundation/prd.md:91-92`
- Change identity and the user's framing: `context/changes/category-icons/change.md`
- Prior slice that moved the category editor into the dashboard: `context/archive/2026-08-17-dashboard-category-management/plan-brief.md`
- Prior slice that built the distribution model: `context/archive/2026-08-16-category-distribution-view/plan-brief.md`
- Chart colour doctrine (now partly superseded): `context/foundation/charts_recommendations.md:59`
- App-layer-only invariants rule: `context/foundation/lessons.md:5-13`
- Pinned-CLI rule: `context/foundation/lessons.md:15-23`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Icon-only row actions

#### Automated

- [x] 1.1 Type checking and lint pass: `npm run lint` — 7d26b0c
- [x] 1.2 Production build succeeds: `npm run build` — 7d26b0c
- [x] 1.3 No text action labels remain in the three converted files — 7d26b0c
- [x] 1.4 The `cykliczny` string is gone — 7d26b0c

#### Manual

- [x] 1.5 Every converted button is at least 44×44px at 375px width — 7d26b0c
- [x] 1.6 Each icon button announces its Polish name (lint cannot catch this) — 7d26b0c
- [x] 1.7 Deleting an entry shows a spinning glyph; `window.confirm` still guards — 7d26b0c
- [x] 1.8 Editing while another row is mid-save is still blocked — 7d26b0c
- [x] 1.9 A recurring category shows the `Repeat` glyph and reads correctly — 7d26b0c

### Phase 2: Icons end to end

#### Automated

- [x] 2.1 Dependencies installed with the pinned CLI first: `npm ci` — 3eb225d
- [x] 2.2 Types regenerated: `npx astro sync` — 3eb225d
- [x] 2.3 Migrations apply from scratch: `npx supabase db reset` — 3eb225d
- [x] 2.4 pgTAP suite green: `npx supabase test db` — 3eb225d
- [x] 2.5 Lint and build pass: `npm run lint && npm run build` — 3eb225d
- [x] 2.6 Backfill populated icons for the demo categories — 3eb225d
- [x] 2.7 `src/types.ts` imports nothing from lucide — 3eb225d
- [x] 2.8 No color dot survives on the dashboard surfaces — 3eb225d

#### Manual

- [x] 2.9 Icon grid opens, the Polish filter works, the glyph appears in the chip — 3eb225d
- [x] 2.10 Editing an icon updates the day list without a reload — 3eb225d
- [x] 2.11 The demo account's 32 categories show sensible backfilled glyphs — 3eb225d
- [x] 2.12 Receipt review rows show glyphs and filing still works — 3eb225d
- [x] 2.13 Dialog auto-select survives; logging is still ≤4 interactions — 3eb225d
- [x] 2.14 Soft-delete still removes the category and frees its name — 3eb225d

### Phase 3: Derived chart colors and icons in reports

#### Automated

- [x] 3.1 Lint and build pass: `npm run lint && npm run build`
- [x] 3.2 No stored colour is read on the reports path
- [x] 3.3 The duplicate-count pre-pass is gone

#### Manual

- [x] 3.4 Eight visible slices are distinct; expanding `Pozostałe` recolours nothing
- [x] 3.5 Switching range and toggling recurring leaves every colour unchanged
- [x] 3.6 Ranking, donut tooltip and trend tooltip agree on glyph and tint
- [x] 3.7 `Pozostałe` reads as distinct in light and dark mode
- [x] 3.8 Board B renders correctly at 375px
